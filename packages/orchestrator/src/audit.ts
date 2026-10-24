// Every agent action goes through here: agent_run rows for lanes, audit_event rows for the trail.
import type { AgentName, AgentRun, RunStatus, StateStore } from '@patchline/core';
import { id } from './ids';

export interface RunHandle {
  id: string;
  agent: AgentName;
  clusterId?: string;
  /** Record one action with its inputs, output and the reasoning behind it. */
  log(action: string, inputs: unknown, output: unknown, reasoning?: string, reversible?: boolean): void;
  progress(summary: string): void;
  finish(status: RunStatus, summary: string): void;
}

const clip = (v: unknown, max = 20_000) => {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v ?? null);
  return s.length > max ? s.slice(0, max) + '…"' : s;
};

export class Audit {
  constructor(private store: StateStore) {}

  start(agent: AgentName, opts: { clusterId?: string; lane?: string; summary: string }): RunHandle {
    const run: AgentRun = {
      id: id('run'),
      agent,
      cluster_id: opts.clusterId,
      lane: opts.lane,
      status: 'running',
      started_at: Date.now(),
      summary: opts.summary,
    };
    this.store.upsert('agent_run', run);
    const store = this.store;
    return {
      id: run.id,
      agent,
      clusterId: opts.clusterId,
      log(action, inputs, output, reasoning = '', reversible = false) {
        store.upsert('audit_event', {
          id: id('evt'),
          agent_run_id: run.id,
          agent,
          cluster_id: opts.clusterId,
          action,
          inputs_json: clip(inputs),
          output_json: clip(output),
          reasoning,
          reversible,
          at: Date.now(),
        });
      },
      progress(summary) {
        store.update('agent_run', run.id, { summary });
      },
      finish(status, summary) {
        store.update('agent_run', run.id, { status, summary, ended_at: Date.now() });
      },
    };
  }

  /** One-off event not tied to an agent run (human approvals, system transitions). */
  event(agent: 'human' | 'system', action: string, data: { clusterId?: string; inputs?: unknown; output?: unknown; reasoning?: string; reversible?: boolean }) {
    this.store.upsert('audit_event', {
      id: id('evt'),
      agent,
      cluster_id: data.clusterId,
      action,
      inputs_json: clip(data.inputs),
      output_json: clip(data.output),
      reasoning: data.reasoning ?? '',
      reversible: data.reversible ?? false,
      at: Date.now(),
    });
  }
}
