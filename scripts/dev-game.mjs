#!/usr/bin/env node
// Runs the demo game's Vite dev server on :5174 from GAME_REPO_PATH (default ../hop-runner).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
const fromEnv = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').match(/^GAME_REPO_PATH=(.*)$/m)?.[1]?.split('#')[0].trim() : undefined;
const game = path.resolve(root, process.env.GAME_REPO_PATH ?? fromEnv ?? '../hop-runner');
const vite = path.join(game, 'node_modules', 'vite', 'bin', 'vite.js');
if (!fs.existsSync(vite)) {
  console.error(`No game at ${game}. Run: pnpm make-history && pnpm --dir ${game} install`);
  process.exit(1);
}
spawn(process.execPath, [vite, '--port', '5174', '--host'], { cwd: game, stdio: 'inherit' }).on('exit', (c) => process.exit(c ?? 0));
