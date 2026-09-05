/**
 * Strato di parsing di The Odds API — da JSON della fonte a quote per book.
 *
 * Perché esiste come modulo separato e puro: il passaggio che mancava a questo
 * adapter non era la chiamata di rete (banale) ma la traduzione della risposta
 * nel contratto interno, con le regole di onestà del progetto:
 *
 *  - ogni bookmaker della risposta è una riga **reale**, mai aggregata in un
 *    consenso finto: è proprio la pluralità dei book a rendere osservabile la
 *    dispersione delle linee;
 *  - la selezione 1X2 si risolve confrontando `outcome.name` con i nomi di
 *    casa e trasferta dichiarati dall'evento: un nome che non corrisponde a
 *    nessuno dei due e non è il pareggio viene saltato e **contato**, mai
 *    indovinato;
 *  - un mercato non gestito o un prezzo non valido non producono quote.
 *
 * Il modulo non tocca la rete. È lo stesso criterio dei fixture HTML congelati
 * di BetExplorer: la rete sta nel chiamante, la traduzione è testabile.
 *
 * Due usi, uno stesso parsing:
 *  - `parseOddsResponse` → `OddsQuoteDTO[]` per il contratto dei provider
 *    (cablaggio nel ciclo di raccolta);
 *  - `extractBookLines` → le righe per book, usate dalla lettura sharp per
 *    mostrare i prezzi dei tre book sharp già presenti nella stessa risposta
 *    (zero crediti aggiuntivi: la chiamata è quella già pagata).
 */
import type { MarketType, SelectionCode } from "@/db/schema";
import type { OddsQuoteDTO } from "../types";
import { SHARP_BOOKS } from "./odds-api-budget";

/** Sottoinsieme tipizzato della risposta `GET /v4/sports/{key}/odds`. */
export interface TheOddsApiEvent {
  id: string;
  sport_key?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: Array<{
    key?: string;
    title?: string;
    last_update?: string;
    markets?: Array<{
      key?: string;
      point?: number;
      last_update?: string;
      outcomes?: Array<{ name?: string; price?: number }>;
    }>;
  }>;
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
  /** istante di osservazione se la fonte non dichiara `last_update` */
  observedAt: Date;
}

export interface ParseOddsResult {
  quotes: OddsQuoteDTO[];
  /** bookmaker presenti nella risposta, anche se scartati */
  bookmakersSeen: number;
  /** bookmaker tradotti in almeno una quota */
  bookmakersUsed: number;
  /** esiti saltati (nome non risolvibile o prezzo non valido), contati e non taciuti */
  skippedOutcomes: number;
}

const H2H = "h2h";
const TOTALS = "totals";

/** Un bookmaker della fonte è sharp se appartiene alla lista dichiarata. */
export function isSharpBookmaker(bookmakerKey: string): boolean {
  return (SHARP_BOOKS as readonly string[]).includes(bookmakerKey);
}

function validPrice(p: unknown): p is number {
  return typeof p === "number" && Number.isFinite(p) && p > 1;
}

function dateOf(iso: string | undefined, fallback: Date): Date {
  if (typeof iso === "string") {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

/**
 * Traduce un evento nelle sue righe per bookmaker.
 * Mercati gestiti: `h2h` (1X2) e `totals` con linea 2.5. Il resto è ignorato.
 */
export function extractBookLines(
  event: TheOddsApiEvent,
  observedAt: Date,
): { lines: BookLine[]; bookmakersSeen: number; skippedOutcomes: number } {
  const lines: BookLine[] = [];
  let bookmakersSeen = 0;
  let skippedOutcomes = 0;

  const home = (event.home_team ?? "").trim().toLowerCase();
  const away = (event.away_team ?? "").trim().toLowerCase();

  for (const book of event.bookmakers ?? []) {
    const bookKey = (book.key ?? "").trim();
    if (bookKey === "") continue;
    bookmakersSeen += 1;

    for (const market of book.markets ?? []) {
      const at = dateOf(book.last_update ?? market.last_update, observedAt);

      if (market.key === H2H) {
        for (const o of market.outcomes ?? []) {
          const name = (o.name ?? "").trim().toLowerCase();
          if (!validPrice(o.price) || name === "") {
            skippedOutcomes += 1;
            continue;
          }
          const selection =
            name === home ? "home" : name === away ? "away" : name === "draw" ? "draw" : null;
          if (selection === null) {
            skippedOutcomes += 1;
            continue;
          }
          lines.push({
            bookmakerKey: bookKey,
            isSharp: isSharpBookmaker(bookKey),
            market: "1x2",
            selection,
            price: o.price,
            observedAt: at,
          });
        }
      } else if (market.key === TOTALS && market.point === 2.5) {
        for (const o of market.outcomes ?? []) {
          const name = (o.name ?? "").trim().toLowerCase();
          if (!validPrice(o.price)) {
            skippedOutcomes += 1;
            continue;
          }
          const selection = name === "over" ? "over" : name === "under" ? "under" : null;
          if (selection === null) {
            skippedOutcomes += 1;
            continue;
          }
          lines.push({
            bookmakerKey: bookKey,
            isSharp: isSharpBookmaker(bookKey),
            market: "ou_2_5",
            selection,
            price: o.price,
            observedAt: at,
          });
        }
      }
    }
  }

  return { lines, bookmakersSeen, skippedOutcomes };
}

/** Le righe di un evento come `OddsQuoteDTO[]` per il contratto dei provider. */
export function parseOddsResponse(
  event: TheOddsApiEvent,
  options: ParseOddsOptions,
): ParseOddsResult {
  const { lines, bookmakersSeen, skippedOutcomes } = extractBookLines(
    event,
    options.observedAt,
  );
  const quotes: OddsQuoteDTO[] = lines.map((l) => ({
    fixtureKey: options.fixtureKey,
    bookmakerKey: l.bookmakerKey,
    isConsensus: false,
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

/**
 * Dispersione dei prezzi fra book per una selezione.
 *
 * È la sola cosa che una singola fotografia consente di dire sui book: non il
 * movimento (servirebbero due fotografie) ma quanto divergono adesso. Quando i
 * book convergono la linea è «presa»; quando divergono, la lettura di un
 * singolo book vale poco. Il valore è misurato, mai stimato, e con un solo
 * prezzo la dispersione non esiste: `null`, non `0`.
 */
export function bookSpread(
  lines: BookLine[],
  selection: SelectionCode,
): { count: number; min: number; max: number; spread: number } | null {
  const prices = lines
    .filter((l) => l.selection === selection)
    .map((l) => l.price);
  if (prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return {
    count: prices.length,
    min,
    max,
    spread: Number((max - min).toFixed(2)),
  };
}

/**
 * Quante serie distinte (bookmaker × mercato) produce un parsing: serve al
 * budget e alla UI per dire «questa lettura vale N serie», non solo «1 chiamata».
 */
export function countSeries(result: ParseOddsResult): number {
  const set = new Set<string>();
  for (const q of result.quotes) set.add(`${q.bookmakerKey}|${q.market}`);
  return set.size;
}
