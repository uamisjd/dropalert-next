/**
 * Scoperta fixture OddsPapi — servono ID reali, non indovinati.
 *
 * OddsPapi non espone un semplice "elenca partite per sport": il flusso
 * verificato (09/09/2026) è:
 *   GET /v4/tournaments?sportId=10   → elenco tornei del calcio
 *   GET /v4/odds-by-tournaments?tournamentIds=...  → fixture CON quote
 *
 * Questo modulo traduce quel flusso in una scoperta di fixture "vivi"
 * (pre-game, con quote) senza scrivere nel DB e senza stampare segreti. Serve
 * allo smoke test per scegliere un fixture valido su cui fare la chiamata
 * reale a `/odds`. Le funzioni sono pure e testabili con fixture congelate.
 */
import { SOCCER_SPORT_ID } from "./oddspapi-maps";

/** Torneo come il docs lo restituisce (GET /v4/tournaments). */
export interface OddsPapiTournament {
  tournamentId: number;
  tournamentSlug?: string;
  tournamentName?: string;
  categorySlug?: string;
  categoryName?: string;
  futureFixtures?: number;
  upcomingFixtures?: number;
  liveFixtures?: number;
}

/** Fixture "vivo" con quote, dal docs `GET /v4/odds-by-tournaments`. */
export interface OddsPapiFixtureWithOdds {
  fixtureId: string;
  participant1Name?: string;
  participant2Name?: string;
  startTime?: string;
  statusId?: number;
  hasOdds?: boolean;
  tournamentId?: number;
}

/** Un array con elementi "object" (tipo stretto per l'iterazione TS). */
function isRecordArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every((v) => typeof v === "object" && v !== null);
}

/**
 * Estrae i tornei usabili per la scoperta: con almeno un fixture in arrivo
 * (entro 24h) o futuro. Per lo smoke serve un fixture CON quote adesso, quindi
 * la priorità va ai tornei con `upcomingFixtures` (match che iniziano presto),
 * poi a quelli con `futureFixtures`. I tornei senza nessun fixture non servono.
 */
export function pickTournaments(
  tournaments: OddsPapiTournament[],
): OddsPapiTournament[] {
  return [...tournaments]
    .filter((t) => (t.upcomingFixtures ?? 0) + (t.futureFixtures ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.upcomingFixtures ?? 0) - (a.upcomingFixtures ?? 0) ||
        (b.futureFixtures ?? 0) - (a.futureFixtures ?? 0),
    );
}

/**
 * Risolve la struttura della risposta `odds-by-tournaments`, che può essere
 * un array nudo oppure un wrapper `{ data: [...] }`. Ritorna solo gli oggetti
 * con `hasOdds` e un `fixtureId` utilizzabile. Non deduce nulla se la
 * struttura non è riconoscibile: in quel caso `[]` (lo smoke fallisce chiuso).
 */
export function fixturesWithOdds(payload: unknown): OddsPapiFixtureWithOdds[] {
  if (Array.isArray(payload) && isRecordArray(payload)) {
    return collect(payload);
  }
  if (typeof payload === "object" && payload !== null) {
    const data = (payload as Record<string, unknown>).data;
    if (isRecordArray(data)) return collect(data);
  }
  return [];
}

function collect(items: Array<Record<string, unknown>>): OddsPapiFixtureWithOdds[] {
  const out: OddsPapiFixtureWithOdds[] = [];
  for (const o of items) {
    if (typeof o.fixtureId !== "string" || o.fixtureId.trim() === "") continue;
    if (o.hasOdds !== true) continue;
    out.push({
      fixtureId: o.fixtureId,
      participant1Name: typeof o.participant1Name === "string" ? o.participant1Name : undefined,
      participant2Name: typeof o.participant2Name === "string" ? o.participant2Name : undefined,
      startTime: typeof o.startTime === "string" ? o.startTime : undefined,
      statusId: typeof o.statusId === "number" ? o.statusId : undefined,
      hasOdds: true,
      tournamentId: typeof o.tournamentId === "number" ? o.tournamentId : undefined,
    });
  }
  return out;
}

/** Sport di calcio (ri-export per chi legge la scoperta). */
export const CALCIO_SPORT_ID = SOCCER_SPORT_ID;
