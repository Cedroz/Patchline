// The dashboard: one responsive page for desktop and phone. Header (live state, services, demo menu),
// stats, the bug list with each bug's next action, and a side column with voice and agent activity.
// Clicking a bug opens the issue drawer.
import { useEffect, useState } from 'react';
import { get, type Meta } from './api';
import { BugList, Stats } from './components/Bugs';
import { DemoControls } from './components/DemoControls';
import { IssueDrawer } from './components/IssueDrawer';
import { Lanes } from './components/Lanes';
import { Policy } from './components/Policy';
import { QuarantineView } from './components/Quarantine';
import { Showcase } from './components/Showcase';
import { VoicePanel } from './components/Voice';
import { useLive, useTick } from './useLive';

const SERVICE_LABEL: Record<string, string> = { llm: 'AI model', fixAgent: 'Fix agent', jira: 'Jira', chat: 'Discord', voice: 'Voice', scraper: 'Steam/Reddit', store: 'Storage' };
const isMock = (v: string) => v.startsWith('mock') || v.startsWith('fixture') || v === 'memory';

export function App() {
  const { db, connected, source } = useLive();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [open, setOpen] = useState<string | null>(new URLSearchParams(location.search).get('cluster'));
  const [toast, setToast] = useState('');
  useTick();
  const services = meta ? Object.entries(meta.services) : [];
  const hasShowcase = db.cluster.some((c) => c.project === 'showcase');

  useEffect(() => {
    get<Meta>('/meta').then(setMeta).catch(() => setMeta(null));
  }, [connected]);

  // ?jira=PATCH-1 (mock Jira links) opens the matching cluster.
  useEffect(() => {
    const key = new URLSearchParams(location.search).get('jira');
    const c = key && db.cluster.find((x) => x.jira_key === key);
    if (c) setOpen(c.id);
  }, [db.cluster]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  return (
    <div className="app">
      <header>
        <div className="brand">
          <svg className="logo" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.6" />
            <rect x="5" y="5" width="6" height="6" rx="1" fill="currentColor" />
          </svg>
          patchline
          {meta && <small className="tagline">QA for {meta.game.repo.split(/[\\/]/).pop()}</small>}
        </div>
        <div className="services">
          <span className={`live-pill ${connected ? 'ok' : 'bad'}`} title={connected ? `live via ${source}` : 'disconnected'}>
            <span className={`dot ${connected ? 'ok' : 'bad'}`} />
            <span className="live-label">{connected ? 'Live' : 'Offline'}</span>
          </span>
          {meta && (
            <details className="menu">
              <summary>{services.filter(([, v]) => isMock(v)).length ? `${services.filter(([, v]) => isMock(v)).length} mocked` : 'All real'}</summary>
              <div className="menu-panel">
                <div className="svc-row">
                  <span className="muted">Live board</span>
                  <span className={`badge ${source === 'spacetimedb' ? 'real' : 'mock'}`}>{source ?? 'none'}</span>
                </div>
                {services.map(([k, v]) => (
                  <div key={k} className="svc-row">
                    <span className="muted">{SERVICE_LABEL[k] ?? k}</span>
                    <span className={`badge ${isMock(v) ? 'mock' : 'real'}`}>{v}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          <DemoControls db={db} />
        </div>
      </header>

      <main className="dash">
        <div className="dash-main">
          <Stats db={db} />
          <BugList db={db} onOpen={setOpen} onToast={flash} />
          {hasShowcase && (
            <details className="fold">
              <summary>Steam/Reddit showcase</summary>
              <Showcase db={db} />
            </details>
          )}
          <details className="fold">
            <summary>
              Security and agent permissions {db.quarantine.length ? <span className="count warn">{db.quarantine.length} quarantined</span> : null}
            </summary>
            <QuarantineView db={db} />
            <Policy meta={meta} />
          </details>
        </div>
        <div className="dash-side">
          <VoicePanel meta={meta} />
          <Lanes db={db} onOpen={setOpen} />
        </div>
      </main>

      {open && <IssueDrawer db={db} clusterId={open} meta={meta} onClose={() => setOpen(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
