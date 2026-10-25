// Merger: only runs after a human approves. Merges the winning branch into main, optionally pushes
// (Vercel redeploys), re-runs the repro against the new main, and closes the loop in Jira and Discord.
import type { Cluster, FixCandidate, Report } from '@patchline/core';
import type { AgentCtx } from './context';

export async function runMerge(
  ctx: AgentCtx<'merger'>,
  cluster: Cluster,
  winner: FixCandidate,
  repro: { testCode: string; testPath: string },
  approvedBy: string,
): Promise<{ sha: string; pushed: boolean; replayPasses: boolean }> {
  const { tools, store, config } = ctx;
  const run = ctx.audit.start('merger', { clusterId: cluster.id, summary: `merging ${winner.branch} (approved by ${approvedBy})` });
  const sha = await tools.repo_merge(winner.branch, `Merge ${winner.branch}: ${cluster.title}${cluster.jira_key ? ` (${cluster.jira_key})` : ''}\n\nApproved by ${approvedBy} via Patchline.`);
  run.log('git.merge', { branch: winner.branch }, { sha }, `Human approval from ${approvedBy}`, true);

  let pushed = false;
  if (config.gamePush) {
    try {
      const out = await tools.repo_push();
      pushed = true;
      run.log('git.push', { remote: 'origin', branch: 'main' }, out, 'Push triggers the Vercel redeploy', false);
    } catch (e) {
      run.log('git.push', { remote: 'origin' }, { error: (e as Error).message }, 'Push failed; merge is local only');
    }
  }

  // The bug must be gone on the new main.
  const wt = await tools.sandbox_worktree(`postmerge-${cluster.id}`, 'main');
  let replayPasses = false;
  try {
    tools.sandbox_write_test(wt, repro.testPath, repro.testCode);
    const res = await tools.sandbox_run_tests(wt, [repro.testPath]);
    replayPasses = res.files[0]?.status === 'passed';
    run.log('postmerge.repro', { sha }, { replayPasses }, 'Repro re-run against merged main');
  } finally {
    await tools.sandbox_remove(wt);
  }

  if (cluster.jira_key) {
    await tools.jira_comment(cluster.jira_key, `Fixed in ${sha.slice(0, 7)} (${winner.branch}), approved by ${approvedBy}. Repro test ${replayPasses ? 'passes' : 'STILL FAILS'} on the merged build.${pushed && config.gameLiveUrl ? ` Live: ${config.gameLiveUrl}` : ''}`);
    await tools.jira_transition(cluster.jira_key, 'Done');
  }
  const reporters = store.list('report', (r: Report) => r.cluster_id === cluster.id && !!r.external_ref);
  for (const r of reporters) await tools.chat_reply(r.external_ref!, `Fixed in ${sha.slice(0, 7)}. Thanks for the report!`).catch(() => {});
  run.finish(replayPasses ? 'passed' : 'failed', `merged ${sha.slice(0, 7)}${pushed ? ', pushed' : ''}; repro ${replayPasses ? 'passes' : 'fails'} on new main`);
  return { sha, pushed, replayPasses };
}

/** Human-triggered undo of a merged fix: revert commit on main, push, confirm main is healthy, reopen the issue. */
export async function runRevert(
  ctx: AgentCtx<'merger'>,
  cluster: Cluster,
  mergedSha: string,
  by: string,
  reason: string,
): Promise<{ sha: string; pushed: boolean; suitePasses: boolean }> {
  const { tools, config } = ctx;
  const run = ctx.audit.start('merger', { clusterId: cluster.id, summary: `reverting ${mergedSha.slice(0, 7)} (requested by ${by})` });
  const sha = await tools.repo_revert(
    mergedSha,
    `Revert Patchline fix ${mergedSha.slice(0, 7)}: ${cluster.title}${cluster.jira_key ? ` (${cluster.jira_key})` : ''}\n\nRequested by ${by} via Patchline${reason ? `: ${reason}` : ''}.`,
  );
  run.log('git.revert', { merged: mergedSha, reason }, { sha }, `Human revert from ${by}`, false);

  let pushed = false;
  if (config.gamePush) {
    try {
      const out = await tools.repo_push();
      pushed = true;
      run.log('git.push', { remote: 'origin', branch: 'main' }, out, 'Push triggers the Vercel redeploy', false);
    } catch (e) {
      run.log('git.push', { remote: 'origin' }, { error: (e as Error).message }, 'Push failed; revert is local only');
    }
  }

  // main must be healthy again: the full suite runs on the reverted build.
  const wt = await tools.sandbox_worktree(`postrevert-${cluster.id}`, 'main');
  let suitePasses = false;
  try {
    const res = await tools.sandbox_run_tests(wt);
    suitePasses = res.ok && res.files.every((f) => f.status === 'passed');
    run.log('postrevert.suite', { sha }, { suitePasses }, 'Full suite on reverted main');
  } finally {
    await tools.sandbox_remove(wt);
  }

  if (cluster.jira_key) {
    await tools.jira_comment(cluster.jira_key, `Fix ${mergedSha.slice(0, 7)} reverted in ${sha.slice(0, 7)} by ${by}${reason ? ` (${reason})` : ''}. Full suite ${suitePasses ? 'passes' : 'FAILS'} on the reverted build. The original bug is back; reopening.`);
    await tools.jira_transition(cluster.jira_key, 'In Progress');
  }
  run.finish(suitePasses ? 'passed' : 'failed', `reverted ${mergedSha.slice(0, 7)} in ${sha.slice(0, 7)}${pushed ? ', pushed' : ''}`);
  return { sha, pushed, suitePasses };
}
