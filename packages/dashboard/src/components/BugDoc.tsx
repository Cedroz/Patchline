// Bug write-ups: what the bug is, why it happened, what the fix changes, and how we know. Facts come straight from
// the pipeline (repro, bisect, verify gates); the prose is the docs agent's draft and is labeled as such.
import type { Cluster, Culprit, FixCandidate, Snapshot, Writeup } from '@patchline/core';
import { useState } from 'react';
import { Diff } from './Diff';

export interface Doc {
  cluster: Cluster;
  stage: string;
  note?: string;
  writeup: Writeup | null;
  repro?: { interpretation: string; invariant: string };
  culprit: Culprit | null;
  winner?: FixCandidate;
  mergedSha?: string;
  steps: string[];
  sources: string[];
}

export function docFor(db: Snapshot, clusterId: string): Doc | null {
  const cluster = db.cluster.find((c) => c.id === clusterId);
  if (!cluster) return null;
  const pipe = db.pipeline.find((p) => p.cluster_id === clusterId);
  const valid = db.repro_attempt.find((a) => a.cluster_id === clusterId && a.result === 'valid' && a.test_path === pipe?.repro_test_path);
  const parse = <T,>(s?: string): T | null => {
    try {
      return s ? (JSON.parse(s) as T) : null;
    } catch {
      return null;
    }
  };
  return {
    cluster,
    stage: pipe?.stage ?? 'clustered',
    note: pipe?.note,
    writeup: parse<Writeup>(pipe?.writeup_json),
    repro: valid && pipe?.expected_error ? { interpretation: valid.interpretation, invariant: pipe.expected_error } : undefined,
    culprit: parse<Culprit>(pipe?.culprit_json),
    winner: pipe?.winner_candidate_id ? db.fix_candidate.find((c) => c.id === pipe.winner_candidate_id) : undefined,
    mergedSha: pipe?.merged_sha,
    steps: parse<string[]>(cluster.repro_steps_json) ?? [],
    sources: [...new Set(db.report.filter((r) => r.cluster_id === clusterId).map((r) => r.source))],
  };
}

export function status(d: Doc): { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
  if (d.stage === 'reverted') return { label: d.note ?? 'Fix reverted', tone: 'bad' };
  if (d.mergedSha) return { label: `Fixed in ${d.mergedSha.slice(0, 7)}`, tone: 'ok' };
  if (d.stage === 'awaiting_approval') return { label: 'Fix verified, waiting for your approval', tone: 'warn' };
  if (d.stage === 'fixing' || d.stage === 'verifying') return { label: 'Fix agents working', tone: 'muted' };
  if (d.culprit) return { label: 'Root cause found', tone: 'muted' };
  if (d.repro) return { label: 'Reproduced', tone: 'muted' };
  if (d.stage === 'not_reproducible' || d.stage === 'escalated') return { label: d.note ?? d.stage.replace(/_/g, ' '), tone: 'bad' };
  return { label: 'Investigating', tone: 'muted' };
}

const gate = (v?: boolean) => (v === undefined ? '…' : v ? '✓' : '✗');
const author = (a: string) => a.replace(/<.*>/, '').trim();
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

export function toMarkdown(d: Doc): string {
  const w = d.writeup;
  const lines = [`# ${d.cluster.jira_key ? `${d.cluster.jira_key}: ` : ''}${d.cluster.title}`, '', `Status: ${status(d).label}. Severity ${d.cluster.severity}, ${d.cluster.report_count} report(s) via ${d.sources.join(', ') || 'n/a'}.`, ''];
  lines.push('## What happens', w?.what ?? d.cluster.summary, '');
  if (w) lines.push('## Impact', w.impact, '');
  if (d.repro) lines.push('## How to reproduce', `${sentence(d.repro.interpretation)} Breaks invariant \`${d.repro.invariant}\`.`, '');
  if (d.culprit) lines.push('## Root cause', `Commit \`${d.culprit.sha.slice(0, 7)}\` "${d.culprit.message}" by ${author(d.culprit.author)} (${d.culprit.files.join(', ')}), found by git bisect.`, ...(w ? ['', w.root_cause] : []), '');
  if (d.winner) {
    lines.push('## The fix', `${d.winner.strategy.replace('_', ' ')} candidate by ${d.winner.agent}, branch \`${d.winner.branch}\`, ${d.winner.diff_lines}-line diff.`, ...(w ? ['', w.fix] : []), '');
    lines.push('```diff', d.winner.diff.trim(), '```', '');
    lines.push('## How we know', `Repro ${gate(d.winner.repro_pass)} · full suite ${gate(d.winner.suite_pass)} · breaker tests ${d.winner.breaker_pass_count ?? 0}/${d.winner.breaker_total ?? 0}.`, ...(w ? ['', w.verification] : []), '');
  }
  if (w) lines.push('## Risk', w.risk, '');
  if (w) lines.push('_Prose drafted by Claude from the verified facts; facts come from the replayed repro, git bisect and the verify gate._');
  return lines.join('\n');
}

function Field({ title, fact, prose, children }: { title: string; fact?: React.ReactNode; prose?: string; children?: React.ReactNode }) {
  if (!fact && !prose && !children) return null;
  return (
    <div className="doc-field">
      <h5>{title}</h5>
      {fact && (
        <p className="doc-fact">
          <span className="doc-src verified" title="Established by plain code: replay, bisect or the verify gate">
            verified
          </span>
          {fact}
        </p>
      )}
      {prose && (
        <p className="doc-prose">
          <span className="doc-src claude" title="Drafted by Claude from the verified facts">
            Claude
          </span>
          {prose}
        </p>
      )}
      {children}
    </div>
  );
}

/** compact = list card with its own title; diffs = show culprit and fix diffs inline (the drawer has its own). */
export function BugDoc({ db, clusterId, compact, diffs, onOpen }: { db: Snapshot; clusterId: string; compact?: boolean; diffs?: boolean; onOpen?: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const d = docFor(db, clusterId);
  if (!d) return null;
  const w = d.writeup;
  const s = status(d);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(d));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; nothing to do */
    }
  };

  return (
    <article className={`bugdoc ${compact ? 'compact' : ''}`}>
      <header className="doc-head">
        <div>
          {compact && (
            <h3>
              {d.cluster.jira_key && <span className="jira">{d.cluster.jira_key}</span>} {d.cluster.title}
            </h3>
          )}
          <span className={`doc-status ${s.tone}`}>{s.label}</span>
          <span className="muted small">
            {' '}
            · {d.cluster.report_count} report(s) via {d.sources.join(', ') || 'n/a'} · <span className={`sev sev-${d.cluster.severity}`}>{d.cluster.severity}</span>
          </span>
        </div>
        <div className="doc-actions">
          {compact && onOpen && <button onClick={() => onOpen(d.cluster.id)}>Open trace</button>}
          <button onClick={copy}>{copied ? 'Copied' : 'Copy as Markdown'}</button>
        </div>
      </header>

      <Field title="What happens" prose={w?.what}>
        {!w && <p>{d.cluster.summary}</p>}
      </Field>
      <Field title="Impact" prose={w?.impact} />
      <Field
        title="How to reproduce"
        fact={
          d.repro && (
            <>
              {sentence(d.repro.interpretation)} Fails with <code>InvariantError({d.repro.invariant})</code> on main and passes on the oldest good commit.
            </>
          )
        }
      >
        {!d.repro && d.steps.length > 0 && (
          <ol className="doc-steps">
            {d.steps.map((st, i) => (
              <li key={i}>{st}</li>
            ))}
          </ol>
        )}
      </Field>
      <Field
        title="Root cause"
        fact={
          d.culprit && (
            <>
              Commit <code>{d.culprit.sha.slice(0, 7)}</code> “{d.culprit.message}” by {author(d.culprit.author)}, in {d.culprit.files.join(', ')}. Found by <code>git bisect run</code>.
            </>
          )
        }
        prose={w?.root_cause}
      >
        {diffs && d.culprit && <Diff diff={d.culprit.diff} />}
      </Field>
      <Field
        title="The fix"
        fact={
          d.winner && (
            <>
              {d.winner.strategy.replace('_', ' ')} candidate by {d.winner.agent} on <code>{d.winner.branch}</code>, {d.winner.diff_lines}-line diff.
            </>
          )
        }
        prose={w?.fix}
      >
        {diffs && d.winner && <Diff diff={d.winner.diff} />}
      </Field>
      <Field
        title="How we know"
        fact={
          d.winner && (
            <>
              Repro {gate(d.winner.repro_pass)} · full suite {gate(d.winner.suite_pass)} · breaker tests {d.winner.breaker_pass_count ?? 0}/{d.winner.breaker_total ?? 0}
            </>
          )
        }
        prose={w?.verification}
      />
      <Field title="Risk" prose={w?.risk} />
    </article>
  );
}

