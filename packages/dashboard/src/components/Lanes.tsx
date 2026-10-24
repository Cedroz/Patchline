// Agent lanes: live agent_run rows, newest first, running ones pinned to the top.
import type { AgentRun, Snapshot } from '@patchline/core';
import { ago } from '../api';

export function RunRow({ r, title }: { r: AgentRun; title?: string }) {
  const dur = ((r.ended_at ?? Date.now()) - r.started_at) / 1000;
  return (
    <div className={`run run-${r.status}`}>
      <span className={`agent agent-${r.agent}`}>{r.agent}</span>
      {r.lane && <span className="lane">{r.lane}</span>}
      <span className="run-summary" title={r.summary}>
        {title ? `${title}: ` : ''}
        {r.summary}
      </span>
      <span className="run-time">{r.status === 'running' ? `${dur.toFixed(0)}s…` : ago(r.ended_at ?? r.started_at)}</span>
    </div>
  );
}

export function Lanes({ db, onOpen }: { db: Snapshot; onOpen: (id: string) => void }) {
  const runs = [...db.agent_run].sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || b.started_at - a.started_at).slice(0, 40);
  const titleOf = (id?: string) => db.cluster.find((c) => c.id === id)?.jira_key;
  return (
    <aside className="lanes">
      <h3>
        Agents <span className="count">{db.agent_run.filter((r) => r.status === 'running').length} running</span>
      </h3>
      {runs.map((r) => (
        <div key={r.id} onClick={() => r.cluster_id && onOpen(r.cluster_id)} className={r.cluster_id ? 'clickable' : ''}>
          <RunRow r={r} title={titleOf(r.cluster_id)} />
        </div>
      ))}
      {!runs.length && <p className="muted">No agent activity yet. Seed the demo or report a bug from the game.</p>}
    </aside>
  );
}
