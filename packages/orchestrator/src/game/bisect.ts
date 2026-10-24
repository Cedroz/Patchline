// git bisect run over the game repo with a repro test. Plain code, no LLM.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommitInfo, GameRepo } from './repo';
import { REPRO_DIR } from './templates';

const STEP_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bisect-step.mjs');
const fwd = (p: string) => p.replace(/\\/g, '/');

export interface BisectResult {
  culprit: CommitInfo;
  steps: string[]; // bisect log lines, shown on the dashboard
  ms: number;
}

export async function bisect(
  repo: GameRepo,
  opts: { name: string; testCode: string; expectedCode: string; good: string; bad: string; sandbox: string },
): Promise<BisectResult> {
  const t0 = Date.now();
  const wt = await repo.worktree(`bisect-${opts.name}`, opts.bad);
  const testRel = `${REPRO_DIR}/bisect-${opts.name}.test.ts`;
  repo.writeFile(wt, testRel, opts.testCode); // untracked + gitignored, survives checkouts
  try {
    await repo.git(['bisect', 'reset'], wt).catch(() => {});
    await repo.git(['bisect', 'start', opts.bad, opts.good], wt);
    const cmd = ['bisect', 'run', fwd(process.execPath), fwd(STEP_SCRIPT), fwd(repo.vitestBin), fwd(repo.viteConfig), testRel, opts.expectedCode, fwd(opts.sandbox)];
    const out = await repo.git(cmd, wt, 300_000);
    const m = out.match(/([0-9a-f]{40}) is the first bad commit/);
    if (!m) throw new Error(`bisect did not converge:\n${out.slice(-2000)}`);
    const steps = out
      .split('\n')
      .filter((l) => /^Bisecting:|is the first bad commit|^\[[0-9a-f]{40}\]/.test(l))
      .map((l) => l.trim());
    const culprit = await repo.commitInfo(m[1]);
    return { culprit, steps, ms: Date.now() - t0 };
  } finally {
    await repo.git(['bisect', 'reset'], wt).catch(() => {});
    await repo.removeWorktree(wt);
  }
}
