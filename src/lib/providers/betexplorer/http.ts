/**
 * Client HTTP per BetExplorer (Sprint 3B).
 *
 * Scraping educato, non negoziabile:
 * - User-Agent identificabile, con contatto e natura del progetto;
 * - timeout esplicito: una fonte che non risponde non blocca il job;
 * - percorsi vietati dal robots.txt rifiutati PRIMA di aprire la
 *   connessione, non dopo;
 * - il rate limiter vive nel runner: qui non si chiama mai due volte di
 *   fila senza passare da lì.
 *
 * Il robots.txt è replicato qui come lista di regole verificate il
 * 18.08.2026. È una copia, quindi può invecchiare: per questo la lista è
 * restrittiva (nega per pattern) e il codice non prova mai a "indovinare"
 * URL alternativi quando uno è vietato.
 */

/** Identificazione onesta: chi siamo e perché stiamo leggendo. */
export const USER_AGENT =
  "DropAlertBot/1.0 (terminale quantitativo non commerciale; rispetta robots.txt)";

export const BASE_URL = "https://www.betexplorer.com";

/** Timeout di una singola richiesta. */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Regole di esclusione lette da https://www.betexplorer.com/robots.txt
 * (User-agent: *), verificate il 18.08.2026 e riverificate il 05.09.2026:
 * invariate (solo una riga `Allow` e un blocco a SmartViper in più,
 * entrambi irrilevanti per noi).
 *
 * L'elenco dei parametri è conservato per documentare la regola della
 * fonte, ma la nostra politica effettiva è più severa: nessuna query
 * string, nessuna eccezione (vedi `isAllowedByRobots`). Gli endpoint AJAX
 * con le quote per singolo bookmaker vivono dietro `?matchid=`: restano
 * fuori dal nostro perimetro, ed è la ragione per cui questa fonte resta
 * di solo consenso.
 */
export const DISALLOWED_PREFIXES = ["/ad/", "/redirect/", "/bookmaker/"];

export const DISALLOWED_QUERY_KEYS = [
  "year",
  "stage",
  "page",
  "timezone",
  "t",
  "setsort",
  "more",
  "msg",
  "activecountry",
  "match",
  "setnext",
  "setmyonly",
  "home",
  "ttid",
  "month",
];

/**
 * true se il percorso è consentito dal robots.txt.
 * Volutamente severa: in dubbio, si rifiuta.
 */
export function isAllowedByRobots(pathOrUrl: string): boolean {
  let path = pathOrUrl;
  let query = "";

  try {
    const url = new URL(pathOrUrl, BASE_URL);
    if (url.hostname !== "www.betexplorer.com") return false;
    path = url.pathname;
    query = url.search;
  } catch {
    return false;
  }

  if (DISALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;

  /**
   * Politica più severa della lettera del robots.txt, per scelta.
   *
   * Il robots vieta una lista di parametri (`?page=`, `?match=`, …) ma non
   * li vieta TUTTI: per esempio `?matchid=`, usato dagli endpoint AJAX
   * delle quote per singolo bookmaker, non è coperto alla lettera.
   *
   * Noi rifiutiamo comunque QUALSIASI query string su questo host. Il
   * gestore ha chiaramente segnalato di non gradire la scansione
   * parametrica, e sfruttare il buco di una regola per raggiungere proprio
   * i dati che ha protetto sarebbe scorretto. Le pagine che ci servono non
   * hanno bisogno di parametri.
   */
  if (query !== "") return false;

  return true;
}

export interface FetchOutcome {
  ok: boolean;
  status: number;
  body: string;
  bytes: number;
  latencyMs: number;
  /** valorizzato solo in caso di errore di trasporto */
  errorMessage: string | null;
  /** header Retry-After, quando la fonte lo dichiara */
  retryAfter: string | null;
  url: string;
}

export type FetchLike = typeof fetch;

/**
 * Esegue una GET con timeout e header identificabili.
 * Non lancia: gli errori di rete diventano un esito con `ok: false`,
 * perché il chiamante deve poterli registrare invece di subirli.
 */
export async function fetchPage(
  path: string,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<FetchOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const startedAt = Date.now();

  if (!isAllowedByRobots(url)) {
    return {
      ok: false,
      status: 0,
      body: "",
      bytes: 0,
      latencyMs: 0,
      errorMessage: `Percorso vietato dal robots.txt della fonte: ${url}. Richiesta non inviata.`,
      retryAfter: null,
      url,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body,
      bytes: Buffer.byteLength(body, "utf8"),
      latencyMs: Date.now() - startedAt,
      errorMessage: null,
      retryAfter: response.headers.get("retry-after"),
      url,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: 0,
      body: "",
      bytes: 0,
      latencyMs: Date.now() - startedAt,
      errorMessage: aborted
        ? `Timeout dopo ${timeoutMs}ms su ${url}.`
        : `Errore di rete su ${url}: ${err instanceof Error ? err.message : String(err)}`,
      retryAfter: null,
      url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Percorsi                                                            */
/* ------------------------------------------------------------------ */

/** Elenco dei drop di quota. Nessuna query string: robots-legale. */
export const DROPPING_ODDS_PATH = "/dropping-odds/";

/** Pagina risultati di un campionato. */
export function resultsPath(countrySlug: string, leagueSlug: string): string {
  return `/football/${countrySlug}/${leagueSlug}/results/`;
}
