// Live subscription to shared state. When the orchestrator mirrors to SpacetimeDB, the dashboard subscribes to
// SpacetimeDB directly (generated bindings in ./module_bindings); otherwise (mocks) it uses the orchestrator's
// SSE stream of the same row changes. Rows are kept per table, keyed by primary key.
import { PRIMARY_KEY, type RowChange, type Snapshot, type TableName } from '@patchline/core';
import { useEffect, useReducer, useState } from 'react';
import { API, get, type Meta } from './api';
import { DbConnection } from './module_bindings';

const empty = (): Snapshot => Object.fromEntries(Object.keys(PRIMARY_KEY).map((t) => [t, []])) as unknown as Snapshot;

type Msg = RowChange | { op: 'snapshot'; data: Snapshot };
export type LiveSource = 'spacetimedb' | 'orchestrator';

function reducer(state: Snapshot, msg: Msg): Snapshot {
  if (msg.op === 'snapshot') return { ...empty(), ...msg.data };
  if (msg.op === 'reset') return empty();
  const table = msg.table as TableName;
  const pk = PRIMARY_KEY[table] as string;
  const rows = state[table] as unknown as Record<string, unknown>[];
  if (msg.op === 'delete') return { ...state, [table]: rows.filter((r) => String(r[pk]) !== msg.key) };
  const row = msg.row as unknown as Record<string, unknown>;
  const i = rows.findIndex((r) => r[pk] === row[pk]);
  const next = i === -1 ? [...rows, row] : rows.map((r, j) => (j === i ? row : r));
  return { ...state, [table]: next };
}

/** Generated table accessors are camelCase (agent_run -> agentRun). */
const accessor = (t: string) => t.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
/** Generated rows are camelCase too (clusterId); the rest of the dashboard uses the core snake_case shape. */
const snake = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]));

type RowHandle = {
  onInsert(cb: (ctx: unknown, row: Record<string, unknown>) => void): void;
  onUpdate(cb: (ctx: unknown, old: Record<string, unknown>, row: Record<string, unknown>) => void): void;
  onDelete(cb: (ctx: unknown, row: Record<string, unknown>) => void): void;
};

function subscribeSpacetime(cfg: NonNullable<Meta['spacetime']>, dispatch: (m: Msg) => void, setConnected: (b: boolean) => void) {
  // The orchestrator reports its own view of the URI (often localhost); use the page's host so phones on the LAN work.
  const uri = new URL(cfg.uri);
  if (uri.hostname === 'localhost' || uri.hostname === '127.0.0.1') uri.hostname = location.hostname;
  const conn = DbConnection.builder()
    .withUri(uri.toString())
    .withDatabaseName(cfg.db)
    .onConnect((c) => {
      const db = c.db as unknown as Record<string, RowHandle>;
      for (const table of Object.keys(PRIMARY_KEY) as TableName[]) {
        const h = db[accessor(table)];
        const pk = PRIMARY_KEY[table] as string;
        const up = (row: Record<string, unknown>) => dispatch({ op: 'upsert', table, row: snake(row) } as unknown as RowChange);
        h.onInsert((_, row) => up(row));
        h.onUpdate((_, _old, row) => up(row));
        h.onDelete((_, row) => dispatch({ op: 'delete', table, key: String(snake(row)[pk]) } as RowChange));
      }
      c.subscriptionBuilder()
        .onApplied(() => setConnected(true))
        .onError(() => setConnected(false))
        .subscribeToAllTables();
    })
    .onConnectError(() => setConnected(false))
    .onDisconnect(() => setConnected(false))
    .build();
  return () => conn.disconnect();
}

function subscribeSse(dispatch: (m: Msg) => void, setConnected: (b: boolean) => void) {
  const es = new EventSource(`${API}/state/stream`);
  es.onopen = () => setConnected(true);
  es.onerror = () => setConnected(false);
  es.onmessage = (e) => dispatch(JSON.parse(e.data) as Msg);
  return () => es.close();
}

export function useLive(): { db: Snapshot; connected: boolean; source: LiveSource | null } {
  const [db, dispatch] = useReducer(reducer, undefined, empty);
  const [connected, setConnected] = useState(false);
  const [source, setSource] = useState<LiveSource | null>(null);
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    // A hosted build (Vercel) names its SpacetimeDB at build time, so the board stays live even when the
    // orchestrator is offline; actions (seed, approve) still need VITE_API_URL to reach it.
    const fromEnv = import.meta.env.VITE_SPACETIME_URI ? { uri: import.meta.env.VITE_SPACETIME_URI as string, db: (import.meta.env.VITE_SPACETIME_DB as string) || 'patchline' } : null;
    (fromEnv ? Promise.resolve(fromEnv) : get<Meta>('/meta').then((m) => m.spacetime, () => null))
      .then((st) => {
        if (cancelled) return;
        setSource(st ? 'spacetimedb' : 'orchestrator');
        stop = st ? subscribeSpacetime(st, dispatch, setConnected) : subscribeSse(dispatch, setConnected);
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return { db, connected, source };
}

/** Re-render every second so "x s ago" labels and running timers stay fresh. */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
