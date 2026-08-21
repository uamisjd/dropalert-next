/**
 * Fonte notizie pubblica per partita (Sprint notizie).
 *
 * SCELTA DELLA FONTE, DICHIARATA: la richiesta di partenza era Google News
 * RSS, ma il robots.txt di news.google.com vieta `/rss/` a ogni user-agent
 * generico (`Disallow: /` senza Allow su /rss, verificato il 21/08/2026) e
 * il feed stesso si dichiara per uso personale in feed reader. Questo
 * progetto non interroga percorsi vietati: la stessa regola applicata alla
 * fonte delle quote vale per le notizie.
 *
 * Fonte adottata: GDELT DOC API — endpoint pubblico e gratuito, pensato
 * per l'uso programmatico, con output RSS. Nessuna chiave. Prima query
 * con `sourcelang:italian`, fallback senza filtro di lingua (l'inglese e
 * le lingue terze arrivano da lì).
 *
 * Cortesia dichiarata: max 1 richiesta ogni 5 secondi, max 20 richieste
 * per finestra di 15 minuti (vedi `limiter.ts`), User-Agent identificabile.
 */

export const NEWS_SOURCE_LABEL = "GDELT DOC API (feed RSS pubblico)";

const BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

export const NEWS_USER_AGENT =
  "DropAlert/1.0 (osservatorio statistico; uso non commerciale; cache 6h)";

/** Durata della cache per partita. */
export const NEWS_CACHE_HOURS = 6;

/** Timeout della singola richiesta alla fonte. */
export const NEWS_TIMEOUT_MS = 10_000;

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

/** Query italiana: entrambe le squadre, fonti in italiano. */
export function italianQuery(homeTeam: string, awayTeam: string): string {
  return `("${homeTeam}" OR "${awayTeam}") sourcelang:italian`;
}

/** Query di fallback: senza filtro di lingua. */
export function fallbackQuery(homeTeam: string, awayTeam: string): string {
  return `("${homeTeam}" OR "${awayTeam}")`;
}

function buildUrl(query: string): string {
  return `${BASE}?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=${NEWS_MAX_ITEMS}&sort=hybrid&format=rss`;
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
    const source =
      block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim() ?? null;
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

/**
 * Cerca le notizie di una partita: italiano prima, fallback senza filtro
 * di lingua solo se la prima query non trova nulla. UNA o DUE richieste
 * in totale — il limiter decide la cortesia, chi chiama decide il resto.
 */
export async function fetchMatchNews(
  homeTeam: string,
  awayTeam: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<NewsFetchOutcome> {
  const doFetch = options.fetchImpl ?? fetch;

  const attempts: Array<{ language: "it" | "en"; query: string }> = [
    { language: "it", query: italianQuery(homeTeam, awayTeam) },
    { language: "en", query: fallbackQuery(homeTeam, awayTeam) },
  ];

  for (const attempt of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
    try {
      const response = await doFetch(buildUrl(attempt.query), {
        headers: { "user-agent": NEWS_USER_AGENT },
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const xml = await response.text();
      const items = parseNewsRss(xml.slice(0, 500_000));
      if (items.length > 0 || attempt.language === "en") {
        return {
          ok: true,
          result: { items, language: attempt.language, query: attempt.query },
        };
      }
      /* query italiana vuota: si prova il fallback, dichiarato */
    } catch {
      /* timeout o rete: si prova il fallback, poi si dichiara */
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, reason: "irraggiungibile" };
}
