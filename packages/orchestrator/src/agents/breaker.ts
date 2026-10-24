// Breaker agent: Claude writes edge-case tests aimed at each candidate. A breaker test is kept only if it
// passes on the oldest good commit; if it fails there, the test is wrong, not the fix.
import type { BreakerTest, Cluster, FixCandidate } from '@patchline/core';
import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import { REPRO_DIR, SIM_API_DOC } from '../game/templates';
import type { AgentCtx } from './context';

export const BreakerSchema = z.object({ tests: z.array(z.object({ name: z.string(), code: z.string() })).max(5) });

export async function runBreaker(ctx: AgentCtx<'breaker'>, cluster: Cluster, candidates: FixCandidate[], good: string): Promise<BreakerTest[]> {
  const { tools, store } = ctx;
  const drafted = new Map<string, { name: string; code: string }>();
  for (const c of candidates) {
    const run = ctx.audit.start('breaker', { clusterId: cluster.id, lane: `vs candidate ${c.n}`, summary: `writing edge cases to break candidate ${c.n}` });
    const input = { cluster: { title: cluster.title, summary: cluster.summary }, diff: c.diff };
    const out = await tools.llm_json({
      task: 'breaker.draft',
      system: `You are an adversarial tester. Write 3 to 5 small Vitest tests that probe edge cases near this bug and would catch a fix that only papers over the symptom. Each test must pass on a correct game. One test per file; each file imports what it needs.\n\n${SIM_API_DOC}`,
      user: `Bug: ${cluster.title}\n${cluster.summary}\n\nCandidate fix:\n\`\`\`diff\n${c.diff}\n\`\`\``,
      input,
      schema: BreakerSchema,
      maxTokens: 6000,
    });
    for (const t of out.tests) drafted.set(createHash('sha1').update(t.code).digest('hex').slice(0, 10), t);
    run.log('draft', input, out.tests.map((t) => t.name), 'Edge cases near the bug');
    run.finish('passed', `${out.tests.length} edge-case tests`);
  }
  if (!drafted.size) return [];

  // Validate every distinct breaker test against the known-good commit.
  const run = ctx.audit.start('breaker', { clusterId: cluster.id, lane: 'validate', summary: `checking ${drafted.size} breaker tests against the good commit` });
  const wt = await tools.sandbox_worktree(`breaker-${cluster.id}-good`, good);
  try {
    const files = [...drafted.keys()].map((h) => `${REPRO_DIR}/breaker-${h}.test.ts`);
    [...drafted.entries()].forEach(([h, t]) => tools.sandbox_write_test(wt, `${REPRO_DIR}/breaker-${h}.test.ts`, t.code));
    const res = await tools.sandbox_run_tests(wt, files);
    const tests: BreakerTest[] = [...drafted.entries()].map(([h, t]) => {
      const f = res.files.find((x) => x.file === `${REPRO_DIR}/breaker-${h}.test.ts`);
      return { id: `brk_${cluster.id}_${h}`, cluster_id: cluster.id, name: t.name, code: t.code, valid_on_good: f?.status === 'passed' };
    });
    for (const t of tests) store.upsert('breaker_test', t);
    const kept = tests.filter((t) => t.valid_on_good);
    run.log('validate', { count: tests.length }, tests.map((t) => ({ name: t.name, valid: t.valid_on_good })), 'Tests that fail on the good commit are discarded');
    run.finish('passed', `${kept.length}/${tests.length} breaker tests valid on good commit`);
    return kept;
  } finally {
    await tools.sandbox_remove(wt);
  }
}
