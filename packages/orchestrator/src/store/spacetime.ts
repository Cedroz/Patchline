// Write-through mirror into SpacetimeDB. Reads stay local (MemoryStore); every change is forwarded to the
// module's upsert reducers so dashboards (and the Forge panel) can subscribe to SpacetimeDB directly.
//
// VERIFY AT THE SPACETIMEDB WORKSHOP before relying on this: the HTTP reducer-call route
// (POST {uri}/v1/database/{db}/call/{reducer}), the identity route (POST {uri}/v1/identity), and the
// SATS-JSON encoding of option fields ({"some": v} / {"none": []}). If any differ, only this file changes.
import type { RowChange, Snapshot, StateStore, TableName, Tables } from '@patchline/core';
import PQueue from 'p-queue';
import { MemoryStore } from './memory';

const REDUCER: Record<TableName, string> = {
  report: 'upsertReport',
  cluster: 'upsertCluster',
  pipeline: 'upsertPipeline',
  agent_run: 'upsertAgentRun',
  repro_attempt: 'upsertReproAttempt',
  fix_candidate: 'upsertFixCandidate',
  breaker_test: 'upsertBreakerTest',
  audit_event: 'upsertAuditEvent',
  quarantine: 'upsertQuarantine',
};

/** Columns declared t.option(...) in packages/spacetime/src/index.ts. */
const OPTIONAL: Record<TableName, string[]> = {
  report: ['replay_id', 'cluster_id', 'external_ref'],
  cluster: ['jira_key'],
  pipeline: ['culprit_commit', 'culprit_json', 'repro_test_path', 'expected_error', 'winner_candidate_id', 'merged_sha', 'note'],
  agent_run: ['cluster_id', 'lane', 'ended_at'],
  repro_attempt: [],
  fix_candidate: ['scope_reason', 'repro_pass', 'suite_pass', 'breaker_total', 'breaker_pass_count', 'score'],
  breaker_test: [],
  audit_event: ['agent_run_id', 'cluster_id'],
  quarantine: [],
};

function encode(table: TableName, row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row };
  for (const k of OPTIONAL[table]) out[k] = row[k] === undefined || row[k] === null ? { none: [] } : { some: row[k] };
  return out;
}

export class SpacetimeMirror implements StateStore {
  readonly name = 'spacetimedb';
  private local: MemoryStore;
  private q = new PQueue({ concurrency: 4 });
  private token = '';
  lastError = '';

  constructor(
    private uri: string,
    private db: string,
    file?: string,
  ) {
    this.local = new MemoryStore(file);
    this.local.subscribe((c) => this.forward(c));
  }

  private get http() {
    return this.uri.replace(/^ws/, 'http').replace(/\/$/, '');
  }

  /** Get an identity token and claim write ownership of the module. Call once at boot. */
  async connect(token?: string) {
    if (token) this.token = token;
    else {
      const res = await fetch(`${this.http}/v1/identity`, { method: 'POST' });
      if (!res.ok) throw new Error(`spacetime identity: ${res.status} ${await res.text()}`);
      this.token = ((await res.json()) as { token: string }).token;
    }
    await this.call('claimOwner', []);
    return this.token;
  }

  private async call(reducer: string, args: unknown) {
    const res = await fetch(`${this.http}/v1/database/${this.db}/call/${reducer}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      this.lastError = `${reducer}: ${res.status} ${await res.text()}`;
      console.error(`[spacetime] ${this.lastError}`);
    }
  }

  private forward(c: RowChange) {
    void this.q.add(() => {
      if (c.op === 'reset') return this.call('resetAll', []);
      if (c.op === 'delete') return this.call('deleteRow', [c.table, c.key]);
      return this.call(REDUCER[c.table], [encode(c.table, c.row as unknown as Record<string, unknown>)]);
    });
  }

  upsert<K extends TableName>(table: K, row: Tables[K]) {
    this.local.upsert(table, row);
  }
  update<K extends TableName>(table: K, key: string, patch: Partial<Tables[K]>) {
    return this.local.update(table, key, patch);
  }
  get<K extends TableName>(table: K, key: string) {
    return this.local.get(table, key);
  }
  list<K extends TableName>(table: K, where?: (row: Tables[K]) => boolean) {
    return this.local.list(table, where);
  }
  remove(table: TableName, key: string) {
    this.local.remove(table, key);
  }
  reset() {
    this.local.reset();
  }
  snapshot(): Snapshot {
    return this.local.snapshot();
  }
  subscribe(fn: (c: RowChange) => void) {
    return this.local.subscribe(fn);
  }
}
