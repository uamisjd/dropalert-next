/**
 * Fonte notizie pubblica per partita (Sprint notizie).
 *
 * SCELTA DELLA FONTE, DICHIARATA, in quattro atti (verificati il
 * 21/08/2026):
 *  1. Google News RSS, la richiesta di partenza: robots.txt vieta `/rss/`
 *     a ogni user-agent generico. Percorso vietato: non si interroga.
 *  2. GDELT DOC API: robots-compatible ma ~10s di latenza e 429
 *     sistematici dagli IP condivisi del deploy. Scartata sul campo.
 *  3. Bing News RSS: robots consentito e velocissimo, ma dal datacenter
 *     del deploy risponde con pagina di blocco. Scartata sul campo.
 *  4. FEED DIRETTI DELLE TESTATE, fonte adottata: feed RSS pubblici di
 *     Gazzetta (calcio) e BBC (football), filtrati per nome di squadra.
 *     Nessun motore di ricerca, nessun percorso vietato (robots
 *     verificati), nessuna chiave. Limite dichiarato: i tornei minori
 *     stranieri difficilmente compaiono — allora lo stato dice «nessuna
 *     notizia pubblica trovata», che è un risultato valido.
 *
 * Cortesia dichiarata: i feed si condividono fra tutte le partite con
 * cache di 15 minuti in-process; il limiter (1 richiesta/5s, 20 per
 * quarto d'ora) valuta le letture vere; User-Agent identificabile.
 */

export const NEWS_SOURCE_LABEL =
  "feed RSS pubblici di Gazzetta (calcio) e BBC (football), filtrati per squadra";

/** Feed italiano di default, overridabile da NEWS_FEEDS_IT (virgole). */
export const DEFAULT_FEEDS_IT = ["https://www.gazzetta.it/rss/calcio.xml"];
/** Feed internazionale di fallback, overridabile da NEWS_FEEDS_EN. */
export const DEFAULT_FEEDS_EN = [
  "https://feeds.bbci.co.uk/sport/football/rss.xml",
];

function feedsOf(language: "it" | "en"): string[] {
  const raw =
    language === "it" ? process.env.NEWS_FEEDS_IT : process.env.NEWS_FEEDS_EN;
  if (raw !== undefined && raw.trim() !== "") {
    return raw
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .slice(0, 3);
  }
  return language === "it" ? DEFAULT_FEEDS_IT : DEFAULT_FEEDS_EN;
}

/** Cache in-process dei feed: tutte le partite condividono la stessa lettura. */
const FEED_TTL_MS = 15 * 60_000;
const feedCache = new Map<string, { at: number; items: NewsFeedItem[] }>();

export const NEWS_USER_AGENT =
  "DropAlert/1.0 (osservatorio statistico; uso non commerciale; cache 6h)";

/** Durata della cache per partita. */
export const NEWS_CACHE_HOURS = 6;

/** Timeout della singola richiesta di feed. */
export const NEWS_TIMEOUT_MS = 8_000;

/** Massimo numero di notizie conservate per partita. */
export const NEWS_MAX_ITEMS = 6;

export interface NewsFeedItem {
  title: string;
  link: string;
  source: string | null;
  publishedAt: Date | null;
}

export interface NewsQueryResult {
  items: NewsFeedItem[];
  /** lingua della query: "it" o "en" (dichiarata: non la lingua degli articoli) */
  language: "it" | "en";
  /** query effettuata, salvata a registro */
  query: string;
}

/** Filtro italiano: il titolo cita una delle due squadre. */
export function italianQuery(homeTeam: string, awayTeam: string): string {
  return `${homeTeam} ${awayTeam}`;
}

/** Filtro di fallback: gli stessi termini, sui feed internazionali. */
export function fallbackQuery(homeTeam: string, awayTeam: string): string {
  return `${homeTeam} ${awayTeam}`;
}

/** true se il titolo cita la squadra (nome lungo almeno 4 caratteri). */
export function titleMentionsTeam(title: string, team: string): boolean {
  const t = team.trim().toLowerCase();
  return t.length >= 4 && title.toLowerCase().includes(t);
}

/** Gli item di un feed che citano una delle due squadre. */
export function filterByTeams(
  items: NewsFeedItem[],
  homeTeam: string,
  awayTeam: string,
): NewsFeedItem[] {
  return items.filter(
    (i) =>
      titleMentionsTeam(i.title, homeTeam) ||
      titleMentionsTeam(i.title, awayTeam),
  );
}

/** RSS essenziale: item con titolo, link, fonte e data. */
export function parseNewsRss(xml: string): NewsFeedItem[] {
  const items: NewsFeedItem[] = [];
  const blocks = xml.split(/<item[\s>]/).slice(1);
  for (const block of blocks) {
    const title =
      block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";
    const link =
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";
    /* titolo o link assenti o vuoti: la riga non esiste, non si completa */
    if (title === "" || link === "") continue;
    /* Bing dichiara la testata in <News:Source>; il tag <source> resta
       letto per compatibilità con feed standard */
    const source =
      block.match(/<News:Source[^>]*>([\s\S]*?)<\/News:Source>/)?.[1]?.trim() ??
      block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim() ??
      null;
    const dateRaw =
      block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? null;
    const parsedDate = dateRaw !== null ? new Date(dateRaw) : null;

    items.push({
      title: decodeEntities(title),
      link: decodeEntities(link),
      source: source !== null ? decodeEntities(source) : null,
      publishedAt:
        parsedDate !== null && Number.isFinite(parsedDate.getTime())
          ? parsedDate
          : null,
    });
  }
  return items;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

/** Link di cortesia: la stessa notizia aperta in traduzione italiana. */
export function italianTranslationLink(url: string): string {
  return `https://translate.google.com/translate?sl=auto&tl=it&u=${encodeURIComponent(url)}`;
}

export type NewsFetchOutcome =
  | { ok: true; result: NewsQueryResult }
  | { ok: false; reason: "irraggiungibile" };

async function fetchFeed(
  url: string,
  fetchImpl: typeof fetch,
): Promise<NewsFeedItem[]> {
  const cached = feedCache.get(url);
  if (cached !== undefined && Date.now() - cached.at < FEED_TTL_MS) {
    return cached.items;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { "user-agent": NEWS_USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const items = parseNewsRss(xml.slice(0, 500_000));
    feedCache.set(url, { at: Date.now(), items });
    return items;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Notizie di una partita: prima i feed italiani filtrati per squadra,
 * fallback sui feed internazionali se nulla. I feed già in cache non
 * costano richieste: il limiter di cortesia valuta solo quelle vere.
 */
export async function fetchMatchNews(
  homeTeam: string,
  awayTeam: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<NewsFetchOutcome> {
  const doFetch = options.fetchImpl ?? fetch;

  const attempts: Array<{ language: "it" | "en"; urls: string[] }> = [
    { language: "it", urls: feedsOf("it") },
    { language: "en", urls: feedsOf("en") },
  ];

  for (const attempt of attempts) {
    const all: NewsFeedItem[] = [];
    for (const url of attempt.urls) {
      all.push(...(await fetchFeed(url, doFetch)));
    }
    const matches = filterByTeams(all, homeTeam, awayTeam).slice(
      0,
      NEWS_MAX_ITEMS,
    );
    if (matches.length > 0 || attempt.language === "en") {
      return {
        ok: true,
        result: {
          items: matches,
          language: attempt.language,
          query: italianQuery(homeTeam, awayTeam),
        },
      };
    }
    /* feed italiano senza citazioni: si prova il fallback, dichiarato */
  }

  return { ok: false, reason: "irraggiungibile" };
}
