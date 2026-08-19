/**
 * Costanti e soglie del motore drop.
 * Ogni numero qui dentro è una convenzione dichiarata, non un parametro
 * ottimizzato su risultati passati. Se cambia, cambia ENGINE_VERSION.
 */

export const ENGINE_VERSION = "drop-engine/1.0.0";

/**
 * Soglie di ampiezza espresse in PUNTI PERCENTUALI di probabilità implicita.
 * probabilità implicita = 1 / quota decimale.
 */
export const MAGNITUDE_THRESHOLDS = {
  /** sotto questa soglia il movimento è indistinguibile dal rumore */
  noise: 2,
  /** 2–5 pp */
  moderate: 5,
  /** 5–10 pp */
  high: 10,
  /** oltre 10 pp → very_high */
} as const;

/** Un movimento concluso in meno di questo tempo è "flash". */
export const FLASH_WINDOW_MINUTES = 30;

/** Oltre questa durata il movimento è considerato pienamente sostenuto. */
export const FULLY_SUSTAINED_MINUTES = 240;

/**
 * Ritracciamento oltre il quale il movimento è considerato rimbalzato,
 * cioè falso segnale parziale.
 */
export const REBOUND_RATIO_THRESHOLD = 0.5;

/** Un movimento su un solo bookmaker non è mai coordinato. */
export const MIN_BOOKS_FOR_COORDINATION = 2;

/** Sotto questo numero di book il quadro è troppo parziale per una banda alta. */
export const MIN_BOOKS_FOR_FULL_PICTURE = 4;

/** Uno snapshot più vecchio di così è marcato stale. */
export const STALE_SNAPSHOT_MINUTES = 90;

/**
 * Pesi delle componenti del punteggio di fiducia. Somma = 100.
 * Il punteggio misura QUANTO È SOLIDA L'OSSERVAZIONE, non la probabilità
 * che l'esito si verifichi.
 */
export const CONFIDENCE_WEIGHTS = {
  magnitude: 30,
  coordination: 25,
  sharp: 20,
  persistence: 15,
  coverage: 10,
} as const;

/** Soglie di banda sul punteggio 0–100. */
export const CONFIDENCE_BANDS = {
  low: 35,
  medium: 60,
  high: 78,
} as const;

/** Copertura dati minima sotto la quale non esponiamo una banda. */
export const MIN_COVERAGE_FOR_BAND = 0.35;

/** Etichette leggibili (IT) per l'interfaccia. */
export const MAGNITUDE_LABELS_IT: Record<string, string> = {
  noise: "Rumore",
  moderate: "Moderato",
  high: "Alto",
  very_high: "Molto alto",
};

export const CONFIDENCE_LABELS_IT: Record<string, string> = {
  insufficient_data: "Dati insufficienti",
  low: "Bassa",
  medium: "Media",
  high: "Alta",
};

export const MARKET_LABELS_IT: Record<string, string> = {
  "1x2": "1X2",
  ou_2_5: "Over/Under 2.5",
  btts: "Entrambe segnano",
};

export const SELECTION_LABELS_IT: Record<string, string> = {
  home: "1 (Casa)",
  draw: "X (Pareggio)",
  away: "2 (Trasferta)",
  over: "Over 2.5",
  under: "Under 2.5",
  yes: "Sì",
  no: "No",
};
