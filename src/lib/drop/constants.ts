/**
 * Costanti e soglie del motore drop.
 * Ogni numero qui dentro è una convenzione dichiarata, non un parametro
 * ottimizzato su risultati passati. Se cambia, cambia ENGINE_VERSION.
 */

export const ENGINE_VERSION = "drop-engine/1.0.0";

/* ------------------------------------------------------------------ */
/* suspicion-v2 — moltiplicatore di fiducia sulle iper-reazioni storiche */
/* ------------------------------------------------------------------ */

/**
 * Versione dell'algoritmo di fiducia attiva sui segnali rilevati da qui
 * in avanti. I segnali già in archivio restano alla loro versione: la
 * coesistenza v1/v2 serve al confronto CLV previsto da R2.
 *
 * Base dichiarata: docs/BACKTEST-R1.5.md — due classi confermate
 * out-of-sample (2023/24–2025/26): drop sull'esito casa (−4,9 pp sotto
 * l'attesa fair) e drop sull'esito sfavorito con quota di partenza > 3,0
 * (−4,0 pp). Nessun peso per lega: il test 2 non ha retto l'entità.
 */
export const ACTIVE_ALGORITHM = "suspicion-v2";

/**
 * Moltiplicatore applicato al punteggio di fiducia delle due classi di
 * iper-reazione. È un VALORE INIZIALE DA VALIDARE IN R2, non una costanza
 * ottimizzata: 0,75 dichiara «stesso segnale, un quarto di fiducia in
 * meno» senza cancellare nulla dalla lista.
 */
export const SUSPICION_MULTIPLIER = 0.75;

/** Quota di partenza dell'esito sceso oltre la quale scatta la classe sfavorito. */
export const SUSPICION_ODDS_THRESHOLD = 3.0;

/** Calo percentuale della quota oltre il quale il drop si dichiara «ampio» (T4). */
export const WIDE_DROP_THRESHOLD = 0.15;

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

/**
 * Peso interno delle quattro componenti della copertura dati. Somma = 1.
 *
 * Sono esportate perché il tetto raggiungibile dell'indice dipende da queste
 * frazioni tanto quanto dai pesi delle componenti: con una sola linea di
 * consenso e nessuna linea sharp, `bookRatio` vale 1/4 e il termine sharp
 * vale zero, e la copertura si ferma a 0,5125 invece di 1. Chi calcola quel
 * tetto deve leggere gli stessi numeri che usa il motore, non una copia.
 */
export const COVERAGE_WEIGHTS = {
  bookRatio: 0.45,
  depthRatio: 0.3,
  sharp: 0.15,
  openingLine: 0.1,
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
