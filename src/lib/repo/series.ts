/**
 * Statistiche di una serie storica di quote.
 *
 * Funzioni pure: prendono i punti realmente registrati in `odds_snapshots` e
 * ne descrivono la forma. Non ricostruiscono nulla, non interpolano, non
 * riempiono i vuoti. Se una serie ha due punti, questo modulo lo dice invece
 * di far sembrare che ce ne siano venti.
 */
import { impliedProbability, round } from "@/lib/drop/math";
import { fmtMinutes } from "@/components/format";

/** Un punto della serie: quando è stato osservato e a che quota. */
export interface SeriesPoint {
  at: Date;
  price: number;
}

/**
 * Numero minimo di rilevazioni sotto il quale non si parla di andamento.
 *
 * Non è una soglia statistica: è una soglia di onestà. Con meno di sei punti
 * una linea è un artefatto del disegno, non una tendenza osservata.
 */
export const MIN_POINTS_FOR_TREND = 6;

export interface SeriesStats {
  opening: number | null;
  current: number | null;
  /** estremo realmente osservato nella direzione del movimento */
  peak: number | null;
  /** variazione percentuale della quota, negativa se è scesa */
  dropPct: number | null;
  /** spostamento della probabilità implicita, in punti percentuali */
  shiftPp: number | null;
  min: number | null;
  max: number | null;
  pointCount: number;
  firstAt: Date | null;
  lastAt: Date | null;
  /** durata coperta dalle osservazioni, in minuti */
  spanMinutes: number | null;
}

/**
 * Estremo osservato nella direzione indicata.
 * `down` = la quota scende, quindi il picco del movimento è il minimo.
 */
export function peakOf(prices: number[], direction: "up" | "down"): number | null {
  const valid = prices.filter((p) => Number.isFinite(p));
  if (valid.length === 0) return null;
  return direction === "down" ? Math.min(...valid) : Math.max(...valid);
}

/** Variazione percentuale fra due quote. Null se una delle due non c'è. */
export function dropPctOf(
  opening: number | null,
  current: number | null,
): number | null {
  if (opening === null || current === null) return null;
  if (!Number.isFinite(opening) || !Number.isFinite(current)) return null;
  if (opening <= 0) return null;
  return round((current / opening - 1) * 100, 2);
}

/**
 * Descrizione completa di una serie.
 * I punti vengono ordinati per istante: l'ordine di arrivo dalla query non è
 * un'ipotesi su cui vale la pena appoggiarsi.
 */
export function seriesStats(points: SeriesPoint[]): SeriesStats {
  const valid = points
    .filter((p) => Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  if (valid.length === 0) {
    return {
      opening: null,
      current: null,
      peak: null,
      dropPct: null,
      shiftPp: null,
      min: null,
      max: null,
      pointCount: 0,
      firstAt: null,
      lastAt: null,
      spanMinutes: null,
    };
  }

  const prices = valid.map((p) => p.price);
  const opening = prices[0];
  const current = prices[prices.length - 1];
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  const openingProb = impliedProbability(opening);
  const currentProb = impliedProbability(current);
  const shiftPp =
    openingProb !== null && currentProb !== null
      ? round((currentProb - openingProb) * 100, 2)
      : null;

  /* La direzione la decide il movimento osservato, non un'aspettativa. */
  const direction: "up" | "down" = current <= opening ? "down" : "up";

  const firstAt = valid[0].at;
  const lastAt = valid[valid.length - 1].at;

  return {
    opening,
    current,
    peak: peakOf(prices, direction),
    dropPct: dropPctOf(opening, current),
    shiftPp,
    min,
    max,
    pointCount: valid.length,
    firstAt,
    lastAt,
    spanMinutes: Math.round((lastAt.getTime() - firstAt.getTime()) / 60_000),
  };
}

/**
 * Profondità dell'osservazione, in parole.
 *
 * Quando la serie è corta la pagina non deve fingere di avere una storia:
 * dichiara da quanto sta guardando e quante rilevazioni ha in mano.
 */
export function describeDepth(
  stats: SeriesStats,
  now = new Date(),
): { shallow: boolean; note: string; observedForMinutes: number | null } {
  if (stats.pointCount === 0 || stats.firstAt === null) {
    return {
      shallow: true,
      observedForMinutes: null,
      note: "Nessuna rilevazione a registro per questo mercato: non c'è serie storica da mostrare.",
    };
  }

  const observedForMinutes = Math.max(
    0,
    Math.round((now.getTime() - stats.firstAt.getTime()) / 60_000),
  );
  const since = fmtMinutes(observedForMinutes);
  const n = stats.pointCount;
  const rilevazioni = `${n} ${n === 1 ? "rilevazione" : "rilevazioni"}`;

  if (n < MIN_POINTS_FOR_TREND) {
    return {
      shallow: true,
      observedForMinutes,
      note: `Osservazione iniziata da ${since}: ${rilevazioni} disponibili, troppo poche per descrivere un andamento. La linea mostra solo i punti realmente registrati.`,
    };
  }

  return {
    shallow: false,
    observedForMinutes,
    note: `Osservazione iniziata da ${since}: ${rilevazioni} registrate.`,
  };
}
