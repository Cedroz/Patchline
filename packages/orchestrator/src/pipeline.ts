// Pipeline state machine: reported -> clustered -> reproducing -> confirmed -> bisecting -> culprit_found
// -> fixing -> verifying -> awaiting_approval -> merged (exits: not_reproducible, escalated).
// The orchestrator moves stages; agents do the work with only their granted tools.
import type { Cluster, Culprit, Pipeline as PipelineRow, ReplayBlob, Report, Source, Stage } from '@patchline/core';
import fs from 'node:fs';
import path from 'node:path';
import PQueue from 'p-queue';
import { runBaseline } from './agents/baseline';
import { runBisect } from './agents/bisect';
import { runBreaker } from './agents/breaker';
import { buildTools, ctxFor, type AllTools } from './agents/context';
import { runFixTournament } from './agents/fix';
import { runIntake } from './agents/intake';
import { runMerge } from './agents/merger';
import { runRepro } from './agents/repro';
import { runShowcase } from './agents/scraper';
import { runVerify } from './agents/verify';
import { Audit } from './audit';
import type { Config } from './config';
import { GameRepo } from './game/repo';
import { id } from './ids';
import { quarantine } from './policy/quarantine';
import type { Services } from './services';

export interface IngestInput {
  source: Source;
  author: string;
  text: string;
  game_version?: string;
  external_ref?: string;
  project?: 'game' | 'showcase';
  replay?: { seed: number; startState?: unknown; inputs: number[]; commit: string };
}

export class Pipeline {
  readonly store;
  readonly audit;
  readonly repo: GameRepo;
  private all: AllTools;
  private intakeQ = new PQueue({ concurrency: 1 }); // clustering is order-sensitive
  private heavyQ = new PQueue({ concurrency: 2 }); // worktrees + vitest
  private busy = new Set<string>();
  private replayDir: string;

  constructor(
    readonly svc: Services,
    readonly config: Config,
  ) {
    this.store = svc.store;
    this.audit = new Audit(svc.store);
    this.repo = new GameRepo(config.gameRepo, config.sandbox, config.gameTools || config.gameRepo);
    this.all = buildTools({ llm: svc.llm, jira: svc.jira, chat: svc.chat, repo: this.repo, fixAgent: svc.fixAgent, config });
    this.replayDir = path.join(config.dataDir, 'replays');
    fs.mkdirSync(this.replayDir, { recursive: true });
  }

  ctx<A extends Parameters<typeof ctxFor>[0]>(agent: A) {
    return ctxFor(agent, { store: this.store, audit: this.audit, config: this.config, all: this.all });
  }

  // ------------------------------------------------------------ replays

  saveReplay(r: NonNullable<IngestInput['replay']>): ReplayBlob {
    const blob: ReplayBlob = { id: id('rp'), seed: r.seed, startState: r.startState, inputs: r.inputs, commit: r.commit, created_at: Date.now() };
    fs.writeFileSync(path.join(this.replayDir, `${blob.id}.json`), JSON.stringify(blob));
    return blob;
  }

  getReplay(rid: string): ReplayBlob | null {
    const p = path.join(this.replayDir, `${path.basename(rid)}.json`);
    return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as ReplayBlob) : null;
  }

  // ------------------------------------------------------------ stages

  private setStage(clusterId: string, stage: Stage, patch: Partial<PipelineRow> = {}) {
    const cur = this.store.get('pipeline', clusterId);
    const row: PipelineRow = { ...(cur ?? { cluster_id: clusterId }), ...patch, stage, updated_at: Date.now() } as PipelineRow;
    this.store.upsert('pipeline', row);
    this.audit.event('system', `stage.${stage}`, { clusterId, inputs: { from: cur?.stage }, output: patch });
  }

  stage(clusterId: string) {
    return this.store.get('pipeline', clusterId)?.stage;
  }

  // ------------------------------------------------------------ ingest

  async ingest(input: IngestInput): Promise<Report> {
    const replay = input.replay ? this.saveReplay(input.replay) : undefined;
    const report: Report = {
      id: id('r'),
      source: input.source,
      author: input.author,
      text: '',
      raw_text: input.text,
      created_at: Date.now(),
      game_version: input.game_version ?? input.replay?.commit ?? 'unknown',
      replay_id: replay?.id,
      quarantined: false,
      project: input.project ?? 'game',
      external_ref: input.external_ref,
    };
    this.store.upsert('report', report);
    const src = this.audit.start('source', { summary: `${input.source} report ${report.id}${replay ? ' with replay' : ''}` });
    src.log('normalize', { source: input.source, chars: input.text.length, replay: !!replay }, { id: report.id }, 'Adapter output is a Report row');
    src.finish('passed', `report ${report.id} from ${input.source}`);

    // Quarantine before any other LLM agent sees the text.
    const qctx = this.ctx('quarantine');
    const qrun = this.audit.start('quarantine', { summary: `screening report ${report.id}` });
    const q = await quarantine(input.text, qctx.tools.llm_json);
    for (const cut of q.cuts) {
      this.store.upsert('quarantine', { id: id('q'), report_id: report.id, matched_text: cut.text, reason: cut.reason, at: Date.now() });
    }
    this.store.update('report', report.id, { text: q.clean, quarantined: q.cuts.length > 0 });
    qrun.log('screen', { chars: input.text.length }, { cuts: q.cuts.length, classifier: q.classifier }, q.cuts.length ? `Removed ${q.cuts.length} suspicious span(s)` : 'Clean');
    qrun.finish(q.cuts.length ? 'rejected' : 'passed', q.cuts.length ? `quarantined ${q.cuts.length} span(s)` : 'clean');

    if (!q.clean) return this.store.get('report', report.id)!;
    const sanitized = this.store.get('report', report.id)!;
    void this.intakeQ.add(async () => {
      const cluster = await runIntake(this.ctx('intake'), sanitized);
      if (cluster && cluster.project === 'game') this.afterIntake(cluster, sanitized);
    });
    return sanitized;
  }

  private afterIntake(cluster: Cluster, report: Report) {
    const stage = this.stage(cluster.id);
    if (stage === 'clustered' || (report.replay_id && stage === 'not_reproducible')) this.scheduleRepro(cluster.id);
    else if (report.replay_id && stage === 'reproducing') this.pendingReplay.add(cluster.id);
    if (report.external_ref && cluster.jira_key) {
      void this.svc.chat.reply(report.external_ref, `Thanks! Tracking as ${cluster.jira_key}: ${this.svc.jira.issueUrl(cluster.jira_key)}`).catch(() => {});
    }
  }

  private pendingReplay = new Set<string>();

  // ------------------------------------------------------------ repro -> bisect

  scheduleRepro(clusterId: string) {
    if (this.busy.has(clusterId)) return;
    this.busy.add(clusterId);
    void this.heavyQ
      .add(() => this.reproAndBisect(clusterId))
      .catch((e) => this.fail(clusterId, e))
      .finally(() => {
        this.busy.delete(clusterId);
        if (this.pendingReplay.delete(clusterId) && this.stage(clusterId) === 'not_reproducible') this.scheduleRepro(clusterId);
        else if (this.config.autoAgentFixable && this.stage(clusterId) === 'culprit_found') this.scheduleFix(clusterId, 'auto (demo)');
      });
  }

  private async reproAndBisect(clusterId: string) {
    const cluster = this.store.get('cluster', clusterId)!;
    const problem = await this.repo.check();
    if (problem) throw new Error(problem);
    const good = await this.repo.oldestGood();
    this.setStage(clusterId, 'reproducing');
    const replays = this.store
      .list('report', (r) => r.cluster_id === clusterId && !!r.replay_id)
      .map((r) => this.getReplay(r.replay_id!))
      .filter((r): r is ReplayBlob => !!r);
    const out = await runRepro(this.ctx('repro'), cluster, replays, good);
    if (!out.ok) {
      this.setStage(clusterId, 'not_reproducible', { note: 'No valid repro after 2 rounds' });
      if (cluster.jira_key) await this.svc.jira.comment(cluster.jira_key, 'Patchline could not reproduce this yet (no repro test passed the validity rule). Asked reporters for details.');
      for (const r of this.store.list('report', (r) => r.cluster_id === clusterId && !!r.external_ref).slice(0, 3)) {
        await this.svc.chat.reply(r.external_ref!, 'Thanks! One question so we can reproduce it: what exactly did you press in the second or two before it happened?').catch(() => {});
      }
      return;
    }
    this.setStage(clusterId, 'confirmed', { repro_test_path: out.testPath, expected_error: out.expectedCode });
    if (cluster.jira_key) {
      await this.svc.jira.comment(cluster.jira_key, `Reproduced. The repro test fails on main with InvariantError(${out.expectedCode}) and passes on the oldest good commit.\n\n\`\`\`ts\n${out.testCode!.slice(0, 3000)}\n\`\`\``);
      await this.svc.jira.addLabel(cluster.jira_key, 'repro-confirmed');
    }

    this.setStage(clusterId, 'bisecting');
    const culprit = await runBisect(this.ctx('bisect'), cluster, out.testCode!, out.expectedCode!, good);
    this.setStage(clusterId, 'culprit_found', { culprit_commit: culprit.sha, culprit_json: JSON.stringify(culprit) });
    if (cluster.jira_key) {
      await this.svc.jira.comment(cluster.jira_key, `git bisect: first bad commit is ${culprit.sha.slice(0, 7)} "${culprit.message}" by ${culprit.author.replace(/<.*>/, '').trim()}.\n\n\`\`\`diff\n${culprit.diff.slice(0, 4000)}\n\`\`\``);
      if (this.config.autoAgentFixable) await this.svc.jira.addLabel(cluster.jira_key, 'agent-fixable');
    }
    // The fix stage is triggered from scheduleRepro's finally, once this job releases the cluster.
  }

  // ------------------------------------------------------------ fix -> verify

  reproFor(clusterId: string) {
    const p = this.store.get('pipeline', clusterId);
    const att = this.store.list('repro_attempt', (a) => a.cluster_id === clusterId && a.result === 'valid' && a.test_path === p?.repro_test_path)[0];
    return att ? { testCode: att.test_code, testPath: att.test_path } : null;
  }

  scheduleFix(clusterId: string, trigger: string): { ok: boolean; reason?: string } {
    const stage = this.stage(clusterId);
    if (stage !== 'culprit_found' && stage !== 'escalated') return { ok: false, reason: `cluster is at ${stage}, needs culprit_found` };
    if (this.busy.has(clusterId)) return { ok: false, reason: 'already running' };
    this.busy.add(clusterId);
    this.audit.event('system', 'fix.trigger', { clusterId, inputs: { trigger } });
    void this.heavyQ
      .add(() => this.fixAndVerify(clusterId))
      .catch((e) => this.fail(clusterId, e))
      .finally(() => this.busy.delete(clusterId));
    return { ok: true };
  }

  private async fixAndVerify(clusterId: string) {
    const cluster = this.store.get('cluster', clusterId)!;
    const pipe = this.store.get('pipeline', clusterId)!;
    const culprit = JSON.parse(pipe.culprit_json!) as Culprit;
    const repro = this.reproFor(clusterId);
    if (!repro) throw new Error('no valid repro test on record');
    const good = await this.repo.oldestGood();

    // Clear old candidates from a previous attempt.
    for (const c of this.store.list('fix_candidate', (c) => c.cluster_id === clusterId)) this.store.remove('fix_candidate', c.id);
    this.setStage(clusterId, 'fixing');
    if (cluster.jira_key) await this.svc.jira.transition(cluster.jira_key, 'In Progress');
    const runs = await runFixTournament(this.ctx('fix'), cluster, culprit, repro, { count: 2, agentName: this.svc.fixAgent.name, timeoutMs: 8 * 60_000 });

    this.setStage(clusterId, 'verifying');
    const viable = runs.filter((r) => r.candidate.scope_ok).map((r) => this.store.get('fix_candidate', r.candidate.id)!);
    const breakers = viable.length ? await runBreaker(this.ctx('breaker'), cluster, viable, good).catch(() => []) : [];
    const winner = await runVerify(this.ctx('verify'), cluster, runs, repro, breakers);

    if (!winner) {
      this.setStage(clusterId, 'escalated', { note: 'No candidate passed the verify gate' });
      if (cluster.jira_key) await this.svc.jira.comment(cluster.jira_key, 'No fix candidate passed the verify gate (repro + full suite). Escalating to a human.');
      return;
    }
    this.setStage(clusterId, 'awaiting_approval', { winner_candidate_id: winner.id });
    if (cluster.jira_key) {
      const others = this.store.list('fix_candidate', (c) => c.cluster_id === clusterId && c.id !== winner.id);
      await this.svc.jira.comment(
        cluster.jira_key,
        `Verified fix ready for approval: ${winner.branch} (${winner.strategy}, ${winner.agent}). Repro passes, full suite passes, ${winner.breaker_pass_count}/${winner.breaker_total} breaker tests survived, ${winner.diff_lines}-line diff.\n${others.map((o) => `Other candidate ${o.n}: ${o.status}${o.scope_reason ? ` (${o.scope_reason})` : ''}, breakers ${o.breaker_pass_count ?? 0}/${o.breaker_total ?? 0}`).join('\n')}\n\n\`\`\`diff\n${winner.diff.slice(0, 4000)}\n\`\`\``,
      );
    }
    for (const r of runs) if (r.candidate.id !== winner.id) await this.repo.removeWorktree(r.worktree);
  }

  // ------------------------------------------------------------ approve -> merge

  async approve(clusterId: string, by: string): Promise<{ ok: boolean; reason?: string; sha?: string }> {
    const pipe = this.store.get('pipeline', clusterId);
    if (pipe?.stage !== 'awaiting_approval' || !pipe.winner_candidate_id) return { ok: false, reason: `cluster is at ${pipe?.stage ?? 'unknown'}` };
    if (this.busy.has(clusterId)) return { ok: false, reason: 'busy' };
    this.busy.add(clusterId);
    try {
      this.audit.event('human', 'approve', { clusterId, inputs: { by, candidate: pipe.winner_candidate_id }, reasoning: 'Human approval gate' });
      const cluster = this.store.get('cluster', clusterId)!;
      const winner = this.store.get('fix_candidate', pipe.winner_candidate_id)!;
      const repro = this.reproFor(clusterId)!;
      const res = await this.heavyQ.add(() => runMerge(this.ctx('merger'), cluster, winner, repro, by));
      if (!res) throw new Error('merge did not run');
      this.store.update('fix_candidate', winner.id, { status: 'merged' });
      this.setStage(clusterId, 'merged', { merged_sha: res.sha, note: res.pushed ? 'pushed; Vercel redeploying' : 'merged locally' });
      await this.repo.removeWorktree(path.join(this.config.sandbox, `fix-${clusterId}-${winner.n}`));
      return { ok: true, sha: res.sha };
    } catch (e) {
      this.fail(clusterId, e);
      return { ok: false, reason: (e as Error).message };
    } finally {
      this.busy.delete(clusterId);
    }
  }

  private fail(clusterId: string, e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    console.error(`[pipeline] ${clusterId}:`, msg);
    this.setStage(clusterId, 'escalated', { note: msg.slice(0, 500) });
  }

  // ------------------------------------------------------------ demo extras

  async baseline(rawText: string) {
    return runBaseline(this.ctx('baseline'), rawText, this.config.gameRepo);
  }

  async showcase(limit = 2000) {
    const items = await this.svc.scraper.fetch({ steamAppId: process.env.SHOWCASE_STEAM_APP_ID, subreddit: process.env.SHOWCASE_SUBREDDIT, limit });
    return runShowcase(this.ctx('scraper'), items);
  }

  /** Resolves once no job is queued, running, or about to chain into another job. */
  async idle() {
    do {
      await this.intakeQ.onIdle();
      await this.heavyQ.onIdle();
      await new Promise((r) => setTimeout(r, 50));
    } while (this.busy.size || this.intakeQ.size || this.intakeQ.pending || this.heavyQ.size || this.heavyQ.pending);
  }
}
