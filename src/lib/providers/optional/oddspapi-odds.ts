/**
 * Strato di parsing di OddsPapi — da JSON della fonte a quote per book.
 *
 * Lo schema è stato verificato sui docs pubblici (`GET /markets`, `GET /odds`)
 * alla data 09/09/2026, quindi è usato e NON è indovinato:
 *
 *  - `GET /v4/sports` → il calcio è `sportId: 10`.
 *  - `GET /v4/markets` → `marketType: "1x2"` è `marketId 101` con esiti
 *    101="1"(home), 102="X"(pareggio), 103="2"(trasferta); il totale a 2.5
 *    (`marketType: "totals"`) è `marketId 1010` con esiti 1010=Over,
 *    1011=Under.
 *  - `GET /v4/odds` → bordo `bookmakerOdds[slug]`, dentro `markets[marketId]`
 *    e `outcomes[outcomeId]`, con la quota decimale in
 *    `outcomes[outcomeId].players["0"].price`.
 *
 * Regole di onestà del progetto:
 *
 *  - ogni bookmaker della risposta è una riga **reale**, mai aggregata in un
 *    consenso finto: è proprio la pluralità dei book a rendere osservabile la
 *    dispersione delle linee;
 *  - un bookmaker è **sharp** se appartiene alla lista dichiarata
 *    (Pinnacle, Singbet, SBOBet, Betfair Exchange): non lo deduciamo mai dal
 *    prezzo o dal titolo, solo dalla key nota. La lista va confermata contro
 *    `GET /v4/bookmakers` al momento dello smoke test;
 *  - le selezioni si risolvono per **ID di esito verificato** (101/102/103 e
 *    1010/1011): la fonte non pubblica un `name` sugli esiti, quindi risolvere
 *    per nome sarebbe impossibile, e indovinare gli ID no. Un ID di esito non
 *    gestito o inattivo viene **contato**, mai indovinato;
 *  - un book, un mercato o un esito inattivo, o un prezzo non valido, non
 *    produce quote.
 *
 * Il modulo non tocca la rete: la rete sta nel chiamante, la traduzione è
 * testabile con una fixture congelata dello schema verificato.
 */
import type { MarketType, SelectionCode } from "@/db/schema";
import type { OddsQuoteDTO } from "../types";
import {
  FULL_TIME_RESULT_MARKET,
  OVER_UNDER_2_5_MARKET,
  SOCCER_SPORT_ID,
  isSharpBookmaker,
  selectionForOutcome,
} from "./oddspapi-maps";

/** Re-export per chi importa dal parser (le mappature sono la fonte unica). */
export { SOCCER_SPORT_ID, isSharpBookmaker };

/** Tipo piú stretto della risposta `GET /odds` di OddsPapi (schema verificato). */
export interface OddsPapiOdd {
  /** id del fixture presso la fonte */
  fixtureId: string;
  /** nome del primo partecipante (casa), come la fonte lo pubblica */
  participant1Name?: string;
  /** nome del secondo partecipante (trasferta) */
  participant2Name?: string;
  /** istante di inizio, se la fonte lo espone */
  startTime?: string;
  /** bookmaker → mercati (chiavi come stringhe: "101", "1010", ...) */
  bookmakerOdds?: Record<string, OddsPapiBook>;
}

interface OddsPapiBook {
  bookmakerIsActive?: boolean;
  suspended?: boolean;
  markets?: Record<string, OddsPapiMarket>;
}

interface OddsPapiMarket {
  marketActive?: boolean;
  outcomes?: Record<string, OddsPapiOutcome>;
}

interface OddsPapiOutcome {
  players?: Record<string, OddsPapiPlayer>;
}

interface OddsPapiPlayer {
  active?: boolean;
  price?: number;
}

/** Una riga per bookmaker, già risolta nei codici interni del progetto. */
export interface BookLine {
  bookmakerKey: string;
  isSharp: boolean;
  market: MarketType;
  selection: SelectionCode;
  price: number;
  observedAt: Date;
}

export interface ParseOddsOptions {
  /** chiave interna stabile della partita a cui agganciare le quote */
  fixtureKey: string;
  /** istante di osservazione (la fonte non dichiara sempre un timestamp) */
  observedAt: Date;
}

export interface ParseOddsResult {
  quotes: OddsQuoteDTO[];
  /** bookmaker presenti nella risposta, anche se scartati */
  bookmakersSeen: number;
  /** bookmaker tradotti in almeno una quota */
  bookmakersUsed: number;
  /** esiti saltati (ID non gestito o prezzo non valido), contati */
  skippedOutcomes: number;
}

function isActive(value: boolean | undefined | null): boolean {
  return value !== false;
}

function validPrice(p: unknown): p is number {
  return typeof p === "number" && Number.isFinite(p) && p > 1;
}

/** Estrae la quota decimale valida dal blocco `players` di un esito. */
function priceOfOutcome(o: OddsPapiOutcome | undefined): number | null {
  if (!o) return null;
  for (const player of Object.values(o.players ?? {})) {
    if (validPrice(player.price) && isActive(player.active)) return player.price;
  }
  return null;
}

/**
 * Traduce un evento in righe per bookmaker.
 * Mercati gestiti: moneyline 1X2 (`101`) e totals 2.5 (`1010`). Il resto è
 * ignorato. Gli ID di mercato/esito sono verificati su GET /markets.
 */
export function extractBookLines(
  odd: OddsPapiOdd,
  observedAt: Date,
): { lines: BookLine[]; bookmakersSeen: number; skippedOutcomes: number } {
  const lines: BookLine[] = [];
  let bookmakersSeen = 0;
  let skippedOutcomes = 0;

  for (const [bookKey, book] of Object.entries(odd.bookmakerOdds ?? {})) {
    const key = bookKey.trim();
    if (key === "") continue;
    bookmakersSeen += 1;

    // Un book inattivo o sospeso non produce quote (ma conta come "visto").
    if (!isActive(book.bookmakerIsActive) || book.suspended === true) continue;

    for (const [marketKey, market] of Object.entries(book.markets ?? {})) {
      if (!isActive(market.marketActive)) continue;
      const outcomes = market.outcomes ?? {};

      if (marketKey === FULL_TIME_RESULT_MARKET) {
        for (const [outcomeId, outcome] of Object.entries(outcomes)) {
          const selection = selectionForOutcome("1x2", outcomeId);
          if (selection === null) {
            skippedOutcomes += 1;
            continue;
          }
          const price = priceOfOutcome(outcome);
          if (price === null) {
            skippedOutcomes += 1;
            continue;
          }
          lines.push({
            bookmakerKey: key,
            isSharp: isSharpBookmaker(key),
            market: "1x2",
            selection,
            price,
            observedAt,
          });
        }
        continue;
      }

      if (marketKey === OVER_UNDER_2_5_MARKET) {
        for (const [outcomeId, outcome] of Object.entries(outcomes)) {
          const selection = selectionForOutcome("ou_2_5", outcomeId);
          if (selection === null) {
            skippedOutcomes += 1;
            continue;
          }
          const price = priceOfOutcome(outcome);
          if (price === null) {
            skippedOutcomes += 1;
            continue;
          }
          lines.push({
            bookmakerKey: key,
            isSharp: isSharpBookmaker(key),
            market: "ou_2_5",
            selection,
            price,
            observedAt,
          });
        }
        continue;
      }
    }
  }

  return { lines, bookmakersSeen, skippedOutcomes };
}

/** Le righe di un evento come `OddsQuoteDTO[]` per il contratto dei provider. */
export function parseOddsResponse(
  odd: OddsPapiOdd,
  options: ParseOddsOptions,
): ParseOddsResult {
  const { lines, bookmakersSeen, skippedOutcomes } = extractBookLines(
    odd,
    options.observedAt,
  );
  const quotes: OddsQuoteDTO[] = lines.map((l) => ({
    fixtureKey: options.fixtureKey,
    bookmakerKey: l.bookmakerKey,
    isConsensus: false,
    isSharp: l.isSharp,
    market: l.market,
    selection: l.selection,
    price: l.price,
    openingPrice: null,
    observedAt: l.observedAt,
    agreement: null,
  }));
  const used = new Set(lines.map((l) => l.bookmakerKey));
  return {
    quotes,
    bookmakersSeen,
    bookmakersUsed: used.size,
    skippedOutcomes,
  };
}

/** Quante serie distinte (bookmaker × mercato) produce un parsing. */
export function countSeries(result: ParseOddsResult): number {
  const set = new Set<string>();
  for (const q of result.quotes) set.add(`${q.bookmakerKey}|${q.market}`);
  return set.size;
}
