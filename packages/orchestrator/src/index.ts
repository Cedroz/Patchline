// Orchestrator entry: wires services (real or mock), the pipeline and the HTTP server.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { Pipeline } from './pipeline';
import { assertPolicy } from './policy/capabilities';
import { buildServer } from './server';
import { buildServices } from './services';
import { startDiscordSource } from './sources/discord';
import { SpacetimeMirror } from './store/spacetime';

assertPolicy();
const services = buildServices(config);
const pipeline = new Pipeline(services, config);
const app = buildServer(pipeline);

const problem = await pipeline.repo.check();
if (problem) console.warn(`[warn] ${problem}`);

if (services.store instanceof SpacetimeMirror) {
  // The first identity to claim owns the database, so the minted token is kept across restarts.
  const tokenFile = path.join(config.dataDir, 'spacetime-token');
  const saved = process.env.SPACETIME_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : undefined);
  await services.store
    .connect(saved || undefined)
    .then(async (token) => {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(tokenFile, token);
      await (services.store as SpacetimeMirror).resync();
      console.log(`[spacetime] mirroring to ${config.spacetime.uri}/${config.spacetime.db}`);
    })
    .catch((e) => console.error('[spacetime] connect failed, continuing with local state only:', e.message));
}

if (services.chat.name === 'discord') {
  startDiscordSource(services.chat, pipeline)
    .then(() => console.log('[discord] listening on #bug-reports'))
    .catch((e) => console.error('[discord] failed to start:', e.message));
}

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Patchline orchestrator on http://localhost:${config.port}`);
console.table(
  Object.fromEntries(
    Object.entries({ llm: services.llm, fix: services.fixAgent, jira: services.jira, chat: services.chat, voice: services.voice, scraper: services.scraper, store: services.store }).map(([k, v]) => [k, v.name]),
  ),
);
