/// <reference types="vitest" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

function commitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  define: { __COMMIT_SHA__: JSON.stringify(commitSha()) },
  test: { include: ['test/**/*.test.ts', '__repro__/**/*.test.ts'], environment: 'node' },
});
