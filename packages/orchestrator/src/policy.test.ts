// Unit tests for the deterministic safety pieces: capability grants, quarantine regex, scope check, ranking.
import { describe, expect, it } from 'vitest';
import { scopeCheck } from './agents/fix';
import { score } from './agents/verify';
import { scrubNames } from './agents/voice';
import { assertPolicy, GRANTS, toolkit } from './policy/capabilities';
import { regexPass } from './policy/quarantine';
import { commandAllowed, describeToolCall, describeToolResult } from './services/fix-agents';
import { INJECTION_POST } from './server';

describe('capabilities', () => {
  it('agents that read player text hold no code tools', () => {
    expect(() => assertPolicy()).not.toThrow();
  });

  it('toolkit only exposes granted tools', () => {
    const all = { llm_json: () => 1, repo_push: () => 2, jira_create: () => 3, jira_comment: () => 4 };
    const tk = toolkit('intake', all) as Record<string, unknown>;
    expect(Object.keys(tk).sort()).toEqual(['jira_comment', 'jira_create', 'llm_json']);
    expect(tk.repo_push).toBeUndefined();
    expect(GRANTS.intake).not.toContain('repo_push');
  });
});

describe('quarantine regex pass', () => {
  it('cuts the injection sentences and keeps the complaint', () => {
    const { clean, cuts } = regexPass(INJECTION_POST);
    expect(clean).toBe('The score keeps resetting after 255 points, super annoying.');
    expect(cuts.length).toBe(3);
  });

  it('leaves ordinary complaints alone', () => {
    const text = 'if i pause and hit jump the game freezes, have to reload the page';
    expect(regexPass(text)).toEqual({ clean: text, cuts: [] });
  });

  it('cuts links to unknown hosts', () => {
    expect(regexPass('see https://evil.example/x for logs').cuts[0].reason).toMatch(/unknown-host/);
  });
});

describe('scope check', () => {
  it('accepts edits inside the allowlist', () => {
    expect(scopeCheck(['src/scoring.ts'], ['src/scoring.ts']).ok).toBe(true);
  });
  it('rejects test edits and files outside the allowlist', () => {
    expect(scopeCheck(['test/sim.test.ts'], ['src/scoring.ts']).ok).toBe(false);
    expect(scopeCheck(['src/sim.ts'], ['src/scoring.ts']).ok).toBe(false);
    expect(scopeCheck([], ['src/scoring.ts']).ok).toBe(false);
  });
});

describe('verify ranking', () => {
  it('gates on repro + suite, then prefers breakers, then smaller diffs', () => {
    expect(score({ repro_pass: false, suite_pass: true, breaker_pass_count: 3, diff_lines: 1 })).toBe(0);
    const a = score({ repro_pass: true, suite_pass: true, breaker_pass_count: 0, diff_lines: 2 });
    const b = score({ repro_pass: true, suite_pass: true, breaker_pass_count: 3, diff_lines: 6 });
    expect(b).toBeGreaterThan(a);
  });
});

describe('voice', () => {
  it('never speaks handles or emails', () => {
    expect(scrubNames('reported by @pixelpanda and jo@example.dev')).toBe('reported by a player and a player');
  });
});

describe('droid commands', () => {
  const wt = String.raw`C:\repo\.sandbox\fix-c_1-1`;
  it('allows the repro and read-only git, in the worktree', () => {
    expect(commandAllowed('node node_modules/vitest/vitest.mjs run __repro__/a.test.ts', wt)).toBe(true);
    expect(commandAllowed('git diff', wt)).toBe(true);
    expect(commandAllowed(`git -C ${wt} status --short`, wt)).toBe(true);
    expect(commandAllowed(`git -C "${wt}" diff`, wt)).toBe(true);
  });
  it('refuses other directories, writes and chaining', () => {
    expect(commandAllowed(`git -C ${wt}0 diff`, wt)).toBe(false); // sibling fix-c_1-10 shares the prefix
    expect(commandAllowed(String.raw`git -C ${wt}\..\other diff`, wt)).toBe(false);
    expect(commandAllowed(String.raw`git -C ${wt}\src diff`, wt)).toBe(true); // a subfolder is still the worktree
    expect(commandAllowed(`git -C ${wt} push`, wt)).toBe(false);
    expect(commandAllowed('git diff --output=../evil.ts', wt)).toBe(false);
    expect(commandAllowed('git status && rm -rf .', wt)).toBe(false);
    expect(commandAllowed('npm install left-pad', wt)).toBe(false);
  });
});

describe('droid trace', () => {
  it('turns vitest output into a test verdict', () => {
    const fail = ' RUN  v2.1.9\n ❯ __repro__/a.test.ts (1)\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n';
    const pass = ' Test Files  1 passed (1)\n      Tests  1 passed (1)\n';
    expect(describeToolResult('Execute', fail, true)).toBe('[test] FAIL · 1 failed (1)');
    expect(describeToolResult('Execute', pass, false)).toBe('[test] PASS · 1 passed (1)');
    expect(describeToolResult('Read', 'export const x = 1', false)).toBe('[result] Read ok');
  });
  it('names what a tool call touched', () => {
    expect(describeToolCall('Execute', { command: 'git diff' }, '/wt')).toBe('[run] git diff');
    expect(describeToolCall('Read', { file_path: '/wt/src/sim.ts' }, '/wt')).toMatch(/^\[read\] src[\\/]sim\.ts$/);
  });
});

describe('droid trace labels', () => {
  it('names the patched file and keeps planning out of edits', () => {
    expect(describeToolCall('ApplyPatch', { input: '*** Begin Patch\n*** Update File: src/scoring.ts\n@@' }, '/wt')).toBe('[edit] src/scoring.ts');
    expect(describeToolCall('TodoWrite', { todos: [] }, '/wt')).toBe('[plan] updated its to-do list');
  });
});
