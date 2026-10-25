// End-to-end check, in-process: seed fixtures -> clusters -> repro (replay + race) -> bisect -> fix tournament
// -> breaker -> verify -> approve -> merge. Uses whatever services config selects (USE_MOCKS=1 for offline).
//   pnpm --filter @patchline/orchestrator e2e
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { Pipeline } from '../pipeline';
import { assertPolicy } from '../policy/capabilities';
import { buildServices } from '../services';
import { playFixtures } from '../sources/fixture';

assertPolicy();

// Work on a disposable clone so merges never touch the real game repo.
const real = config.gameRepo;
const clone = path.join(config.sandbox, `e2e-${path.basename(real)}`);
const git = (args: string[], cwd = clone) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
if (!fs.existsSync(path.join(clone, '.git'))) {
  fs.mkdirSync(config.sandbox, { recursive: true });
  execFileSync('git', ['clone', '-q', real, clone]);
} else {
  // Drop worktrees left over from a previous run (they hold fix/* branches checked out).
  for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
    const wt = line.startsWith('worktree ') ? line.slice(9) : '';
    if (wt && path.resolve(wt) !== path.resolve(clone)) git(['worktree', 'remove', '--force', wt]);
  }
  git(['worktree', 'prune']);
  git(['fetch', '-q', 'origin']);
  git(['checkout', '-q', '-f', 'main']);
  git(['reset', '-q', '--hard', 'origin/main']);
  for (const b of git(['branch', '--format=%(refname:short)']).split('\n')) if (b.startsWith('fix/')) git(['branch', '-q', '-D', b]);
}
config.gameRepo = clone;
config.gameTools = real;
config.dataDir = path.join(config.sandbox, 'e2e-data');
config.gamePush = false;

const svc = buildServices(config);
svc.store.reset();
const p = new Pipeline(svc, config);
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
svc.store.subscribe((c) => {
  if (c.op === 'upsert' && c.table === 'pipeline') log('stage', (c.row as { cluster_id: string }).cluster_id, '->', (c.row as { stage: string }).stage);
});

const n = await playFixtures(p, config.fixtures, { intervalMs: 20 });
log(`ingested ${n} reports`);
await p.idle();

const clusters = svc.store.list('cluster', (c) => c.project === 'game');
const quarantined = svc.store.list('quarantine');
log(`${clusters.length} clusters, ${quarantined.length} quarantined spans`);
for (const c of clusters) log(` - ${c.jira_key} ${c.title} (${c.report_count}) stage=${svc.store.get('pipeline', c.id)?.stage}`);

// Injection text must never reach any later prompt: it is not in any sanitized report.
const leaked = svc.store.list('report').some((r) => /ignore all previous|--force|\.env/.test(r.text));
log(`injection leaked into sanitized text: ${leaked}`);

let failures = leaked ? 1 : 0;
for (const c of clusters) {
  const pipe = svc.store.get('pipeline', c.id)!;
  if (pipe.stage !== 'awaiting_approval') continue;
  const cands = svc.store.list('fix_candidate', (x) => x.cluster_id === c.id);
  for (const x of cands) log(`   candidate ${x.n} ${x.strategy}: ${x.status} repro=${x.repro_pass} suite=${x.suite_pass} breakers=${x.breaker_pass_count}/${x.breaker_total} diff=${x.diff_lines} score=${x.score}`);
  const w = pipe.writeup_json ? (JSON.parse(pipe.writeup_json) as { root_cause: string }) : null;
  log(`   write-up: ${w ? w.root_cause.slice(0, 140) : 'MISSING'}`);
  if (!w) failures++;
  const res = await p.approve(c.id, 'e2e');
  log(`approve ${c.title}: ${res.ok ? `merged ${res.sha?.slice(0, 7)}` : res.reason}`);
  if (!res.ok) failures++;
}
await p.idle();
const final = clusters.map((c) => ({ title: c.title, stage: svc.store.get('pipeline', c.id)?.stage }));
console.table(final);
const merged = final.filter((f) => f.stage === 'merged').length;
if (merged < 2) failures++;

// Revert the most recent merge: a new revert commit on main, suite re-run, issue reopened.
const last = clusters.map((c) => svc.store.get('pipeline', c.id)!).filter((x) => x.stage === 'merged').sort((a, b) => b.updated_at - a.updated_at)[0];
if (last) {
  const rv = await p.revert(last.cluster_id, 'e2e', 'revert check');
  const after = svc.store.get('pipeline', last.cluster_id)!;
  log(`revert ${last.merged_sha?.slice(0, 7)}: ${rv.ok ? `reverted in ${rv.sha?.slice(0, 7)}; stage=${after.stage}; ${after.note}` : rv.reason}`);
  if (!rv.ok || after.stage !== 'reverted' || /FAILS/.test(after.note ?? '')) failures++;
}
log(failures ? `FAILED (${failures})` : `OK: ${merged} bugs fixed end to end`);
process.exit(failures ? 1 : 0);
