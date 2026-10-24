// Least privilege in code: each agent receives a toolkit containing only the tools in its grant.
// A tool that is not granted is simply absent from the object the agent gets, so it cannot be called.
import type { AgentName } from '@patchline/core';

export const GRANTS = {
  source: [],
  quarantine: ['llm_json'],
  intake: ['llm_json', 'jira_create', 'jira_comment'],
  repro: ['llm_json', 'sandbox_worktree', 'sandbox_write_test', 'sandbox_run_tests', 'sandbox_remove'],
  bisect: ['repo_read', 'sandbox_bisect'],
  fix: ['repo_read', 'sandbox_branch', 'sandbox_run_tests', 'sandbox_commit', 'sandbox_diff', 'fix_agent', 'jira_comment'],
  breaker: ['llm_json', 'sandbox_worktree', 'sandbox_write_test', 'sandbox_run_tests', 'sandbox_remove'],
  verify: ['sandbox_write_test', 'sandbox_run_tests'],
  merger: ['repo_merge', 'repo_push', 'sandbox_worktree', 'sandbox_write_test', 'sandbox_run_tests', 'sandbox_remove', 'jira_comment', 'jira_transition', 'chat_reply'],
  scraper: ['llm_json'],
  voice: ['llm_json', 'llm_text'],
  baseline: ['*'], // demo only, and only ever against a throwaway clone with no remote
} as const satisfies Record<AgentName, readonly string[]>;

/** Which agents read untrusted player text. None of them may hold a code or git tool. */
export const READS_UNTRUSTED_TEXT: AgentName[] = ['quarantine', 'intake', 'repro', 'scraper'];
const CODE_TOOLS = ['repo_merge', 'repo_push', 'sandbox_commit', 'sandbox_diff', 'fix_agent', 'sandbox_branch'];

export type ToolName = Exclude<(typeof GRANTS)[keyof typeof GRANTS][number], '*'>;

export function toolkit<T extends Record<string, unknown>, A extends AgentName>(agent: A, all: T): Pick<T, Extract<keyof T, (typeof GRANTS)[A][number]>> {
  const grant = GRANTS[agent] as readonly string[];
  if (grant.includes('*')) return all as never;
  const out: Record<string, unknown> = {};
  for (const name of grant) if (name in all) out[name] = all[name];
  return Object.freeze(out) as never;
}

/** Startup self-check, also shown on the dashboard's policy panel. */
export function assertPolicy(): void {
  for (const a of READS_UNTRUSTED_TEXT) {
    const bad = (GRANTS[a] as readonly string[]).filter((t) => CODE_TOOLS.includes(t) || t === '*');
    if (bad.length) throw new Error(`policy violation: ${a} reads untrusted text but holds ${bad.join(', ')}`);
  }
}
