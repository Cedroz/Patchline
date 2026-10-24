#!/usr/bin/env node
// Called by `git bisect run` at each commit. Exit 0 = good, 1 = bad, 125 = skip (cannot test).
//   node bisect-step.mjs <vitestBin> <viteConfig> <testFile> <expectedCode> <resultDir>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [vitestBin, viteConfig, testFile, expectedCode, resultDir] = process.argv.slice(2);
const wt = process.cwd();
const out = path.join(resultDir, `bisect-${Date.now()}-${process.pid}.json`);

spawnSync(process.execPath, [vitestBin, 'run', '--root', wt, '--config', viteConfig, '--reporter=json', `--outputFile=${out}`, testFile], {
  cwd: wt,
  stdio: 'ignore',
  timeout: 60_000,
});

if (!fs.existsSync(out)) process.exit(125);
const json = JSON.parse(fs.readFileSync(out, 'utf8'));
fs.rmSync(out, { force: true });
const file = json.testResults?.[0];
if (!file) process.exit(125);
if (file.status === 'passed') process.exit(0);
const text = [file.message, ...(file.assertionResults ?? []).flatMap((a) => a.failureMessages ?? [])].join('\n');
// Bad only if it fails for the expected reason; any other failure means we cannot judge this commit.
process.exit(text.includes(`InvariantError(${expectedCode})`) ? 1 : 125);
