// Fix stage: a tournament of fix-agent runs (Droid by default), each on its own branch + worktree,
// each followed by a scope check done with git (files touched must be in the culprit allowlist, no tests).
import type { Cluster, Culprit, FixCandidate } from '@patchline/core';
import { countDiffLines } from '../game/repo';
import { id } from '../ids';
import type { AgentCtx } from './context';

export const STRATEGIES = [
  { strategy: 'smallest' as const, instructions: 'Make the smallest change that makes the failing test pass.' },
  { strategy: 'root_cause' as const, instructions: 'Fix the root cause introduced by the culprit commit, keeping the intent of unrelated changes.' },
];

const isTestFile = (f: string) => /(^|\/)(test|tests|__tests__|__repro__)\//.test(f) || /\.(test|spec)\.[tj]sx?$/.test(f);

export function scopeCheck(files: string[], allowlist: string[]): { ok: boolean; reason?: string } {
  if (!files.length) return { ok: false, reason: 'no changes' };
  const tests = files.filter(isTestFile);
  if (tests.length) return { ok: false, reason: `edited test files: ${tests.join(', ')}` };
  const outside = files.filter((f) => !allowlist.includes(f));
  if (outside.length) return { ok: false, reason: `touched files outside the allowlist: ${outside.join(', ')}` };
  return { ok: true };
}

export interface CandidateRun {
  candidate: FixCandidate;
  worktree: string;
}

export async function runFixTournament(
  ctx: AgentCtx<'fix'>,
  cluster: Cluster,
  culprit: Culprit,
  repro: { testCode: string; testPath: string },
  opts: { count: number; agentName: string; timeoutMs: number },
): Promise<CandidateRun[]> {
  const { tools, store } = ctx;
  const base = await tools.repo_read.head('main');
  const allowlist = culprit.files.filter((f) => !isTestFile(f));

  const one = async (n: number): Promise<CandidateRun> => {
    const s = STRATEGIES[(n - 1) % STRATEGIES.length];
    const branch = `fix/${cluster.id}/${n}`;
    const candidate: FixCandidate = {
      id: id('cand'),
      cluster_id: cluster.id,
      n,
      strategy: s.strategy,
      agent: opts.agentName,
      branch,
      plan: '',
      log: '',
      diff: '',
      files_touched: [],
      scope_ok: false,
      diff_lines: 0,
      status: 'running',
    };
    store.upsert('fix_candidate', candidate);
    const run = ctx.audit.start('fix', { clusterId: cluster.id, lane: `candidate ${n}`, summary: `${opts.agentName}: ${s.instructions}` });
    const logLines: string[] = [];
    const onStep = (line: string) => {
      if (!line) return;
      logLines.push(line);
      store.update('fix_candidate', candidate.id, { log: logLines.join('\n') });
      run.progress(line.slice(0, 160));
    };

    const wt = await tools.sandbox_branch(`fix-${cluster.id}-${n}`, base, branch);
    try {
      const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`fix agent timed out after ${opts.timeoutMs / 1000}s`)), opts.timeoutMs));
      const result = await Promise.race([
        tools.fix_agent({
          clusterId: cluster.id,
          n,
          strategy: s.strategy,
          instructions: s.instructions,
          worktree: wt,
          allowlist,
          failingTestPath: repro.testPath,
          failingTestCode: repro.testCode,
          culpritDiff: culprit.diff,
          bugTitle: cluster.title,
          onStep,
        }),
        timer,
      ]);
      run.log('fix_agent.run', { strategy: s.strategy, allowlist, branch }, { plan: result.plan, summary: result.summary }, result.plan, true);
      await tools.sandbox_commit(wt, `Fix: ${cluster.title} (${s.strategy})\n\nPatchline candidate ${n} by ${result.agent}. Culprit: ${culprit.sha.slice(0, 7)}`);
      const { diff, files } = await tools.sandbox_diff(wt, base);
      const scope = scopeCheck(files, allowlist);
      const patch: Partial<FixCandidate> = {
        plan: result.plan,
        diff,
        files_touched: files,
        diff_lines: countDiffLines(diff),
        scope_ok: scope.ok,
        scope_reason: scope.reason,
        status: scope.ok ? 'running' : 'rejected', // the verifier sets the final status
      };
      const updated = store.update('fix_candidate', candidate.id, patch);
      run.log('scope.check', { files, allowlist }, scope, scope.ok ? 'All edits inside culprit files, no tests touched' : `Rejected: ${scope.reason}`);
      run.finish(scope.ok ? 'passed' : 'rejected', scope.ok ? `diff ${updated.diff_lines} lines in ${files.join(', ')}` : `rejected: ${scope.reason}`);
      return { candidate: updated, worktree: wt };
    } catch (e) {
      const msg = (e as Error).message;
      const updated = store.update('fix_candidate', candidate.id, { status: 'failed', scope_reason: msg.slice(0, 300) });
      run.finish('failed', msg.slice(0, 300));
      return { candidate: updated, worktree: wt };
    }
  };

  return Promise.all(Array.from({ length: opts.count }, (_, i) => one(i + 1)));
}
