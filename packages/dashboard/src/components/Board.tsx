// Kanban board: one column per pipeline stage group; cards are game bug clusters.
import type { Snapshot, Stage } from '@patchline/core';

const COLUMNS: { title: string; stages: Stage[] }[] = [
  { title: 'Clustered', stages: ['reported', 'clustered'] },
  { title: 'Reproducing', stages: ['reproducing'] },
  { title: 'Confirmed', stages: ['confirmed', 'bisecting'] },
  { title: 'Culprit found', stages: ['culprit_found'] },
  { title: 'Fixing', stages: ['fixing', 'verifying'] },
  { title: 'Awaiting approval', stages: ['awaiting_approval'] },
  { title: 'Merged', stages: ['merged'] },
  { title: 'Needs a human', stages: ['not_reproducible', 'escalated'] },
];

export function Board({ db, onOpen }: { db: Snapshot; onOpen: (id: string) => void }) {
  const clusters = db.cluster.filter((c) => c.project === 'game');
  const stageOf = (id: string): Stage => db.pipeline.find((p) => p.cluster_id === id)?.stage ?? 'clustered';
  const running = new Set(db.agent_run.filter((r) => r.status === 'running').map((r) => r.cluster_id));

  return (
    <div className="board">
      {COLUMNS.map((col) => {
        const cards = clusters.filter((c) => col.stages.includes(stageOf(c.id))).sort((a, b) => b.report_count - a.report_count);
        return (
          <section key={col.title} className={`column ${col.title === 'Awaiting approval' && cards.length ? 'attention' : ''}`}>
            <h3>
              {col.title} <span className="count">{cards.length}</span>
            </h3>
            {cards.map((c) => {
              const stage = stageOf(c.id);
              const pipe = db.pipeline.find((p) => p.cluster_id === c.id);
              return (
                <button key={c.id} className={`card sev-${c.severity} ${running.has(c.id) ? 'busy' : ''}`} onClick={() => onOpen(c.id)}>
                  <div className="card-top">
                    <span className="jira">{c.jira_key ?? '…'}</span>
                    <span className={`sev sev-${c.severity}`}>{c.severity}</span>
                  </div>
                  <div className="card-title">{c.title}</div>
                  <div className="card-meta">
                    <span>{c.report_count} reports</span>
                    <span className="stage">{stage.replace(/_/g, ' ')}</span>
                  </div>
                  {pipe?.culprit_commit && <div className="card-culprit">culprit {pipe.culprit_commit.slice(0, 7)}</div>}
                  {pipe?.merged_sha && <div className="card-culprit ok">fixed in {pipe.merged_sha.slice(0, 7)}</div>}
                  {(stage === 'escalated' || stage === 'not_reproducible') && pipe?.note && <div className="card-note">{pipe.note}</div>}
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
