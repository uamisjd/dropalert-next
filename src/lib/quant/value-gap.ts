/**
 * Divario fra prezzo eseguibile e linea senza margine (no-vig).
 *
 * Perché esiste un modulo separato: la stessa formula è stata scritta tre volte
 * (scanner `/value-bets`, card del dashboard, pannello quantitativo) e tutte e tre
 * la costruivano allo stesso modo scorretto — una «fair» ricavata dividendo la quota
 * corrente per 1,045 e un edge calcolato sul prezzo di APERTURA, che nessuno può più
 * comprare. Qui sta la versione che si può difendere, con due regole sole:
 *
 *  1. la fair viene dalla LINEA COMPLETA (tutte le selezioni dello stesso mercato,
 *     dello stesso bookmaker, alla stessa ora di lettura) con lo STESSO metodo usato
 *     per la chiusura fair del CLV (`fairMarket`, no-vig proporzionale). Se la terna
 *     non c'è, non c'è un fair: `{ ok: false }` con il motivo, mai una stima;
 *  2. il prezzo valutato è quello ESEGUIBILE, cioè quello corrente. Il movimento
 *     dall'apertura è un'altra cosa e si chiama `dropPct`.
 *
 * Il risultato è un numero che può essere negativo e viene mostrato tale: un monitor
 * che non può dire «qui non c'è nulla» non sta monitorando.
 *
 * Modulo puro: nessuna rete, nessun database, nessuna assunzione numerica.
 */
import { fairMarket } from "@/lib/drop/novig";
import { round, isValidPrice } from "@/lib/drop/math";
import type { MarketType, SelectionCode } from "@/db/schema";

export interface ValueGapInput {
  market: MarketType;
  selection: SelectionCode;
  /** prezzo corrente eseguibile (consenso) */
  currentPrice: number;
  /** prezzi di tutte le selezioni dello stesso mercato, stesso bookmaker, stessa lettura */
  line: Partial<Record<SelectionCode, number | null | undefined>>;
}

export type ValueGapResult =
  | {
      ok: true;
      /** quota senza margine della selezione */
      fairOdds: number;
      /** probabilità senza margine della selezione, frazione 0–1 */
      fairProb: number;
      /** overround osservato sulla linea: 0.061 = margine 6,1% */
      marginPct: number;
      /**
       * Divario fra fair ed eseguibile in PERCENTO relativo (`ev × 100`, non punti
       * percentuali): +5,0 significa che il rendimento atteso sul prezzo eseguibile
       * supera di un ventesimo la posta, non che le probabilità distano 5 pp.
       * Può essere negativo.
       */
      edgePct: number;
      /** lo stesso divario in frazione */
      expectedValue: number;
      /** numero di selezioni complete trovato sulla linea */
      selectionsUsed: number;
    }
  | { ok: false; reason: string };

/**
 * Calcola il divario. Non accetta prezzi di apertura: se vuoi misurare il movimento,
 * `dropPct` del motore dei drop è la misura giusta, non questa.
 */
export function computeValueGap(input: ValueGapInput): ValueGapResult {
  if (!isValidPrice(input.currentPrice)) {
    return {
      ok: false,
      reason: `prezzo corrente non utilizzabile (${String(input.currentPrice)})`,
    };
  }

  const fair = fairMarket({ market: input.market, prices: input.line });
  if (!fair.ok) {
    return { ok: false, reason: fair.failure.reason };
  }

  const fairOdds = fair.data.fairPrices[input.selection];
  const fairProb = fair.data.fairProbs[input.selection];
  if (fairOdds === undefined || fairProb === undefined) {
    return {
      ok: false,
      reason: `mercato ${input.market}: selezione ${input.selection} assente dalla linea`,
    };
  }
  if (!isValidPrice(fairOdds) || !(fairProb > 0 && fairProb <= 1)) {
    return {
      ok: false,
      reason: `mercato ${input.market}: linea no-vig non valida per ${input.selection}`,
    };
  }

  /* EV sul prezzo eseguibile: è l'unico che un lettore potrebbe ottenere. */
  const ev = fairProb * input.currentPrice - 1;

  return {
    ok: true,
    fairOdds: round(fairOdds, 3),
    fairProb: round(fairProb, 6),
    marginPct: round(fair.data.margin * 100, 2),
    edgePct: round(ev * 100, 2),
    expectedValue: round(ev, 4),
    selectionsUsed: Object.keys(fair.data.fairPrices).length,
  };
}
