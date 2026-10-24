// Orchestrator entry: wires services (real or mock), the pipeline and the HTTP server.
import { config } from './config';
import { Pipeline } from './pipeline';
import { assertPolicy } from './policy/capabilities';
import { buildServer } from './server';
import { buildServices } from './services';
import { startDiscordSource } from './sources/discord';

assertPolicy();
const services = buildServices(config);
const pipeline = new Pipeline(services, config);
const app = buildServer(pipeline);

const problem = await pipeline.repo.check();
if (problem) console.warn(`[warn] ${problem}`);

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
