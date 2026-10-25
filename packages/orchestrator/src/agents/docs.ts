// Docs agent: once the verify gate picks a winner, Claude writes the plain-English write-up (what broke, why,
// what the fix changes) from facts the deterministic stages already proved. It drafts prose; it decides nothing.
import type { Cluster, Culprit, FixCandidate, Writeup } from '@patchline/core';
import { z } from 'zod/v4';
import type { AgentCtx } from './context';

export const WriteupSchema = z.object({
  what: z.string(),
  impact: z.string(),
  root_cause: z.string(),
  fix: z.string(),
  verification: z.string(),
  risk: z.string(),
});

const SYSTEM = `You write the bug write-up an indie game developer reads before approving an automated fix.
Use only the facts given: they were established by a replayed repro test, git bisect and a verify gate. Do not speculate beyond them.
Each field is 1 to 3 plain sentences for someone who knows the game but has not read the code:
- what: the bug as a player experiences it.
- impact: who hits it and how badly, from the report count and severity.
- root_cause: what the culprit commit changed and why that breaks the invariant. Name the function or line.
- fix: what the winning diff changes and why that restores the invariant.
- verification: how it was proven (repro now passes, full suite passes, breaker tests survived).
- risk: what the fix could still miss, or "None known" if the evidence covers it.
Never include player names.`;

export interface DocsFacts {
  cluster: Cluster;
  reproInterpretation: string;
  invariant: string;
  culprit: Culprit;
  winner: FixCandidate;
}

export async function runDocs(ctx: AgentCtx<'docs'>, f: DocsFacts): Promise<Writeup | null> {
  const { tools } = ctx;
  const run = ctx.audit.start('docs', { clusterId: f.cluster.id, summary: `writing up ${f.cluster.title}` });
  const input = {
    bug: { title: f.cluster.title, summary: f.cluster.summary, reports: f.cluster.report_count, severity: f.cluster.severity },
    repro: { interpretation: f.reproInterpretation, invariant: f.invariant },
    culprit: { sha: f.culprit.sha.slice(0, 7), message: f.culprit.message, files: f.culprit.files, diff: f.culprit.diff.slice(0, 4000) },
    fix: {
      strategy: f.winner.strategy,
      agent: f.winner.agent,
      plan: f.winner.plan,
      diff: f.winner.diff.slice(0, 4000),
      gates: { repro: f.winner.repro_pass, suite: f.winner.suite_pass, breakers: `${f.winner.breaker_pass_count ?? 0}/${f.winner.breaker_total ?? 0}` },
    },
  };
  try {
    const out = await tools.llm_json({
      task: 'docs.writeup',
      system: SYSTEM,
      user: `Verified facts:\n${JSON.stringify(input, null, 1)}`,
      input,
      schema: WriteupSchema,
      maxTokens: 2000,
    });
    run.log('writeup', input, out, 'Prose drafted from verified facts only');
    run.finish('passed', 'write-up ready');
    return out;
  } catch (e) {
    run.finish('failed', `write-up failed: ${(e as Error).message}`);
    return null;
  }
}

/** Jira-comment rendering of a write-up. */
export function writeupText(w: Writeup) {
  return [
    `What happens: ${w.what}`,
    `Impact: ${w.impact}`,
    `Root cause: ${w.root_cause}`,
    `The fix: ${w.fix}`,
    `How we know: ${w.verification}`,
    `Risk: ${w.risk}`,
  ].join('\n\n');
}
