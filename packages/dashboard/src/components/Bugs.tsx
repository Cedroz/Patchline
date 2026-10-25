// Bug list: every game bug as one row with a progress track and its one next action (fix, approve, revert).
// Actions ask for confirmation in a sheet first. Clicking a row opens the issue drawer.
import type { Snapshot } from '@patchline/core';
import { useState } from 'react';
import { ago, maskName, post } from '../api';
import { docFor, status, type Doc } from './BugDoc';

type Filter = 'all' | 'needs' | 'fixed' | 'false';
export type Kind = 'fix' | 'approve' | 'revert' | 'close';
export type Action = { kind: Kind; doc: Doc };

const STEPS = ['Reported', 'Reproduced', 'Root cause', 'Fix verified', 'Shipped'];
const STEP_OF: Record<string, number> = {
  reported: 0,
  clustered: 0,
  reproducing: 0,
  not_reproducible: 0,
  confirmed: 1,
  bisecting: 1,
  culprit_found: 2,
  fixing: 2,
  verifying: 2,
  escalated: 2,
  reverted: 2,
  awaiting_approval: 3,
  merged: 4,
};
const HUMAN = new Set(['reverted', 'escalated', 'not_reproducible']);
const RANK: Record<string, number> = { awaiting_approval: 0, reverted: 1, culprit_found: 2, escalated: 3, not_reproducible: 4, merged: 9 };

function actionFor(d: Doc): Kind | null {
  if (d.stage === 'awaiting_approval') return 'approve';
  if (d.stage === 'culprit_found' || d.stage === 'reverted') return 'fix';
  if (d.stage === 'merged' && d.mergedSha) return 'revert';
  return null;
}

const LABEL: Record<Kind, (d: Doc) => string> = {
  approve: () => 'Approve & ship',
  fix: () => 'Run fix',
  revert: (d) => `Revert ${d.mergedSha?.slice(0, 7)}`,
  close: () => 'Yes, close it',
};

export function Stats({ db }: { db: Snapshot }) {
  const docs = gameDocs(db);
  const stats = [
    { label: 'Bugs', value: docs.length },
    { label: 'In progress', value: docs.filter((d) => !HUMAN.has(d.stage) && d.stage !== 'merged' && d.stage !== 'awaiting_approval').length, tone: 'accent' },
    { label: 'Ready to ship', value: docs.filter((d) => d.stage === 'awaiting_approval').length, tone: 'warn' },
    { label: 'Fixed', value: docs.filter((d) => d.stage === 'merged').length, tone: 'ok' },
    { label: 'Player reports', value: db.report.filter((r) => r.project === 'game').length },
  ];
  return (
    <div className="stats">
      {stats.map((s) => (
        <div key={s.label} className={`stat ${s.value ? (s.tone ? `tone-${s.tone}` : '') : 'zero'}`}>
          <span className="stat-value">{s.value}</span>
          <span className="stat-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export function BugList({ db, onOpen, onToast }: { db: Snapshot; onOpen: (id: string) => void; onToast: (msg: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [confirm, setConfirm] = useState<Action | null>(null);
  const all = gameDocs(db);
  const needs = all.filter((d) => (HUMAN.has(d.stage) && d.stage !== 'not_reproducible') || (actionFor(d) && d.stage !== 'merged'));
  // False reports: player reports intake classified as "not a bug", plus bugs that could not be reproduced.
  const notBug = new Set(db.agent_run.filter((r) => r.agent === 'intake' && r.status === 'skipped').map((r) => /^report (\S+): not a bug/.exec(r.summary)?.[1]));
  const rejected = db.report.filter((r) => r.project === 'game' && !r.cluster_id && notBug.has(r.id)).sort((a, b) => b.created_at - a.created_at);
  const unrepro = all.filter((d) => d.stage === 'not_reproducible');
  const docs = filter === 'needs' ? needs : filter === 'fixed' ? all.filter((d) => d.stage === 'merged') : filter === 'false' ? unrepro : all;
  const running = new Set(db.agent_run.filter((r) => r.status === 'running').map((r) => r.cluster_id));

  return (
    <section className="bugs">
      <div className="section-head">
        <h2>Bugs</h2>
        <div className="seg" role="tablist">
          {(
            [
              ['all', `All ${all.length}`],
              ['needs', `Needs you ${needs.length}`],
              ['fixed', 'Fixed'],
              ['false', `False reports ${rejected.length + unrepro.length}`],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {!docs.length && !(filter === 'false' && rejected.length) && (
        <div className="empty">
          {filter === 'all' ? (
            <>
              <strong>No bugs yet</strong>
              <span>Report one from the game, or use Demo → Seed 30 reports.</span>
            </>
          ) : (
            <span>Nothing here right now.</span>
          )}
        </div>
      )}

      {docs.map((d) => {
        const s = status(d);
        const act = actionFor(d);
        const step = STEP_OF[d.stage] ?? 0;
        const stuck = HUMAN.has(d.stage);
        return (
          <article key={d.cluster.id} className={`bug sev-${d.cluster.severity} ${running.has(d.cluster.id) ? 'busy' : ''}`} onClick={() => onOpen(d.cluster.id)}>
            <button
              className="bug-close"
              aria-label="Close bug"
              title="Close bug"
              onClick={(e) => {
                e.stopPropagation();
                setConfirm({ kind: 'close', doc: d });
              }}
            >
              ×
            </button>
            <div className="bug-main">
              <div className="bug-meta">
                {d.cluster.jira_key && <span className="jira">{d.cluster.jira_key}</span>}
                <span className={`sev sev-${d.cluster.severity}`}>{d.cluster.severity}</span>
                <span>
                  {d.cluster.report_count} report{d.cluster.report_count === 1 ? '' : 's'}
                </span>
                {d.sources.length > 0 && <span>via {d.sources.join(', ')}</span>}
              </div>
              <h3>{d.cluster.title}</h3>
              <p className="bug-summary">{d.writeup?.what ?? d.cluster.summary}</p>
              <div className={`bug-status doc-status ${s.tone}`}>
                {running.has(d.cluster.id) && <span className="spinner" />}
                {s.label}
              </div>
            </div>
            <div className="bug-side">
              <ol className={`track ${stuck ? 'stuck' : ''}`} aria-label={`Progress: ${STEPS[step]}`}>
                {STEPS.map((label, i) => (
                  <li key={label} className={i < step || d.stage === 'merged' ? 'done' : i === step ? 'now' : ''} title={label}>
                    <span>{label}</span>
                  </li>
                ))}
              </ol>
              {act && (
                <button
                  className={`bug-action ${act}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirm({ kind: act, doc: d });
                  }}
                >
                  {LABEL[act](d)}
                </button>
              )}
            </div>
          </article>
        );
      })}

      {filter === 'false' &&
        rejected.map((r) => (
          <article key={r.id} className="bug false-report">
            <div className="bug-main">
              <div className="bug-meta">
                <span className={`src src-${r.source}`}>{r.source}</span>
                <span>{maskName(r.author)}</span>
                <span>{ago(r.created_at)}</span>
              </div>
              <h3>“{r.text}”</h3>
              <div className="bug-status doc-status muted">Not a bug: intake found nothing to fix in this report</div>
            </div>
          </article>
        ))}

      {confirm && <ConfirmSheet action={confirm} onClose={() => setConfirm(null)} onDone={(msg) => (setConfirm(null), onToast(msg))} />}
    </section>
  );
}

function gameDocs(db: Snapshot): Doc[] {
  return db.cluster
    .filter((c) => c.project === 'game')
    .map((c) => docFor(db, c.id)!)
    .filter((d) => d && d.stage !== 'duplicate' && d.stage !== 'closed')
    .sort((a, b) => (RANK[a.stage] ?? 5) - (RANK[b.stage] ?? 5) || b.cluster.last_seen - a.cluster.last_seen);
}

const CONFIRM: Record<Kind, { title: (d: Doc) => string; body: (d: Doc) => string; path: string; done: string }> = {
  fix: {
    title: () => 'Start the fix tournament?',
    body: (d) => `Two fix agents will each propose a fix for "${d.cluster.title}", limited to the culprit's files. Nothing ships until you approve.`,
    path: 'fix',
    done: 'Fix agents started',
  },
  approve: {
    title: () => 'Ship this fix?',
    body: (d) => `Merges ${d.winner?.branch ?? 'the winning branch'} into main and redeploys. It passed the repro, the full suite and ${d.winner?.breaker_pass_count ?? 0}/${d.winner?.breaker_total ?? 0} breaker tests. You can revert it later.`,
    path: 'approve',
    done: 'Merged. Redeploying.',
  },
  revert: {
    title: (d) => `Revert ${d.mergedSha?.slice(0, 7)}?`,
    body: () => 'Adds a revert commit on main (history is kept), redeploys, re-runs the suite and reopens the issue. The original bug comes back.',
    path: 'revert',
    done: 'Reverted. Issue reopened.',
  },
  close: {
    title: (d) => `Close "${d.cluster.title}"?`,
    body: () => 'Are you sure? It disappears from the dashboard. Its reports and history are kept, and if players report it again it comes back as a new bug.',
    path: 'close',
    done: 'Bug closed',
  },
};

export function ConfirmSheet({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: (msg: string) => void }) {
  const c = CONFIRM[action.kind];
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await post(`/clusters/${action.doc.cluster.id}/${c.path}`, { by: 'dashboard', reason });
      navigator.vibrate?.(30);
      onDone(c.done);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{c.title(action.doc)}</h2>
        <p>{c.body(action.doc)}</p>
        {(action.kind === 'revert' || action.kind === 'close') && <input placeholder={action.kind === 'close' ? 'Why? (optional, e.g. not a real bug)' : 'Why? (optional, goes in the commit and Jira)'} value={reason} onChange={(e) => setReason(e.target.value)} />}
        {error && <p className="error">{error}</p>}
        <div className="sheet-row">
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className={`bug-action ${action.kind}`} disabled={busy} onClick={go}>
            {busy ? 'Working…' : LABEL[action.kind](action.doc)}
          </button>
        </div>
      </div>
    </div>
  );
}
