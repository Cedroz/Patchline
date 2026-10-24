// In-memory StateStore with the same tables as the SpacetimeDB module. Persists to .data/state.json.
import { PRIMARY_KEY, type RowChange, type Snapshot, type StateStore, type TableName, type Tables } from '@patchline/core';
import fs from 'node:fs';
import path from 'node:path';

const TABLES = Object.keys(PRIMARY_KEY) as TableName[];

export class MemoryStore implements StateStore {
  readonly name = 'memory';
  private tables = new Map<TableName, Map<string, unknown>>();
  private listeners = new Set<(c: RowChange) => void>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private file?: string) {
    for (const t of TABLES) this.tables.set(t, new Map());
    if (file && fs.existsSync(file)) {
      try {
        const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
        for (const t of TABLES) for (const row of snap[t] ?? []) this.table(t).set(this.key(t, row as never), row);
      } catch {
        // corrupt snapshot: start empty
      }
    }
  }

  private table(t: TableName) {
    return this.tables.get(t)!;
  }

  private key<K extends TableName>(t: K, row: Tables[K]): string {
    return String(row[PRIMARY_KEY[t]]);
  }

  private emit(c: RowChange) {
    for (const fn of this.listeners) fn(c);
    this.scheduleSave();
  }

  private scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      fs.mkdirSync(path.dirname(this.file!), { recursive: true });
      fs.writeFileSync(this.file!, JSON.stringify(this.snapshot()));
    }, 250);
  }

  upsert<K extends TableName>(table: K, row: Tables[K]): void {
    this.table(table).set(this.key(table, row), structuredClone(row));
    this.emit({ op: 'upsert', table, row: structuredClone(row) });
  }

  update<K extends TableName>(table: K, key: string, patch: Partial<Tables[K]>): Tables[K] {
    const cur = this.table(table).get(key) as Tables[K] | undefined;
    if (!cur) throw new Error(`${table}/${key} not found`);
    const next = { ...cur, ...patch };
    this.upsert(table, next);
    return next;
  }

  get<K extends TableName>(table: K, key: string): Tables[K] | undefined {
    const row = this.table(table).get(key);
    return row ? (structuredClone(row) as Tables[K]) : undefined;
  }

  list<K extends TableName>(table: K, where?: (row: Tables[K]) => boolean): Tables[K][] {
    const rows = [...this.table(table).values()].map((r) => structuredClone(r) as Tables[K]);
    return where ? rows.filter(where) : rows;
  }

  remove(table: TableName, key: string): void {
    if (this.table(table).delete(key)) this.emit({ op: 'delete', table, key });
  }

  reset(): void {
    for (const t of TABLES) this.table(t).clear();
    this.emit({ op: 'reset' });
  }

  snapshot(): Snapshot {
    const out = {} as Snapshot;
    for (const t of TABLES) (out as Record<string, unknown[]>)[t] = [...this.table(t).values()];
    return out;
  }

  subscribe(fn: (c: RowChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
