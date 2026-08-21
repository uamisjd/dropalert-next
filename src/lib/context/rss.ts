/**
 * Notizie RSS accanto al Contesto 360° (opzionale, dichiarato).
 *
 * Niente ricerche in rete a pagamento: al massimo i feed pubblici
 * configurati in `RSS_FEEDS` (URL separati da virgola). Le notizie si
 * mostrano SOLO quando un titolo contiene il nome di una delle due
 * squadre: nessuna notizia, nessuna riga — l'assenza non si riempie.
 *
 * Il contesto generato dal modello resta sempre taggato "conoscenza
 * modello": le notizie RSS, quando ci sono, sono l'unica parte del
 * blocco che cita una fonte recuperata.
 */
const RSS_TIMEOUT_MS = 4000;
const MAX_FEEDS = 3;
const MAX_NEWS = 4;
/** cache in-process di un'ora: i feed non si rileggono a ogni richiesta */
const CACHE_TTL_MS = 3_600_000;

export interface NewsItem {
  title: string;
  link: string | null;
  publishedAt: string | null;
  feed: string;
}

const feedCache = new Map<string, { at: number; items: NewsItem[] }>();

export function configuredFeeds(): string[] {
  const raw = process.env.RSS_FEEDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_FEEDS);
}

/** Estrae titolo, link e data dai tag di un feed RSS 2.0 / Atom essenziale. */
function parseItems(xml: string, feed: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.split(/<(?:item|entry)[\s>]/).slice(1);
  for (const block of blocks.slice(0, 40)) {
    const title =
      block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? null;
    if (title === null) continue;
    const link =
      block.match(/<link[^>]*href="([^"]+)"/)?.[1] ??
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1]?.trim() ??
      null;
    const date =
      block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ??
      block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/)?.[1]?.trim() ??
      null;
    items.push({
      title: title.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"'),
      link,
      publishedAt: date,
      feed,
    });
  }
  return items;
}

async function fetchFeed(
  url: string,
  fetchImpl: typeof fetch,
): Promise<NewsItem[]> {
  const cached = feedCache.get(url);
  if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.items;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "user-agent": "DropAlert/observatory (RSS, contact: none)" },
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const items = parseItems(xml.slice(0, 500_000), url);
    feedCache.set(url, { at: Date.now(), items });
    return items;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Notizie che citano una delle due squadre, quando i feed sono
 * configurati e dicono qualcosa. Mai errori: un feed muto è un feed muto.
 */
export async function fetchTeamNews(
  homeTeam: string,
  awayTeam: string,
  options: { fetchImpl?: typeof fetch; feeds?: string[] } = {},
): Promise<NewsItem[]> {
  const feeds = options.feeds ?? configuredFeeds();
  if (feeds.length === 0) return [];

  const doFetch = options.fetchImpl ?? fetch;
  const all = (
    await Promise.all(feeds.map((f) => fetchFeed(f, doFetch)))
  ).flat();

  const match = (title: string, team: string): boolean => {
    const t = team.toLowerCase().trim();
    return t.length >= 4 && title.toLowerCase().includes(t);
  };

  return all
    .filter(
      (n) => match(n.title, homeTeam) || match(n.title, awayTeam),
    )
    .slice(0, MAX_NEWS);
}
