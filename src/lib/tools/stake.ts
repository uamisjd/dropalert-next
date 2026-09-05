/**
 * Quanto costa giocare: pareggio, varianza e dimensione della puntata.
 *
 * È la parte del lato "betting" che serve a NON farsi illusioni. Nessuna di
 * queste funzioni sceglie una selezione o suggerisce una giocata: misurano
 * che cosa implica aritmeticamente un prezzo, e quanto è ampia la
 * distribuzione dei risultati quando lo stesso prezzo si ripete.
 *
 * Il messaggio che queste funzioni producono è quasi sempre scomodo, ed è il
 * motivo per cui esistono:
 *  - alla quota del bookmaker il punto di pareggio è SOPRA la probabilità che
 *    la quota stessa dichiara, di quanto vale il margine;
 *  - con un vantaggio piccolo e reale la varianza resta enorme: su poche
 *    decine di giocate il risultato è dominato dal caso, non dal vantaggio;
 *  - la puntata "ottimale" di Kelly cresce in fretta e la sua metà è già
 *    difficile da sopportare: per questo qui si mostra, non si consiglia.
 *
 * Regola del progetto: la simulazione è deterministica (seme esplicito), così
 * il numero mostrato è riproducibile e testabile. Nessun generatore casuale
 * del runtime, nessuna dipendenza esterna.
 */
import { isValidPrice, round } from "@/lib/drop/math";

/** Testo unico del limite, mostrato accanto a ogni risultato. */
export const STAKE_DISCLAIMER =
  "Non indica alcuna giocata e non garantisce vincite: sono conseguenze aritmetiche di un prezzo e di una probabilità che inserisci tu.";

/** Avviso sulla dimensione della puntata, fisso in interfaccia. */
export const KELLY_NOTE =
  "La frazione di Kelly è il tetto teorico di crescita, non una raccomandazione: è calcolata su una probabilità che nessuno conosce davvero, e sovrastimarla porta a perderla più in fretta.";

/**
 * Soglia di rovina della simulazione, in percentuale del bankroll iniziale.
 * Dichiarata: sotto questo livello la sequenza è considerata rovinata.
 */
export const RUIN_THRESHOLD_PCT = 20;

/* ------------------------------------------------------------------ */
/* Conseguenze aritmetiche di un prezzo                                */
/* ------------------------------------------------------------------ */

/**
 * Probabilità di pareggio: quante volte su cento deve andare bene perché, a
 * quella quota, il risultato finale sia zero.
 *
 * @returns percentuale 0–100, oppure null se la quota non è utilizzabile.
 */
export function breakEvenWinRate(
  price: number | null | undefined,
): number | null {
  if (!isValidPrice(price)) return null;
  return round((1 / price) * 100, 2);
}

/**
 * Rendimento atteso per unità puntata.
 *
 * @param winPct probabilità di vincita in percentuale
 * @param price  quota decimale
 * @returns frazione: −0.045 significa −4,5% per ogni euro puntato.
 */
export function expectedValue(
  winPct: number | null | undefined,
  price: number | null | undefined,
): number | null {
  if (!isValidPrice(price)) return null;
  if (typeof winPct !== "number" || !Number.isFinite(winPct)) return null;
  if (winPct < 0 || winPct > 100) return null;
  return round((winPct / 100) * price - 1, 4);
}

/**
 * Frazione di bankroll secondo il criterio di Kelly.
 *
 * f* = (p·b − q) / b, con b = quota − 1. Negativa significa nessun
 * vantaggio: viene riportata come 0 con il motivo, perché una puntata
 * negativa non esiste.
 */
export function kellyFraction(
  winPct: number | null | undefined,
  price: number | null | undefined,
): { fractionPct: number; hasEdge: boolean } | null {
  if (!isValidPrice(price)) return null;
  if (typeof winPct !== "number" || !Number.isFinite(winPct)) return null;
  if (winPct < 0 || winPct > 100) return null;
  const p = winPct / 100;
  const b = price - 1;
  if (b <= 0) return null;
  const f = (p * b - (1 - p)) / b;
  return {
    fractionPct: round(Math.max(0, f) * 100, 2),
    hasEdge: f > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Simulazione della varianza                                          */
/* ------------------------------------------------------------------ */

/**
 * Generatore pseudocasuale deterministico (mulberry32).
 *
 * Scelto perché riproducibile: a parità di seme la simulazione dà sempre gli
 * stessi numeri, quindi il risultato mostrato è verificabile e i test non
 * sono fluttuanti.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulationInput {
  /** capitale iniziale, in unità qualsiasi */
  bankroll: number;
  /** quota decimale a cui si gioca */
  price: number;
  /** probabilità di vincita reale, in percentuale */
  winPct: number;
  /** numero di giocate della sequenza */
  bets: number;
  /** puntata in percentuale del capitale CORRENTE a ogni giro */
  stakePct: number;
  /** quante sequenze simulare */
  trials: number;
  /** seme del generatore: stesso seme, stesso risultato */
  seed: number;
}

export interface SimulationResult {
  trials: number;
  bets: number;
  /** capitale finale: mediana, 5° e 95° percentile */
  finalMedian: number;
  finalP5: number;
  finalP95: number;
  /** quota di sequenze chiuse sotto il capitale iniziale, in percentuale */
  lossSharePct: number;
  /** quota di sequenze scese sotto la soglia di rovina, in percentuale */
  ruinSharePct: number;
  /** calo massimo dal picco: mediana, in percentuale del capitale */
  maxDrawdownMedianPct: number;
  /** rendimento atteso teorico per giocata, in percentuale */
  evPerBetPct: number;
  /** rendimento atteso teorico sulla sequenza, in percentuale */
  expectedTotalPct: number;
  /** esito migliore e peggiore osservati, in % rispetto al capitale iniziale */
  bestPct: number;
  worstPct: number;
}

/** Limiti dichiarati: oltre, la simulazione diventa solo lenta. */
export const SIM_LIMITS = {
  maxBets: 5000,
  maxTrials: 20000,
  minStakePct: 0.1,
  maxStakePct: 100,
} as const;

export const SIMULATION_NOTE = `Simulazione deterministica: stesso seme, stesso risultato. La soglia di rovina è fissata al ${RUIN_THRESHOLD_PCT}% del capitale iniziale ed è una convenzione dichiarata, non una legge.`;

function percentileIndex(length: number, pct: number): number {
  if (length === 0) return 0;
  return Math.min(length - 1, Math.max(0, Math.round((pct / 100) * (length - 1))));
}

/**
 * Simula `trials` sequenze di `bets` giocate allo stesso prezzo.
 *
 * Non predice nulla: mostra l'ampiezza della distribuzione. È il numero che
 * manca quasi sempre quando si parla di "vantaggio", ed è il motivo per cui
 * un vantaggio piccolo e reale non si vede nel conto di un mese.
 */
export function simulate(input: SimulationInput): SimulationResult | null {
  const { bankroll, price, winPct, bets, stakePct, trials, seed } = input;
  if (!isValidPrice(price)) return null;
  if (!Number.isFinite(bankroll) || bankroll <= 0) return null;
  if (!Number.isFinite(winPct) || winPct < 0 || winPct > 100) return null;
  if (!Number.isInteger(bets) || bets < 1 || bets > SIM_LIMITS.maxBets) return null;
  if (!Number.isInteger(trials) || trials < 1 || trials > SIM_LIMITS.maxTrials)
    return null;
  if (
    !Number.isFinite(stakePct) ||
    stakePct < SIM_LIMITS.minStakePct ||
    stakePct > SIM_LIMITS.maxStakePct
  )
    return null;

  const p = winPct / 100;
  const stakeFraction = stakePct / 100;
  const random = mulberry32(seed);

  const finals: number[] = [];
  const drawdowns: number[] = [];
  let losses = 0;
  let ruins = 0;

  for (let t = 0; t < trials; t++) {
    let capital = bankroll;
    let peak = bankroll;
    let worstDrawdown = 0;
    let ruined = false;

    for (let i = 0; i < bets; i++) {
      const stake = capital * stakeFraction;
      capital = random() < p ? capital + stake * (price - 1) : capital - stake;
      if (capital <= 0) {
        capital = 0;
        ruined = true;
        break;
      }
      if (capital > peak) peak = capital;
      const dd = peak > 0 ? (peak - capital) / peak : 0;
      if (dd > worstDrawdown) worstDrawdown = dd;
      if (!ruined && capital < bankroll * (RUIN_THRESHOLD_PCT / 100)) {
        ruined = true;
      }
    }

    finals.push(capital);
    drawdowns.push(worstDrawdown);
    if (capital < bankroll) losses += 1;
    if (ruined) ruins += 1;
  }

  finals.sort((a, b) => a - b);
  drawdowns.sort((a, b) => a - b);

  const evPct = (p * price - 1) * 100;
  const pctOfStart = (v: number) => round(((v - bankroll) / bankroll) * 100, 1);

  return {
    trials,
    bets,
    finalMedian: round(finals[percentileIndex(finals.length, 50)] ?? 0, 2),
    finalP5: round(finals[percentileIndex(finals.length, 5)] ?? 0, 2),
    finalP95: round(finals[percentileIndex(finals.length, 95)] ?? 0, 2),
    lossSharePct: round((losses / trials) * 100, 1),
    ruinSharePct: round((ruins / trials) * 100, 1),
    maxDrawdownMedianPct: round(
      (drawdowns[percentileIndex(drawdowns.length, 50)] ?? 0) * 100,
      1,
    ),
    evPerBetPct: round(evPct, 2),
    expectedTotalPct: round((Math.pow(1 + evPct / 100, bets) - 1) * 100, 1),
    bestPct: pctOfStart(finals[finals.length - 1] ?? bankroll),
    worstPct: pctOfStart(finals[0] ?? 0),
  };
}
