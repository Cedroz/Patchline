// FixAgent implementations. All three edit files inside one worktree; the scope check afterwards is
// done by the fix stage with git (never trusted to the agent). Droid is the primary; Claude and Mock
// sit behind the same interface as fallbacks.
import type { FixAgent, FixRequest, FixResult, LLM } from '@patchline/core';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { z } from 'zod/v4';

const norm = (p: string) => path.resolve(p).toLowerCase();

function prompt(req: FixRequest): string {
  return `You are fixing one bug in a small TypeScript browser game. ${req.instructions}

Bug: ${req.bugTitle}

The failing repro test is ${req.failingTestPath}. Do not edit it or any other test file.
You may only edit these files: ${req.allowlist.join(', ')}.
Run the repro with: node node_modules/vitest/vitest.mjs run ${req.failingTestPath}
Run it before and after your edit, and keep editing until it passes.
Allowed commands: that vitest command and read-only git (git status, git diff, git log, git show), one command at a time, from this directory.
Any other command, or an edit to any other file, is refused and ends your run. Reading files needs no permission.

Failing test:
\`\`\`ts
${req.failingTestCode}
\`\`\`

The commit that introduced the bug (found by git bisect):
\`\`\`diff
${req.culpritDiff}
\`\`\`

First state a short plan, then make the edit, then summarize what you changed in one sentence.`;
}

// ---------------------------------------------------------------- Droid

/** Commands Droid may run: the repro/suite via vitest, and read-only git. Anything chained (&&, ;, |) is refused. */
const ALLOWED_COMMAND = /^(node\s+node_modules[\\/]vitest[\\/]vitest\.mjs\s+run\b|npx vitest\b|pnpm (exec )?vitest\b|git (status|diff|log|show)\b)[^;&|`$<>]*$/;

/** Is `p` the directory itself or inside it (not a sibling that merely shares the prefix)? */
export function insideDir(p: string, dir: string): boolean {
  const a = norm(p);
  const d = norm(dir);
  return a === d || a.startsWith(d + path.sep);
}

/** May Droid run this command in `worktree`? `git -C <dir> ...` counts when <dir> is the worktree. */
export function commandAllowed(command: string, worktree: string): boolean {
  const c = command.trim();
  if (/\s--output\b/.test(c)) return false; // `git diff/log --output=<file>` writes a file: not read-only
  const m = /^git\s+-C\s+(?:"([^"]+)"|(\S+))\s+(.+)$/.exec(c);
  if (m) return insideDir(m[1] ?? m[2], worktree) && ALLOWED_COMMAND.test(`git ${m[3]}`);
  return ALLOWED_COMMAND.test(c);
}

// Trace lines for the dashboard: what each tool call did, and test outcomes pulled out of command output,
// so the edit -> run repro -> edit loop is visible (`[test] FAIL ...` then `[test] PASS ...`).
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function describeToolCall(name: string, input: unknown, worktree: string): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const rel = (p: string) => (insideDir(p, worktree) ? path.relative(worktree, p) || '.' : p);
  const command = [i.command, i.fullCommand, i.cmd].find((v) => typeof v === 'string') as string | undefined;
  if (command) return `[run] ${short(command.trim())}`;
  if (/todo/i.test(name)) return '[plan] updated its to-do list';
  // A patch names its files inside the patch text ("*** Update File: src/x.ts").
  const patched = /\*\*\* (?:Update|Add) File: ([^\n"\\]+)/.exec(JSON.stringify(i))?.[1];
  const file = patched ?? ([i.file_path, i.filePath, i.path, i.target_file].find((v) => typeof v === 'string') as string | undefined);
  const verb = /edit|write|patch|create/i.test(name) ? 'edit' : /read|view|open|cat/i.test(name) ? 'read' : /grep|search|glob|find|ls/i.test(name) ? 'search' : 'tool';
  if (file) return `[${verb}] ${rel(file)}`;
  const query = [i.pattern, i.query].find((v) => typeof v === 'string') as string | undefined;
  return query ? `[${verb}] ${name}: ${short(query, 80)}` : `[${verb}] ${name}`;
}

export function describeToolResult(toolName: string, content: unknown, isError: boolean): string {
  const text = (typeof content === 'string' ? content : JSON.stringify(content ?? '')).replace(ANSI, '');
  // Vitest summary, e.g. "Tests  1 failed | 2 passed (3)" or "Tests  3 passed (3)".
  const tests = /^\s*Tests\s+(.+)$/m.exec(text)?.[1]?.trim();
  if (tests) return `[test] ${/failed/.test(tests) ? 'FAIL' : 'PASS'} · ${short(tests, 80)}`;
  const first = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return `[result] ${toolName} ${isError ? 'error' : 'ok'}${isError && first ? ` · ${short(first, 100)}` : ''}`;
}

/** The SDK spawns `droid` without a shell. On Windows the npm `droid` is a .cmd shim, which that can't run, so use
 *  DROID_EXEC_PATH or the native droid.exe the CLI package ships (found through the CLI's own platform.js). */
function droidExecPath(): string | undefined {
  if (process.env.DROID_EXEC_PATH) return process.env.DROID_EXEC_PATH;
  if (process.platform !== 'win32') return undefined;
  try {
    const root = execFileSync('npm', ['root', '-g'], { shell: true, encoding: 'utf8' }).trim();
    const platform = createRequire(import.meta.url)(path.join(root, '@factory', 'cli', 'platform.js')) as { getBinaryPathWithInfo(): { path: string } | null };
    return platform.getBinaryPathWithInfo()?.path;
  } catch {
    return undefined;
  }
}

export class DroidFixAgent implements FixAgent {
  readonly name = 'droid';
  private execPath?: string;
  constructor(private apiKey: string) {}

  async fix(req: FixRequest): Promise<FixResult> {
    // Imported lazily so the orchestrator boots without the droid CLI installed.
    const sdk = await import('@factory/droid-sdk/node');
    const { createSession, AutonomyLevel, ToolConfirmationOutcome, ToolConfirmationType, DroidMessageType } = sdk;
    const allowed = new Set(req.allowlist.map((f) => norm(path.join(req.worktree, f))));

    const session = await createSession({
      cwd: req.worktree,
      apiKey: this.apiKey,
      execPath: (this.execPath ??= droidExecPath() ?? ''),
      autonomyLevel: AutonomyLevel.Off, // every action goes through our permission handler
      permissionHandler({ toolUses, options }) {
        // Least privilege, enforced in code: edits only to allowlisted files; commands only vitest or read-only git.
        // A Script batches several tool calls; each inner call is held to the same rules.
        type Conf = { type: string; filePath?: string; command?: string; fullCommand?: string; calls?: { confirmation?: Conf }[] };
        const cmd = (d: Conf) => (d.fullCommand || d.command || '').trim(); // command is just the program; fullCommand has the args
        const check = (d: Conf): boolean => {
          if (d.type === ToolConfirmationType.Script) return (d.calls ?? []).every((c) => !c.confirmation || check(c.confirmation));
          if (d.type === ToolConfirmationType.Edit || d.type === ToolConfirmationType.Create || d.type === ToolConfirmationType.ApplyPatch) {
            return !!d.filePath && allowed.has(norm(path.isAbsolute(d.filePath) ? d.filePath : path.join(req.worktree, d.filePath)));
          }
          if (d.type === ToolConfirmationType.Execute) return commandAllowed(cmd(d), req.worktree);
          return false;
        };
        const ok = toolUses.every((u) => check(u.details as Conf));
        const want = ok ? ToolConfirmationOutcome.ProceedOnce : ToolConfirmationOutcome.Cancel;
        const describe = (d: Conf): string =>
          d.type === ToolConfirmationType.Script ? `script[${(d.calls ?? []).map((c) => (c.confirmation ? describe(c.confirmation) : 'read')).join('; ')}]` : `${d.type} ${d.filePath ?? cmd(d)}`.trim();
        const verdict = toolUses.map((u) => describe(u.details as Conf)).join(', ');
        req.onStep(`[permission] ${ok ? 'allow' : 'DENY'}: ${verdict}`);
        return options.some((o) => o.value === want) ? want : ToolConfirmationOutcome.Cancel;
      },
    });

    let text = '';
    try {
      for await (const msg of session.stream(prompt(req))) {
        switch (msg.type) {
          case DroidMessageType.Assistant:
            text += msg.text;
            req.onStep(msg.text.trim());
            break;
          case DroidMessageType.ToolCall:
            req.onStep(describeToolCall(msg.name, msg.input, req.worktree));
            break;
          case DroidMessageType.ToolResult:
            req.onStep(describeToolResult(msg.toolName, msg.content, msg.isError));
            break;
          case DroidMessageType.Error:
            req.onStep(`[error] ${msg.message}`);
            break;
          case DroidMessageType.Result:
            if (!msg.success) throw new Error(msg.error?.message ?? `Droid turn ended: ${msg.subtype}`);
            break;
        }
      }
    } finally {
      await session.close();
    }
    const plan = text.split('\n').slice(0, 8).join('\n');
    return { plan, summary: text.split('\n').filter(Boolean).pop() ?? '', agent: 'droid' };
  }
}

// ---------------------------------------------------------------- Claude fallback

const ClaudePatch = z.object({
  plan: z.string(),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  summary: z.string(),
});

export class ClaudeFixAgent implements FixAgent {
  readonly name = 'claude';
  constructor(private llm: LLM) {}

  async fix(req: FixRequest): Promise<FixResult> {
    const current = req.allowlist.map((f) => ({ path: f, content: fs.readFileSync(path.join(req.worktree, f), 'utf8') }));
    req.onStep(`Reading ${req.allowlist.join(', ')}`);
    const out = await this.llm.json({
      task: 'fix.patch',
      system: 'You are a careful game programmer. Return the full new contents of each file you change. Only change allowlisted files.',
      user: `${prompt(req)}\n\nCurrent file contents:\n${current.map((f) => `--- ${f.path}\n${f.content}`).join('\n')}`,
      input: { req: { ...req, onStep: undefined }, current },
      schema: ClaudePatch,
    });
    req.onStep(out.plan);
    for (const f of out.files) {
      // Writes outside the allowlist are dropped here and would also be caught by the scope check.
      if (!req.allowlist.includes(f.path)) {
        req.onStep(`[blocked] attempted write to ${f.path}`);
        continue;
      }
      fs.writeFileSync(path.join(req.worktree, f.path), f.content);
      req.onStep(`[edit] ${f.path}`);
    }
    return { plan: out.plan, summary: out.summary, agent: 'claude' };
  }
}

// ---------------------------------------------------------------- Mock

/** Canned patches for the planted bugs. "smallest" deliberately includes a plausible-but-wrong fix for score. */
const CANNED: Record<string, Record<FixRequest['strategy'], { file: string; find: string; replace: string; plan: string }>> = {
  score: {
    smallest: {
      file: 'src/scoring.ts',
      find: '  scoreCell[0] = score + points;',
      replace: '  scoreCell[0] = Math.min(255, score + points); // never wrap',
      plan: 'The repro fails because the byte cell wraps. Clamp the value at 255 so it can never wrap back to a small number.',
    },
    root_cause: {
      file: 'src/scoring.ts',
      find: '// Keep the score in a single byte cell so leaderboard payloads stay compact.\nconst scoreCell = new Uint8Array(1);\n\nexport function addScore(score: number, points: number): number {\n  scoreCell[0] = score + points;\n  return scoreCell[0];\n}',
      replace: 'export function addScore(score: number, points: number): number {\n  return score + points;\n}',
      plan: 'The culprit commit stored the score in a Uint8Array, which wraps at 256. Remove the byte cell and keep the score as a plain number.',
    },
  },
  pause: {
    smallest: {
      file: 'src/sim.ts',
      find: '    p.vy = -(JUMP_VELOCITY * DT) / dt; // scale impulse by the frame step',
      replace: '    p.vy = dt > 0 ? -(JUMP_VELOCITY * DT) / dt : -JUMP_VELOCITY; // scale impulse by the frame step',
      plan: 'dt is 0 while paused, so the division produces Infinity. Guard the division when dt is 0.',
    },
    root_cause: {
      file: 'src/sim.ts',
      find: '    p.vy = -(JUMP_VELOCITY * DT) / dt; // scale impulse by the frame step',
      replace: '    p.vy = -JUMP_VELOCITY;',
      plan: 'The jump impulse is already a velocity applied once; scaling it by dt is wrong and divides by zero while paused. Restore the constant impulse.',
    },
  },
};

export class MockFixAgent implements FixAgent {
  readonly name = 'mock';

  async fix(req: FixRequest): Promise<FixResult> {
    const key = /score/i.test(req.bugTitle) ? 'score' : /paus|freez/i.test(req.bugTitle) ? 'pause' : '';
    const patch = key ? CANNED[key][req.strategy] : undefined;
    const steps = ['Reading the failing test', `Reading culprit diff (${req.allowlist.join(', ')})`];
    for (const s of steps) {
      req.onStep(s);
      await new Promise((r) => setTimeout(r, 400));
    }
    const file = patch && path.join(req.worktree, patch.file);
    if (patch && file && fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(patch.find)) {
      req.onStep(`Plan: ${patch.plan}`);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(patch.find, patch.replace));
      req.onStep(`[edit] ${patch.file}`);
      return { plan: patch.plan, summary: `Edited ${patch.file}`, agent: 'mock' };
    }
    // Unknown bug: revert the culprit's hunks on the allowlisted files (a real, deterministic strategy).
    req.onStep('Plan: no canned patch; reverse-apply the culprit diff to the allowlisted files.');
    await new Promise<void>((resolve, reject) => {
      const child = execFile('git', ['apply', '-R', '--3way', '-'], { cwd: req.worktree }, (err) => (err ? reject(err) : resolve()));
      child.stdin!.end(req.culpritDiff);
    });
    return { plan: 'Revert the culprit change.', summary: 'Reverted culprit hunks', agent: 'mock' };
  }
}
