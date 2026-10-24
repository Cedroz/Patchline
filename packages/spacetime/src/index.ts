// SpacetimeDB module: Patchline's shared live state. Tables mirror packages/core/src/types.ts one to one.
// All tables are public (dashboards subscribe directly); only the orchestrator identity may write.
// Publish: spacetime publish patchline   (from this package; see README)
import { schema, SenderError, t, table } from 'spacetimedb/server';

const str = () => t.string();
const optStr = () => t.option(t.string());
const ms = () => t.f64(); // epoch milliseconds

const report = table(
  { public: true },
  {
    id: str().primaryKey(),
    source: str(),
    author: str(),
    text: str(),
    raw_text: str(),
    created_at: ms(),
    game_version: str(),
    replay_id: optStr(),
    quarantined: t.bool(),
    cluster_id: optStr(),
    project: str(),
    external_ref: optStr(),
  },
);

const cluster = table(
  { public: true },
  {
    id: str().primaryKey(),
    title: str(),
    summary: str(),
    repro_steps_json: str(),
    report_count: t.u32(),
    first_seen: ms(),
    last_seen: ms(),
    jira_key: optStr(),
    severity: str(),
    project: str(),
    labels: t.array(t.string()),
  },
);

const pipeline = table(
  { public: true },
  {
    cluster_id: str().primaryKey(),
    stage: str(),
    culprit_commit: optStr(),
    culprit_json: optStr(),
    repro_test_path: optStr(),
    expected_error: optStr(),
    winner_candidate_id: optStr(),
    merged_sha: optStr(),
    note: optStr(),
    updated_at: ms(),
  },
);

const agent_run = table(
  { public: true },
  {
    id: str().primaryKey(),
    agent: str(),
    cluster_id: optStr(),
    lane: optStr(),
    status: str(),
    started_at: ms(),
    ended_at: t.option(t.f64()),
    summary: str(),
  },
);

const repro_attempt = table(
  { public: true },
  {
    id: str().primaryKey(),
    cluster_id: str(),
    interpretation: str(),
    test_path: str(),
    test_code: str(),
    result: str(),
    detail: str(),
  },
);

const fix_candidate = table(
  { public: true },
  {
    id: str().primaryKey(),
    cluster_id: str(),
    n: t.u32(),
    strategy: str(),
    agent: str(),
    branch: str(),
    plan: str(),
    log: str(),
    diff: str(),
    files_touched: t.array(t.string()),
    scope_ok: t.bool(),
    scope_reason: optStr(),
    repro_pass: t.option(t.bool()),
    suite_pass: t.option(t.bool()),
    breaker_total: t.option(t.u32()),
    breaker_pass_count: t.option(t.u32()),
    diff_lines: t.u32(),
    score: t.option(t.f64()),
    status: str(),
  },
);

const breaker_test = table(
  { public: true },
  { id: str().primaryKey(), cluster_id: str(), name: str(), code: str(), valid_on_good: t.bool() },
);

const audit_event = table(
  { public: true },
  {
    id: str().primaryKey(),
    agent_run_id: optStr(),
    agent: str(),
    cluster_id: optStr(),
    action: str(),
    inputs_json: str(),
    output_json: str(),
    reasoning: str(),
    reversible: t.bool(),
    at: ms(),
  },
);

const quarantine = table(
  { public: true },
  { id: str().primaryKey(), report_id: str(), matched_text: str(), reason: str(), at: ms() },
);

/** Private: which identity is the orchestrator (the only writer). */
const owner = table({}, { id: t.u32().primaryKey(), identity: t.identity() });

const spacetimedb = schema({ report, cluster, pipeline, agent_run, repro_attempt, fix_candidate, breaker_test, audit_event, quarantine, owner });
export default spacetimedb;

type Ctx = Parameters<Parameters<typeof spacetimedb.reducer>[1]>[0];

/** The first identity to call claimOwner becomes the writer; everyone else is read-only. */
function requireOwner(ctx: Ctx) {
  const o = ctx.db.owner.id.find(0);
  if (!o || !o.identity.isEqual(ctx.sender)) throw new SenderError('only the Patchline orchestrator may write');
}

export const claimOwner = spacetimedb.reducer((ctx) => {
  const o = ctx.db.owner.id.find(0);
  if (o && !o.identity.isEqual(ctx.sender)) throw new SenderError('owner already set');
  if (!o) ctx.db.owner.insert({ id: 0, identity: ctx.sender });
});

// One upsert reducer per table. Rows arrive whole, exactly as the orchestrator's StateStore holds them.
export const upsertReport = spacetimedb.reducer({ row: report.rowType }, (ctx, { row }) => {
  requireOwner(ctx);
  if (ctx.db.report.id.find(row.id)) ctx.db.report.id.update(row);
  else ctx.db.report.insert(row);
});
export const upsertCluster = spacetimedb.reducer({ row: cluster.rowType }, (ctx, { row }) => {
  requireOwner(ctx);
  if (ctx.db.cluster.id.find(row.id)) ctx.db.cluster.id.update(row);
  else ctx.db.cluster.insert(row);
});
export const upsertPipeline = spacetimedb.reducer({ row: pipeline.rowType }, (ctx, { row }) => {
  requireOwner(ctx);
  if (ctx.db.pipeline.cluster_id.find(row.cluster_id)) ctx.db.pipeline.cluster_id.update(row);
  else ctx.db.pipeline.insert(row);
});
export const upsertAgentRun = spacetimedb.reducer({ row: agent_run.rowType }, (ctx, { row }) => {
  requireOwner(ctx);
  if (ctx.db.agent_run.id.find(row.id)) ctx.db.agent_run.id.update(row);
  else ctx.db.agent_run.insert(row);
});
export const upsertReproAttempt = spacetimedb.reducer({ row: repro_attempt.rowType }, (ctx, { row }) => {
  requireOwner(ctx);
  if (ctx.db.repro_attempt.id.find(row.id)) ctx.db.repro_attempt.id.update(row);
  else ctx.db.repro_attempt.insert(row);
});
export const upsertFixCandidate = spacetimedb.reducer({ row: fix_candidate.rowType }, (ctx, { row }) => {
  requireOwner(ctx);
  if (ctx.db.fix_candidate.id.find(row.id)) ctx.db.fix_candidate.id.update(row);
  else ctx.db.fix_candidate.insert(row);
});
export const upsertBreakerTest = spacetimedb.reducer({ row: breaker_test.rowType }, (ctx, { row }) => {
  requireOwner(ctx);
  if (ctx.db.breaker_test.id.find(row.id)) ctx.db.breaker_test.id.update(row);
  else ctx.db.breaker_test.insert(row);
});
export const upsertAuditEvent = spacetimedb.reducer({ row: audit_event.rowType }, (ctx, { row }) => {
  requireOwner(ctx);
  if (!ctx.db.audit_event.id.find(row.id)) ctx.db.audit_event.insert(row); // append-only
});
export const upsertQuarantine = spacetimedb.reducer({ row: quarantine.rowType }, (ctx, { row }) => {
  requireOwner(ctx);
  if (!ctx.db.quarantine.id.find(row.id)) ctx.db.quarantine.insert(row);
});

export const deleteRow = spacetimedb.reducer({ table: t.string(), key: t.string() }, (ctx, { table, key }) => {
  requireOwner(ctx);
  if (table === 'fix_candidate') ctx.db.fix_candidate.id.delete(key);
  else if (table === 'breaker_test') ctx.db.breaker_test.id.delete(key);
  else if (table === 'repro_attempt') ctx.db.repro_attempt.id.delete(key);
  else throw new SenderError(`delete not allowed on ${table}`);
});

/** Demo reset: clears every public table. */
export const resetAll = spacetimedb.reducer((ctx) => {
  requireOwner(ctx);
  for (const r of ctx.db.report.iter()) ctx.db.report.id.delete(r.id);
  for (const r of ctx.db.cluster.iter()) ctx.db.cluster.id.delete(r.id);
  for (const r of ctx.db.pipeline.iter()) ctx.db.pipeline.cluster_id.delete(r.cluster_id);
  for (const r of ctx.db.agent_run.iter()) ctx.db.agent_run.id.delete(r.id);
  for (const r of ctx.db.repro_attempt.iter()) ctx.db.repro_attempt.id.delete(r.id);
  for (const r of ctx.db.fix_candidate.iter()) ctx.db.fix_candidate.id.delete(r.id);
  for (const r of ctx.db.breaker_test.iter()) ctx.db.breaker_test.id.delete(r.id);
  for (const r of ctx.db.audit_event.iter()) ctx.db.audit_event.id.delete(r.id);
  for (const r of ctx.db.quarantine.iter()) ctx.db.quarantine.id.delete(r.id);
});
