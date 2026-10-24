// Dashboard shell: header, demo controls, tabs (board, audit, quarantine, showcase, policy), issue drawer.
import { useEffect, useState } from 'react';
import { get, type Meta } from './api';
import { AuditLog } from './components/AuditLog';
import { Board } from './components/Board';
import { DemoControls } from './components/DemoControls';
import { IssueDrawer } from './components/IssueDrawer';
import { Lanes } from './components/Lanes';
import { Policy } from './components/Policy';
import { QuarantineView } from './components/Quarantine';
import { Showcase } from './components/Showcase';
import { useLive, useTick } from './useLive';

const TABS = ['Board', 'Audit log', 'Quarantine', 'Showcase', 'Policy'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const { db, connected } = useLive();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tab, setTab] = useState<Tab>('Board');
  const [open, setOpen] = useState<string | null>(new URLSearchParams(location.search).get('cluster'));
  useTick();

  useEffect(() => {
    get<Meta>('/meta').then(setMeta).catch(() => setMeta(null));
  }, [connected]);

  // ?jira=PATCH-1 (mock Jira links) opens the matching cluster.
  useEffect(() => {
    const key = new URLSearchParams(location.search).get('jira');
    const c = key && db.cluster.find((x) => x.jira_key === key);
    if (c) setOpen(c.id);
  }, [db.cluster]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">◆</span> Patchline <small>AI QA team for indie games</small>
        </div>
        <div className="services">
          <span className={`dot ${connected ? 'ok' : 'bad'}`} title={connected ? 'live' : 'disconnected'} />
          {meta &&
            Object.entries(meta.services).map(([k, v]) => (
              <span key={k} className={`badge ${v.startsWith('mock') || v.startsWith('fixture') || v === 'memory' ? 'mock' : 'real'}`} title={k}>
                {k}: {v}
              </span>
            ))}
        </div>
      </header>
      <DemoControls db={db} />
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
            {t === 'Quarantine' && db.quarantine.length ? <span className="count">{db.quarantine.length}</span> : null}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'Board' && (
          <div className="board-layout">
            <Board db={db} onOpen={setOpen} />
            <Lanes db={db} onOpen={setOpen} />
          </div>
        )}
        {tab === 'Audit log' && <AuditLog db={db} />}
        {tab === 'Quarantine' && <QuarantineView db={db} />}
        {tab === 'Showcase' && <Showcase db={db} />}
        {tab === 'Policy' && <Policy meta={meta} />}
      </main>
      {open && <IssueDrawer db={db} clusterId={open} meta={meta} onClose={() => setOpen(null)} />}
    </div>
  );
}
