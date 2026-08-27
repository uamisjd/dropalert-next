/**
 * Geometria del grafico CLV nel tempo (Sprint ENH-1, punto 3).
 *
 * Nessuna libreria: coordinate calcolate a mano, disegno in SVG inline.
 * Il modulo è puro — nessun DOM, nessuna data implicita — così le regole
 * di lettura sono verificabili nei test invece che a occhio.
 *
 * Due scelte dichiarate:
 *  - lo zero è SEMPRE nel riquadro, perché un CLV negativo deve vedersi
 *    sotto la linea e non solo "più in basso degli altri";
 *  - i punti sotto la soglia di significatività restano nella serie ma
 *    vengono marcati: la linea non promuove un campione piccolo.
 */

export const CLV_CHART_WIDTH = 640;
export const CLV_CHART_HEIGHT = 200;
const PAD_X = 10;
const PAD_Y = 16;

export interface ClvChartInput {
  day: string;
  cumulativeAvgPp: number | null;
  cumulativeN: number;
  inconclusive: boolean;
}

export interface ClvChartDot {
  x: number;
  y: number;
  day: string;
  value: number;
  n: number;
  inconclusive: boolean;
}

export interface ClvChartGeometry {
  dots: ClvChartDot[];
  path: string;
  /** ordinata dello zero, per la linea di riferimento */
  zeroY: number;
  min: number;
  max: number;
  firstDay: string;
  lastDay: string;
}

/**
 * Costruisce le coordinate della serie cumulata.
 * `null` quando non c'è nulla da disegnare: la pagina mostra il testo, non
 * un riquadro vuoto che sembra un guasto.
 */
export function buildClvChart(
  points: ClvChartInput[],
): ClvChartGeometry | null {
  const valid = points.filter(
    (p): p is ClvChartInput & { cumulativeAvgPp: number } =>
      p.cumulativeAvgPp !== null && Number.isFinite(p.cumulativeAvgPp),
  );
  if (valid.length === 0) return null;

  const values = valid.map((p) => p.cumulativeAvgPp);
  /* lo zero entra sempre nella scala: è il riferimento del CLV */
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }

  const usableW = CLV_CHART_WIDTH - PAD_X * 2;
  const usableH = CLV_CHART_HEIGHT - PAD_Y * 2;
  const yOf = (v: number) => PAD_Y + (1 - (v - min) / (max - min)) * usableH;

  const dots: ClvChartDot[] = valid.map((p, i) => ({
    x:
      PAD_X +
      (valid.length === 1 ? usableW / 2 : (i / (valid.length - 1)) * usableW),
    y: yOf(p.cumulativeAvgPp),
    day: p.day,
    value: p.cumulativeAvgPp,
    n: p.cumulativeN,
    inconclusive: p.inconclusive,
  }));

  return {
    dots,
    path: dots
      .map((d, i) => `${i === 0 ? "M" : "L"}${d.x.toFixed(1)} ${d.y.toFixed(1)}`)
      .join(" "),
    zeroY: yOf(0),
    min,
    max,
    firstDay: valid[0].day,
    lastDay: valid[valid.length - 1].day,
  };
}

/** Data breve italiana da una chiave "2026-08-26". */
export function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  return m !== undefined && d !== undefined ? `${d}/${m}` : day;
}
