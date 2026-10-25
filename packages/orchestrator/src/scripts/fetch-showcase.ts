// Pulls public Steam reviews + Reddit posts through Apify once and saves them to fixtures/showcase/,
// so the showcase demo runs offline afterwards.
//   APIFY_TOKEN=... APIFY_STEAM_ACTOR=... APIFY_REDDIT_ACTOR=... SHOWCASE_STEAM_APP_ID=... SHOWCASE_SUBREDDIT=... pnpm showcase:fetch
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { ApifyScraper, showcaseKeywords } from '../services/scraper';

if (!config.apify.token) {
  console.error('APIFY_TOKEN is not set.');
  process.exit(1);
}
const scraper = new ApifyScraper(config.apify.token, config.apify.steamActor, config.apify.redditActor);
const limit = Number(process.env.SHOWCASE_LIMIT ?? 2000);
const items = await scraper.fetch({ steamAppId: process.env.SHOWCASE_STEAM_APP_ID, subreddit: process.env.SHOWCASE_SUBREDDIT, redditKeywords: showcaseKeywords(), limit });
const dir = path.join(config.fixtures, 'showcase');
fs.mkdirSync(dir, { recursive: true });
for (const source of ['steam', 'reddit'] as const) {
  const subset = items.filter((i) => i.source === source);
  if (subset.length) fs.writeFileSync(path.join(dir, `${source}.json`), JSON.stringify(subset));
  console.log(`${source}: ${subset.length} items`);
}
