// One interface per external service. Each has a real and a Mock* implementation in the orchestrator.
import type { RowChange, Snapshot, TableName, Tables } from './types';

/** Minimal schema contract so core does not depend on zod; zod schemas satisfy it. */
export interface Parser<T> {
  parse(value: unknown): T;
}

export interface LLMRequest<T> {
  /** Stable task id, e.g. "intake.classify". Mocks dispatch on it; recordings are keyed by it. */
  task: string;
  system: string;
  user: string;
  /** Structured copy of what is in `user`, so mocks can answer without parsing prose. */
  input: unknown;
  schema: Parser<T>;
  maxTokens?: number;
}

export interface LLM {
  readonly name: string;
  json<T>(req: LLMRequest<T>): Promise<T>;
  text(req: Omit<LLMRequest<string>, 'schema'>): Promise<string>;
}

export interface FixRequest {
  clusterId: string;
  n: number;
  strategy: 'smallest' | 'root_cause';
  instructions: string;
  worktree: string; // the agent may only work inside this directory
  allowlist: string[]; // repo-relative files it may edit
  failingTestPath: string; // repo-relative
  failingTestCode: string;
  culpritDiff: string;
  bugTitle: string;
  onStep: (line: string) => void; // streamed into the candidate's visible log
}

export interface FixResult {
  plan: string;
  summary: string;
  agent: string;
}

export interface FixAgent {
  readonly name: string;
  fix(req: FixRequest): Promise<FixResult>;
}

export interface JiraIssueRef {
  key: string;
  url: string;
}

export interface JiraService {
  readonly name: string;
  createIssue(input: { summary: string; description: string; labels: string[]; severity: string }): Promise<JiraIssueRef>;
  comment(key: string, body: string): Promise<void>;
  addLabel(key: string, label: string): Promise<void>;
  transition(key: string, to: 'In Progress' | 'Done'): Promise<void>;
  issueUrl(key: string): string;
}

export interface ChatService {
  readonly name: string;
  /** Reply in the thread of an external message (Discord). */
  reply(externalRef: string, text: string): Promise<void>;
  start(onMessage: (msg: { id: string; author: string; text: string; at: number }) => void): Promise<void>;
}

export interface VoiceService {
  readonly name: string;
  /** Returns audio bytes (audio/wav or mpeg) or null to tell the client to use browser TTS. */
  tts(text: string): Promise<{ contentType: string; audio: Uint8Array } | null>;
}

export interface ScrapedItem {
  source: 'steam' | 'reddit';
  id: string;
  author: string;
  text: string;
  created_at: number;
  url?: string;
}

export interface ScraperService {
  readonly name: string;
  fetch(opts: { steamAppId?: string; subreddit?: string; limit: number }): Promise<ScrapedItem[]>;
}

/** Shared live state. Real impl is SpacetimeDB; the mock is in-memory with the same tables. */
export interface StateStore {
  readonly name: string;
  upsert<K extends TableName>(table: K, row: Tables[K]): void;
  update<K extends TableName>(table: K, key: string, patch: Partial<Tables[K]>): Tables[K];
  get<K extends TableName>(table: K, key: string): Tables[K] | undefined;
  list<K extends TableName>(table: K, where?: (row: Tables[K]) => boolean): Tables[K][];
  remove(table: TableName, key: string): void;
  reset(): void;
  snapshot(): Snapshot;
  subscribe(fn: (change: RowChange) => void): () => void;
}
