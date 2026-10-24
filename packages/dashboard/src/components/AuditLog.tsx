// Audit log: every audit_event with inputs, output and reasoning.
import type { AuditEvent, Snapshot } from '@patchline/core';
import { useState } from 'react';
import { ago } from '../api';

export function AuditRows({ events }: { events: AuditEvent[] }) {
  return (
    <div className="audit">
      {events.map((e) => (
        <details key={e.id} className="audit-row">
          <summary>
            <span className={`agent agent-${e.agent}`}>{e.agent}</span>
            <code>{e.action}</code>
            <span className="audit-reason">{e.reasoning}</span>
            {e.reversible && <span className="tag">reversible</span>}
            <span className="run-time">{ago(e.at)}</span>
          </summary>
          <div className="audit-io">
            <div>
              <h5>inputs</h5>
              <pre className="code small">{pretty(e.inputs_json)}</pre>
            </div>
            <div>
              <h5>output</h5>
              <pre className="code small">{pretty(e.output_json)}</pre>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

export function AuditLog({ db }: { db: Snapshot }) {
  const [agent, setAgent] = useState('');
  const agents = [...new Set(db.audit_event.map((e) => e.agent))].sort();
  const events = db.audit_event.filter((e) => !agent || e.agent === agent).sort((a, b) => b.at - a.at).slice(0, 300);
  return (
    <div className="panel">
      <div className="filters">
        <select value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">all agents ({db.audit_event.length} events)</option>
          {agents.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </div>
      <AuditRows events={events} />
    </div>
  );
}

function pretty(json: string) {
  try {
    const v = JSON.parse(json);
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  } catch {
    return json;
  }
}
