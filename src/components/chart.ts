/**
 * Geometria del grafico della serie storica.
 *
 * Nessuna libreria: un grafico a linea è aritmetica, e portarsi dietro un
 * pacchetto per farla costerebbe più di quanto renda. Qui si calcolano solo
 * le coordinate; il disegno è un SVG inline nel componente.
 *
 * Il modulo è puro e testabile: nessun accesso al DOM, nessuna data implicita.
 */

/** Coordinate del riquadro di disegno, in unità utente SVG. */
export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 180;
const PAD_X = 8;
const PAD_Y = 14;

export interface ChartInput {
  /** istante in millisecondi */
  t: number;
  /** valore osservato (una quota) */
  v: number;
}

export interface ChartDot extends ChartInput {
  x: number;
  y: number;
}

export interface ChartGeometry {
  dots: ChartDot[];
  /** percorso SVG, stringa vuota se c'è un solo punto */
  path: string;
  min: number;
  max: number;
  /** true quando tutti i valori coincidono: la linea è orizzontale */
  flat: boolean;
  firstT: number;
  lastT: number;
}

/**
 * Trasforma i punti osservati in coordinate.
 *
 * Restituisce `null` se non c'è nulla da disegnare: la pagina deve poter
 * distinguere "grafico vuoto" da "grafico piatto", che sono cose diverse.
 *
 * Due casi degeneri sono gestiti esplicitamente perché in produzione capitano
 * davvero: tutti i valori uguali (serie ferma) e tutti gli istanti uguali
 * (due rilevazioni nello stesso secondo). In entrambi la divisione ingenua
 * produrrebbe NaN e il tracciato sparirebbe senza spiegazione.
 */
export function buildChart(points: ChartInput[]): ChartGeometry | null {
  const valid = points
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);

  if (valid.length === 0) return null;

  const values = valid.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max - min < 1e-9;

  const firstT = valid[0].t;
  const lastT = valid[valid.length - 1].t;
  const spanT = lastT - firstT;

  const usableW = CHART_WIDTH - PAD_X * 2;
  const usableH = CHART_HEIGHT - PAD_Y * 2;

  const dots: ChartDot[] = valid.map((p, i) => {
    /* Se tutti gli istanti coincidono i punti si distribuiscono a passo
       uguale: l'alternativa sarebbe sovrapporli tutti nello stesso pixel. */
    const fx =
      spanT > 0
        ? (p.t - firstT) / spanT
        : valid.length === 1
          ? 0.5
          : i / (valid.length - 1);

    /* Serie piatta: linea a metà altezza invece di 0/0. */
    const fy = flat ? 0.5 : (p.v - min) / (max - min);

    return {
      ...p,
      x: round2(PAD_X + fx * usableW),
      /* y cresce verso il basso in SVG: la quota alta va in alto */
      y: round2(PAD_Y + (1 - fy) * usableH),
    };
  });

  const path =
    dots.length < 2
      ? ""
      : dots
          .map((d, i) => `${i === 0 ? "M" : "L"} ${d.x} ${d.y}`)
          .join(" ");

  return { dots, path, min, max, flat, firstT, lastT };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
