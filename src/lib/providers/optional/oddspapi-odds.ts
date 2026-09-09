/**
 * Strato di parsing di OddsPapi — da JSON della fonte a quote per book.
 *
 * Perché esiste come modulo separato e puro (stesso criterio del parser di
 * The Odds API): la chiamata di rete è banale, il passaggio delicato è la
 * traduzione della risposta nel contratto interno `OddsQuoteDTO`, con le
 * regole di onestà del progetto:
 *
 *  - ogni bookmaker della risposta è una riga **reale**, mai aggregata in un
 *    consenso finto: è proprio la pluralità dei book a rendere osservabile la
 *    dispersione delle linee;
 *  - un bookmaker è **sharp** se appartiene alla lista dichiarata
 *    (Pinnacle, Singbet, SBOBet, Betfair Exchange): non lo deduciamo mai
 *    dal prezzo o dal titolo, solo dalla key nota;
 *  - la selezione 1X2 si risolve confrontando `outcome.name` con i nomi di
 *    casa e trasferta dichiarati dall'evento: un nome che non corrisponde a
 *    nessuno dei due e non è il pareggio viene saltato e **contato**, mai
 *    indovinato;
 *  - un mercato non gestito o un prezzo non valido non produce quote.
 *
 * Il modulo non tocca la rete: la rete sta nel chiamante, la traduzione è
 * testabile con una fixture congelata dello schema documentato.
 */
import type { MarketType, SelectionCode } from "@/db/schema";
import type { OddsQuoteDTO } from "../types";

/** Bookmaker riconosciuti come "sharp" (benchmark di riferimento). */
const ODDS_PAPI_SHARP_BOOKS: readonly string[] = [
  "pinnacle",
  "singbet",
  "sbobet",
  "betfair-exchange",
];

/** Sottoinsieme tipizzato della risposta `GET /odds` di OddsPapi. */
export interface OddsPapiOdd {
  /** id del fixture presso la fonte */
  fixtureId: string;
  participants?: {
    home?: { name?: string; id?: string | number };
    away?: { name?: string; id?: string | number };
  };
  /** istante di inizio, se la fonte lo espone */
  startTime?: string;
  /** bookmaker → mercati */
  bookmakerOdds?: Record<
    string,
    {
      /** mercato (es. "131" moneyline, "3" totals) → outcomes */
      markets?: Record<
        string,
        {
          /** descrizione / linea, es. "2.5" */
          name?: string;
          point?: number;
          outcomes?: Record<
            string,
            {
              /** id esito (131 home, 132 away, ...) */
              id?: string | number;
              name?: string;
              /** quota decimale */
              price?: number;
              active?: boolean;
            }
          >;
        }
      >;
    }
  >;
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
  /** esiti saltati (nome non risolvibile o prezzo non valido), contati */
  skippedOutcomes: number;
}

const H2H_MARKET = "131"; // moneyline 1X2 per OddsPapi
const TOTALS_MARKET = "3"; // totals (over/under)
const OVER_OUTCOME = "over";
const UNDER_OUTCOME = "under";

/** Un bookmaker della fonte è sharp se appartiene alla lista dichiarata. */
export function isSharpBookmaker(bookmakerKey: string): boolean {
  return ODDS_PAPI_SHARP_BOOKS.includes(bookmakerKey.trim().toLowerCase());
}

function validPrice(p: unknown): p is number {
  return typeof p === "number" && Number.isFinite(p) && p > 1;
}

function activeName(o: { name?: string; active?: boolean }): string {
  if (o.active === false) return "";
  return (o.name ?? "").trim().toLowerCase();
}

/**
 * Traduce un evento in righe per bookmaker.
 * Mercati gestiti: moneyline 1X2 (`131`) e totals (`3`). Il resto è ignorato.
 *
 * La market-key `131`/`3` di OddsPapi è un dettaglio osservato nella
 * documentazione pubblica (es. `markets["131"]["outcomes"]`); è possibile che
 * la fonte la esprima diversamente — la fixture congelata e lo smoke test live
 * lo verificano prima di attivare l'adapter.
 */
export function extractBookLines(
  odd: OddsPapiOdd,
  observedAt: Date,
): { lines: BookLine[]; bookmakersSeen: number; skippedOutcomes: number } {
  const lines: BookLine[] = [];
  let bookmakersSeen = 0;
  let skippedOutcomes = 0;

  const home = (odd.participants?.home?.name ?? "").trim().toLowerCase();
  const away = (odd.participants?.away?.name ?? "").trim().toLowerCase();

  for (const [bookKey, book] of Object.entries(odd.bookmakerOdds ?? {})) {
    const key = bookKey.trim();
    if (key === "") continue;
    bookmakersSeen += 1;

    for (const [marketKey, market] of Object.entries(book.markets ?? {})) {
      // Osservazione: usare marketKey; se la fonte usa anche `name` come
      // descrizione (es. "Money Line"), la leggiamo ma non la assumiamo.
      const outcomes = market.outcomes ?? {};

      if (marketKey === H2H_MARKET) {
        for (const o of Object.values(outcomes)) {
          const name = activeName(o);
          if (!validPrice(o.price) || name === "") {
            skippedOutcomes += 1;
            continue;
          }
          // Selezione per NOME della squadra, mai per chiave numerica dell'esito:
          // lo schema delle chiavi (131/132/133) non è verificabile e dedurlo
          // sarebbe indovinare. Il nome è ciò che la fonte pubblica.
          const selection =
            name === home ? "home" : name === away ? "away" : name === "draw" || name === "pareggio" ? "draw" : null;
          if (selection === null) {
            skippedOutcomes += 1;
            continue;
          }
          lines.push({
            bookmakerKey: key,
            isSharp: isSharpBookmaker(key),
            market: "1x2",
            selection,
            price: o.price!,
            observedAt,
          });
        }
        continue;
      }

      if (marketKey === TOTALS_MARKET) {
        // La linea del mercato può stare in `point` o nel nome (es. "2.5").
        const point = market.point ?? Number(market.name ?? "");
        if (!Number.isFinite(point) || point !== 2.5) continue;
        for (const [outcomeKey, o] of Object.entries(outcomes)) {
          const name = activeName(o);
          const selection =
            name === OVER_OUTCOME || outcomeKey === OVER_OUTCOME
              ? "over"
              : name === UNDER_OUTCOME || outcomeKey === UNDER_OUTCOME
                ? "under"
                : null;
          if (selection === null || !validPrice(o.price)) {
            skippedOutcomes += 1;
            continue;
          }
          lines.push({
            bookmakerKey: key,
            isSharp: isSharpBookmaker(key),
            market: "ou_2_5",
            selection,
            price: o.price!,
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
