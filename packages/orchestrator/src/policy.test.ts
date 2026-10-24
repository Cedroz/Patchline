// Unit tests for the deterministic safety pieces: capability grants, quarantine regex, scope check, ranking.
import { describe, expect, it } from 'vitest';
import { scopeCheck } from './agents/fix';
import { score } from './agents/verify';
import { scrubNames } from './agents/voice';
import { assertPolicy, GRANTS, toolkit } from './policy/capabilities';
import { regexPass } from './policy/quarantine';
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
    expect(scrubNames('reported by @pixelpanda and jo@blipzz.dev')).toBe('reported by a player and a player');
  });
});
