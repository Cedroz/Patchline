// Bisect agent: wraps the deterministic git bisect run. No LLM.
import type { Cluster, Culprit } from '@patchline/core';
import type { AgentCtx } from './context';

export async function runBisect(ctx: AgentCtx<'bisect'>, cluster: Cluster, testCode: string, expectedCode: string, good: string): Promise<Culprit> {
  const run = ctx.audit.start('bisect', { clusterId: cluster.id, summary: `git bisect run between ${good.slice(0, 7)} and main` });
  try {
    const r = await ctx.tools.sandbox_bisect({ name: cluster.id, testCode, expectedCode, good, bad: 'main' });
    const culprit: Culprit = { sha: r.culprit.sha, message: r.culprit.message, author: r.culprit.author, diff: r.culprit.diff, files: r.culprit.files };
    run.log('git.bisect', { good, bad: 'main', expectedCode }, { culprit: culprit.sha, message: culprit.message, files: culprit.files, steps: r.steps }, `First bad commit in ${(r.ms / 1000).toFixed(1)} s`);
    run.finish('passed', `culprit ${culprit.sha.slice(0, 7)} "${culprit.message}" in ${(r.ms / 1000).toFixed(1)} s`);
    return culprit;
  } catch (e) {
    run.finish('failed', (e as Error).message.slice(0, 300));
    throw e;
  }
}
