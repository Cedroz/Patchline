// One real Droid fix run on the score-reset bug, in a disposable clone. Proves the Droid wiring end to end:
// permission handler, streamed steps, scope check, repro + suite on the result.
//   pnpm droid:smoke            (needs FACTORY_API_KEY in .env and the droid CLI on PATH)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { scopeCheck } from '../agents/fix';
import { config } from '../config';
import { GameRepo } from '../game/repo';
import { DroidFixAgent } from '../services/fix-agents';

if (!config.droid.key) {
  console.error('FACTORY_API_KEY is not set in .env');
  process.exit(1);
}

const real = config.gameRepo;
const clone = path.join(config.sandbox, `droid-smoke-${path.basename(real)}`);
if (!fs.existsSync(path.join(clone, '.git'))) {
  fs.mkdirSync(config.sandbox, { recursive: true });
  execFileSync('git', ['clone', '-q', real, clone]);
}
const repo = new GameRepo(clone, config.sandbox, real);
const history = JSON.parse(fs.readFileSync(path.join(config.fixtures, 'game-history.json'), 'utf8')) as { bugs: Record<string, string> };
const culprit = await repo.commitInfo(history.bugs['score-reset']);
const testPath = '__repro__/score-reset.test.ts';
const testCode = fs.readFileSync(path.join(config.fixtures, 'repro', 'score-reset.test.ts'), 'utf8');
const base = await repo.head('origin/main');

const wt = await repo.worktree('droid-smoke-1', base, 'fix/droid-smoke/1');
repo.writeFile(wt, testPath, testCode);
console.log(`worktree ${wt}\nallowlist ${culprit.files.join(', ')}\n`);

const t0 = Date.now();
const result = await new DroidFixAgent(config.droid.key).fix({
  clusterId: 'smoke',
  n: 1,
  strategy: 'root_cause',
  instructions: 'Fix the root cause introduced by the culprit commit, keeping the intent of unrelated changes.',
  worktree: wt,
  allowlist: culprit.files,
  failingTestPath: testPath,
  failingTestCode: testCode,
  culpritDiff: culprit.diff,
  bugTitle: 'Score resets to near zero after ~255 points',
  onStep: (line) => console.log(`  | ${line.replace(/\n/g, '\n  | ')}`),
});
console.log(`\nDroid finished in ${((Date.now() - t0) / 1000).toFixed(0)} s. Plan:\n${result.plan}\n`);

await repo.commitAll(wt, 'Droid smoke fix');
const { diff, files } = await repo.diffAgainst(wt, base);
const scope = scopeCheck(files, culprit.files);
console.log(diff || '(no diff)');
console.log(`\nscope check: ${scope.ok ? 'OK' : `REJECTED (${scope.reason})`}`);
const run = await repo.vitest(wt, [], 120_000);
const repro = run.files.find((f) => f.file === testPath)?.status === 'passed';
const suite = run.files.filter((f) => !f.file.startsWith('__repro__/')).every((f) => f.status === 'passed');
console.log(`repro test: ${repro ? 'PASS' : 'FAIL'} · full suite: ${suite ? 'PASS' : 'FAIL'}`);
await repo.removeWorktree(wt);
process.exit(scope.ok && repro && suite ? 0 : 1);
