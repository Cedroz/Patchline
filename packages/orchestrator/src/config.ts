// Loads .env from the monorepo root and decides, per service, whether to use the real client or the mock.
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: path.join(ROOT, '.env'), quiet: true });

const env = process.env;
const flag = (v?: string) => v === '1' || v === 'true';
const allMocks = flag(env.USE_MOCKS);

/** A service is mocked if USE_MOCKS=1, its MOCK_<NAME>=1, or its key is missing. */
function mocked(name: string, ...required: (string | undefined)[]): boolean {
  return allMocks || flag(env[`MOCK_${name}`]) || required.some((v) => !v);
}

export const config = {
  port: Number(env.PORT ?? 8787),
  publicUrl: env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 8787}`,
  dashboardUrl: env.DASHBOARD_URL ?? 'http://localhost:5173',
  gameRepo: path.resolve(ROOT, env.GAME_REPO_PATH ?? '../blip-runner'),
  gameTools: '' as string, // where node_modules for tests live; empty = gameRepo
  gamePush: flag(env.GAME_REPO_PUSH),
  gameLiveUrl: env.GAME_LIVE_URL ?? '',
  autoAgentFixable: env.AUTO_AGENT_FIXABLE !== '0',
  sandbox: path.join(ROOT, '.sandbox'),
  dataDir: path.join(ROOT, '.data'),
  fixtures: path.join(ROOT, 'fixtures'),
  forgeSecret: env.FORGE_WEBHOOK_SECRET ?? 'change-me',

  anthropic: { key: env.ANTHROPIC_API_KEY ?? '', model: env.ANTHROPIC_MODEL ?? 'claude-opus-5-5', mock: mocked('CLAUDE', env.ANTHROPIC_API_KEY) },
  fixAgent: (env.FIX_AGENT ?? 'droid') as 'droid' | 'claude' | 'mock',
  droid: { key: env.FACTORY_API_KEY ?? '', mock: mocked('DROID', env.FACTORY_API_KEY) },
  jira: {
    baseUrl: (env.JIRA_BASE_URL ?? '').replace(/\/$/, ''),
    email: env.JIRA_EMAIL ?? '',
    token: env.JIRA_API_TOKEN ?? '',
    project: env.JIRA_PROJECT_KEY ?? 'PATCH',
    mock: mocked('JIRA', env.JIRA_EMAIL, env.JIRA_API_TOKEN, env.JIRA_BASE_URL),
  },
  spacetime: { uri: env.SPACETIME_URI ?? 'ws://localhost:3000', db: env.SPACETIME_DB ?? 'patchline', mock: mocked('SPACETIME', env.SPACETIME_URI) },
  discord: { token: env.DISCORD_BOT_TOKEN ?? '', channel: env.DISCORD_CHANNEL_ID ?? '', mock: mocked('DISCORD', env.DISCORD_BOT_TOKEN, env.DISCORD_CHANNEL_ID) },
  cartesia: {
    key: env.CARTESIA_API_KEY ?? '',
    voice: env.CARTESIA_VOICE_ID ?? '',
    model: env.CARTESIA_MODEL ?? 'sonic-3.6',
    mock: mocked('CARTESIA', env.CARTESIA_API_KEY, env.CARTESIA_VOICE_ID),
  },
  apify: {
    token: env.APIFY_TOKEN ?? '',
    steamActor: env.APIFY_STEAM_ACTOR ?? '',
    redditActor: env.APIFY_REDDIT_ACTOR ?? '',
    mock: mocked('APIFY', env.APIFY_TOKEN),
  },
};

export type Config = typeof config;
