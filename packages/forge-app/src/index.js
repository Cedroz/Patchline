// Issue panel resolver: fetches the cluster's live pipeline state from the orchestrator by Jira key.
// ORCH_URL is set with: forge variables set ORCH_URL https://<tunnel-host>
import api from '@forge/api';
import Resolver from '@forge/resolver';

const resolver = new Resolver();

resolver.define('getDetail', async ({ context }) => {
  const key = context.extension?.issue?.key;
  const base = process.env.ORCH_URL;
  if (!base) return { error: 'ORCH_URL is not set (forge variables set ORCH_URL ...)' };
  const res = await api.fetch(`${base}/jira/${encodeURIComponent(key)}`);
  if (res.status === 404) return { error: `No Patchline data for ${key} yet.` };
  if (!res.ok) return { error: `Orchestrator returned ${res.status}` };
  const d = await res.json();
  // Send only what the panel renders.
  return {
    key,
    stage: d.pipeline?.stage,
    note: d.pipeline?.note,
    culprit: d.pipeline?.culprit_json ? JSON.parse(d.pipeline.culprit_json) : null,
    mergedSha: d.pipeline?.merged_sha,
    repro: d.repro.map((a) => ({ interpretation: a.interpretation, result: a.result })),
    candidates: d.candidates.map((c) => ({
      n: c.n,
      strategy: c.strategy,
      agent: c.agent,
      status: c.status,
      repro: c.repro_pass,
      suite: c.suite_pass,
      breakers: `${c.breaker_pass_count ?? 0}/${c.breaker_total ?? 0}`,
      lines: c.diff_lines,
      score: c.score,
      diff: (c.diff || '').slice(0, 3000),
      winner: d.pipeline?.winner_candidate_id === c.id,
    })),
    audit: d.audit.slice(-15).map((e) => ({ agent: e.agent, action: e.action, reasoning: e.reasoning })),
    dashboard: process.env.DASHBOARD_URL ? `${process.env.DASHBOARD_URL}/?cluster=${d.cluster.id}` : null,
  };
});

export const handler = resolver.getDefinitions();
