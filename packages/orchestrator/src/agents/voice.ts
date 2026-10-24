// Voice agent: builds a ~20 s spoken brief and parses spoken commands into intents.
// Approve always needs a spoken "yes" confirmation. Player names and usernames are never spoken.
import type { StateStore } from '@patchline/core';
import { z } from 'zod/v4';
import type { AgentCtx } from './context';

export const IntentSchema = z.object({
  intent: z.enum(['brief', 'approve', 'confirm', 'cancel', 'details', 'repeat', 'assign', 'unknown']),
  cluster_id: z.string().nullable(),
  assignee: z.string().nullable(),
});

export interface Pending {
  action: 'approve';
  cluster_id: string;
}

/** Remove anything that looks like a handle, mention or email before it reaches TTS. */
export function scrubNames(text: string): string {
  return text.replace(/<@!?\d+>|@[\w.-]+|\b[\w.-]+@[\w-]+\.\w+\b/g, 'a player');
}

function clusterView(store: StateStore) {
  return store
    .list('cluster', (c) => c.project === 'game')
    .map((c) => ({ id: c.id, title: c.title, severity: c.severity, report_count: c.report_count, stage: store.get('pipeline', c.id)?.stage ?? 'clustered' }));
}

export async function voiceBrief(ctx: AgentCtx<'voice'>): Promise<string> {
  const clusters = clusterView(ctx.store);
  const text = await ctx.tools.llm_text({
    task: 'voice.brief',
    system: 'You write a spoken status brief (max 60 words, about 20 seconds) for a busy indie game developer. Lead with what needs their decision. No markdown, no player names, no usernames.',
    user: JSON.stringify(clusters),
    input: { clusters },
  });
  return scrubNames(text);
}

export async function voiceCommand(
  ctx: AgentCtx<'voice'>,
  utterance: string,
  pending: Pending | null,
  approve: (clusterId: string) => Promise<{ ok: boolean; reason?: string; sha?: string }>,
): Promise<{ say: string; pending: Pending | null }> {
  const clusters = clusterView(ctx.store);
  const run = ctx.audit.start('voice', { summary: `voice: "${utterance.slice(0, 60)}"` });
  const out = await ctx.tools.llm_json({
    task: 'voice.intent',
    system: 'Map a spoken command from the developer to an intent. "yes"/"confirm" = confirm. Pick the cluster the developer means by title, else null.',
    user: `Clusters: ${JSON.stringify(clusters)}\nPending confirmation: ${JSON.stringify(pending)}\nUtterance: "${utterance}"`,
    input: { utterance, clusters, pending },
    schema: IntentSchema,
    maxTokens: 300,
  });
  run.log('intent', { utterance }, out, 'Spoken command parsed into an intent');
  const byId = (cid: string | null) => clusters.find((c) => c.id === cid);
  let say: string;
  let next: Pending | null = null;

  switch (out.intent) {
    case 'approve': {
      const target = byId(out.cluster_id) ?? clusters.find((c) => c.stage === 'awaiting_approval');
      if (!target || target.stage !== 'awaiting_approval') say = 'There is no verified fix waiting for approval.';
      else {
        say = `Approving the fix for "${target.title}". Say yes to confirm.`;
        next = { action: 'approve', cluster_id: target.id };
      }
      break;
    }
    case 'confirm': {
      if (!pending) {
        say = 'There is nothing to confirm.';
        break;
      }
      const res = await approve(pending.cluster_id);
      say = res.ok ? `Done. Merged as ${res.sha!.slice(0, 7).split('').join(' ')}. Redeploying now.` : `I could not merge it: ${res.reason}.`;
      break;
    }
    case 'cancel':
      say = 'Cancelled.';
      break;
    case 'details': {
      const target = byId(out.cluster_id) ?? clusters[0];
      const pipe = target ? ctx.store.get('pipeline', target.id) : undefined;
      const culprit = pipe?.culprit_json ? JSON.parse(pipe.culprit_json) : null;
      say = target
        ? `"${target.title}": ${target.report_count} reports, ${target.severity} severity, stage ${target.stage.replace(/_/g, ' ')}.${culprit ? ` Bisect blamed the commit "${culprit.message}".` : ''}`
        : 'No open bugs.';
      break;
    }
    case 'assign':
      say = 'Assigning is not wired up yet. Use Jira for that one.';
      break;
    case 'brief':
      say = await voiceBrief(ctx);
      break;
    case 'repeat':
      say = '__repeat__';
      break;
    default:
      say = 'Sorry, I did not catch that. You can say: what is new, details, or approve.';
  }
  run.finish('passed', `${out.intent} -> ${say.slice(0, 80)}`);
  return { say: scrubNames(say), pending: next };
}
