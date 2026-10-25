// The full tool table and the per-agent context. Agents only ever see toolkit(agent, ALL_TOOLS).
import type { AgentName, ChatService, FixAgent, JiraService, LLM, StateStore } from '@patchline/core';
import type { Audit } from '../audit';
import type { Config } from '../config';
import { bisect } from '../game/bisect';
import type { GameRepo } from '../game/repo';
import { GRANTS, toolkit } from '../policy/capabilities';

export function buildTools(deps: { llm: LLM; jira: JiraService; chat: ChatService; repo: GameRepo; fixAgent: FixAgent; config: Config }) {
  const { llm, jira, chat, repo, fixAgent, config } = deps;
  return {
    llm_json: llm.json.bind(llm),
    llm_text: llm.text.bind(llm),
    jira_create: jira.createIssue.bind(jira),
    jira_comment: jira.comment.bind(jira),
    jira_label: jira.addLabel.bind(jira),
    jira_transition: jira.transition.bind(jira),
    chat_reply: chat.reply.bind(chat),
    repo_read: {
      head: (ref?: string) => repo.head(ref),
      oldestGood: () => repo.oldestGood(),
      commitInfo: (sha: string) => repo.commitInfo(sha),
    },
    sandbox_worktree: (name: string, ref: string) => repo.worktree(name, ref),
    sandbox_branch: (name: string, ref: string, branch: string) => repo.worktree(name, ref, branch),
    sandbox_write_test: (wt: string, rel: string, code: string) => {
      if (!/^__repro__\/[\w.-]+\.test\.ts$/.test(rel)) throw new Error(`test path not allowed: ${rel}`);
      repo.writeFile(wt, rel, code);
    },
    sandbox_run_tests: (wt: string, files?: string[], timeoutMs?: number) => repo.vitest(wt, files, timeoutMs),
    sandbox_remove: (wt: string) => repo.removeWorktree(wt),
    sandbox_commit: (wt: string, msg: string) => repo.commitAll(wt, msg),
    sandbox_diff: (wt: string, base: string) => repo.diffAgainst(wt, base),
    sandbox_bisect: (opts: Omit<Parameters<typeof bisect>[1], 'sandbox'>) => bisect(repo, { ...opts, sandbox: config.sandbox }),
    repo_merge: (branch: string, msg: string) => repo.merge(branch, msg),
    repo_push: () => repo.push(),
    repo_revert: (sha: string, msg: string) => repo.revert(sha, msg),
    fix_agent: fixAgent.fix.bind(fixAgent),
  };
}

export type AllTools = ReturnType<typeof buildTools>;

export interface AgentCtx<A extends AgentName> {
  store: StateStore;
  audit: Audit;
  config: Config;
  tools: Pick<AllTools, Extract<keyof AllTools, (typeof GRANTS)[A][number]>>;
}

export function ctxFor<A extends AgentName>(agent: A, base: { store: StateStore; audit: Audit; config: Config; all: AllTools }): AgentCtx<A> {
  return { store: base.store, audit: base.audit, config: base.config, tools: toolkit(agent, base.all) as AgentCtx<A>['tools'] };
}
