// Fixture source: replays saved reports (fixtures/reports/*.json) into the pipeline on a timer. Powers demo mode.
import fs from 'node:fs';
import path from 'node:path';
import type { IngestInput, Pipeline } from '../pipeline';

export interface FixtureReport extends Omit<IngestInput, 'replay'> {
  replay_file?: string; // fixtures/replays/<file>.json
  delay_ms?: number;
}

export function loadFixtureReports(fixturesDir: string, file = 'demo-reports.json'): FixtureReport[] {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, 'reports', file), 'utf8'));
}

export async function playFixtures(pipeline: Pipeline, fixturesDir: string, opts: { file?: string; intervalMs?: number; filter?: (r: FixtureReport) => boolean } = {}) {
  const reports = loadFixtureReports(fixturesDir, opts.file).filter(opts.filter ?? (() => true));
  let n = 0;
  for (const r of reports) {
    const replay = r.replay_file ? JSON.parse(fs.readFileSync(path.join(fixturesDir, 'replays', r.replay_file), 'utf8')) : undefined;
    const { replay_file: _f, delay_ms, ...rest } = r;
    await pipeline.ingest({ ...rest, replay });
    n++;
    await new Promise((res) => setTimeout(res, delay_ms ?? opts.intervalMs ?? 150));
  }
  return n;
}
