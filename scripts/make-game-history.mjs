#!/usr/bin/env node
// Builds the patchline-demo-game repo from game-base/ with a realistic commit history.
// Two planted bugs land mid-history so `git bisect` has something real to find.
//   node scripts/make-game-history.mjs [targetDir]   (default: ../blip-runner)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'game-base');
const target = path.resolve(process.argv[2] ?? process.env.GAME_REPO_PATH ?? path.join(root, '..', 'blip-runner'));

const AUTHORS = {
  mina: 'Mina Park <mina@blipzz.dev>',
  jo: 'Jo Alvarez <jo@blipzz.dev>',
  sam: 'Sam Okafor <sam@blipzz.dev>',
};

// Each step edits files with exact find/replace (asserted) or writes whole files.
const STEPS = [
  { msg: 'Tune obstacle spacing for early game', author: 'jo', edits: [['src/sim.ts', 'export const MIN_GAP = 380;', 'export const MIN_GAP = 400;']] },
  { msg: 'Warmer coin color', author: 'sam', edits: [['src/render.ts', "coin: '#facc15'", "coin: '#fbbf24'"]] },
  {
    msg: 'HUD: show best score',
    author: 'sam',
    edits: [['src/render.ts', '  ctx.fillText(`COINS ${s.coins}`, 16, 28);\n', '  ctx.fillText(`COINS ${s.coins}`, 16, 28);\n  ctx.fillText(`BEST ${formatScore(s.best)}`, 16, 50);\n']],
  },
  {
    msg: 'README: document controls',
    author: 'mina',
    tag: 'v0.2.0',
    edits: [['README.md', 'A tiny endless runner. Jump the blocks, grab the coins.\n', 'A tiny endless runner. Jump the blocks, grab the coins.\n\n## Controls\n\n- Space / Up / tap: jump\n- Down: duck\n- P / Esc: pause\n']],
  },
  {
    msg: 'refactor scoring',
    author: 'jo',
    bug: 'score-reset',
    edits: [
      [
        'src/scoring.ts',
        'export function addScore(score: number, points: number): number {\n  return score + points;\n}\n',
        '// Keep the score in a single byte cell so leaderboard payloads stay compact.\nconst scoreCell = new Uint8Array(1);\n\nexport function addScore(score: number, points: number): number {\n  scoreCell[0] = score + points;\n  return scoreCell[0];\n}\n',
      ],
    ],
  },
  { msg: 'Mobile: larger touch buttons', author: 'sam', edits: [['src/style.css', 'padding: 10px 18px;', 'padding: 14px 22px;']] },
  { msg: 'Lower max speed for readability', author: 'mina', edits: [['src/sim.ts', 'export const MAX_SPEED = 520;', 'export const MAX_SPEED = 480;']] },
  {
    msg: 'Make jump impulse frame-rate independent',
    author: 'jo',
    bug: 'pause-jump',
    edits: [['src/sim.ts', '    p.vy = -JUMP_VELOCITY;\n', '    p.vy = -(JUMP_VELOCITY * DT) / dt; // scale impulse by the frame step\n']],
  },
  {
    msg: 'Report modal: close on Escape',
    author: 'sam',
    edits: [
      [
        'src/report.ts',
        "  cancel.addEventListener('click', close);\n",
        "  cancel.addEventListener('click', close);\n  modal.addEventListener('keydown', (e) => {\n    if (e.key === 'Escape') close();\n  });\n",
      ],
    ],
  },
  { msg: 'Friendlier game over hint', author: 'mina', edits: [['src/render.ts', "'press jump to restart'", "'press jump to try again'"]] },
  {
    msg: 'Add coin pickup test',
    author: 'jo',
    files: {
      'test/coins.test.ts': `import { expect, it } from 'vitest';
import { createState, PLAYER, step, WORLD } from '../src/sim';

it('picking up a coin counts it', () => {
  const s = createState(8);
  s.coinList.push({ x: PLAYER.x + 15, y: WORLD.groundY - 20, taken: false });
  const next = step(s, 0);
  expect(next.coins).toBe(1);
  expect(next.coinList[0].taken).toBe(true);
});
`,
    },
  },
  {
    msg: 'Ground stripes for a sense of speed',
    author: 'sam',
    edits: [
      [
        'src/render.ts',
        '  ctx.fillRect(0, groundY, width, height - groundY);\n',
        "  ctx.fillRect(0, groundY, width, height - groundY);\n  ctx.fillStyle = '#475569';\n  for (let x = -(s.distance % 40); x < width; x += 40) ctx.fillRect(x, groundY + 12, 18, 3);\n",
      ],
    ],
  },
  { msg: 'Release 0.3.0', author: 'mina', tag: 'v0.3.0', edits: [['package.json', '"version": "0.1.0"', '"version": "0.3.0"']] },
];

function git(args, env = {}) {
  return execFileSync('git', args, { cwd: target, env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (['node_modules', 'dist', '__repro__'].includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function commit(msg, author, when) {
  const [name, email] = AUTHORS[author].match(/^(.*) <(.*)>$/).slice(1);
  const iso = when.toISOString();
  git(['add', '-A']);
  git(['commit', '-q', '-m', msg], {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
  return git(['rev-parse', 'HEAD']);
}

if (fs.existsSync(path.join(target, '.git'))) {
  console.error(`${target} already has a git repo. Delete it first to regenerate history.`);
  process.exit(1);
}
fs.mkdirSync(target, { recursive: true });
copyDir(base, target);
git(['init', '-q', '-b', 'main']);

const start = Date.now() - (STEPS.length + 1) * 9 * 60_000;
const bugs = {};
const first = commit('Blip Runner: seeded sim, canvas renderer, replays, report button', 'mina', new Date(start));
git(['tag', 'v0.1.0']);

STEPS.forEach((st, i) => {
  for (const [file, find, replace] of st.edits ?? []) {
    const p = path.join(target, file);
    const text = fs.readFileSync(p, 'utf8');
    if (!text.includes(find)) throw new Error(`step "${st.msg}": text not found in ${file}: ${find}`);
    fs.writeFileSync(p, text.replace(find, replace));
  }
  for (const [file, content] of Object.entries(st.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    fs.writeFileSync(path.join(target, file), content);
  }
  const sha = commit(st.msg, st.author, new Date(start + (i + 1) * 9 * 60_000));
  if (st.tag) git(['tag', st.tag]);
  if (st.bug) bugs[st.bug] = sha;
});

const manifest = { good: first, head: git(['rev-parse', 'HEAD']), bugs };
fs.writeFileSync(path.join(root, 'fixtures', 'game-history.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(git(['log', '--oneline']));
console.log('\nplanted bugs:', bugs);
