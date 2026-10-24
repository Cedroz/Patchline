// Issue view: one bug from report to merge. Reports, repro race, bisect result, fix candidates with
// diffs + scores, breaker tests, Approve, and the cluster's audit trail.
import { STAGES, type Culprit, type FixCandidate, type Snapshot } from '@patchline/core';
import { useState } from 'react';
import { ago, maskName, post, type Meta } from '../api';
import { AuditRows } from './AuditLog';
import { Diff } from './Diff';
import { RunRow } from './Lanes';

const RESULT_LABEL: Record<string, string> = {
  valid: 'reproduces',
  passes_on_head: 'passes on HEAD',
  wrong_error: 'wrong failure',
  fails_on_good: 'fails on good commit',
  error: 'error',
  pending: 'running',
};

export function IssueDrawer({ db, clusterId, meta, onClose }: { db: Snapshot; clusterId: string; meta: Meta | null; onClose: () => void }) {
  const cluster = db.cluster.find((c) => c.id === clusterId);
  const pipe = db.pipeline.find((p) => p.cluster_id === clusterId);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!cluster) return null;

  const reports = db.report.filter((r) => r.cluster_id === clusterId).sort((a, b) => a.created_at - b.created_at);
  const attempts = db.repro_attempt.filter((a) => a.cluster_id === clusterId);
  const candidates = db.fix_candidate.filter((c) => c.cluster_id === clusterId).sort((a, b) => a.n - b.n);
  const breakers = db.breaker_test.filter((b) => b.cluster_id === clusterId);
  const runs = db.agent_run.filter((r) => r.cluster_id === clusterId).sort((a, b) => a.started_at - b.started_at);
  const audit = db.audit_event.filter((e) => e.cluster_id === clusterId).sort((a, b) => b.at - a.at);
  const culprit: Culprit | null = pipe?.culprit_json ? JSON.parse(pipe.culprit_json) : null;
  const stage = pipe?.stage ?? 'clustered';
  const stageIdx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  const gameUrl = meta?.game.liveUrl || 'http://localhost:5174';

  const act = async (label: string, path: string) => {
    setBusy(label);
    setError('');
    try {
      await post(path, { by: 'dashboard' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="muted">
              {cluster.jira_key && meta?.jiraBrowse ? (
                <a href={`${meta.jiraBrowse}${cluster.jira_key}`} target="_blank" rel="noreferrer">
                  {cluster.jira_key}
                </a>
              ) : (
                cluster.jira_key
              )}{' '}
              · {cluster.report_count} reports · <span className={`sev sev-${cluster.severity}`}>{cluster.severity}</span> · {cluster.labels.join(', ')}
            </div>
            <h2>{cluster.title}</h2>
            <p>{cluster.summary}</p>
          </div>
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </div>

        <ol className="timeline">
          {STAGES.map((s, i) => (
            <li key={s} className={i < stageIdx ? 'done' : i === stageIdx ? 'now' : ''}>
              {s.replace(/_/g, ' ')}
            </li>
          ))}
          {(stage === 'not_reproducible' || stage === 'escalated') && <li className="exit">{stage.replace(/_/g, ' ')}</li>}
        </ol>
        {pipe?.note && <p className="note">{pipe.note}</p>}

        <div className="actions">
          {stage === 'culprit_found' && (
            <button className="primary" disabled={!!busy} onClick={() => act('fix', `/clusters/${clusterId}/fix`)}>
              {busy === 'fix' ? 'Starting…' : 'Start Droid fix tournament'}
            </button>
          )}
          {stage === 'awaiting_approval' && (
            <button className="approve" disabled={!!busy} onClick={() => act('approve', `/clusters/${clusterId}/approve`)}>
              {busy === 'approve' ? 'Merging…' : 'Approve & merge winning fix'}
            </button>
          )}
          {(stage === 'not_reproducible' || stage === 'escalated') && (
            <button disabled={!!busy} onClick={() => act('retry', `/clusters/${clusterId}/retry`)}>
              Retry repro
            </button>
          )}
          {error && <span className="error">{error}</span>}
        </div>

        <Section title={`Reports (${reports.length})`}>
          {reports.map((r) => (
            <div key={r.id} className="report">
              <span className={`src src-${r.source}`}>{r.source}</span>
              <span className="muted">{maskName(r.author)}</span>
              <span className="report-text">{r.text}</span>
              {r.quarantined && <span className="tag warn">quarantined text removed</span>}
              {r.replay_id && (
                <a href={`${gameUrl}/?replay=${r.replay_id}`} target="_blank" rel="noreferrer" className="tag">
                  ▶ replay
                </a>
              )}
            </div>
          ))}
        </Section>

        <Section title="Reproduce" hint="Valid = fails on HEAD with the expected invariant AND passes on the oldest good commit">
          {!attempts.length && <p className="muted">Waiting for repro…</p>}
          <div className="race">
            {attempts.map((a) => (
              <details key={a.id} className={`racer res-${a.result}`}>
                <summary>
                  <span className="res">{RESULT_LABEL[a.result] ?? a.result}</span> {a.interpretation}
                </summary>
                <p className="muted">{a.detail}</p>
                <pre className="code">{a.test_code}</pre>
              </details>
            ))}
          </div>
        </Section>

        {culprit && (
          <Section title="Culprit commit (git bisect run, no LLM)">
            <div className="culprit">
              <code>{culprit.sha.slice(0, 10)}</code> <strong>{culprit.message}</strong> <span className="muted">by {culprit.author.replace(/<.*>/, '').trim()}</span>
              <span className="muted"> · allowlist for fix agents: {culprit.files.join(', ')}</span>
            </div>
            <Diff diff={culprit.diff} />
          </Section>
        )}

        {candidates.length > 0 && (
          <Section title="Fix tournament" hint="Gates: repro passes + full suite passes. Rank: breaker tests survived, then smaller diff.">
            <div className="candidates">
              {candidates.map((c) => (
                <Candidate key={c.id} c={c} winner={pipe?.winner_candidate_id === c.id} />
              ))}
            </div>
          </Section>
        )}

        {breakers.length > 0 && (
          <Section title={`Breaker tests (${breakers.filter((b) => b.valid_on_good).length}/${breakers.length} valid on good commit)`}>
            {breakers.map((b) => (
              <details key={b.id} className={`racer ${b.valid_on_good ? 'res-valid' : 'res-wrong_error'}`}>
                <summary>
                  <span className="res">{b.valid_on_good ? 'kept' : 'discarded'}</span> {b.name}
                </summary>
                <pre className="code">{b.code}</pre>
              </details>
            ))}
          </Section>
        )}

        <Section title={`Agent runs (${runs.length})`}>
          {runs.map((r) => (
            <RunRow key={r.id} r={r} />
          ))}
        </Section>

        <Section title={`Audit trail (${audit.length})`}>
          <AuditRows events={audit} />
        </Section>
        <p className="muted small">Opened {ago(cluster.first_seen)}.</p>
      </div>
    </div>
  );
}

function Candidate({ c, winner }: { c: FixCandidate; winner: boolean }) {
  const gate = (v?: boolean) => (v === undefined ? '…' : v ? '✓' : '✗');
  return (
    <div className={`candidate status-${c.status} ${winner ? 'is-winner' : ''}`}>
      <div className="cand-head">
        <strong>
          #{c.n} {c.strategy.replace('_', ' ')}
        </strong>
        <span className="agent">{c.agent}</span>
        <span className={`status`}>{winner ? 'WINNER' : c.status}</span>
      </div>
      <code className="muted small">{c.branch}</code>
      <div className="gates">
        <span>scope {c.status === 'running' && !c.files_touched.length ? '…' : gate(c.scope_ok)}</span>
        <span>repro {gate(c.repro_pass)}</span>
        <span>suite {gate(c.suite_pass)}</span>
        <span>
          breakers {c.breaker_pass_count ?? '…'}/{c.breaker_total ?? '…'}
        </span>
        <span>{c.diff_lines} lines</span>
        <span>score {c.score ?? '…'}</span>
      </div>
      {c.scope_reason && <p className="error small">{c.scope_reason}</p>}
      {c.plan && <p className="plan">{c.plan}</p>}
      <details>
        <summary>Agent log ({c.log.split('\n').filter(Boolean).length} steps)</summary>
        <pre className="code small">{c.log}</pre>
      </details>
      <Diff diff={c.diff} />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h4>
        {title} {hint && <span className="hint">{hint}</span>}
      </h4>
      {children}
    </section>
  );
}
