import { parseOddsResponse, type TheOddsApiEvent } from "./the-odds-api-odds";
import { findEvent } from "./odds-api-sharp";
import { readOddsApiKey } from "./odds-api-budget";
import {
  fail,
  ok,
  partial,
  type OddsQuoteDTO,
  type ProviderResult,
} from "../types";

const ENDPOINT = "https://api.the-odds-api.com/v4/sports";
export const THE_ODDS_API_TIMEOUT_MS = 12_000;
export const THE_ODDS_API_REGION = "eu";
export const THE_ODDS_API_MARKETS = "h2h";

export interface TheOddsApiOddsRequest {
  sportKey: string;
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

function publicUrl(sportKey: string): string {
  return `${ENDPOINT}/${encodeURIComponent(sportKey)}/odds`;
}

/**
 * Chiamata HTTP completa e testabile a The Odds API.
 *
 * Non attiva il provider da sola: il registry continua a governare la
 * capacità. Questo modulo traduce soltanto una risposta verificabile in DTO
 * per bookmaker, senza mediare prezzi e senza riempire eventi mancanti.
 */
export async function fetchTheOddsApiOdds(
  request: TheOddsApiOddsRequest,
): Promise<ProviderResult<OddsQuoteDTO[]>> {
  const apiKey = request.apiKey ?? readOddsApiKey();
  const url = publicUrl(request.sportKey);
  if (apiKey === null || apiKey.trim() === "") {
    return fail(
      { kind: "disabled", message: "The Odds API: chiave non configurata.", url },
      0,
      false,
    );
  }

  const doFetch = request.fetchImpl ?? fetch;
  const observedAt = request.observedAt ?? new Date();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THE_ODDS_API_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await doFetch(
      `${url}?apiKey=${encodeURIComponent(apiKey)}&regions=${THE_ODDS_API_REGION}&markets=${THE_ODDS_API_MARKETS}&oddsFormat=decimal`,
      { signal: controller.signal },
    );
    const latencyMs = Date.now() - startedAt;
    const body = await response.text();
    const payloadBytes = Buffer.byteLength(body, "utf8");

    if (!response.ok) {
      const kind = response.status === 429 ? "rate_limited" : response.status === 401 || response.status === 403 ? "blocked" : "http";
      return fail(
        {
          kind,
          message: `The Odds API: risposta HTTP ${response.status}.`,
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
        { kind: "parse", message: "The Odds API: JSON non interpretabile.", url },
        latencyMs,
        false,
        payloadBytes,
      );
    }

    const event = findEvent(payload, request.homeTeam, request.awayTeam, request.kickoffAt);
    if (event === null) {
      return partial(
        [],
        latencyMs,
        ["evento non trovato con squadre e kickoff verificati"],
        payloadBytes,
      );
    }

    const parsed = parseOddsResponse(event as TheOddsApiEvent, {
      fixtureKey: request.fixtureKey,
      observedAt,
    });
    if (parsed.quotes.length === 0) {
      return partial(
        [],
        latencyMs,
        ["evento trovato ma nessuna quota h2h valida tradotta"],
        payloadBytes,
      );
    }

    const missing: string[] = [];
    if (parsed.skippedOutcomes > 0) {
      missing.push(`${parsed.skippedOutcomes} esiti scartati per nome o prezzo non valido`);
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
          ? `The Odds API: timeout dopo ${THE_ODDS_API_TIMEOUT_MS} ms.`
          : "The Odds API: errore di rete.",
        url,
      },
      Date.now() - startedAt,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}
