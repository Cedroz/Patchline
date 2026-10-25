// Deterministic git + test harness over the demo game repo. No LLM in here.
// Worktrees live under .sandbox/; vitest always runs from the main clone's node_modules
// with --root pointed at the worktree, so worktrees never need their own installs.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import PQueue from 'p-queue';

export interface FileResult {
  file: string; // repo-relative, forward slashes
  status: 'passed' | 'failed';
  message: string; // failure text (assertion messages, import errors)
  tests: { title: string; status: string; failure: string }[];
}

export interface VitestRun {
  ok: boolean;
  timedOut: boolean;
  files: FileResult[];
  stdout: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  diff: string;
  files: string[];
}

function exec(cmd: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr), timedOut: !!e?.killed });
    });
  });
}

const slash = (p: string) => p.replace(/\\/g, '/');

export class GameRepo {
  /** Serializes operations that touch the shared .git dir (worktree add/remove, merge). */
  private gitLock = new PQueue({ concurrency: 1 });

  constructor(
    public readonly dir: string,
    private readonly sandbox: string,
    /** Clone whose node_modules + vite config run the tests (defaults to dir). */
    private readonly toolsDir = dir,
  ) {}

  get vitestBin() {
    return path.join(this.toolsDir, 'node_modules', 'vitest', 'vitest.mjs');
  }

  get viteConfig() {
    return path.join(this.toolsDir, 'vite.config.ts');
  }

  async git(args: string[], cwd = this.dir, timeoutMs?: number): Promise<string> {
    const r = await exec('git', args, cwd, timeoutMs);
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
    return r.stdout.trim();
  }

  async tryGit(args: string[], cwd = this.dir) {
    return exec('git', args, cwd);
  }

  async check(): Promise<string | null> {
    if (!fs.existsSync(path.join(this.dir, '.git'))) return `game repo not found at ${this.dir} (run pnpm make-history)`;
    if (!fs.existsSync(this.vitestBin)) return `game repo has no node_modules (run pnpm install in ${this.dir})`;
    return null;
  }

  head(ref = 'HEAD') {
    return this.git(['rev-parse', ref]);
  }

  /** Oldest commit on main: the default known-good for bisect. */
  async oldestGood(): Promise<string> {
    const roots = await this.git(['rev-list', '--max-parents=0', 'HEAD']);
    return roots.split('\n')[0];
  }

  async commitInfo(sha: string): Promise<CommitInfo> {
    const meta = await this.git(['show', '-s', '--format=%H%n%an <%ae>%n%s', sha]);
    const [full, author, message] = meta.split('\n');
    const files = (await this.git(['show', '--name-only', '--format=', sha])).split('\n').filter(Boolean);
    const diff = await this.git(['show', '--format=', '--patch', sha]);
    return { sha: full, author, message, diff, files };
  }

  async log(n = 30): Promise<{ sha: string; message: string }[]> {
    const out = await this.git(['log', `-${n}`, '--format=%H %s']);
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => ({ sha: l.slice(0, 40), message: l.slice(41) }));
  }

  /** Create (or recreate) a worktree under .sandbox at `ref`. With `branch`, creates/resets that branch. */
  worktree(name: string, ref: string, branch?: string): Promise<string> {
    return this.gitLock.add(async () => {
      const wt = path.join(this.sandbox, name);
      await this.removeWorktreeUnlocked(wt);
      fs.mkdirSync(this.sandbox, { recursive: true });
      const args = branch ? ['worktree', 'add', '-f', '-B', branch, wt, ref] : ['worktree', 'add', '-f', '--detach', wt, ref];
      await this.git(args);
      return wt;
    }) as Promise<string>;
  }

  removeWorktree(wt: string) {
    return this.gitLock.add(() => this.removeWorktreeUnlocked(wt));
  }

  private async removeWorktreeUnlocked(wt: string) {
    if (fs.existsSync(wt)) await this.tryGit(['worktree', 'remove', '--force', wt]);
    await this.tryGit(['worktree', 'prune']);
  }

  /** Write a file inside a worktree (used for untracked __repro__ tests). */
  writeFile(wt: string, rel: string, content: string) {
    const p = path.join(wt, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }

  /** Run vitest headless. `files` are repo-relative filters; empty = whole suite (test/ + __repro__/). */
  async vitest(wt: string, files: string[] = [], timeoutMs = 60_000): Promise<VitestRun> {
    fs.mkdirSync(this.sandbox, { recursive: true });
    const out = path.join(this.sandbox, `vitest-${path.basename(wt)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    const args = [this.vitestBin, 'run', '--root', wt, '--config', this.viteConfig, '--reporter=json', `--outputFile=${out}`, ...files];
    const r = await exec(process.execPath, args, wt, timeoutMs);
    let files_: FileResult[] = [];
    if (fs.existsSync(out)) {
      const json = JSON.parse(fs.readFileSync(out, 'utf8')) as {
        testResults: { name: string; status: string; message: string; assertionResults: { title: string; status: string; failureMessages: string[] }[] }[];
      };
      files_ = json.testResults.map((t) => ({
        file: slash(path.relative(wt, t.name)),
        status: t.status === 'passed' ? 'passed' : 'failed',
        message: [t.message, ...t.assertionResults.flatMap((a) => a.failureMessages)].filter(Boolean).join('\n'),
        tests: t.assertionResults.map((a) => ({ title: a.title, status: a.status, failure: a.failureMessages.join('\n') })),
      }));
    }
    fs.rmSync(out, { force: true });
    return { ok: r.code === 0 && files_.length > 0, timedOut: r.timedOut, files: files_, stdout: (r.stdout + r.stderr).slice(-8000) };
  }

  async commitAll(wt: string, message: string): Promise<string | null> {
    await this.git(['add', '-A'], wt); // __repro__/ and node_modules/ are gitignored in the game repo
    const staged = await this.tryGit(['diff', '--cached', '--quiet'], wt);
    if (staged.code === 0) return null; // nothing to commit
    await this.git(['-c', 'user.name=Patchline', '-c', 'user.email=bot@patchline.dev', 'commit', '-q', '-m', message], wt);
    return this.git(['rev-parse', 'HEAD'], wt);
  }

  async diffAgainst(wt: string, base: string): Promise<{ diff: string; files: string[] }> {
    const diff = await this.git(['diff', `${base}...HEAD`], wt);
    const files = (await this.git(['diff', '--name-only', `${base}...HEAD`], wt)).split('\n').filter(Boolean);
    return { diff, files };
  }

  /** Merge a branch into main in the primary clone. Fails if the primary clone is dirty. */
  merge(branch: string, message: string): Promise<string> {
    return this.gitLock.add(async () => {
      const dirty = await this.git(['status', '--porcelain', '--untracked-files=no']);
      if (dirty) throw new Error(`game repo has uncommitted changes; refusing to merge:\n${dirty}`);
      const cur = await this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
      if (cur !== 'main') await this.git(['checkout', '-q', 'main']);
      await this.git(['-c', 'user.name=Patchline', '-c', 'user.email=bot@patchline.dev', 'merge', '--no-ff', '-q', '-m', message, branch]);
      return this.git(['rev-parse', 'HEAD']);
    }) as Promise<string>;
  }

  /** Undo a Patchline merge on main with a new revert commit (history is kept, nothing is force-pushed). */
  revert(mergeSha: string, message: string): Promise<string> {
    return this.gitLock.add(async () => {
      const dirty = await this.git(['status', '--porcelain', '--untracked-files=no']);
      if (dirty) throw new Error(`game repo has uncommitted changes; refusing to revert:
${dirty}`);
      const cur = await this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
      if (cur !== 'main') await this.git(['checkout', '-q', 'main']);
      const parents = (await this.git(['rev-list', '--parents', '-n', '1', mergeSha])).split(' ').length - 1;
      const r = await this.tryGit(['revert', '--no-commit', ...(parents > 1 ? ['-m', '1'] : []), mergeSha]);
      if (r.code !== 0) {
        await this.tryGit(['revert', '--abort']);
        throw new Error(`git revert failed (later commits may touch the same lines): ${(r.stderr || r.stdout).slice(0, 500)}`);
      }
      await this.git(['-c', 'user.name=Patchline', '-c', 'user.email=bot@patchline.dev', 'commit', '-q', '-m', message]);
      return this.git(['rev-parse', 'HEAD']);
    }) as Promise<string>;
  }

  async push(): Promise<string> {
    const r = await this.tryGit(['push', 'origin', 'main']);
    if (r.code !== 0) throw new Error(r.stderr || r.stdout);
    return r.stderr || r.stdout;
  }
}

export function countDiffLines(diff: string): number {
  return diff.split('\n').filter((l) => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---')).length;
}
