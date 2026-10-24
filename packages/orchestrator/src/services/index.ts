// Picks real or mock implementation for every external service based on config.
import type { ChatService, FixAgent, JiraService, LLM, ScraperService, StateStore, VoiceService } from '@patchline/core';
import path from 'node:path';
import type { Config } from '../config';
import { MemoryStore } from '../store/memory';
import { SpacetimeMirror } from '../store/spacetime';
import { DiscordChat, MockChat } from './chat';
import { ClaudeFixAgent, DroidFixAgent, MockFixAgent } from './fix-agents';
import { MockJira, RestJira } from './jira';
import { ClaudeLLM, MockLLM } from './llm';
import { ApifyScraper, FixtureScraper } from './scraper';
import { CartesiaVoice, MockVoice } from './voice';

export interface Services {
  store: StateStore;
  llm: LLM;
  fixAgent: FixAgent;
  jira: JiraService;
  chat: ChatService;
  voice: VoiceService;
  scraper: ScraperService;
}

export function buildServices(c: Config): Services {
  const recordings = path.join(c.fixtures, 'recordings');
  const llm: LLM = c.anthropic.mock ? new MockLLM(recordings) : new ClaudeLLM(c.anthropic.key, c.anthropic.model, recordings);

  let fixAgent: FixAgent;
  if (c.fixAgent === 'droid' && !c.droid.mock) fixAgent = new DroidFixAgent(c.droid.key);
  else if (c.fixAgent === 'claude' && !c.anthropic.mock) fixAgent = new ClaudeFixAgent(llm);
  else fixAgent = new MockFixAgent();

  const stateFile = path.join(c.dataDir, 'state.json');
  const store = c.spacetime.mock ? new MemoryStore(stateFile) : new SpacetimeMirror(c.spacetime.uri, c.spacetime.db, stateFile);

  return {
    store,
    llm,
    fixAgent,
    jira: c.jira.mock ? new MockJira(c.jira.project, c.dashboardUrl) : new RestJira(c.jira.baseUrl, c.jira.email, c.jira.token, c.jira.project),
    chat: c.discord.mock ? new MockChat() : new DiscordChat(c.discord.token, c.discord.channel),
    voice: c.cartesia.mock ? new MockVoice() : new CartesiaVoice(c.cartesia.key, c.cartesia.voice, c.cartesia.model),
    scraper: c.apify.mock ? new FixtureScraper(path.join(c.fixtures, 'showcase')) : new ApifyScraper(c.apify.token, c.apify.steamActor, c.apify.redditActor),
  };
}
