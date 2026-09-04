/**
 * Lettura della scomposizione dell'indice di fiducia.
 *
 * Il motore assegna zero punti a un componente in due situazioni molto
 * diverse: il dato c'è e non conferma, oppure il dato non esiste affatto.
 * Mostrarle allo stesso modo sarebbe una piccola bugia — la seconda va
 * dichiarata come lacuna, non come giudizio negativo.
 *
 * Modulo puro: nessun accesso al database.
 */

export type ComponentKey =
  "magnitude" | "coordination" | "sharp" | "persistence" | "coverage";

/** Ciò che il motore ha scritto in `explanation.components`. */
export interface RawScoreComponent {
  key: ComponentKey;
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
}

/** Quel tanto di segnale che serve per capire se un componente è misurabile. */
export interface ComponentContext {
  booksTotal: number;
  sharpAvailable: boolean;
  sharpConfirms: boolean | null;
  pointCount: number;
}

export interface ScoreComponentView extends RawScoreComponent {
  /**
   * true quando i punti mancano perché manca il dato, non perché il dato
   * è sfavorevole. In questo caso la UI mostra "GAP" al posto di uno zero.
   */
  isGap: boolean;
  /** motivo della lacuna, in italiano; null quando il dato è misurato */
  gapReason: string | null;
  /** quota di punti ottenuti, 0–1; null quando il componente è un gap */
  ratio: number | null;
}

/**
 * Decide se un componente è misurato o mancante.
 *
 * Le regole seguono le decisioni già prese altrove nel sistema: la fonte
 * unica espone solo la quota di consenso, quindi coordinazione e linea sharp
 * non sono osservabili e non entrano nel punteggio come bocciature.
 */
export function componentStatusOf(
  component: RawScoreComponent,
  ctx: ComponentContext,
): ScoreComponentView {
  const base = { ...component };

  const gap = (reason: string): ScoreComponentView => ({
    ...base,
    isGap: true,
    gapReason: reason,
    ratio: null,
  });

  const measured = (): ScoreComponentView => ({
    ...base,
    isGap: false,
    gapReason: null,
    ratio:
      component.maxPoints > 0
        ? Math.max(0, Math.min(1, component.points / component.maxPoints))
        : null,
  });

  switch (component.key) {
    case "coordination":
      /* Con un solo bookmaker osservato la coordinazione non è misurabile:
         non esiste un secondo movimento con cui confrontarsi. */
      return ctx.booksTotal <= 1
        ? gap(
            "La fonte espone una sola linea di consenso: la concordanza fra bookmaker non è osservabile e non viene stimata.",
          )
        : measured();

    case "sharp":
      /* sharpConfirms null significa "non osservato", mai "non conferma". */
      return !ctx.sharpAvailable || ctx.sharpConfirms === null
        ? gap(
            "Nessuna linea sharp disponibile per questo mercato: la verifica indipendente non è eseguibile.",
          )
        : measured();

    case "persistence":
      /* Con una sola rilevazione non c'è intervallo su cui misurare la tenuta. */
      return ctx.pointCount <= 1
        ? gap(
            "Una sola rilevazione a registro: la tenuta nel tempo non è ancora misurabile.",
          )
        : measured();

    default:
      return measured();
  }
}

/** Applica la classificazione a tutta la scomposizione. */
export function scoreComponentsView(
  components: RawScoreComponent[],
  ctx: ComponentContext,
): ScoreComponentView[] {
  return components.map((c) => componentStatusOf(c, ctx));
}

/**
 * Punti effettivamente ottenibili al netto delle lacune.
 *
 * Serve a dire una cosa precisa: un indice basso può dipendere dal movimento
 * o dal fatto che metà del quadro informativo non è osservabile. Sono due
 * storie diverse e chi legge ha diritto di distinguerle.
 */
export interface ScoreReachability {
  earned: number;
  measurableMax: number;
  gapMax: number;
  totalMax: number;
}

export function scoreReachability(
  views: ScoreComponentView[],
): ScoreReachability {
  let earned = 0;
  let measurableMax = 0;
  let gapMax = 0;

  for (const v of views) {
    earned += v.points;
    if (v.isGap) gapMax += v.maxPoints;
    else measurableMax += v.maxPoints;
  }

  return {
    earned: Math.round(earned * 100) / 100,
    measurableMax,
    gapMax,
    totalMax: measurableMax + gapMax,
  };
}

/**
 * Riporta il punteggio effettivo sulla sola base misurabile.
 *
 * `effectiveScore` è il valore finale del motore e comprende gli eventuali
 * moltiplicatori applicati dopo la somma delle componenti. Se non esiste,
 * resta disponibile la somma delle componenti per i record storici.
 */
export function normalizedReachabilityScore(
  reachability: ScoreReachability,
  effectiveScore: number | null,
): number | null {
  if (reachability.measurableMax <= 0) return null;
  const earned = effectiveScore ?? reachability.earned;
  return Math.round(
    Math.max(0, Math.min(100, (earned / reachability.measurableMax) * 100)),
  );
}
