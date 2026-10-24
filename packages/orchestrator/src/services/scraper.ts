// Apify client for the Steam/Reddit showcase, and a mock that reads saved datasets from fixtures/showcase.
import type { ScrapedItem, ScraperService } from '@patchline/core';
import fs from 'node:fs';
import path from 'node:path';

type Item = Record<string, unknown>;

const str = (...vals: unknown[]) => vals.find((v) => typeof v === 'string' && v.trim()) as string | undefined;

/** Map whatever field names an actor uses onto ScrapedItem. */
export function normalizeItem(source: 'steam' | 'reddit', item: Item, i: number): ScrapedItem | null {
  const author = item.author as Item | string | undefined;
  const text = str(item.review, item.text, item.body, item.selftext, item.content, [item.title, item.body].filter(Boolean).join('\n'));
  if (!text) return null;
  const ts = item.timestamp_created ?? item.created_utc ?? item.createdAt ?? item.date;
  const created = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : typeof ts === 'string' ? Date.parse(ts) || Date.now() : Date.now();
  return {
    source,
    id: String(item.recommendationid ?? item.id ?? item.url ?? `${source}-${i}`),
    author: typeof author === 'string' ? author : String(author?.steamid ?? author?.name ?? item.username ?? 'anon'),
    text: text.slice(0, 4000),
    created_at: created,
    url: str(item.url, item.permalink),
  };
}

export class ApifyScraper implements ScraperService {
  readonly name = 'apify';
  constructor(
    private token: string,
    private steamActor: string,
    private redditActor: string,
  ) {}

  private async runActor(actor: string, input: Item, source: 'steam' | 'reddit', limit: number) {
    const { ApifyClient } = await import('apify-client');
    const client = new ApifyClient({ token: this.token });
    const run = await client.actor(actor).call(input);
    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit });
    return items.map((it, i) => normalizeItem(source, it as Item, i)).filter((x): x is ScrapedItem => !!x);
  }

  async fetch(opts: { steamAppId?: string; subreddit?: string; limit: number }) {
    const out: ScrapedItem[] = [];
    // Actor inputs differ per actor; these are the common field names. Adjust to the actor you pick.
    if (opts.steamAppId && this.steamActor) out.push(...(await this.runActor(this.steamActor, { appId: opts.steamAppId, appIds: [opts.steamAppId], maxReviews: opts.limit }, 'steam', opts.limit)));
    if (opts.subreddit && this.redditActor) out.push(...(await this.runActor(this.redditActor, { startUrls: [{ url: `https://www.reddit.com/r/${opts.subreddit}/` }], maxItems: opts.limit }, 'reddit', opts.limit)));
    return out;
  }
}

export class FixtureScraper implements ScraperService {
  readonly name = 'fixture-scraper';
  constructor(private dir: string) {}

  async fetch(opts: { limit: number }) {
    if (!fs.existsSync(this.dir)) return [];
    const items: ScrapedItem[] = [];
    for (const f of fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'))) {
      items.push(...(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as ScrapedItem[]));
    }
    return items.slice(0, opts.limit);
  }
}
