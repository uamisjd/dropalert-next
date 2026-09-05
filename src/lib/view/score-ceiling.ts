/**
 * Tetto strutturale dell'indice di fiducia.
 *
 * Il problema che questo modulo rende visibile è misurato, non ipotizzato. Con
 * la fonte attuale — una sola linea di consenso, nessun bookmaker marcato
 * sharp — il punteggio grezzo non può superare un valore preciso, e quel
 * valore sta DENTRO la seconda fascia della tabella CLV:
 *
 *   magnitude    30/30   (il drop è misurabile)
 *   coordination  0/25   (un solo book: `booksTotal < MIN_BOOKS_FOR_COORDINATION`)
 *   sharp         0/20   (nessun libro sharp osservato)
 *   persistence  15/15   (movimento sostenuto)
 *   coverage    5,13/10  (0,45·¼ + 0,30·1 + 0 + 0,10 = 0,5125)
 *   ─────────────────
 *   totale      50,13/100        → banda `low`
 *   con il moltiplicatore 0,75 → 37,60
 *
 * Verificato chiamando `analyzeDrop` con il miglior caso possibile (drop
 * +11,3 pp sostenuto otto ore). Conseguenza: le fasce «50–74» e «75–100» della
 * tabella CLV non sono poco popolate per sfortuna di campione — sono
 * **strutturalmente vuote**. `docs/BACKTEST-R2.md` lo aveva osservato (n=1 e
 * n=0) senza poterne dire il motivo; il motivo è questo.
 *
 * Regola applicata: il tetto si calcola dalle costanti del motore, non si
 * scrive a mano, e una fascia sopra il tetto viene marcata come irraggiungibile
 * invece di essere letta come «nessun segnale abbastanza buono».
 *
 * Modulo puro: nessun database, nessuna rete.
 */
import {
  CONFIDENCE_WEIGHTS,
  COVERAGE_WEIGHTS,
  MIN_BOOKS_FOR_COORDINATION,
  MIN_BOOKS_FOR_FULL_PICTURE,
  SUSPICION_MULTIPLIER,
} from "@/lib/drop/constants";

export interface ScoreCeilingInput {
  /** bookmaker con almeno una rilevazione, come li vede il motore */
  booksObserved: number;
  /** bookmaker attesi per il mercato (denominatore della copertura) */
  booksExpected: number;
  /** almeno un libro sharp osservato */
  sharpAvailable: boolean;
  /** esiste una seconda rilevazione, quindi una linea di apertura */
  hasOpeningLine: boolean;
}

export interface ScoreCeiling {
  /** punteggio grezzo massimo ottenibile in queste condizioni */
  maxRaw: number;
  /** lo stesso punteggio con il moltiplicatore di iper-reazione applicato */
  maxWithSuspicion: number;
  /** punti persi perché il dato non esiste, non perché è sfavorevole */
  unreachablePoints: number;
  /** copertura massima ottenibile, 0–1 */
  maxCoverageScore: number;
  /** la configurazione è quella a fonte singola: coordination e sharp a zero */
  singleSource: boolean;
}

/**
 * Calcola il tetto. Non ottimizza nulla: applica le stesse regole del motore
 * al caso migliore (ampiezza piena, tenuta piena) e lascia a zero ciò che i
 * dati non possono produrre.
 */
export function scoreCeiling(input: ScoreCeilingInput): ScoreCeiling {
  const booksExpected = Math.max(input.booksExpected, input.booksObserved, 1);
  const bookRatio = Math.min(1, Math.max(0, input.booksObserved / booksExpected));
  const singleSource = input.booksObserved < MIN_BOOKS_FOR_COORDINATION;

  /* coordination: il motore dà 0 sotto MIN_BOOKS_FOR_COORDINATION, altrimenti
     il caso migliore è tutti i book concordi → rapporto 1 */
  const coordinationMax = singleSource ? 0 : CONFIDENCE_WEIGHTS.coordination;

  /* sharp: senza un libro sharp marcato il componente non è misurabile */
  const sharpMax = input.sharpAvailable ? CONFIDENCE_WEIGHTS.sharp : 0;

  const coverageScore = Math.min(
    1,
    Math.max(
      0,
      bookRatio * COVERAGE_WEIGHTS.bookRatio +
        /* profondità massima: oltre FULLY_SUSTAINED_MINUTES il rapporto è 1 */
        COVERAGE_WEIGHTS.depthRatio +
        (input.sharpAvailable ? COVERAGE_WEIGHTS.sharp : 0) +
        (input.hasOpeningLine ? COVERAGE_WEIGHTS.openingLine : 0),
    ),
  );

  const maxRaw = round2(
    CONFIDENCE_WEIGHTS.magnitude +
      coordinationMax +
      sharpMax +
      CONFIDENCE_WEIGHTS.persistence +
      CONFIDENCE_WEIGHTS.coverage * coverageScore,
  );

  const unreachable =
    CONFIDENCE_WEIGHTS.coordination -
    coordinationMax +
    (CONFIDENCE_WEIGHTS.sharp - sharpMax);

  return {
    maxRaw,
    maxWithSuspicion: round2(maxRaw * SUSPICION_MULTIPLIER),
    unreachablePoints: round2(unreachable),
    maxCoverageScore: round2(coverageScore),
    singleSource,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Fasce                                                              */
/* ------------------------------------------------------------------ */

export interface BandReachability {
  key: string;
  label: string;
  /** la fascia interseca l'intervallo raggiungibile con questo tetto */
  reachable: boolean;
  /** interamente sopra il tetto: nessuna osservazione può caderci */
  empty: boolean;
}

/**
 * Marca le fasce di indice raggiungibili e quelle strutturalmente vuote.
 *
 * `min`/`max` seguono la convenzione di `SCORE_BUCKETS`: intervallo chiuso a
 * sinistra, aperto a destra.
 */
export function bandReachability(
  bands: ReadonlyArray<{ key: string; label: string; min: number; max: number }>,
  ceiling: number,
): BandReachability[] {
  return bands.map((b) => ({
    key: b.key,
    label: b.label,
    reachable: b.min < ceiling,
    empty: b.min >= ceiling,
  }));
}

/**
 * Frase pubblicata accanto alla tabella.
 *
 * Non è un commento sui dati: è la dichiarazione di che cosa la tabella può e
 * non può mostrare finché la fonte espone una sola linea.
 */
export function describeCeiling(ceiling: ScoreCeiling): string {
  if (!ceiling.singleSource) {
    return (
      `Con ${ceiling.unreachablePoints === 0 ? "tutte le componenti misurabili" : `${ceiling.unreachablePoints} punti non misurabili`} ` +
      `l'indice grezzo può arrivare a ${ceiling.maxRaw} su 100.`
    );
  }
  return (
    `La fonte espone una sola linea di consenso e nessun libro sharp: ` +
    `${ceiling.unreachablePoints} punti su 100 non sono misurabili e l'indice grezzo ` +
    `si ferma a ${ceiling.maxRaw} — ${ceiling.maxWithSuspicion} con il moltiplicatore di iper-reazione. ` +
    `Le fasce sopra quel valore non sono vuote perché mancano segnali buoni: sono irraggiungibili per costruzione.`
  );
}

/** Soglie usate dal motore per la copertura completa, esposte per la UI. */
export const FULL_PICTURE_BOOKS = MIN_BOOKS_FOR_FULL_PICTURE;
