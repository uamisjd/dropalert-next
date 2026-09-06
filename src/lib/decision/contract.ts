/**
 * Contratto decisionale di DropAlert.
 *
 * Questo modulo è intenzionalmente puro: non legge il database, non chiama
 * fonti e non calcola stake. Riceve ciò che è stato osservato e restituisce
 * uno stato con motivi espliciti. In questo modo un nuovo provider non può
 * trasformare un dato mancante in una «giocata» solo perché la UI lo desidera.
 *
 * Catena obbligatoria:
 * dato grezzo → qualità/freshness → movimento → mercato completo → fair
 * indipendente → prezzo eseguibile → contesto → validazione → stato.
 */

export const DECISION_STATES = [
  "NON_AZIONABILE",
  "OSSERVAZIONE",
  "CANDIDATA",
  "VALORE_VERIFICATO",
] as const;

export type DecisionState = (typeof DECISION_STATES)[number];

export type PriceSource = "consensus" | "bookmaker" | "exchange" | "unknown";
export type FairSource = "independent_sharp" | "validated_model" | "same_line" | "none";

export type DecisionReasonCode =
  | "INVALID_KICKOFF"
  | "KICKOFF_PASSED"
  | "DATA_ERROR"
  | "STALE_DATA"
  | "MISSING_CURRENT_PRICE"
  | "PRICE_NOT_EXECUTABLE"
  | "INCOMPLETE_MARKET"
  | "MISSING_INDEPENDENT_FAIR"
  | "NO_POSITIVE_EDGE"
  | "SHARP_NOT_CONFIRMED"
  | "MOVEMENT_NOT_MEASURABLE"
  | "MOVEMENT_NOT_COHERENT"
  | "MOVEMENT_REBOUNDED"
  | "INSUFFICIENT_VALIDATION"
  | "VALIDATION_NOT_OUT_OF_SAMPLE"
  | "CLV_NOT_POSITIVE"
  | "CALIBRATION_NOT_PASSED";

export interface DecisionReason {
  code: DecisionReasonCode;
  message: string;
}

export interface DecisionValidation {
  /** Numero di osservazioni/partite realmente disponibili per la regola. */
  sampleSize: number;
  /** Soglia minima dichiarata dal protocollo, non implicita nel motore. */
  minimumSampleSize: number;
  /** La regola ha superato una verifica fuori campione separata. */
  outOfSamplePassed: boolean;
  /** CLV positivo misurato sulla stessa coorte e con base dichiarata. */
  clvPositive: boolean;
  /** Calibrazione della probabilità, se il protocollo la misura. */
  calibrationPassed: boolean;
}

export interface MovementEvidence {
  observed: boolean;
  /** calo quota dall'apertura, negativo quando la quota è scesa */
  dropPct: number | null;
  durationMinutes: number | null;
  isFlash: boolean | null;
  rebounded: boolean | null;
  directionCoherent: boolean | null;
  hoursToKickoff: number | null;
}

export interface ContextEvidence {
  status: "available" | "empty" | "unavailable" | "error";
  newsCount: number | null;
}

export interface DecisionInput {
  now: Date;
  kickoffAt: Date | null;
  dataError?: string | null;
  /** Età del dato che alimenta il prezzo, in minuti. */
  priceAgeMinutes: number | null;
  /** Soglia massima ammessa dal contratto della fonte. */
  maxPriceAgeMinutes: number;
  currentPrice: number | null;
  priceSource: PriceSource;
  /** true solo se il mercato ha tutte le selezioni necessarie allo specifico metodo. */
  marketComplete: boolean;
  fairProbability: number | null;
  fairSource: FairSource;
  edgePct: number | null;
  /** Soglia conservativa decisa prima della lettura, non adattata alla riga. */
  minimumEdgePct: number;
  /** Evidenza del movimento: segno, forma, durata e timing restano separati dalla fair. */
  movement: MovementEvidence;
  context: ContextEvidence;
  sharpAvailable: boolean;
  sharpConfirmed: boolean | null;
  validation: DecisionValidation;
}

export interface DecisionAssessment {
  state: DecisionState;
  label: string;
  reasons: DecisionReason[];
  warnings: string[];
  /** true soltanto per VALORE_VERIFICATO; non significa garanzia. */
  mayEnterValidationQueue: boolean;
}

const LABELS: Record<DecisionState, string> = {
  NON_AZIONABILE: "NON AZIONABILE",
  OSSERVAZIONE: "OSSERVAZIONE",
  CANDIDATA: "CANDIDATA",
  VALORE_VERIFICATO: "VALORE VERIFICATO",
};

const reason = (code: DecisionReasonCode, message: string): DecisionReason => ({
  code,
  message,
});

function hasValidPrice(price: number | null): price is number {
  return price !== null && Number.isFinite(price) && price > 1;
}

function hasIndependentFair(input: DecisionInput): boolean {
  return (
    input.fairSource === "independent_sharp" || input.fairSource === "validated_model"
  ) &&
    input.fairProbability !== null &&
    Number.isFinite(input.fairProbability) &&
    input.fairProbability > 0 &&
    input.fairProbability < 1;
}

function validationReasons(input: DecisionInput): DecisionReason[] {
  const v = input.validation;
  const reasons: DecisionReason[] = [];
  if (v.sampleSize < v.minimumSampleSize) {
    reasons.push(
      reason(
        "INSUFFICIENT_VALIDATION",
        `Validazione insufficiente: ${v.sampleSize} osservazioni su almeno ${v.minimumSampleSize}.`,
      ),
    );
  }
  if (!v.outOfSamplePassed) {
    reasons.push(
      reason(
        "VALIDATION_NOT_OUT_OF_SAMPLE",
        "La regola non ha ancora superato una validazione fuori campione.",
      ),
    );
  }
  if (!v.clvPositive) {
    reasons.push(
      reason("CLV_NOT_POSITIVE", "Il CLV della coorte non è positivo o non è ancora dimostrato."),
    );
  }
  if (!v.calibrationPassed) {
    reasons.push(
      reason(
        "CALIBRATION_NOT_PASSED",
        "La calibrazione della probabilità non è ancora superata.",
      ),
    );
  }
  return reasons;
}

/**
 * Applica i gate in ordine. Le prime condizioni sono hard gate: se una è vera
 * la riga non può diventare CANDIDATA, indipendentemente dal divario mostrato.
 */
export function assessDecision(input: DecisionInput): DecisionAssessment {
  const hard: DecisionReason[] = [];
  const warnings: string[] = [];
  const kickoff = input.kickoffAt?.getTime() ?? Number.NaN;

  if (input.context.status !== "available") {
    warnings.push(
      input.context.status === "empty"
        ? "Nessuna notizia pubblica trovata: assenza di informazione, non conferma dell'ipotesi."
        : "Contesto/news non disponibile: l'incertezza resta esplicita.",
    );
  }

  if (!Number.isFinite(kickoff)) {
    hard.push(reason("INVALID_KICKOFF", "Kickoff assente o non interpretabile."));
  } else if (kickoff <= input.now.getTime()) {
    hard.push(reason("KICKOFF_PASSED", "Il kickoff è passato: il dato non è più pre-gara."));
  }

  if (input.dataError) {
    hard.push(reason("DATA_ERROR", input.dataError));
  }

  if (
    input.priceAgeMinutes === null ||
    !Number.isFinite(input.priceAgeMinutes) ||
    input.priceAgeMinutes > input.maxPriceAgeMinutes
  ) {
    hard.push(
      reason(
        "STALE_DATA",
        input.priceAgeMinutes === null
          ? "Età del prezzo non disponibile: freshness non dimostrata."
          : `Prezzo vecchio di ${input.priceAgeMinutes} minuti, oltre la soglia di ${input.maxPriceAgeMinutes}.`,
      ),
    );
  }

  if (!hasValidPrice(input.currentPrice)) {
    hard.push(reason("MISSING_CURRENT_PRICE", "Nessun prezzo corrente valido."));
  }

  if (input.priceSource !== "bookmaker" && input.priceSource !== "exchange") {
    hard.push(
      reason(
        "PRICE_NOT_EXECUTABLE",
        input.priceSource === "consensus"
          ? "La fonte espone consenso, non una quota acquistabile presso un singolo operatore."
          : "La fonte del prezzo eseguibile non è identificata.",
      ),
    );
  }

  if (!input.marketComplete) {
    hard.push(
      reason("INCOMPLETE_MARKET", "Mercato incompleto: la fair richiesta non è calcolabile."),
    );
  }

  if (hard.length > 0) {
    return {
      state: "NON_AZIONABILE",
      label: LABELS.NON_AZIONABILE,
      reasons: hard,
      warnings,
      mayEnterValidationQueue: false,
    };
  }

  if (!hasIndependentFair(input)) {
    return {
      state: "OSSERVAZIONE",
      label: LABELS.OSSERVAZIONE,
      reasons: [
        reason(
          "MISSING_INDEPENDENT_FAIR",
          "Manca una probabilità fair indipendente e validata: il movimento resta un'osservazione.",
        ),
      ],
      warnings,
      mayEnterValidationQueue: false,
    };
  }

  if (input.edgePct === null || !Number.isFinite(input.edgePct) || input.edgePct < input.minimumEdgePct) {
    return {
      state: "OSSERVAZIONE",
      label: LABELS.OSSERVAZIONE,
      reasons: [
        reason(
          "NO_POSITIVE_EDGE",
          `Edge ${input.edgePct === null ? "non misurato" : `${input.edgePct.toFixed(2)}%`} sotto la soglia di ${input.minimumEdgePct.toFixed(2)}%.`,
        ),
      ],
      warnings,
      mayEnterValidationQueue: false,
    };
  }

  if (!input.movement.observed) {
    return {
      state: "OSSERVAZIONE",
      label: LABELS.OSSERVAZIONE,
      reasons: [
        reason("MOVEMENT_NOT_MEASURABLE", "Il movimento non ha una forma osservabile sufficiente."),
      ],
      warnings,
      mayEnterValidationQueue: false,
    };
  }

  if (input.movement.directionCoherent !== true) {
    return {
      state: "OSSERVAZIONE",
      label: LABELS.OSSERVAZIONE,
      reasons: [
        reason("MOVEMENT_NOT_COHERENT", "La direzione del movimento non è coerente o non è misurabile."),
      ],
      warnings,
      mayEnterValidationQueue: false,
    };
  }

  if (input.movement.rebounded === true) {
    return {
      state: "OSSERVAZIONE",
      label: LABELS.OSSERVAZIONE,
      reasons: [
        reason("MOVEMENT_REBOUNDED", "Il movimento ha rimbalzato: non è un segnale coerente d'ingresso."),
      ],
      warnings,
      mayEnterValidationQueue: false,
    };
  }

  if (!input.sharpAvailable || input.sharpConfirmed !== true) {
    return {
      state: "OSSERVAZIONE",
      label: LABELS.OSSERVAZIONE,
      reasons: [
        reason(
          "SHARP_NOT_CONFIRMED",
          "La linea indipendente sharp non è disponibile o non conferma il movimento.",
        ),
      ],
      warnings,
      mayEnterValidationQueue: false,
    };
  }

  const validation = validationReasons(input);
  if (validation.length > 0) {
    warnings.push(...validation.map((r) => r.message));
    return {
      state: "CANDIDATA",
      label: LABELS.CANDIDATA,
      reasons: [],
      warnings,
      mayEnterValidationQueue: true,
    };
  }

  return {
    state: "VALORE_VERIFICATO",
    label: LABELS.VALORE_VERIFICATO,
    reasons: [],
    warnings,
    mayEnterValidationQueue: true,
  };
}

/** Motivo breve per un badge o una lista compatta. */
export function primaryDecisionReason(assessment: DecisionAssessment): string {
  return assessment.reasons[0]?.message ?? assessment.warnings[0] ?? "Requisiti soddisfatti.";
}
