// Apify showcase: public Steam reviews / Reddit posts of a game we do not own, clustered by intake.
import type { Snapshot } from '@patchline/core';
import { maskName } from '../api';

export function Showcase({ db }: { db: Snapshot }) {
  const clusters = db.cluster.filter((c) => c.project === 'showcase').sort((a, b) => b.report_count - a.report_count);
  const items = db.report.filter((r) => r.project === 'showcase');
  const bugs = items.filter((r) => r.cluster_id).length;
  return (
    <div className="panel">
      <h2>
        {items.length.toLocaleString()} public reviews and posts → {clusters.length} bug clusters
      </h2>
      <p className="muted">
        Pulled with Apify (Steam discussions + Reddit), clustered by the same intake prompt. No repro here: we do not have that game's repo. Usernames are masked. {bugs} items were
        bug reports; the rest were opinions or feature requests.
      </p>
      <div className="showcase">
        {clusters.map((c) => {
          const samples = items.filter((r) => r.cluster_id === c.id).slice(0, 3);
          const max = clusters[0]?.report_count || 1;
          return (
            <div key={c.id} className="sc-card">
              <div className="sc-head">
                <strong>{c.title}</strong>
                <span className={`sev sev-${c.severity}`}>{c.severity}</span>
              </div>
              <div className="bar">
                <div style={{ width: `${(c.report_count / max) * 100}%` }} />
              </div>
              <div className="muted small">
                {c.report_count} report{c.report_count === 1 ? '' : 's'}
              </div>
              {samples.map((s) => (
                <p key={s.id} className="small quote">
                  <span className={`src src-${s.source}`}>{s.source}</span> {maskName(s.author)}: “{s.text.slice(0, 160)}”
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
