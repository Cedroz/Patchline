// Policy panel: the capability grants enforced in code, per agent.
import type { Meta } from '../api';

export function Policy({ meta }: { meta: Meta | null }) {
  if (!meta) return <div className="panel">Loading…</div>;
  const untrusted = new Set(meta.policy.readsUntrustedText);
  return (
    <div className="panel">
      <p className="muted">
        Each agent's module receives only these tool functions. Agents that read untrusted player text (highlighted) hold no code or git tools; the orchestrator refuses to start if
        that ever changes.
      </p>
      <table className="policy">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Tools</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(meta.policy.grants).map(([agent, tools]) => (
            <tr key={agent} className={untrusted.has(agent) ? 'untrusted' : ''}>
              <td>
                {agent}
                {untrusted.has(agent) && <span className="tag warn">reads player text</span>}
              </td>
              <td>{tools.length ? tools.map((t) => <code key={t}>{t}</code>) : <span className="muted">none</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">Quarantine regex rules: {meta.policy.quarantineRules.join(', ')}</p>
      <p className="small muted">
        Game repo: {meta.game.repo} · main {meta.game.head?.slice(0, 7)} · push on merge: {String(meta.game.push)}
      </p>
    </div>
  );
}
