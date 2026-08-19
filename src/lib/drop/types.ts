import type {
  ConfidenceBand,
  MagnitudeClass,
  MarketType,
  SelectionCode,
} from "@/db/schema";

/** Un punto della serie storica per un singolo bookmaker. */
export interface PricePoint {
  price: number;
  at: Date;
  isStale?: boolean;
}

/** Serie completa di un bookmaker su una selezione. */
export interface BookmakerSeries {
  bookmakerId: number;
  bookmakerKey: string;
  bookmakerName: string;
  isSharp: boolean;
  weight: number;
  points: PricePoint[];
}

/** Input del motore per una coppia (partita, mercato, selezione). */
export interface DropAnalysisInput {
  matchId: number;
  market: MarketType;
  selection: SelectionCode;
  kickoffAt: Date;
  now: Date;
  series: BookmakerSeries[];
  /** numero di bookmaker attesi per questo mercato (per la copertura dati) */
  expectedBookmakers?: number;
}

/** Ampiezza del movimento sul consenso di mercato. */
export interface MagnitudeResult {
  openingPrice: number;
  currentPrice: number;
  openingProb: number;
  currentProb: number;
  deltaPp: number;
  /** massimo drop raggiunto durante la finestra, in pp */
  peakDeltaPp: number;
  magnitudeClass: MagnitudeClass;
  /** true se il movimento è al di sopra della soglia di rumore */
  isSignificant: boolean;
}

/** Conferma incrociata fra bookmaker. */
export interface CoordinationResult {
  booksTotal: number;
  booksConfirming: number;
  booksOpposing: number;
  booksFlat: number;
  /** 0–1 pesato */
  coordinationScore: number;
  /** dettaglio per bookmaker, ordinato per delta decrescente */
  perBook: Array<{
    bookmakerId: number;
    bookmakerKey: string;
    bookmakerName: string;
    isSharp: boolean;
    openingPrice: number | null;
    currentPrice: number | null;
    deltaPp: number | null;
    direction: "confirm" | "oppose" | "flat" | "unknown";
  }>;
}

/** Verifica sulla linea sharp. */
export interface SharpResult {
  available: boolean;
  confirms: boolean | null;
  deltaPp: number | null;
  /** i book sharp che hanno contribuito */
  bookKeys: string[];
  /** true se lo sharp si muove PIÙ del consenso: segnale guidato dallo sharp */
  leadsMarket: boolean | null;
}

/** Struttura temporale del movimento. */
export interface PersistenceResult {
  firstMoveAt: Date;
  lastMoveAt: Date;
  /** minuti trascorsi dal primo movimento significativo a ora */
  sustainedMinutes: number;
  /** minuti impiegati dal primo movimento al picco */
  moveDurationMinutes: number;
  isFlash: boolean;
  rebounded: boolean;
  /** 0–1: quanto del movimento massimo è stato restituito */
  retracementRatio: number;
  /** 0–1 usato nel punteggio */
  persistenceScore: number;
}

/** Copertura del quadro informativo. */
export interface CoverageResult {
  /** 0–1 */
  score: number;
  booksObserved: number;
  booksExpected: number;
  hasSharp: boolean;
  hasOpeningLine: boolean;
  historyDepthMinutes: number;
  staleSeries: number;
  /** elenco leggibile di ciò che manca */
  missing: string[];
}

/** Una riga della scomposizione del punteggio. */
export interface ScoreComponent {
  key: "magnitude" | "coordination" | "sharp" | "persistence" | "coverage";
  label: string;
  /** punti ottenuti */
  points: number;
  /** punti massimi ottenibili */
  maxPoints: number;
  /** frase esplicativa in italiano, fattuale */
  detail: string;
}

/** Spiegazione completa persistita in jsonb. */
export interface SignalExplanation {
  engineVersion: string;
  summary: string;
  components: ScoreComponent[];
  missingData: string[];
  caveats: string[];
  computedAt: string;
}

/** Output completo del motore. */
export interface DropAnalysis {
  matchId: number;
  market: MarketType;
  selection: SelectionCode;
  magnitude: MagnitudeResult;
  coordination: CoordinationResult;
  sharp: SharpResult;
  persistence: PersistenceResult;
  coverage: CoverageResult;
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  explanation: SignalExplanation;
  /** true se merita di essere persistito come segnale osservato */
  qualifiesAsSignal: boolean;
  /** motivo dell'eventuale scarto */
  rejectionReason: string | null;
}
