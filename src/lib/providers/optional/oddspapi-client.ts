/**
 * Client HTTP di OddsPapi — da chiave sport a chiamata `/odds` e parsing.
 *
 * SOLO per il POC: non attiva il provider da solo (il registry governa la
 * capacità), e non tocca motore né `odds_snapshots`. Traduce una risposta
 * verificabile in DTO per bookmaker, senza mediare prezzi e senza riempire
 * eventi mancanti. Il costo (richieste/mese) va governato dal budget, come
 * per The Odds API.
 */
import {
  fail,
  ok,
  partial,
  type OddsQuoteDTO,
  type ProviderResult,
} from "../types";
import {
  parseOddsResponse,
  type OddsPapiOdd,
} from "./oddspapi-odds";

const ENDPOINT = "https://api.oddspapi.io";
export const ODDS_PAPI_TIMEOUT_MS = 12_000;

export interface OddsPapiOddsRequest {
  /** sport/lega secondo la tassonomia della fonte (mappa separata) */
  sportKey: string;
  /** id nativo del fixture presso la fonte */
  providerMatchId: string;
  fixtureKey: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  observedAt?: Date;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function retryableForStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Chiamata HTTP completa a `/odds` per un singolo fixture.
 *
 * Non attiva il provider da sola: il registry continua a governare la
 * capacità. Questo modulo traduce soltanto una risposta verificabile in DTO
 * per bookmaker, senza mediare prezzi e senza riempire eventi mancanti.
 */
export async function fetchOddsPapiOdds(
  request: OddsPapiOddsRequest,
): Promise<ProviderResult<OddsQuoteDTO[]>> {
  const apiKey = request.apiKey ?? process.env.ODDS_PAPI_KEY;
  const url = `${ENDPOINT}/odds`;
  if (apiKey === null || apiKey === undefined || apiKey.trim() === "") {
    return fail(
      { kind: "disabled", message: "OddsPapi: chiave non configurata.", url },
      0,
      false,
    );
  }

  const doFetch = request.fetchImpl ?? fetch;
  const observedAt = request.observedAt ?? new Date();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ODDS_PAPI_TIMEOUT_MS);
  const startedAt = Date.now();

  // Parametri secondo la documentazione pubblica (auth via query-param).
  // `/odds` richiede SOLO `fixtureId`; lo `sportKey` non va inviato (serve solo
  // alla mappatura in `oddspapi-maps` e per i log). La quota è sempre decimale.
  const params = new URLSearchParams({
    apiKey,
    fixtureId: request.providerMatchId,
    oddsFormat: "decimal",
  });

  try {
    const response = await doFetch(`${url}?${params.toString()}`, {
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const body = await response.text();
    const payloadBytes = Buffer.byteLength(body, "utf8");

    if (!response.ok) {
      const kind =
        response.status === 429
          ? "rate_limited"
          : response.status === 401 || response.status === 403
            ? "blocked"
            : "http";
      return fail(
        {
          kind,
          message: `OddsPapi: risposta HTTP ${response.status}.`,
          httpStatus: response.status,
          url,
        },
        latencyMs,
        retryableForStatus(response.status),
        payloadBytes,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return fail(
        { kind: "parse", message: "OddsPapi: JSON non interpretabile.", url },
        latencyMs,
        false,
        payloadBytes,
      );
    }

    // La risposta può essere l'oggetto fixture, un array con `data`, o un
    // wrapper `{ data: [...] }`. Si distingue:
    //  - `unrecognized` → struttura cambiata: è un errore di parse, non un
    //    "nessun evento" (la dottrina non maschera un cambio di schema).
    //  - `not_found` → struttura riconosciuta ma nessun fixture: esito parziale.
    const odd = extractOdd(payload);
    if (odd.kind === "unrecognized") {
      return fail(
        { kind: "parse", message: "OddsPapi: risposta non riconosciuta (nessun fixture con bookmakerOdds).", url },
        latencyMs,
        false,
        payloadBytes,
      );
    }
    if (odd.kind === "not_found") {
      return partial(
        [],
        latencyMs,
        ["nessun fixture trovato con questo id"],
        payloadBytes,
      );
    }

    const parsed = parseOddsResponse(odd.odd, {
      fixtureKey: request.fixtureKey,
      observedAt,
    });
    if (parsed.quotes.length === 0) {
      return partial(
        [],
        latencyMs,
        ["nessuna quota per-bookmaker tradotta"],
        payloadBytes,
      );
    }

    const missing: string[] = [];
    if (parsed.skippedOutcomes > 0) {
      missing.push(`${parsed.skippedOutcomes} esiti scartati per ID non gestito o prezzo non valido`);
    }
    return missing.length > 0
      ? partial(parsed.quotes, latencyMs, missing, payloadBytes)
      : ok(parsed.quotes, latencyMs, payloadBytes);
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    return fail(
      {
        kind: "network",
        message: timeout
          ? `OddsPapi: timeout dopo ${ODDS_PAPI_TIMEOUT_MS} ms.`
          : "OddsPapi: errore di rete.",
        url,
      },
      Date.now() - startedAt,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Esito dell'estrazione di un fixture da una risposta. */
type ExtractOdd =
  | { kind: "found"; odd: OddsPapiOdd }
  | { kind: "not_found" }
  | { kind: "unrecognized" };

function asOdd(value: unknown): OddsPapiOdd | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.bookmakerOdds !== undefined) return v as unknown as OddsPapiOdd;
  return null;
}

/**
 * Estrae l'oggetto fixture da una risposta che può essere nuda, un wrapper
 * `{ data: {...} }`, o un array in `data`. Se la struttura non è riconoscibile
 * restituisce `unrecognized`, perché un cambio di schema è un errore di parse,
 * non un "nessun evento".
 */
function extractOdd(payload: unknown): ExtractOdd {
  if (typeof payload !== "object" || payload === null) return { kind: "unrecognized" };
  const obj = payload as Record<string, unknown>;

  // 1. oggetto nudo con bookmakerOdds
  const direct = asOdd(payload);
  if (direct !== null) return { kind: "found", odd: direct };

  // 2. wrapper { data: {...} } con bookmakerOdds
  const data = obj.data;
  if (typeof data === "object" && data !== null) {
    const wrapped = asOdd(data);
    if (wrapped !== null) return { kind: "found", odd: wrapped };
    // 3. array in data
    if (Array.isArray(data)) {
      for (const item of data) {
        const o = asOdd(item);
        if (o !== null) return { kind: "found", odd: o };
      }
      // array riconosciuto ma senza fixture: evento non trovato (esito valido)
      return { kind: "not_found" };
    }
  }

  // 4. struttura non riconoscibile
  return { kind: "unrecognized" };
}
