// Quarantine view: spans cut from reports before any LLM saw them.
import type { Snapshot } from '@patchline/core';
import { ago } from '../api';

export function QuarantineView({ db }: { db: Snapshot }) {
  const rows = [...db.quarantine].sort((a, b) => b.at - a.at);
  return (
    <div className="panel">
      <p className="muted">Instruction-like text is removed by a regex pass, then a Claude classifier that can only answer suspicious / not suspicious. Only the cleaned text continues.</p>
      {!rows.length && <p>Nothing quarantined yet. Try the injection demo.</p>}
      {rows.map((q) => {
        const r = db.report.find((x) => x.id === q.report_id);
        return (
          <div key={q.id} className="qrow">
            <span className="tag warn">{q.reason}</span>
            <s>{q.matched_text}</s>
            <span className="muted small">
              {r?.source} · {ago(q.at)} · continued as: “{r?.text || '(dropped entirely)'}”
            </span>
          </div>
        );
      })}
    </div>
  );
}
