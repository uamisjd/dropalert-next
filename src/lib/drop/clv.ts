/**
 * CLV — Closing Line Value.
 *
 * È l'unica misura di validità dell'osservatorio: un segnale è utile se la
 * quota rilevata era migliore della quota di chiusura. Non promette esiti.
 *
 * Convenzione dei segni:
 *  - clvPp  = (probChiusura - probSegnale) * 100. Positivo = il mercato si è
 *             mosso ancora nella direzione del segnale dopo il rilevamento.
 *  - clvPct = signalPrice / closingPrice - 1. Positivo = quota rilevata più
 *             alta della chiusura, cioè prezzo migliore.
 */
import { impliedProbability, isValidPrice, round } from "./math";

export interface ClvInput {
  signalPrice: number;
  closingPrice: number;
}

export interface ClvResult {
  signalPrice: number;
  closingPrice: number;
  signalProb: number;
  closingProb: number;
  clvPp: number;
  clvPct: number;
  beatClose: boolean;
}

/** Calcola il CLV per un singolo segnale. null se una quota non è valida. */
export function computeClv(input: ClvInput): ClvResult | null {
  if (!isValidPrice(input.signalPrice) || !isValidPrice(input.closingPrice)) {
    return null;
  }
  const signalProb = impliedProbability(input.signalPrice);
  const closingProb = impliedProbability(input.closingPrice);
  if (signalProb === null || closingProb === null) return null;

  const clvPp = (closingProb - signalProb) * 100;
  const clvPct = input.signalPrice / input.closingPrice - 1;

  return {
    signalPrice: round(input.signalPrice, 3),
    closingPrice: round(input.closingPrice, 3),
    signalProb: round(signalProb, 6),
    closingProb: round(closingProb, 6),
    clvPp: round(clvPp, 2),
    clvPct: round(clvPct, 4),
    beatClose: clvPct > 0,
  };
}

export interface ClvAggregate {
  sampleSize: number;
  beatCloseCount: number;
  /** quota di segnali che hanno battuto la chiusura, 0–1 */
  beatCloseRate: number;
  /** CLV medio in punti percentuali */
  avgClvPp: number;
  /** CLV medio in percentuale di prezzo */
  avgClvPct: number;
  medianClvPp: number;
  /** deviazione standard campionaria del clvPp */
  stdDevClvPp: number;
  /**
   * Intervallo di confidenza normale al 95% sulla media di clvPp.
   * null sotto le 10 osservazioni: campione troppo piccolo.
   */
  ci95: { low: number; high: number } | null;
  /** true se il campione è troppo piccolo per trarre conclusioni */
  underpowered: boolean;
}

/** Numero minimo di osservazioni sotto cui non pubblichiamo conclusioni. */
export const MIN_SAMPLE_FOR_INFERENCE = 10;

/** Aggrega una lista di CLV in statistiche descrittive oneste. */
export function aggregateClv(records: ClvResult[]): ClvAggregate {
  const n = records.length;
  if (n === 0) {
    return {
      sampleSize: 0,
      beatCloseCount: 0,
      beatCloseRate: 0,
      avgClvPp: 0,
      avgClvPct: 0,
      medianClvPp: 0,
      stdDevClvPp: 0,
      ci95: null,
      underpowered: true,
    };
  }

  const pps = records.map((r) => r.clvPp);
  const pcts = records.map((r) => r.clvPct);
  const beat = records.filter((r) => r.beatClose).length;

  const avgPp = pps.reduce((a, b) => a + b, 0) / n;
  const avgPct = pcts.reduce((a, b) => a + b, 0) / n;

  const sorted = [...pps].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const medPp = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  const variance =
    n > 1 ? pps.reduce((acc, v) => acc + (v - avgPp) ** 2, 0) / (n - 1) : 0;
  const stdDev = Math.sqrt(variance);

  const underpowered = n < MIN_SAMPLE_FOR_INFERENCE;
  const stdErr = n > 1 ? stdDev / Math.sqrt(n) : 0;
  const ci95 = underpowered
    ? null
    : { low: round(avgPp - 1.96 * stdErr, 2), high: round(avgPp + 1.96 * stdErr, 2) };

  return {
    sampleSize: n,
    beatCloseCount: beat,
    beatCloseRate: round(beat / n, 4),
    avgClvPp: round(avgPp, 2),
    avgClvPct: round(avgPct, 4),
    medianClvPp: round(medPp, 2),
    stdDevClvPp: round(stdDev, 2),
    ci95,
    underpowered,
  };
}

/**
 * Frase di lettura del risultato aggregato, senza promesse.
 * Dichiara esplicitamente quando il campione è insufficiente.
 */
export function describeClv(agg: ClvAggregate): string {
  if (agg.sampleSize === 0) {
    return "Nessun segnale con linea di chiusura acquisita: il CLV non è ancora calcolabile.";
  }
  if (agg.underpowered) {
    return `Campione di ${agg.sampleSize} segnali: troppo piccolo per una conclusione statistica. CLV medio osservato ${agg.avgClvPp > 0 ? "+" : ""}${agg.avgClvPp} pp.`;
  }
  const direction =
    agg.ci95 && agg.ci95.low > 0
      ? "Il CLV medio è positivo con intervallo di confidenza interamente sopra lo zero."
      : agg.ci95 && agg.ci95.high < 0
        ? "Il CLV medio è negativo con intervallo di confidenza interamente sotto lo zero."
        : "L'intervallo di confidenza include lo zero: il CLV non è distinguibile dal caso.";
  return `Su ${agg.sampleSize} segnali chiusi, ${agg.beatCloseCount} hanno battuto la quota di chiusura (${round(agg.beatCloseRate * 100, 1)}%). CLV medio ${agg.avgClvPp > 0 ? "+" : ""}${agg.avgClvPp} pp. ${direction}`;
}
