// Spec 1 "Done when" check: replay determinism, hand-written repros, bugs mid-history, bisect finds them.
//   pnpm check:game
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config';
import { bisect } from '../game/bisect';
import { GameRepo } from '../game/repo';

const repo = new GameRepo(config.gameRepo, config.sandbox);
const history = JSON.parse(fs.readFileSync(path.join(config.fixtures, 'game-history.json'), 'utf8')) as {
  good: string;
  bugs: Record<string, string>;
};
const BUGS: Record<string, { file: string; code: string }> = {
  'score-reset': { file: 'score-reset.test.ts', code: 'score_decreased' },
  'pause-jump': { file: 'pause-jump.test.ts', code: 'non_finite_position' },
};
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

const problem = await repo.check();
if (problem) {
  console.error(problem);
  process.exit(1);
}

// 1. Determinism: 100 identical replays.
const sim = await import(pathToFileURL(path.join(config.gameRepo, 'src/sim.ts')).href);
const replayMod = await import(pathToFileURL(path.join(config.gameRepo, 'src/replay.ts')).href);
const bot = await import(pathToFileURL(path.join(config.gameRepo, 'src/bot.ts')).href);
let s = sim.createState(77);
const inputs: number[] = [];
for (let i = 0; i < 1800; i++) {
  const inp = bot.botInput(s);
  inputs.push(inp);
  s = sim.step(s, inp);
}
const first = JSON.stringify(replayMod.runReplay({ seed: 77, inputs }).finalState);
let same = 0;
for (let i = 0; i < 100; i++) if (JSON.stringify(replayMod.runReplay({ seed: 77, inputs }).finalState) === first) same++;
check(same === 100, `runReplay identical on ${same}/100 runs`);

// 2. Bugs are mid-history.
const log = (await repo.log(50)).reverse();
for (const [bug, sha] of Object.entries(history.bugs)) {
  const idx = log.findIndex((c) => c.sha === sha);
  check(idx > 0 && idx < log.length - 1, `${bug} commit is mid-history (${idx + 1} of ${log.length})`);
}

// 3. Each hand-written repro fails on HEAD with the expected error and passes on the good commit.
const head = await repo.worktree('check-head', 'main');
const good = await repo.worktree('check-good', history.good);
for (const [bug, { file, code }] of Object.entries(BUGS)) {
  const test = fs.readFileSync(path.join(config.fixtures, 'repro', file), 'utf8');
  for (const wt of [head, good]) repo.writeFile(wt, `__repro__/${file}`, test);
  const onHead = await repo.vitest(head, [`__repro__/${file}`]);
  const onGood = await repo.vitest(good, [`__repro__/${file}`]);
  const headFail = onHead.files[0]?.status === 'failed' && onHead.files[0].message.includes(`InvariantError(${code})`);
  check(headFail, `${bug}: repro fails on HEAD with ${code}`);
  check(onGood.files[0]?.status === 'passed', `${bug}: repro passes on oldest good commit`);

  const r = await bisect(repo, { name: `check-${bug}`, testCode: test, expectedCode: code, good: history.good, bad: 'main', sandbox: config.sandbox });
  check(r.culprit.sha === history.bugs[bug], `${bug}: bisect found ${r.culprit.sha.slice(0, 7)} "${r.culprit.message}" in ${(r.ms / 1000).toFixed(1)}s`);
  check(r.ms < 30_000, `${bug}: bisect under 30 s`);
}
const suite = await repo.vitest(head, ['test/']);
check(suite.files.length > 0 && suite.files.every((f) => f.status === 'passed'), `baseline suite passes on HEAD (${suite.files.length} files)`);
await repo.removeWorktree(head);
await repo.removeWorktree(good);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll spec 1 checks passed');
process.exit(failures ? 1 : 0);
