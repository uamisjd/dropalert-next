/**
 * Motore di analisi dei movimenti di quota.
 *
 * Principi:
 *  - funzioni pure: stesso input → stesso output, nessun accesso a IO;
 *  - nessun segnale inventato: se il dato manca, la funzione lo dichiara
 *    e il punteggio ne risente, non viene stimato;
 *  - il punteggio misura la SOLIDITÀ DELL'OSSERVAZIONE, non la probabilità
 *    che un esito si verifichi, e non costituisce un consiglio.
 */
import type { ConfidenceBand, MagnitudeClass } from "@/db/schema";
import {
  CONFIDENCE_BANDS,
  CONFIDENCE_WEIGHTS,
  ENGINE_VERSION,
  FLASH_WINDOW_MINUTES,
  FULLY_SUSTAINED_MINUTES,
  MAGNITUDE_LABELS_IT,
  MAGNITUDE_THRESHOLDS,
  MIN_BOOKS_FOR_COORDINATION,
  MIN_BOOKS_FOR_FULL_PICTURE,
  MIN_COVERAGE_FOR_BAND,
  REBOUND_RATIO_THRESHOLD,
} from "./constants";
import {
  clamp,
  deltaInPercentagePoints,
  impliedProbability,
  isValidPrice,
  median,
  minutesBetween,
  round,
} from "./math";
import type {
  BookmakerSeries,
  CoordinationResult,
  CoverageResult,
  CoverageResult as Coverage,
  DropAnalysis,
  DropAnalysisInput,
  MagnitudeResult,
  PersistenceResult,
  PricePoint,
  ScoreComponent,
  SharpResult,
  SignalExplanation,
} from "./types";

/* ------------------------------------------------------------------ */
/* Utility interne                                                     */
/* ------------------------------------------------------------------ */

function sortPoints(points: PricePoint[]): PricePoint[] {
  return [...points]
    .filter((p) => isValidPrice(p.price))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function firstPoint(series: BookmakerSeries): PricePoint | null {
  const s = sortPoints(series.points);
  return s.length > 0 ? s[0] : null;
}

function lastPoint(series: BookmakerSeries): PricePoint | null {
  const s = sortPoints(series.points);
  return s.length > 0 ? s[s.length - 1] : null;
}

/**
 * Consenso di mercato a un dato istante: mediana delle quote note dei book
 * che avevano già una quotazione a quell'istante (last-observation-carried-forward).
 * La mediana è preferita alla media perché resiste al book fuori linea.
 */
export function consensusAt(series: BookmakerSeries[], at: Date): number | null {
  const prices: number[] = [];
  for (const s of series) {
    const pts = sortPoints(s.points).filter((p) => p.at.getTime() <= at.getTime());
    if (pts.length > 0) prices.push(pts[pts.length - 1].price);
  }
  return median(prices);
}

/** Griglia temporale unificata: tutti gli istanti osservati, ordinati. */
export function timeline(series: BookmakerSeries[]): Date[] {
  const set = new Map<number, Date>();
  for (const s of series) {
    for (const p of sortPoints(s.points)) set.set(p.at.getTime(), p.at);
  }
  return [...set.values()].sort((a, b) => a.getTime() - b.getTime());
}

/* ------------------------------------------------------------------ */
/* 1. Ampiezza                                                         */
/* ------------------------------------------------------------------ */

/**
 * Classifica l'ampiezza in punti percentuali secondo le soglie dichiarate.
 * Usa il valore assoluto: la classe descrive l'intensità, il segno la direzione.
 */
export function classifyMagnitude(deltaPp: number): MagnitudeClass {
  const abs = Math.abs(deltaPp);
  if (abs < MAGNITUDE_THRESHOLDS.noise) return "noise";
  if (abs < MAGNITUDE_THRESHOLDS.moderate) return "moderate";
  if (abs < MAGNITUDE_THRESHOLDS.high) return "high";
  return "very_high";
}

/**
 * Ampiezza del movimento sul consenso di mercato.
 * @returns null se non esistono almeno due istanti con consenso calcolabile.
 */
export function computeMagnitude(series: BookmakerSeries[]): MagnitudeResult | null {
  const times = timeline(series);
  if (times.length < 2) return null;

  const openingPrice = consensusAt(series, times[0]);
  const currentPrice = consensusAt(series, times[times.length - 1]);
  if (openingPrice === null || currentPrice === null) return null;

  const openingProb = impliedProbability(openingPrice);
  const currentProb = impliedProbability(currentPrice);
  if (openingProb === null || currentProb === null) return null;

  const deltaPp = (currentProb - openingProb) * 100;

  // picco: massimo scostamento nella direzione del movimento corrente
  let peakDeltaPp = deltaPp;
  for (const t of times) {
    const p = consensusAt(series, t);
    const d = deltaInPercentagePoints(openingPrice, p);
    if (d === null) continue;
    if (deltaPp >= 0 ? d > peakDeltaPp : d < peakDeltaPp) peakDeltaPp = d;
  }

  return {
    openingPrice: round(openingPrice, 3),
    currentPrice: round(currentPrice, 3),
    openingProb: round(openingProb, 6),
    currentProb: round(currentProb, 6),
    deltaPp: round(deltaPp, 2),
    peakDeltaPp: round(peakDeltaPp, 2),
    magnitudeClass: classifyMagnitude(deltaPp),
    isSignificant: Math.abs(deltaPp) >= MAGNITUDE_THRESHOLDS.noise,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Coordinazione fra bookmaker                                      */
/* ------------------------------------------------------------------ */

/**
 * Quanti book confermano la direzione del movimento di consenso.
 * Un book conferma se si muove nella stessa direzione di almeno metà
 * della soglia di rumore (1 pp): sotto quel livello è considerato fermo.
 */
export function computeCoordination(
  series: BookmakerSeries[],
  consensusDeltaPp: number,
): CoordinationResult {
  const direction = Math.sign(consensusDeltaPp);
  const minMovePp = MAGNITUDE_THRESHOLDS.noise / 2;

  let confirming = 0;
  let opposing = 0;
  let flat = 0;
  let weightConfirming = 0;
  let weightTotal = 0;

  const perBook: CoordinationResult["perBook"] = [];

  for (const s of series) {
    const first = firstPoint(s);
    const last = lastPoint(s);
    const openingPrice = first?.price ?? null;
    const currentPrice = last?.price ?? null;
    const deltaPp =
      first && last && first !== last
        ? deltaInPercentagePoints(first.price, last.price)
        : first && last
          ? 0
          : null;

    let dir: "confirm" | "oppose" | "flat" | "unknown" = "unknown";
    if (deltaPp === null) {
      dir = "unknown";
    } else if (Math.abs(deltaPp) < minMovePp) {
      dir = "flat";
      flat += 1;
    } else if (Math.sign(deltaPp) === direction && direction !== 0) {
      dir = "confirm";
      confirming += 1;
      weightConfirming += s.weight;
    } else {
      dir = "oppose";
      opposing += 1;
    }
    if (deltaPp !== null) weightTotal += s.weight;

    perBook.push({
      bookmakerId: s.bookmakerId,
      bookmakerKey: s.bookmakerKey,
      bookmakerName: s.bookmakerName,
      isSharp: s.isSharp,
      openingPrice: openingPrice === null ? null : round(openingPrice, 3),
      currentPrice: currentPrice === null ? null : round(currentPrice, 3),
      deltaPp: deltaPp === null ? null : round(deltaPp, 2),
      direction: dir,
    });
  }

  perBook.sort((a, b) => (b.deltaPp ?? -Infinity) - (a.deltaPp ?? -Infinity));

  const booksTotal = confirming + opposing + flat;
  const coordinationScore =
    weightTotal > 0 && booksTotal >= MIN_BOOKS_FOR_COORDINATION
      ? clamp(weightConfirming / weightTotal, 0, 1)
      : 0;

  return {
    booksTotal,
    booksConfirming: confirming,
    booksOpposing: opposing,
    booksFlat: flat,
    coordinationScore: round(coordinationScore, 3),
    perBook,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Conferma sharp                                                   */
/* ------------------------------------------------------------------ */

/**
 * La linea sharp è la conferma indipendente più informativa.
 * Se nessun book sharp è disponibile lo dichiariamo: non si stima.
 */
export function computeSharp(
  series: BookmakerSeries[],
  consensusDeltaPp: number,
): SharpResult {
  const sharps = series.filter((s) => s.isSharp);
  if (sharps.length === 0) {
    return {
      available: false,
      confirms: null,
      deltaPp: null,
      bookKeys: [],
      leadsMarket: null,
    };
  }

  const deltas: number[] = [];
  const keys: string[] = [];
  for (const s of sharps) {
    const first = firstPoint(s);
    const last = lastPoint(s);
    if (!first || !last) continue;
    const d = deltaInPercentagePoints(first.price, last.price);
    if (d === null) continue;
    deltas.push(d);
    keys.push(s.bookmakerKey);
  }

  if (deltas.length === 0) {
    return {
      available: false,
      confirms: null,
      deltaPp: null,
      bookKeys: sharps.map((s) => s.bookmakerKey),
      leadsMarket: null,
    };
  }

  const sharpDelta = median(deltas) ?? 0;
  const minMovePp = MAGNITUDE_THRESHOLDS.noise / 2;
  const confirms =
    Math.abs(sharpDelta) >= minMovePp &&
    Math.sign(sharpDelta) === Math.sign(consensusDeltaPp) &&
    consensusDeltaPp !== 0;

  return {
    available: true,
    confirms,
    deltaPp: round(sharpDelta, 2),
    bookKeys: keys,
    leadsMarket: confirms ? Math.abs(sharpDelta) > Math.abs(consensusDeltaPp) : false,
  };
}

/* ------------------------------------------------------------------ */
/* 4. Persistenza e rimbalzo                                           */
/* ------------------------------------------------------------------ */

/**
 * Struttura temporale: quando è iniziato il movimento, quanto è durato,
 * se è flash e se è rientrato.
 *
 * Un movimento flash (< 30 min) riceve fiducia inferiore.
 * Un movimento sostenuto per ore riceve fiducia superiore.
 * Un movimento rimbalzato oltre il 50% è un falso segnale parziale.
 */
export function computePersistence(
  series: BookmakerSeries[],
  now: Date,
): PersistenceResult | null {
  const times = timeline(series);
  if (times.length < 2) return null;

  const openingPrice = consensusAt(series, times[0]);
  if (openingPrice === null) return null;

  const minMovePp = MAGNITUDE_THRESHOLDS.noise;

  // serie dei delta cumulati rispetto all'apertura
  const track: Array<{ at: Date; delta: number }> = [];
  for (const t of times) {
    const p = consensusAt(series, t);
    const d = deltaInPercentagePoints(openingPrice, p);
    if (d !== null) track.push({ at: t, delta: d });
  }
  if (track.length < 2) return null;

  const currentDelta = track[track.length - 1].delta;
  const dir = Math.sign(currentDelta) || 1;

  // picco nella direzione del movimento
  let peak = track[0];
  for (const point of track) {
    if (dir > 0 ? point.delta > peak.delta : point.delta < peak.delta) peak = point;
  }

  // primo istante in cui il movimento ha superato la soglia di rumore
  const firstSignificant =
    track.find((p) => Math.abs(p.delta) >= minMovePp && Math.sign(p.delta) === dir) ??
    peak;

  const firstMoveAt = firstSignificant.at;
  const lastMoveAt = track[track.length - 1].at;
  const sustainedMinutes = Math.max(0, minutesBetween(firstMoveAt, now));
  const moveDurationMinutes = Math.max(0, minutesBetween(firstMoveAt, peak.at));

  // ritracciamento: quanto del picco è stato restituito
  const peakAbs = Math.abs(peak.delta);
  const currentAbs = Math.abs(currentDelta);
  const retracementRatio =
    peakAbs > 0 ? clamp((peakAbs - currentAbs) / peakAbs, 0, 1) : 0;
  const rebounded =
    peakAbs >= minMovePp && retracementRatio >= REBOUND_RATIO_THRESHOLD;

  const isFlash =
    moveDurationMinutes <= FLASH_WINDOW_MINUTES &&
    sustainedMinutes < FLASH_WINDOW_MINUTES;

  // punteggio: cresce col tempo di tenuta, penalizzato dal ritracciamento
  const durationScore = clamp(sustainedMinutes / FULLY_SUSTAINED_MINUTES, 0, 1);
  const persistenceScore = clamp(durationScore * (1 - retracementRatio), 0, 1);

  return {
    firstMoveAt,
    lastMoveAt,
    sustainedMinutes: Math.round(sustainedMinutes),
    moveDurationMinutes: Math.round(moveDurationMinutes),
    isFlash,
    rebounded,
    retracementRatio: round(retracementRatio, 3),
    persistenceScore: round(persistenceScore, 3),
  };
}

/* ------------------------------------------------------------------ */
/* 5. Copertura dati                                                   */
/* ------------------------------------------------------------------ */

/** Quanto del quadro informativo è realmente disponibile. */
export function computeCoverage(
  input: DropAnalysisInput,
  hasSharp: boolean,
): CoverageResult {
  const missing: string[] = [];
  const booksObserved = input.series.filter((s) => s.points.length > 0).length;
  const booksExpected = Math.max(
    input.expectedBookmakers ?? MIN_BOOKS_FOR_FULL_PICTURE,
    booksObserved,
    1,
  );

  const times = timeline(input.series);
  const historyDepthMinutes =
    times.length >= 2 ? Math.round(minutesBetween(times[0], times[times.length - 1])) : 0;
  const staleSeries = input.series.filter((s) =>
    s.points.some((p) => p.isStale),
  ).length;

  const bookRatio = clamp(booksObserved / booksExpected, 0, 1);
  const depthRatio = clamp(historyDepthMinutes / FULLY_SUSTAINED_MINUTES, 0, 1);
  const hasOpeningLine = times.length >= 2;

  if (booksObserved < MIN_BOOKS_FOR_COORDINATION) {
    missing.push(
      `Solo ${booksObserved} bookmaker con dati: impossibile verificare la coordinazione.`,
    );
  } else if (booksObserved < MIN_BOOKS_FOR_FULL_PICTURE) {
    missing.push(
      `Copertura parziale: ${booksObserved} bookmaker su ${booksExpected} attesi.`,
    );
  }
  if (!hasSharp) missing.push("Nessuna linea sharp disponibile per questo mercato.");
  if (!hasOpeningLine) missing.push("Linea di apertura non disponibile.");
  if (historyDepthMinutes < 60) {
    missing.push(
      `Storico breve: ${historyDepthMinutes} minuti di osservazioni disponibili.`,
    );
  }
  if (staleSeries > 0) {
    missing.push(`${staleSeries} serie contengono snapshot non aggiornati.`);
  }

  const score = clamp(
    bookRatio * 0.45 + depthRatio * 0.3 + (hasSharp ? 0.15 : 0) + (hasOpeningLine ? 0.1 : 0),
    0,
    1,
  );

  return {
    score: round(score, 3),
    booksObserved,
    booksExpected,
    hasSharp,
    hasOpeningLine,
    historyDepthMinutes,
    staleSeries,
    missing,
  };
}

/* ------------------------------------------------------------------ */
/* 6. Punteggio di fiducia e spiegazione                               */
/* ------------------------------------------------------------------ */

function magnitudePoints(m: MagnitudeResult): number {
  const abs = Math.abs(m.deltaPp);
  const max = CONFIDENCE_WEIGHTS.magnitude;
  if (abs < MAGNITUDE_THRESHOLDS.noise) return 0;
  if (abs < MAGNITUDE_THRESHOLDS.moderate) return max * 0.4;
  if (abs < MAGNITUDE_THRESHOLDS.high) return max * 0.75;
  return max;
}

/** Banda di fiducia derivata dal punteggio, con guardia sulla copertura. */
export function toConfidenceBand(score: number, coverage: number): ConfidenceBand {
  if (coverage < MIN_COVERAGE_FOR_BAND) return "insufficient_data";
  if (score >= CONFIDENCE_BANDS.high) return "high";
  if (score >= CONFIDENCE_BANDS.medium) return "medium";
  if (score >= CONFIDENCE_BANDS.low) return "low";
  return "low";
}

/**
 * Punteggio 0–100 sulla solidità dell'osservazione.
 * NON è una probabilità di vincita e non è un consiglio.
 */
export function computeConfidence(
  magnitude: MagnitudeResult,
  coordination: CoordinationResult,
  sharp: SharpResult,
  persistence: PersistenceResult,
  coverage: Coverage,
): { score: number; components: ScoreComponent[] } {
  const components: ScoreComponent[] = [];

  /* ampiezza */
  const magPts = magnitudePoints(magnitude);
  components.push({
    key: "magnitude",
    label: "Ampiezza del movimento",
    points: round(magPts, 2),
    maxPoints: CONFIDENCE_WEIGHTS.magnitude,
    detail: `${magnitude.deltaPp >= 0 ? "+" : ""}${magnitude.deltaPp} punti percentuali di probabilità implicita (${MAGNITUDE_LABELS_IT[magnitude.magnitudeClass]}), da quota ${magnitude.openingPrice} a ${magnitude.currentPrice}.`,
  });

  /* coordinazione */
  const coordPts =
    coordination.booksTotal >= MIN_BOOKS_FOR_COORDINATION
      ? CONFIDENCE_WEIGHTS.coordination * coordination.coordinationScore
      : 0;
  components.push({
    key: "coordination",
    label: "Conferma fra bookmaker",
    points: round(coordPts, 2),
    maxPoints: CONFIDENCE_WEIGHTS.coordination,
    detail:
      coordination.booksTotal >= MIN_BOOKS_FOR_COORDINATION
        ? `${coordination.booksConfirming} bookmaker su ${coordination.booksTotal} si muovono nella stessa direzione (${coordination.booksOpposing} in direzione opposta, ${coordination.booksFlat} fermi).`
        : `Dati da un solo bookmaker: un movimento isolato non è coordinato.`,
  });

  /* sharp */
  let sharpPts = 0;
  let sharpDetail: string;
  if (!sharp.available) {
    sharpPts = 0;
    sharpDetail = "Linea sharp non disponibile: la conferma indipendente manca.";
  } else if (sharp.confirms) {
    sharpPts = sharp.leadsMarket
      ? CONFIDENCE_WEIGHTS.sharp
      : CONFIDENCE_WEIGHTS.sharp * 0.8;
    sharpDetail = sharp.leadsMarket
      ? `La linea sharp si muove di ${sharp.deltaPp} pp, più del consenso: il movimento è guidato dai libri di riferimento.`
      : `La linea sharp conferma la direzione con ${sharp.deltaPp} pp.`;
  } else {
    sharpPts = 0;
    sharpDetail = `La linea sharp non conferma (${sharp.deltaPp} pp): il movimento resta circoscritto agli altri libri.`;
  }
  components.push({
    key: "sharp",
    label: "Conferma linea sharp",
    points: round(sharpPts, 2),
    maxPoints: CONFIDENCE_WEIGHTS.sharp,
    detail: sharpDetail,
  });

  /* persistenza */
  let persPts = CONFIDENCE_WEIGHTS.persistence * persistence.persistenceScore;
  if (persistence.isFlash) persPts *= 0.5;
  if (persistence.rebounded) persPts *= 0.3;
  const persDetailParts: string[] = [];
  persDetailParts.push(
    `Movimento osservato da ${persistence.sustainedMinutes} minuti.`,
  );
  if (persistence.isFlash) {
    persDetailParts.push(
      `Movimento flash completato in ${persistence.moveDurationMinutes} minuti: fiducia ridotta.`,
    );
  } else if (persistence.sustainedMinutes >= FULLY_SUSTAINED_MINUTES) {
    persDetailParts.push("Movimento sostenuto per ore: fiducia superiore.");
  }
  if (persistence.rebounded) {
    persDetailParts.push(
      `Ritracciamento del ${Math.round(persistence.retracementRatio * 100)}%: falso segnale parziale.`,
    );
  }
  components.push({
    key: "persistence",
    label: "Tenuta nel tempo",
    points: round(persPts, 2),
    maxPoints: CONFIDENCE_WEIGHTS.persistence,
    detail: persDetailParts.join(" "),
  });

  /* copertura */
  const covPts = CONFIDENCE_WEIGHTS.coverage * coverage.score;
  components.push({
    key: "coverage",
    label: "Copertura dei dati",
    points: round(covPts, 2),
    maxPoints: CONFIDENCE_WEIGHTS.coverage,
    detail: `${coverage.booksObserved} bookmaker osservati su ${coverage.booksExpected} attesi, ${coverage.historyDepthMinutes} minuti di storico.`,
  });

  const score = clamp(
    components.reduce((sum, c) => sum + c.points, 0),
    0,
    100,
  );

  return { score: round(score, 2), components };
}

/* ------------------------------------------------------------------ */
/* 7. Analisi completa                                                 */
/* ------------------------------------------------------------------ */

function emptyAnalysis(
  input: DropAnalysisInput,
  reason: string,
): DropAnalysis {
  const coverage = computeCoverage(input, false);
  const explanation: SignalExplanation = {
    engineVersion: ENGINE_VERSION,
    summary: reason,
    components: [],
    missingData: coverage.missing.length > 0 ? coverage.missing : [reason],
    caveats: [
      "Questa scheda descrive un movimento di mercato osservato. Non è una previsione dell'esito né un consiglio di scommessa.",
    ],
    computedAt: input.now.toISOString(),
  };
  return {
    matchId: input.matchId,
    market: input.market,
    selection: input.selection,
    magnitude: {
      openingPrice: 0,
      currentPrice: 0,
      openingProb: 0,
      currentProb: 0,
      deltaPp: 0,
      peakDeltaPp: 0,
      magnitudeClass: "noise",
      isSignificant: false,
    },
    coordination: {
      booksTotal: 0,
      booksConfirming: 0,
      booksOpposing: 0,
      booksFlat: 0,
      coordinationScore: 0,
      perBook: [],
    },
    sharp: {
      available: false,
      confirms: null,
      deltaPp: null,
      bookKeys: [],
      leadsMarket: null,
    },
    persistence: {
      firstMoveAt: input.now,
      lastMoveAt: input.now,
      sustainedMinutes: 0,
      moveDurationMinutes: 0,
      isFlash: false,
      rebounded: false,
      retracementRatio: 0,
      persistenceScore: 0,
    },
    coverage,
    confidenceScore: 0,
    confidenceBand: "insufficient_data",
    explanation,
    qualifiesAsSignal: false,
    rejectionReason: reason,
  };
}

/** Genera la frase di sintesi, fattuale e senza raccomandazioni. */
export function buildSummary(
  magnitude: MagnitudeResult,
  coordination: CoordinationResult,
  sharp: SharpResult,
  persistence: PersistenceResult,
): string {
  const dirWord = magnitude.deltaPp > 0 ? "calo" : "rialzo";
  const parts: string[] = [];

  parts.push(
    `Quota in ${dirWord} da ${magnitude.openingPrice} a ${magnitude.currentPrice}, pari a ${magnitude.deltaPp > 0 ? "+" : ""}${magnitude.deltaPp} punti percentuali di probabilità implicita (${MAGNITUDE_LABELS_IT[magnitude.magnitudeClass].toLowerCase()}).`,
  );

  if (coordination.booksTotal >= MIN_BOOKS_FOR_COORDINATION) {
    parts.push(
      coordination.booksConfirming >= Math.ceil(coordination.booksTotal / 2)
        ? `Il movimento è confermato da ${coordination.booksConfirming} bookmaker su ${coordination.booksTotal}.`
        : `Il movimento è confermato solo da ${coordination.booksConfirming} bookmaker su ${coordination.booksTotal}: coordinazione debole.`,
    );
  } else {
    parts.push("Il movimento è osservato su un solo bookmaker.");
  }

  if (!sharp.available) {
    parts.push("Nessuna linea sharp disponibile per la verifica indipendente.");
  } else if (sharp.confirms) {
    parts.push("La linea sharp conferma la direzione.");
  } else {
    parts.push("La linea sharp non conferma la direzione.");
  }

  if (persistence.rebounded) {
    parts.push(
      "Il prezzo è poi rientrato verso i livelli iniziali: il segnale è considerato falso in parte.",
    );
  } else if (persistence.isFlash) {
    parts.push(
      "Il movimento si è esaurito in meno di 30 minuti: la tenuta non è ancora verificabile.",
    );
  } else if (persistence.sustainedMinutes >= FULLY_SUSTAINED_MINUTES) {
    parts.push(
      `Il nuovo livello è mantenuto da ${Math.round(persistence.sustainedMinutes / 60)} ore.`,
    );
  }

  return parts.join(" ");
}

/**
 * Analisi completa di una coppia (partita, mercato, selezione).
 * Restituisce sempre un oggetto: se i dati sono insufficienti lo dichiara
 * tramite `qualifiesAsSignal = false` e `rejectionReason`.
 */
export function analyzeDrop(input: DropAnalysisInput): DropAnalysis {
  const usable = input.series.filter((s) => sortPoints(s.points).length > 0);
  if (usable.length === 0) {
    return emptyAnalysis(input, "Nessuna quotazione disponibile per questa selezione.");
  }

  const magnitude = computeMagnitude(usable);
  if (!magnitude) {
    return emptyAnalysis(
      input,
      "Storico insufficiente: serve almeno una seconda rilevazione per misurare un movimento.",
    );
  }

  const persistence = computePersistence(usable, input.now);
  if (!persistence) {
    return emptyAnalysis(
      input,
      "Storico insufficiente per ricostruire la dinamica temporale del movimento.",
    );
  }

  const coordination = computeCoordination(usable, magnitude.deltaPp);
  const sharp = computeSharp(usable, magnitude.deltaPp);
  const coverage = computeCoverage(input, sharp.available);
  const { score, components } = computeConfidence(
    magnitude,
    coordination,
    sharp,
    persistence,
    coverage,
  );

  const caveats: string[] = [
    "Il punteggio misura la solidità dell'osservazione statistica, non la probabilità che l'esito si verifichi.",
    "La misura di riferimento dell'osservatorio è il CLV: il confronto fra la quota rilevata e la quota di chiusura.",
  ];
  if (persistence.isFlash) {
    caveats.push("Movimento flash: rivalutare dopo ulteriori rilevazioni.");
  }
  if (persistence.rebounded) {
    caveats.push("Movimento rientrato: trattare come falso segnale parziale.");
  }
  if (!sharp.available) {
    caveats.push("Assenza di linea sharp: la conferma indipendente manca.");
  }

  const explanation: SignalExplanation = {
    engineVersion: ENGINE_VERSION,
    summary: buildSummary(magnitude, coordination, sharp, persistence),
    components,
    missingData: coverage.missing,
    caveats,
    computedAt: input.now.toISOString(),
  };

  // un movimento sotto la soglia di rumore non è un segnale
  const qualifies = magnitude.isSignificant && magnitude.deltaPp > 0;
  const rejectionReason = !magnitude.isSignificant
    ? `Movimento di ${magnitude.deltaPp} pp sotto la soglia di rumore di ${MAGNITUDE_THRESHOLDS.noise} pp.`
    : magnitude.deltaPp <= 0
      ? "Movimento in rialzo di quota: non è un drop."
      : null;

  return {
    matchId: input.matchId,
    market: input.market,
    selection: input.selection,
    magnitude,
    coordination,
    sharp,
    persistence,
    coverage,
    confidenceScore: score,
    confidenceBand: toConfidenceBand(score, coverage.score),
    explanation,
    qualifiesAsSignal: qualifies,
    rejectionReason,
  };
}
