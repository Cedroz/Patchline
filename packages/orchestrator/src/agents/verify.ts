// Verifier: deterministic gates + ranking. Gates: repro passes, full suite passes. Rank: breaker tests
// passed (high first), then diff size (small first).
import type { BreakerTest, Cluster, FixCandidate } from '@patchline/core';
import { REPRO_DIR } from '../game/templates';
import type { CandidateRun } from './fix';
import type { AgentCtx } from './context';

export function score(c: Pick<FixCandidate, 'repro_pass' | 'suite_pass' | 'breaker_pass_count' | 'diff_lines'>): number {
  if (!c.repro_pass || !c.suite_pass) return 0;
  return 1000 + (c.breaker_pass_count ?? 0) * 100 - Math.min(99, c.diff_lines);
}

export async function runVerify(ctx: AgentCtx<'verify'>, cluster: Cluster, runs: CandidateRun[], repro: { testCode: string; testPath: string }, breakers: BreakerTest[]): Promise<FixCandidate | null> {
  const { tools, store } = ctx;
  const eligible = runs.filter((r) => r.candidate.scope_ok && r.candidate.status !== 'failed');
  await Promise.all(
    eligible.map(async ({ candidate, worktree }) => {
      const run = ctx.audit.start('verify', { clusterId: cluster.id, lane: `candidate ${candidate.n}`, summary: 'repro + full suite + breaker tests' });
      tools.sandbox_write_test(worktree, repro.testPath, repro.testCode);
      breakers.forEach((b, i) => tools.sandbox_write_test(worktree, `${REPRO_DIR}/breaker-${i + 1}.test.ts`, b.code));
      const res = await tools.sandbox_run_tests(worktree, [], 120_000); // whole suite: test/ + __repro__/
      const repro_pass = res.files.find((f) => f.file === repro.testPath)?.status === 'passed';
      const suite = res.files.filter((f) => !f.file.startsWith(`${REPRO_DIR}/`));
      const suite_pass = suite.length > 0 && suite.every((f) => f.status === 'passed');
      const brk = res.files.filter((f) => f.file.startsWith(`${REPRO_DIR}/breaker-`));
      const breaker_pass_count = brk.filter((f) => f.status === 'passed').length;
      const patch = { repro_pass, suite_pass, breaker_total: breakers.length, breaker_pass_count };
      const s = score({ ...patch, diff_lines: candidate.diff_lines });
      store.update('fix_candidate', candidate.id, { ...patch, score: s, status: s > 0 ? 'verified' : 'failed' });
      const failedBreakers = brk.filter((f) => f.status !== 'passed').map((f) => f.tests[0]?.title ?? f.file);
      run.log('verify', { branch: candidate.branch }, { ...patch, score: s, failedBreakers }, s > 0 ? `Gates pass; ${breaker_pass_count}/${breakers.length} breakers survived` : 'Failed a gate');
      run.finish(s > 0 ? 'passed' : 'failed', `repro ${repro_pass ? 'pass' : 'FAIL'} · suite ${suite_pass ? 'pass' : 'FAIL'} · breakers ${breaker_pass_count}/${breakers.length}`);
    }),
  );
  const ranked = store
    .list('fix_candidate', (c) => c.cluster_id === cluster.id && c.status === 'verified')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.diff_lines - b.diff_lines);
  const winner = ranked[0] ?? null;
  if (winner) store.update('fix_candidate', winner.id, { status: 'winner' });
  return winner;
}
