// Demo controls: seed fixtures, simulate a Discord post, injection side-by-side, showcase, reset.
import type { Snapshot } from '@patchline/core';
import { useState } from 'react';
import { post } from '../api';

interface Compare {
  baseline: { tool: string; args: string; outcome: string }[];
  patchline: { cleanText: string; quarantined: { matched_text: string; reason: string }[]; intakeTools: string[] };
}

export function DemoControls({ db }: { db: Snapshot }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [discord, setDiscord] = useState('');
  const [compare, setCompare] = useState<Compare | null>(null);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setMsg('');
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="demo">
      <span className="demo-label">Demo</span>
      <button disabled={!!busy} onClick={() => run('seed', () => post('/demo/seed'))}>
        Seed 30 reports
      </button>
      <form
        className="discord-sim"
        onSubmit={(e) => {
          e.preventDefault();
          if (discord.trim()) run('discord', () => post('/discord/simulate', { text: discord }).then(() => setDiscord('')));
        }}
      >
        <input value={discord} onChange={(e) => setDiscord(e.target.value)} placeholder="Simulate a #bug-reports Discord post…" />
      </form>
      <button disabled={!!busy} onClick={() => run('discord', () => post('/discord/simulate', { text: 'if i pause and hit jump the game freezes, have to reload' }))}>
        Pause-jump post
      </button>
      <button className="danger" disabled={!!busy} onClick={() => run('inject', () => post<Compare>('/demo/injection-compare').then(setCompare))}>
        {busy === 'inject' ? 'Running…' : 'Injection: baseline vs Patchline'}
      </button>
      <button disabled={!!busy} onClick={() => run('showcase', () => post('/demo/showcase'))}>
        {busy === 'showcase' ? 'Clustering…' : 'Steam/Reddit showcase'}
      </button>
      <button
        disabled={!!busy}
        onClick={() => confirm('Reset all state and move the game repo main back to the generated history?') && run('reset', () => post('/demo/reset').then(() => setCompare(null)))}
      >
        Reset
      </button>
      <span className="muted small">
        {db.report.filter((r) => r.project === 'game').length} reports · {db.cluster.filter((c) => c.project === 'game').length} clusters
      </span>
      {msg && <span className="error">{msg}</span>}

      {compare && (
        <div className="compare" onClick={() => setCompare(null)}>
          <div className="compare-card" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="bad-h">Baseline agent (scripted naive loop, every tool, sandbox clone)</h3>
              <ul>
                {compare.baseline.map((a, i) => (
                  <li key={i}>
                    <code>
                      {a.tool} {a.args}
                    </code>
                    <div className="muted small">{a.outcome}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="good-h">Patchline</h3>
              <p className="small">Quarantined before any LLM saw it:</p>
              <ul>
                {compare.patchline.quarantined.map((q, i) => (
                  <li key={i}>
                    <s>{q.matched_text}</s> <span className="tag warn">{q.reason}</span>
                  </li>
                ))}
              </ul>
              <p className="small">Intake agent sees only: “{compare.patchline.cleanText || '(nothing)'}”</p>
              <p className="small">
                Intake's tools: <code>{compare.patchline.intakeTools.join(', ')}</code>. No git, no shell, no file writes.
              </p>
            </div>
            <button onClick={() => setCompare(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
