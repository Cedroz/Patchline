// Generates demo fixtures from the real game at HEAD:
//  - fixtures/replays/score-reset.json: a bot session on the buggy build that hits the score reset,
//    captured exactly like the in-game recorder does (snapshot + last <=1800 frames).
//   pnpm fixtures
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config';

const imp = (f: string) => import(pathToFileURL(path.join(config.gameRepo, 'src', f)).href);
const sim = await imp('sim.ts');
const { InputRecorder } = await imp('recorder.ts');
const { runReplay } = await imp('replay.ts');
const { botInput } = await imp('bot.ts');
const commit = (await import('node:child_process')).execSync('git rev-parse HEAD', { cwd: config.gameRepo }).toString().trim();

let found = false;
for (let seed = 1; seed < 3000 && !found; seed++) {
  let s = sim.createState(seed);
  const rec = new InputRecorder(s);
  for (let f = 0; f < 6000; f++) {
    const input = botInput(s);
    rec.record(input);
    const next = sim.step(s, input);
    if (next.gameOver) break;
    if (next.runId === s.runId && next.score < s.score) {
      // Player notices, keeps going ~1 s, then hits Report.
      s = next;
      for (let k = 0; k < 60 && !s.gameOver; k++) {
        const i2 = botInput(s);
        rec.record(i2);
        s = sim.step(s, i2);
      }
      const { snapshot, inputs } = rec.export();
      const check = runReplay({ seed, startState: snapshot, inputs });
      if (check.error?.code !== 'score_decreased') break;
      fs.mkdirSync(path.join(config.fixtures, 'replays'), { recursive: true });
      fs.writeFileSync(path.join(config.fixtures, 'replays', 'score-reset.json'), JSON.stringify({ seed, startState: snapshot, inputs, commit }));
      console.log(`score-reset replay: seed ${seed}, ${inputs.length} frames, wraps at frame ${f}, error ${check.error.message}`);
      found = true;
      break;
    }
    s = next;
  }
}
if (!found) {
  console.error('no bot run reached the score wrap; tune the bot');
  process.exit(1);
}
