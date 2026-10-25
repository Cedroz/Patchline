// Apify client for the Steam/Reddit showcase, and a mock that reads saved datasets from fixtures/showcase.
import type { ScrapedItem, ScraperService } from '@patchline/core';
import fs from 'node:fs';
import path from 'node:path';

type Item = Record<string, unknown>;

const str = (...vals: unknown[]) => vals.find((v) => typeof v === 'string' && v.trim()) as string | undefined;

/** SHOWCASE_REDDIT_KEYWORDS="bug,crash" narrows the subreddit to posts matching any of these. */
export const showcaseKeywords = () =>
  (process.env.SHOWCASE_REDDIT_KEYWORDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Map whatever field names an actor uses onto ScrapedItem. */
export function normalizeItem(source: 'steam' | 'reddit', item: Item, i: number): ScrapedItem | null {
  const author = item.author as Item | string | undefined;
  if (item.kind === 'comment') return null;
  // Pinned developer topics (FAQs, rules) on Steam discussion boards are not player reports.
  if (item.is_developer_post && item.is_pinned) return null;
  // Reddit posts and Steam discussion topics keep the bug in the title as often as in the body, so keep both.
  const text = str(item.review, item.text, [item.title, item.body ?? item.selftext ?? item.opening_post_body ?? item.preview].filter(Boolean).join('\n'), item.content);
  if (!text) return null;
  const ts = item.timestamp_created ?? item.created_utc ?? item.createdAt ?? item.date ?? item.last_posted_at;
  const created = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : typeof ts === 'string' ? Date.parse(ts) || Date.now() : Date.now();
  return {
    source,
    id: String(item.recommendationid ?? item.id ?? item.topic_id ?? item.url ?? `${source}-${i}`),
    author: typeof author === 'string' ? author : String(author?.steamid ?? author?.name ?? item.username ?? item.author_name ?? 'anon'),
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

  /** Field names the actor's input schema accepts, or null if it has no schema (then everything is sent). */
  private async inputFields(actor: string): Promise<Set<string> | null> {
    try {
      const res = await fetch(`https://api.apify.com/v2/acts/${actor.replace('/', '~')}/builds/default`, { headers: { authorization: `Bearer ${this.token}` } });
      if (!res.ok) return null;
      const build = ((await res.json()) as { data: { inputSchema?: string | Item; actorDefinition?: { input?: Item } } }).data;
      const raw = build.inputSchema ?? build.actorDefinition?.input;
      const schema = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { properties?: Item } | undefined;
      return schema?.properties ? new Set(Object.keys(schema.properties)) : null;
    } catch {
      return null;
    }
  }

  private async runActor(actor: string, input: Item, source: 'steam' | 'reddit', limit: number) {
    const { ApifyClient } = await import('apify-client');
    const client = new ApifyClient({ token: this.token });
    // We send several actors' field names at once; strict actors reject unknown ones, so keep only what this actor accepts.
    const fields = await this.inputFields(actor);
    if (fields) input = Object.fromEntries(Object.entries(input).filter(([k]) => fields.has(k)));
    const run = await client.actor(actor).call(input);
    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit });
    return items.map((it, i) => normalizeItem(source, it as Item, i)).filter((x): x is ScrapedItem => !!x);
  }

  async fetch(opts: { steamAppId?: string; subreddit?: string; redditKeywords?: string[]; limit: number }) {
    const out: ScrapedItem[] = [];
    // Actor inputs differ per actor; these are the common field names. Adjust to the actor you pick.
    if (opts.steamAppId && this.steamActor) {
      // Generic review actors (appIds/maxReviews), plus shahidirfan/steam-reviews-scraper (discussion topics: results_wanted, max_pages).
      // startUrl too: that actor's default startUrl points at another game and wins over appId.
      const input = {
        appId: opts.steamAppId,
        appIds: [opts.steamAppId],
        startUrl: `https://steamcommunity.com/app/${opts.steamAppId}/discussions/`,
        maxReviews: opts.limit,
        results_wanted: opts.limit,
        max_pages: Math.ceil(opts.limit / 15) + 1,
      };
      out.push(...(await this.runActor(this.steamActor, input, 'steam', opts.limit)));
    }
    if (opts.subreddit && this.redditActor) {
      const input: Item = {
        // Generic Reddit actors (startUrls/maxItems), plus fatihtahta/reddit-scraper-search-fast (subreddit*, maxPosts).
        startUrls: [{ url: `https://www.reddit.com/r/${opts.subreddit}/new/` }],
        maxItems: opts.limit,
        subredditName: opts.subreddit,
        subredditSort: 'new',
        maxPosts: opts.limit,
        scrapeComments: false,
      };
      if (opts.redditKeywords?.length) input.subredditKeywords = opts.redditKeywords;
      out.push(...(await this.runActor(this.redditActor, input, 'reddit', opts.limit)));
    }
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
