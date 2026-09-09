/**
 * Lettura del catalogo sport di The Odds API — endpoint GRATUITO.
 *
 * `GET /v4/sports` restituisce l'elenco di tutti i campionati che la fonte
 * copre (con `active` che indica se la competizione è in stagione). Come
 * dichiara la documentazione della fonte, questo endpoint «does not count
 * against the usage quota»: serve a decidere, con dati reali, quali
 * competizioni mappare in `sport-keys.ts` senza spendere un credito e senza
 * indovinare a memoria.
 *
 * Il costo dichiarato dalla fonte negli header viene letto e restituito: se
 * un giorno l'endpoint smettesse di essere gratuito, lo si vede nel log
 * invece di scoprirlo a fine mese.
 */
import { fail, ok, partial, type ProviderResult } from "../types";
import { readOddsApiKey } from "./odds-api-budget";
import { parseSportsCatalog, type OddsApiSport } from "./odds-api-sports";

const ENDPOINT = "https://api.the-odds-api.com/v4/sports";
const TIMEOUT_MS = 12_000;

export interface OddsApiSportsRequest {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/** Esito della chiamata con il costo dichiarato dalla fonte. */
export interface OddsApiSportsOutcome {
  result: ProviderResult<OddsApiSport[]>;
  /** `x-requests-last`: crediti addebitati per questa chiamata, se dichiarati */
  creditsUsed: number | null;
  /** `x-requests-remaining`: crediti residui nel mese, se dichiarati */
  creditsRemaining: number | null;
}

function headerNumber(response: Response, name: string): number | null {
  const value = response.headers?.get?.(name);
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Scarica il catalogo completo dei campionati coperti dalla fonte.
 *
 * Non tocca il database e non fa matching: restituisce l'elenco così com'è,
 * con le righe non leggibili scartate e contate dal parser. Eseguire una sola
 * volta — il catalogo cambia raramente.
 */
export async function fetchOddsApiSports(
  request: OddsApiSportsRequest,
): Promise<OddsApiSportsOutcome> {
  const apiKey = request.apiKey ?? readOddsApiKey();

  if (apiKey === null || apiKey.trim() === "") {
    return {
      result: fail(
        { kind: "disabled", message: "The Odds API: chiave non configurata.", url: ENDPOINT },
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
    const response = await doFetch(`${ENDPOINT}?apiKey=${encodeURIComponent(apiKey)}`, {
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
            message: `The Odds API: risposta HTTP ${response.status} sul catalogo sport.`,
            httpStatus: response.status,
            url: ENDPOINT,
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
          { kind: "parse", message: "The Odds API: JSON non interpretabile sul catalogo sport.", url: ENDPOINT },
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
          { kind: "parse", message: "The Odds API: il catalogo non è un elenco.", url: ENDPOINT },
          latencyMs,
          false,
          payloadBytes,
        ),
        creditsUsed,
        creditsRemaining,
      };
    }

    const parsed = parseSportsCatalog(payload);
    if (parsed.sports.length === 0) {
      return {
        result: partial(
          [],
          latencyMs,
          parsed.discarded > 0
            ? [`nessuno sport leggibile (${parsed.discarded} righe scartate)`]
            : ["il catalogo è vuoto — la fonte potrebbe non esporre competizioni"],
          payloadBytes,
        ),
        creditsUsed,
        creditsRemaining,
      };
    }

    return {
      result:
        parsed.discarded > 0
          ? partial(parsed.sports, latencyMs, [`${parsed.discarded} righe scartate perché incomplete`], payloadBytes)
          : ok(parsed.sports, latencyMs, payloadBytes),
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
            ? `The Odds API: timeout dopo ${TIMEOUT_MS} ms sul catalogo sport.`
            : "The Odds API: errore di rete sul catalogo sport.",
          url: ENDPOINT,
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
