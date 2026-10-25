// Audit rows: audit_events with inputs, output and reasoning (used in the issue drawer).
import type { AuditEvent } from '@patchline/core';
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


function pretty(json: string) {
  try {
    const v = JSON.parse(json);
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  } catch {
    return json;
  }
}
