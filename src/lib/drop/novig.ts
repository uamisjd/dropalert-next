/**
 * Chiusura "fair" senza margine (no-vig).
 *
 * Perché serve: la quota di chiusura pubblicata contiene il margine del
 * bookmaker. Confrontare la quota rilevata con la chiusura GREZZA misura
 * quindi due cose insieme: il movimento del mercato e il margine applicato.
 * Rimuovendo il margine si confronta stima contro stima.
 *
 * Metodo: rimozione proporzionale (probabilità divise per la loro somma).
 * È il metodo più semplice e più trasparente; non è il più raffinato
 * (Shin, power method) ma non richiede assunzioni non verificabili sui dati
 * che abbiamo. La scelta è dichiarata insieme al risultato.
 *
 * Regola invariante: il no-vig richiede l'insieme COMPLETO delle selezioni
 * di un mercato per lo STESSO bookmaker. Se manca anche una sola selezione
 * il risultato è null con motivo esplicito: non si stima il margine mancante.
 *
 * Tutte le funzioni sono pure: nessuna rete, nessun database.
 */
import type { MarketType, SelectionCode } from "@/db/schema";
import { isValidPrice, normalizeProbabilities, round } from "./math";

/* ------------------------------------------------------------------ */
/* Anagrafica dei mercati                                              */
/* ------------------------------------------------------------------ */

/**
 * Selezioni che compongono un mercato completo.
 * Un mercato è normalizzabile solo se sono presenti tutte.
 */
export const MARKET_SELECTIONS: Record<MarketType, SelectionCode[]> = {
  "1x2": ["home", "draw", "away"],
  ou_2_5: ["over", "under"],
  btts: ["yes", "no"],
};

/** Etichetta leggibile del metodo di rimozione del margine impiegato. */
export const NOVIG_METHOD = "proportional" as const;

/** Base di confronto usata per il CLV. */
export type ClosingBasis = "fair_novig" | "raw_consensus";

/* ------------------------------------------------------------------ */
/* Calcolo                                                             */
/* ------------------------------------------------------------------ */

export interface FairMarketInput {
  market: MarketType;
  /** prezzi osservati per selezione, di un singolo bookmaker */
  prices: Partial<Record<SelectionCode, number | null | undefined>>;
}

export interface FairMarketResult {
  market: MarketType;
  /** margine osservato: 0.0614 = 106.14% */
  margin: number;
  /** probabilità fair per selezione, sommano a 1 */
  fairProbs: Record<string, number>;
  /** quote fair corrispondenti */
  fairPrices: Record<string, number>;
  method: typeof NOVIG_METHOD;
}

export interface FairMarketFailure {
  market: MarketType;
  /** selezioni attese e non disponibili */
  missing: SelectionCode[];
  /** selezioni presenti ma con prezzo non utilizzabile */
  invalid: SelectionCode[];
  reason: string;
}

/**
 * Rimuove il margine da un mercato completo di un singolo bookmaker.
 *
 * @returns il mercato fair, oppure la descrizione esatta di cosa manca.
 *          Mai una stima parziale.
 */
export function fairMarket(
  input: FairMarketInput,
): { ok: true; data: FairMarketResult } | { ok: false; failure: FairMarketFailure } {
  const expected = MARKET_SELECTIONS[input.market];
  const missing: SelectionCode[] = [];
  const invalid: SelectionCode[] = [];
  const ordered: number[] = [];

  for (const sel of expected) {
    const price = input.prices[sel];
    if (price === undefined || price === null) {
      missing.push(sel);
      continue;
    }
    if (!isValidPrice(price)) {
      invalid.push(sel);
      continue;
    }
    ordered.push(price);
  }

  if (missing.length > 0 || invalid.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`selezioni assenti: ${missing.join(", ")}`);
    if (invalid.length > 0) parts.push(`quote non valide: ${invalid.join(", ")}`);
    return {
      ok: false,
      failure: {
        market: input.market,
        missing,
        invalid,
        reason: `Mercato ${input.market} incompleto (${parts.join("; ")}): chiusura fair non calcolabile.`,
      },
    };
  }

  const normalized = normalizeProbabilities(ordered);
  if (!normalized) {
    return {
      ok: false,
      failure: {
        market: input.market,
        missing: [],
        invalid: [...expected],
        reason: `Mercato ${input.market}: normalizzazione impossibile sulle quote osservate.`,
      },
    };
  }

  const rawSum = ordered.reduce((acc, p) => acc + 1 / p, 0);
  const fairProbs: Record<string, number> = {};
  const fairPrices: Record<string, number> = {};

  expected.forEach((sel, i) => {
    const prob = normalized[i];
    fairProbs[sel] = round(prob, 6);
    fairPrices[sel] = round(1 / prob, 3);
  });

  return {
    ok: true,
    data: {
      market: input.market,
      margin: round(rawSum - 1, 4),
      fairProbs,
      fairPrices,
      method: NOVIG_METHOD,
    },
  };
}

/**
 * Chiusura fair di una singola selezione.
 * @returns quota fair, oppure null se il mercato non è completo.
 */
export function fairPriceFor(
  market: MarketType,
  selection: SelectionCode,
  prices: FairMarketInput["prices"],
): number | null {
  const res = fairMarket({ market, prices });
  if (!res.ok) return null;
  return res.data.fairPrices[selection] ?? null;
}

/* ------------------------------------------------------------------ */
/* Fasce dell'indice di fiducia                                        */
/* ------------------------------------------------------------------ */

/**
 * Fasce del punteggio di fiducia usate per il riepilogo del CLV.
 * Sono fasce di lettura, non soglie operative: servono a verificare se un
 * indice più alto corrisponde davvero a un CLV migliore.
 */
export const SCORE_BUCKETS = [
  { key: "0-24", label: "indice 0–24", min: 0, max: 25 },
  { key: "25-49", label: "indice 25–49", min: 25, max: 50 },
  { key: "50-74", label: "indice 50–74", min: 50, max: 75 },
  { key: "75-100", label: "indice 75–100", min: 75, max: 100.01 },
] as const;

export type ScoreBucketKey = (typeof SCORE_BUCKETS)[number]["key"];

/** Assegna un punteggio di fiducia alla sua fascia. */
export function scoreBucketOf(score: number): ScoreBucketKey {
  for (const b of SCORE_BUCKETS) {
    if (score >= b.min && score < b.max) return b.key;
  }
  return score >= 75 ? "75-100" : "0-24";
}
