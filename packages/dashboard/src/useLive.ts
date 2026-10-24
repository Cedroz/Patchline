// Live subscription to shared state. Today: the orchestrator's SSE stream of row changes (same tables
// as the SpacetimeDB module). Rows are kept per table, keyed by primary key.
import { PRIMARY_KEY, type RowChange, type Snapshot, type TableName } from '@patchline/core';
import { useEffect, useReducer, useState } from 'react';
import { API } from './api';

const empty = (): Snapshot => Object.fromEntries(Object.keys(PRIMARY_KEY).map((t) => [t, []])) as unknown as Snapshot;

type Msg = RowChange | { op: 'snapshot'; data: Snapshot };

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

export function useLive(): { db: Snapshot; connected: boolean } {
  const [db, dispatch] = useReducer(reducer, undefined, empty);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const es = new EventSource(`${API}/state/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => dispatch(JSON.parse(e.data) as Msg);
    return () => es.close();
  }, []);
  return { db, connected };
}

/** Re-render every second so "x s ago" labels and running timers stay fresh. */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
