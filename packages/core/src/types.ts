// Shared row shapes. These mirror the SpacetimeDB tables one to one.

export const STAGES = [
  'reported',
  'clustered',
  'reproducing',
  'confirmed',
  'bisecting',
  'culprit_found',
  'fixing',
  'verifying',
  'awaiting_approval',
  'merged',
] as const;
export const EXIT_STAGES = ['not_reproducible', 'escalated', 'duplicate', 'reverted', 'closed'] as const;
export type Stage = (typeof STAGES)[number] | (typeof EXIT_STAGES)[number];

export type Source = 'ingame' | 'discord' | 'steam' | 'reddit' | 'fixture';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Report {
  id: string;
  source: Source;
  author: string; // never shown or spoken raw; the UI masks it
  text: string; // sanitized text (after quarantine)
  raw_text: string; // original, only ever shown in the quarantine view
  created_at: number;
  game_version: string; // commit sha or version string
  replay_id?: string;
  quarantined: boolean;
  cluster_id?: string;
  project: 'game' | 'showcase'; // showcase = Apify data for a game we do not own
  external_ref?: string; // e.g. Discord message id, for replies
}

export interface Cluster {
  id: string;
  title: string;
  summary: string;
  repro_steps_json: string;
  report_count: number;
  first_seen: number;
  last_seen: number;
  jira_key?: string;
  severity: Severity;
  project: 'game' | 'showcase';
  labels: string[];
}

/** Plain-English bug write-up. Claude drafts it from facts the deterministic stages already proved. */
export interface Writeup {
  what: string; // the bug as a player sees it
  impact: string; // who hits it and how badly
  root_cause: string; // what the culprit commit changed and why that breaks the invariant
  fix: string; // what the winning diff changes
  verification: string; // how we know: repro, suite, breakers
  risk: string; // what the fix could still miss
}

export interface Culprit {
  sha: string;
  message: string;
  author: string;
  diff: string;
  files: string[];
}

export interface Pipeline {
  cluster_id: string;
  stage: Stage;
  culprit_commit?: string;
  culprit_json?: string; // Culprit
  repro_test_path?: string;
  expected_error?: string;
  winner_candidate_id?: string;
  merged_sha?: string;
  note?: string;
  writeup_json?: string; // Writeup, drafted by the docs agent once a fix is verified

  updated_at: number;
}

export type RunStatus = 'running' | 'passed' | 'failed' | 'rejected' | 'skipped';

export interface AgentRun {
  id: string;
  agent: AgentName;
  cluster_id?: string;
  lane?: string; // e.g. "racer 2", "candidate 1"
  status: RunStatus;
  started_at: number;
  ended_at?: number;
  summary: string;
}

export interface ReproAttempt {
  id: string;
  cluster_id: string;
  interpretation: string;
  test_path: string;
  test_code: string;
  result: 'pending' | 'valid' | 'passes_on_head' | 'wrong_error' | 'fails_on_good' | 'error';
  detail: string;
}

export interface FixCandidate {
  id: string;
  cluster_id: string;
  n: number;
  strategy: string;
  agent: string; // droid | claude | mock
  branch: string;
  plan: string;
  log: string; // step-by-step trace from the fix agent
  diff: string;
  files_touched: string[];
  scope_ok: boolean;
  scope_reason?: string;
  repro_pass?: boolean;
  suite_pass?: boolean;
  breaker_total?: number;
  breaker_pass_count?: number;
  diff_lines: number;
  score?: number;
  status: 'running' | 'rejected' | 'verified' | 'failed' | 'winner' | 'merged';
}

export interface BreakerTest {
  id: string;
  cluster_id: string;
  name: string;
  code: string;
  valid_on_good: boolean;
}

export interface AuditEvent {
  id: string;
  agent_run_id?: string;
  agent: AgentName | 'human' | 'system';
  cluster_id?: string;
  action: string;
  inputs_json: string;
  output_json: string;
  reasoning: string;
  reversible: boolean;
  at: number;
}

export interface QuarantineRow {
  id: string;
  report_id: string;
  matched_text: string;
  reason: string;
  at: number;
}

export interface ReplayBlob {
  id: string;
  seed: number;
  startState?: unknown;
  inputs: number[];
  commit: string;
  created_at: number;
}

export type AgentName =
  | 'source'
  | 'quarantine'
  | 'intake'
  | 'repro'
  | 'bisect'
  | 'fix'
  | 'breaker'
  | 'verify'
  | 'merger'
  | 'baseline'
  | 'scraper'
  | 'voice'
  | 'docs';

export interface Tables {
  report: Report;
  cluster: Cluster;
  pipeline: Pipeline;
  agent_run: AgentRun;
  repro_attempt: ReproAttempt;
  fix_candidate: FixCandidate;
  breaker_test: BreakerTest;
  audit_event: AuditEvent;
  quarantine: QuarantineRow;
}
export type TableName = keyof Tables;

/** Primary key column per table. */
export const PRIMARY_KEY: { [K in TableName]: keyof Tables[K] & string } = {
  report: 'id',
  cluster: 'id',
  pipeline: 'cluster_id',
  agent_run: 'id',
  repro_attempt: 'id',
  fix_candidate: 'id',
  breaker_test: 'id',
  audit_event: 'id',
  quarantine: 'id',
};

/** Change event broadcast to dashboards. */
export type RowChange =
  | { op: 'upsert'; table: TableName; row: Tables[TableName] }
  | { op: 'delete'; table: TableName; key: string }
  | { op: 'reset' };

export type Snapshot = { [K in TableName]: Tables[K][] };
