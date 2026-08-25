/**
 * Notizie via Tavily (Sprint «Perché si muove»).
 *
 * PERCHÉ: i feed RSS di Gazzetta e BBC coprono bene i campionati maggiori e
 * quasi mai le leghe minori — per una partita di terza serie argentina lo
 * stato onesto era «nessuna notizia pubblica trovata», sempre. Tavily fa una
 * ricerca vera e restituisce risultati strutturati, quindi diventa la fonte
 * principale; l'RSS resta come integrazione gratuita, non come ripiego.
 *
 * Budget: le query consumano lo STESSO contatore giornaliero del Contesto
 * 360° (TAVILY_DAILY_LIMIT), con al massimo due query per partita. Esaurito
 * il budget si dichiara «ricerca non disponibile per budget»: nessuna
 * notizia inventata, nessun risultato riciclato da un'altra partita.
 *
 * Modulo puro nelle sue parti decisionali (query, parsing, dedupe) così che
 * i test non tocchino la rete.
 */
import {
  TAVILY_MAX_NEWS_PER_MATCH,
  TAVILY_TIMEOUT_MS,
  parseTavilyResults,
  type TavilyResult,
} from "@/lib/context/tavily";
import type { NewsFeedItem } from "./source";

export const TAVILY_NEWS_SOURCE_LABEL =
  "ricerca web Tavily (italiano, poi internazionale), integrata dai feed RSS pubblici di Gazzetta e BBC";

/** Prima query: le due squadre e la competizione, in italiano. */
export function newsQueryPrimary(
  homeTeam: string,
  awayTeam: string,
  league: string | null,
): string {
  const l = league === null || league.trim() === "" ? "" : ` ${league.trim()}`;
  return `${homeTeam} ${awayTeam}${l}`;
}

/** Seconda query: ciò che muove davvero una quota alla vigilia. */
export function newsQuerySecondary(
  homeTeam: string,
  awayTeam: string,
): string {
  return `${homeTeam} ${awayTeam} infortuni squalifiche formazioni notizie`;
}

/** Le stesse due domande in inglese, quando l'italiano non trova nulla. */
export function newsQueryEnglish(
  homeTeam: string,
  awayTeam: string,
): string {
  return `${homeTeam} ${awayTeam} injuries suspensions lineup news`;
}

/** Estrae il dominio, per dichiarare la testata quando manca. */
export function domainOf(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Una data pubblicata solo se Tavily la fornisce: mai dedotta. */
function parseDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** I risultati Tavily diventano righe di notizia, con lingua della query. */
export function toNewsItems(
  results: Array<TavilyResult & { publishedDate?: unknown }>,
): NewsFeedItem[] {
  return results.map((r) => ({
    title: r.title,
    link: r.url,
    source: domainOf(r.url),
    publishedAt: parseDate(r.publishedDate),
  }));
}

/**
 * Dedupe per URL, normalizzando schema, www e slash finale: la stessa
 * notizia trovata da Tavily e dall'RSS deve comparire una volta sola.
 */
export function dedupeByUrl<T extends { link: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = it.link
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "")
      .split("#")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export interface TavilyNewsOutcome {
  items: Array<NewsFeedItem & { language: "it" | "en" }>;
  queriesUsed: number;
  /** motivo in italiano quando la ricerca non ha potuto girare */
  unavailableReason: string | null;
}

interface TavilyNewsRaw extends TavilyResult {
  publishedDate?: unknown;
}

function extractWithDates(payload: unknown): TavilyNewsRaw[] {
  const base = parseTavilyResults(payload);
  const raw =
    typeof payload === "object" && payload !== null
      ? ((payload as { results?: unknown }).results as unknown[])
      : [];
  return base.map((b, i) => {
    const r = Array.isArray(raw) ? raw[i] : undefined;
    const published =
      typeof r === "object" && r !== null
        ? (r as Record<string, unknown>).published_date
        : undefined;
    return { ...b, publishedDate: published };
  });
}

/**
 * Notizie di una partita via Tavily: italiano prima, inglese solo se
 * l'italiano non ha trovato nulla, entro il budget passato da chi chiama.
 */
export async function searchNewsForMatch(
  homeTeam: string,
  awayTeam: string,
  league: string | null,
  options: {
    budgetLeft: number;
    fetchImpl?: typeof fetch;
    apiKey?: string;
  },
): Promise<TavilyNewsOutcome> {
  const apiKey = options.apiKey ?? process.env.TAVILY_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    return {
      items: [],
      queriesUsed: 0,
      unavailableReason: "ricerca non disponibile: chiave Tavily non configurata",
    };
  }
  if (options.budgetLeft <= 0) {
    return {
      items: [],
      queriesUsed: 0,
      unavailableReason: "ricerca non disponibile per budget",
    };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const plan: Array<{ query: string; language: "it" | "en" }> = [
    { query: newsQueryPrimary(homeTeam, awayTeam, league), language: "it" },
    { query: newsQuerySecondary(homeTeam, awayTeam), language: "it" },
    { query: newsQueryEnglish(homeTeam, awayTeam), language: "en" },
  ];

  const out: Array<NewsFeedItem & { language: "it" | "en" }> = [];
  let used = 0;
  let failed = false;
  const maxQueries = Math.min(TAVILY_MAX_NEWS_PER_MATCH, options.budgetLeft);

  for (const step of plan) {
    if (used >= maxQueries) break;
    /* la query inglese ha senso solo se l'italiano è rimasto a mani vuote */
    if (step.language === "en" && out.length > 0) break;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);
    try {
      const response = await doFetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: step.query,
          max_results: 5,
          search_depth: "basic",
          topic: "news",
        }),
        signal: controller.signal,
      });
      used += 1;
      if (!response.ok) {
        failed = true;
        continue;
      }
      const payload: unknown = await response.json();
      const items = toNewsItems(extractWithDates(payload));
      out.push(...items.map((i) => ({ ...i, language: step.language })));
    } catch {
      used += 1;
      failed = true;
    } finally {
      clearTimeout(timer);
    }
  }

  const deduped = dedupeByUrl(out);
  return {
    items: deduped,
    queriesUsed: used,
    unavailableReason:
      deduped.length === 0 && failed
        ? "ricerca non disponibile: errore della fonte"
        : null,
  };
}
