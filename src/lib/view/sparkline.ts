/**
 * Geometria della sparkline di card (Sprint UX-3).
 *
 * Stessa disciplina del grafico di dettaglio: si disegnano SOLO i punti
 * realmente registrati, i segmenti sono collegamenti visivi e non dati
 * osservati, e sotto i due punti non si disegna niente — la card mostra i
 * valori in testo invece di suggerire un andamento che non è stato visto.
 *
 * Modulo puro: nessun DOM, nessuna data implicita, nessuna query.
 */

export const SPARK_WIDTH = 320;
export const SPARK_HEIGHT = 44;
const PAD_X = 3;
const PAD_Y = 6;

/** Sotto questa soglia non c'è nulla da disegnare. */
export const MIN_POINTS_FOR_SPARKLINE = 2;

export interface SparkPoint {
  /** istante in millisecondi */
  t: number;
  /** quota osservata */
  v: number;
}

export interface SparkDot extends SparkPoint {
  x: number;
  y: number;
}

export interface SparkGeometry {
  dots: SparkDot[];
  path: string;
  min: number;
  max: number;
  /** tutti i valori coincidono: la linea è orizzontale per davvero */
  flat: boolean;
  first: SparkDot;
  last: SparkDot;
  /**
   * Estremo nella direzione del movimento: il valore da cui si misura il drop.
   * Coincide col primo o con l'ultimo punto quando la serie è monotona.
   */
  peak: SparkDot;
  /** true quando la quota è complessivamente scesa */
  falling: boolean;
}

/**
 * Coordinate della sparkline, oppure `null` quando i punti utili sono meno
 * di due: chi disegna deve poter distinguere "non disegnabile" da "piatto".
 */
export function buildSparkline(points: SparkPoint[]): SparkGeometry | null {
  const valid = points
    .filter(
      (p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0,
    )
    .sort((a, b) => a.t - b.t);

  if (valid.length < MIN_POINTS_FOR_SPARKLINE) return null;

  const values = valid.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max - min < 1e-9;

  const firstT = valid[0].t;
  const lastT = valid[valid.length - 1].t;
  const spanT = lastT - firstT;

  const usableW = SPARK_WIDTH - PAD_X * 2;
  const usableH = SPARK_HEIGHT - PAD_Y * 2;

  const dots: SparkDot[] = valid.map((p, i) => {
    /* istanti tutti uguali: passo costante, invece di sovrapporre i punti */
    const fx =
      spanT > 0 ? (p.t - firstT) / spanT : i / (valid.length - 1);
    /* quota bassa in alto: il drop si vede come una discesa del prezzo,
       quindi l'asse resta quello naturale (valore alto = alto) */
    const fy = flat ? 0.5 : (p.v - min) / (max - min);
    return {
      ...p,
      x: PAD_X + fx * usableW,
      y: PAD_Y + (1 - fy) * usableH,
    };
  });

  const first = dots[0];
  const last = dots[dots.length - 1];
  const falling = last.v < first.v;

  /* il picco del movimento è l'estremo nella direzione osservata */
  const peak = dots.reduce((acc, d) =>
    falling ? (d.v < acc.v ? d : acc) : d.v > acc.v ? d : acc,
  );

  const path = dots
    .map((d, i) => `${i === 0 ? "M" : "L"}${d.x.toFixed(1)} ${d.y.toFixed(1)}`)
    .join(" ");

  return { dots, path, min, max, flat, first, last, peak, falling };
}
