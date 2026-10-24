// Trigger on avi:jira:updated:issue. Reads the issue's current labels and forwards them to the orchestrator,
// which starts the Droid fix tournament when "agent-fixable" is present and the bug has a culprit commit.
// Forge does no long work here (function time limits); the orchestrator does.
import api, { route } from '@forge/api';

export async function run(event) {
  if (event.selfGenerated) return;
  const key = event.issue?.key;
  const base = process.env.ORCH_URL;
  if (!key || !base) return;

  let labels = event.issue?.fields?.labels;
  if (!Array.isArray(labels)) {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}?fields=labels`);
    labels = res.ok ? (await res.json()).fields?.labels ?? [] : [];
  }
  if (!labels.includes('agent-fixable')) return;

  await api.fetch(`${base}/webhooks/jira`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-patchline-secret': process.env.PATCHLINE_SECRET ?? '' },
    body: JSON.stringify({ issueKey: key, labels }),
  });
}
