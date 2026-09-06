/**
 * Lettura dell'elenco eventi di The Odds API — endpoint GRATUITO.
 *
 * `GET /v4/sports/{sport}/events` restituisce id, squadre e orario delle
 * partite in programma e, come dichiara la documentazione della fonte,
 * «does not count against the usage quota». Non restituisce quote.
 *
 * Serve esattamente a questo: scegliere la partita dello smoke test con i
 * nomi e l'orario REALI della fonte, senza spendere il credito che la lettura
 * delle quote costerebbe. Usare l'endpoint `/odds` per lo stesso scopo
 * brucerebbe un credito per ogni tentativo.
 *
 * Il costo dichiarato dalla fonte negli header viene letto e restituito: se
 * un giorno l'endpoint dovesse diventare a pagamento, lo si vede nel log
 * invece di scoprirlo a fine mese.
 */
import { fail, ok, partial, type ProviderResult } from "../types";
import { readOddsApiKey } from "./odds-api-budget";
import type { OddsApiEventLite } from "./odds-match-resolver";

const ENDPOINT = "https://api.the-odds-api.com/v4/sports";
const TIMEOUT_MS = 12_000;

export interface OddsApiEventsRequest {
  sportKey: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/** Esito della chiamata con il costo dichiarato dalla fonte. */
export interface OddsApiEventsOutcome {
  result: ProviderResult<OddsApiEventLite[]>;
  /** `x-requests-last`: crediti addebitati per questa chiamata, se dichiarati */
  creditsUsed: number | null;
  /** `x-requests-remaining`: crediti residui nel mese, se dichiarati */
  creditsRemaining: number | null;
}

interface RawEvent {
  id?: unknown;
  sport_key?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  commence_time?: unknown;
}

/** Converte la riga grezza: ciò che non è leggibile resta fuori, non stimato. */
function toEventLite(raw: RawEvent): OddsApiEventLite | null {
  if (typeof raw.id !== "string" || raw.id === "") return null;
  if (typeof raw.home_team !== "string" || typeof raw.away_team !== "string") return null;
  const commenceTime = new Date(raw.commence_time as string);
  if (Number.isNaN(commenceTime.getTime())) return null;
  return {
    id: raw.id,
    sportKey: typeof raw.sport_key === "string" ? raw.sport_key : "",
    homeTeam: raw.home_team,
    awayTeam: raw.away_team,
    commenceTime,
  };
}

function headerNumber(response: Response, name: string): number | null {
  const value = response.headers?.get?.(name);
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Elenca gli eventi in programma per una chiave sport.
 *
 * Non fa matching e non tocca il database: restituisce l'elenco così com'è.
 * Una risposta vuota è un esito parziale dichiarato («nessun evento»), non un
 * errore: la fonte stessa dice che in quel caso non addebita nulla.
 */
export async function fetchOddsApiEvents(
  request: OddsApiEventsRequest,
): Promise<OddsApiEventsOutcome> {
  const apiKey = request.apiKey ?? readOddsApiKey();
  const url = `${ENDPOINT}/${encodeURIComponent(request.sportKey)}/events`;

  if (apiKey === null || apiKey.trim() === "") {
    return {
      result: fail(
        { kind: "disabled", message: "The Odds API: chiave non configurata.", url },
        0,
        false,
      ),
      creditsUsed: null,
      creditsRemaining: null,
    };
  }

  const doFetch = request.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await doFetch(`${url}?apiKey=${encodeURIComponent(apiKey)}&dateFormat=iso`, {
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const creditsUsed = headerNumber(response, "x-requests-last");
    const creditsRemaining = headerNumber(response, "x-requests-remaining");
    const body = await response.text();
    const payloadBytes = Buffer.byteLength(body, "utf8");

    if (!response.ok) {
      const kind =
        response.status === 429
          ? "rate_limited"
          : response.status === 401 || response.status === 403
            ? "blocked"
            : "http";
      return {
        result: fail(
          {
            kind,
            message: `The Odds API: risposta HTTP ${response.status} sull'elenco eventi.`,
            httpStatus: response.status,
            url,
          },
          latencyMs,
          response.status === 429 || response.status >= 500,
          payloadBytes,
        ),
        creditsUsed,
        creditsRemaining,
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return {
        result: fail(
          { kind: "parse", message: "The Odds API: JSON non interpretabile.", url },
          latencyMs,
          false,
          payloadBytes,
        ),
        creditsUsed,
        creditsRemaining,
      };
    }

    if (!Array.isArray(payload)) {
      return {
        result: fail(
          { kind: "parse", message: "The Odds API: risposta non è un elenco di eventi.", url },
          latencyMs,
          false,
          payloadBytes,
        ),
        creditsUsed,
        creditsRemaining,
      };
    }

    const events = payload.flatMap((raw) => {
      if (typeof raw !== "object" || raw === null) return [];
      const event = toEventLite(raw as RawEvent);
      return event === null ? [] : [event];
    });
    const discarded = payload.length - events.length;

    if (events.length === 0) {
      return {
        result: partial(
          [],
          latencyMs,
          discarded > 0
            ? [`nessun evento leggibile (${discarded} righe scartate)`]
            : ["la fonte non pubblica eventi in programma per questa chiave sport"],
          payloadBytes,
        ),
        creditsUsed,
        creditsRemaining,
      };
    }

    return {
      result:
        discarded > 0
          ? partial(events, latencyMs, [`${discarded} righe scartate perché incomplete`], payloadBytes)
          : ok(events, latencyMs, payloadBytes),
      creditsUsed,
      creditsRemaining,
    };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    return {
      result: fail(
        {
          kind: "network",
          message: timeout
            ? `The Odds API: timeout dopo ${TIMEOUT_MS} ms sull'elenco eventi.`
            : "The Odds API: errore di rete sull'elenco eventi.",
          url,
        },
        Date.now() - startedAt,
        true,
      ),
      creditsUsed: null,
      creditsRemaining: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
