/**
 * Mappature OdsPapi verificate (09/09/2026), fonte unica di verità.
 *
 * Tutti gli ID qui sotto provengono dalla documentazione pubblica
 * (`GET /sports`, `GET /markets`, `GET /odds`) di oddspapi.io, NON da
 * assunzioni a memoria:
 *
 *  - sport: il calcio è `sportId: 10` (`slug: "soccer"`);
 *  - 1X2 (Full Time Result) = `marketId 101`, esiti 101="1"(casa),
 *    102="X"(pareggio), 103="2"(trasferta), `marketType: "1x2"`;
 *  - Over/Under 2.5 = `marketId 1010`, esiti 1010=Over, 1011=Under,
 *    `marketType: "totals"`.
 *
 * Concentra le traduzioni interne → OddsPapi e viceversa, così parser,
 * client e (futuro) adapter condividono un'unica verità e nessuno indovina
 * un ID. La lista dei bookmaker "sharp" è dichiarata e va confermata contro
 * `GET /bookmakers` al momento dello smoke test live: è una lista nota, non
 * una deduzione dal prezzo.
 */
import type { MarketType, SelectionCode } from "@/db/schema";

/** Sport del calcio su OddsPapi (verificato su GET /sports: slug "soccer"). */
export const SOCCER_SPORT_ID = 10;

/** Bookmaker riconosciuti come "sharp" (benchmark di riferimento), da confermare con GET /bookmakers. */
export const ODDS_PAPI_SHARP_BOOKS: readonly string[] = [
  "pinnacle",
  "singbet",
  "sbobet",
  "betfair-exchange",
];

/** Verificato su GET /markets: 1X2 (Full Time Result). */
export const FULL_TIME_RESULT_MARKET = "101";
/** Verificato su GET /markets: Over/Under 2.5 Goals. */
export const OVER_UNDER_2_5_MARKET = "1010";

/** ID di esito del mercato 1X2 (verificato). */
export const H2H_OUTCOME_HOME = "101";
export const H2H_OUTCOME_DRAW = "102";
export const H2H_OUTCOME_AWAY = "103";
/** ID di esito del mercato Over/Under 2.5 (verificato). */
export const OU_OUTCOME_OVER = "1010";
export const OU_OUTCOME_UNDER = "1011";

/** Un bookmaker della fonte è sharp se appartiene alla lista dichiarata. */
export function isSharpBookmaker(bookmakerKey: string): boolean {
  return ODDS_PAPI_SHARP_BOOKS.includes(bookmakerKey.trim().toLowerCase());
}

/**
 * SportKey interno (stile The Odds API, es. `soccer_epl`) → sportId OddsPapi.
 *
 * OddsPapi distingue solo lo sport (non la lega): per il calcio l'ID è 10.
 * Restituisce `null` per qualunque sport non-calcio: in quel caso la chiamata
 * NON parte (fallire chiuso non costa crediti, e non si indovina l'ID).
 */
export function sportIdForSportKey(sportKey: string | undefined): number | null {
  if (!sportKey) return null;
  return /^soccer(_|$)/i.test(sportKey.trim()) ? SOCCER_SPORT_ID : null;
}

/** Mercato interno → marketId OddsPapi (stringa, come compare in `markets`). */
export function marketIdFor(market: MarketType): string | null {
  switch (market) {
    case "1x2":
      return FULL_TIME_RESULT_MARKET;
    case "ou_2_5":
      return OVER_UNDER_2_5_MARKET;
    default:
      return null;
  }
}

/** Selezione 1X2 interna → outcomeId OddsPapi. */
export function h2hOutcomeIdFor(selection: SelectionCode): string | null {
  switch (selection) {
    case "home":
      return H2H_OUTCOME_HOME;
    case "draw":
      return H2H_OUTCOME_DRAW;
    case "away":
      return H2H_OUTCOME_AWAY;
    default:
      return null;
  }
}

/** Selezione Over/Under 2.5 interna → outcomeId OddsPapi. */
export function ouOutcomeIdFor(selection: SelectionCode): string | null {
  switch (selection) {
    case "over":
      return OU_OUTCOME_OVER;
    case "under":
      return OU_OUTCOME_UNDER;
    default:
      return null;
  }
}

/** Selezione interna (mercato+esito) → outcomeId OddsPapi, se il mercato è gestito. */
export function outcomeIdFor(
  market: MarketType,
  selection: SelectionCode,
): string | null {
  if (market === "1x2") return h2hOutcomeIdFor(selection);
  if (market === "ou_2_5") return ouOutcomeIdFor(selection);
  return null;
}

/** outcomeId OddsPapi → selezione 1X2 interna (per il parser). */
export function h2hSelectionFor(outcomeId: string): SelectionCode | null {
  switch (outcomeId) {
    case H2H_OUTCOME_HOME:
      return "home";
    case H2H_OUTCOME_DRAW:
      return "draw";
    case H2H_OUTCOME_AWAY:
      return "away";
    default:
      return null;
  }
}

/** outcomeId OddsPapi → selezione Over/Under 2.5 interna (per il parser). */
export function ouSelectionFor(outcomeId: string): SelectionCode | null {
  switch (outcomeId) {
    case OU_OUTCOME_OVER:
      return "over";
    case OU_OUTCOME_UNDER:
      return "under";
    default:
      return null;
  }
}

/** outcomeId OddsPapi → selezione interna dato il mercato (per il parser). */
export function selectionForOutcome(
  market: MarketType,
  outcomeId: string,
): SelectionCode | null {
  if (market === "1x2") return h2hSelectionFor(outcomeId);
  if (market === "ou_2_5") return ouSelectionFor(outcomeId);
  return null;
}
