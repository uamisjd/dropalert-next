/**
 * Ricerca web per il Contesto 360°: Tavily (Sprint ricerca web).
 *
 * Perché Tavily: il grounding Google Search dell'API Gemini è riservato
 * alle chiavi con billing (429 sul free tier, verificato il 21/08/2026) e
 * Brave chiede una carta. Tavily ha un piano gratuito senza carta, con un
 * risultato già strutturato (title, url, content).
 *
 * Budget dichiarato, bloccato qui e nel contatore a registro:
 *  - massimo DUE query per partita (la seconda scatta solo se la prima
 *    non ha trovato nulla);
 *  - massimo TRENTA query al giorno, contate per giornata italiana in
 *    `system_state` — chi legge il contatore sa quante ne restano.
 *
 * Su errore o chiave assente: «ricerca non disponibile», e il contesto
 * nasce dalle altre fonti (Wikipedia, feed) o dal modello — mai inventato.
 */

/** Tetto giornaliero dichiarato per il piano gratuito. */
export const TAVILY_DAILY_LIMIT = 30;

/** Query massime per partita. */
export const TAVILY_MAX_PER_MATCH = 2;

/** Timeout di una query. */
export const TAVILY_TIMEOUT_MS = 8_000;

/** Risultato minimo che serve al contesto. */
export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export type TavilyOutcome =
  | { ok: true; results: TavilyResult[]; queriesUsed: number }
  | { ok: false; reason: "chiave_assente" | "budget" | "errore"; queriesUsed: number };

/** Prima query: le squadre, la competizione, scontri e classifica. */
export function primaryQuery(
  homeTeam: string,
  awayTeam: string,
  league: string | null,
): string {
  const l = league === null || league.trim() === "" ? "" : ` ${league.trim()}`;
  return `${homeTeam} ${awayTeam}${l} H2H standings`;
}

/** Seconda query, solo a vuoto della prima: fase e playoff. */
export function fallbackQueryTavily(
  homeTeam: string,
  awayTeam: string,
  league: string | null,
): string {
  const l = league === null || league.trim() === "" ? "" : ` ${league.trim()}`;
  return `${homeTeam} ${awayTeam}${l} semifinal playoff recent form`;
}

/** Estrae i risultati dalla risposta Tavily. Puro, testato. */
export function parseTavilyResults(payload: unknown): TavilyResult[] {
  if (typeof payload !== "object" || payload === null) return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: TavilyResult[] = [];
  for (const r of results) {
    if (typeof r !== "object" || r === null) continue;
    const { title, url, content } = r as Record<string, unknown>;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    out.push({
      title: typeof title === "string" ? title.slice(0, 120) : url,
      url: url.slice(0, 500),
      content: typeof content === "string" ? content.slice(0, 400) : "",
    });
  }
  return out;
}

/** Chiave del contatore giornaliero, per giornata italiana. */
export function tavilyUsageKey(now: Date): string {
  const romeDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `tavily:daily:${romeDay}`;
}

/**
 * La ricerca di una partita: 1 query, la seconda solo se la prima non ha
 * trovato nulla. Rispetta il budget di query rimaste che chi chiama passa.
 */
export async function searchForMatch(
  homeTeam: string,
  awayTeam: string,
  league: string | null,
  options: {
    budgetLeft: number;
    fetchImpl?: typeof fetch;
    apiKey?: string;
  },
): Promise<TavilyOutcome> {
  const apiKey = options.apiKey ?? process.env.TAVILY_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    return { ok: false, reason: "chiave_assente", queriesUsed: 0 };
  }
  if (options.budgetLeft <= 0) {
    return { ok: false, reason: "budget", queriesUsed: 0 };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const queries = [
    primaryQuery(homeTeam, awayTeam, league),
    fallbackQueryTavily(homeTeam, awayTeam, league),
  ];

  const all: TavilyResult[] = [];
  let used = 0;

  for (const query of queries) {
    if (used >= Math.min(TAVILY_MAX_PER_MATCH, options.budgetLeft)) break;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);
    try {
      const response = await doFetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: 3,
          search_depth: "basic",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (used === 0 && all.length === 0) {
          return { ok: false, reason: "errore", queriesUsed: used };
        }
        break;
      }
      const payload: unknown = await response.json();
      const results = parseTavilyResults(payload);
      used += 1;
      all.push(...results);
      if (results.length > 0) break; /* trovato: la seconda non serve */
    } catch {
      if (used === 0 && all.length === 0) {
        return { ok: false, reason: "errore", queriesUsed: used };
      }
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: true, results: all, queriesUsed: used };
}
