/**
 * DropAlert — schema PostgreSQL (Drizzle ORM)
 *
 * Osservatorio statistico sui movimenti di quota nel calcio.
 * Nessuna tabella contiene consigli di scommessa: solo dati osservati,
 * metriche derivate e tracciamento della qualità del dato.
 */
import {
  pgEnum,
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  numeric,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

/** Mercati coperti dall'osservatorio. */
export const marketTypeEnum = pgEnum("market_type", [
  "1x2",
  "ou_2_5",
  "btts",
]);

/** Selezioni ammesse (validate a livello applicativo per mercato). */
export const selectionCodeEnum = pgEnum("selection_code", [
  "home",
  "draw",
  "away",
  "over",
  "under",
  "yes",
  "no",
]);

/** Classe di ampiezza del movimento, in punti percentuali di probabilità implicita. */
export const magnitudeClassEnum = pgEnum("magnitude_class", [
  "noise", // < 2 pp
  "moderate", // 2–5 pp
  "high", // 5–10 pp
  "very_high", // > 10 pp
]);

/** Banda di fiducia sintetica del segnale. */
export const confidenceBandEnum = pgEnum("confidence_band", [
  "insufficient_data",
  "low",
  "medium",
  "high",
]);

/** Stato di vita di un segnale osservato. */
export const signalStatusEnum = pgEnum("signal_status", [
  "forming", // movimento in corso, non ancora consolidato
  "active", // movimento consolidato, partita non iniziata
  "rebounded", // la quota è tornata indietro: falso segnale parziale
  "closed", // partita iniziata, linea di chiusura acquisita
  "expired", // dati insufficienti per mantenerlo vivo
]);

/** Stato partita. */
export const matchStatusEnum = pgEnum("match_status", [
  "scheduled",
  "live",
  "finished",
  "postponed",
  "cancelled",
]);

/** Esito di una esecuzione di collector. */
export const runStatusEnum = pgEnum("run_status", [
  "running",
  "success",
  "partial",
  "failed",
]);

/** Motivo di un buco nei dati. */
export const gapReasonEnum = pgEnum("gap_reason", [
  "provider_unavailable",
  "market_not_offered",
  "bookmaker_missing",
  "stale_snapshot",
  "parse_error",
  "rate_limited",
  /**
   * La pagina risultati della competizione è stata letta e la partita non
   * c'è: la fonte non ha ancora pubblicato l'esito. È un'assenza dichiarata
   * dalla fonte, non un fallimento del collector — e il giro successivo
   * ritenterà finché il risultato non compare.
   */
  "result_not_published",
]);

/**
 * Stato di salute di una fonte dati.
 * Guida l'etichetta pubblica: dati completi / parziali / fonte bloccata.
 */
export const sourceStatusEnum = pgEnum("source_status", [
  "ok",
  "degraded", // risponde ma con dati parziali o lenta
  "blocked", // non risponde, rate-limited o bloccata
  "disabled", // spenta per configurazione
  "unknown", // mai interrogata
]);

/* ------------------------------------------------------------------ */
/* Anagrafiche                                                         */
/* ------------------------------------------------------------------ */

export const leagues = pgTable(
  "leagues",
  {
    id: serial("id").primaryKey(),
    /** chiave stabile interna, es. "it-serie-a" */
    key: text("key").notNull(),
    name: text("name").notNull(),
    country: text("country"),
    tier: integer("tier"),
    /** riferimento presso il provider esterno, se disponibile */
    externalRef: text("external_ref"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("leagues_key_uq").on(t.key)],
);

export const teams = pgTable(
  "teams",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name"),
    country: text("country"),
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("teams_key_uq").on(t.key)],
);

export const bookmakers = pgTable(
  "bookmakers",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /**
     * Libro considerato "sharp" (bassa marginalità, limiti alti, linea di
     * riferimento del mercato). Usato per la conferma indipendente.
     */
    isSharp: boolean("is_sharp").notNull().default(false),
    /** peso nel calcolo della coordinazione (0–1). */
    weight: numeric("weight", { precision: 4, scale: 3 })
      .notNull()
      .default("1.000"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("bookmakers_key_uq").on(t.key)],
);

export const matches = pgTable(
  "matches",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    homeTeamId: integer("home_team_id")
      .notNull()
      .references(() => teams.id),
    awayTeamId: integer("away_team_id")
      .notNull()
      .references(() => teams.id),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
    status: matchStatusEnum("status").notNull().default("scheduled"),
    externalRef: text("external_ref"),
    /** risultato, popolato dal collector risultati */
    homeGoals: integer("home_goals"),
    awayGoals: integer("away_goals"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("matches_key_uq").on(t.key),
    index("matches_kickoff_idx").on(t.kickoffAt),
    index("matches_league_idx").on(t.leagueId),
    index("matches_status_idx").on(t.status),
  ],
);

/* ------------------------------------------------------------------ */
/* Serie storica quote                                                 */
/* ------------------------------------------------------------------ */

/**
 * Snapshot puntuale di una quota. Append-only: è la fonte di verità
 * da cui ogni metrica viene ricalcolata. Nessun valore derivato viene
 * salvato qui se non la probabilità implicita (1/quota).
 */
export const oddsSnapshots = pgTable(
  "odds_snapshots",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    bookmakerId: integer("bookmaker_id")
      .notNull()
      .references(() => bookmakers.id, { onDelete: "cascade" }),
    market: marketTypeEnum("market").notNull(),
    selection: selectionCodeEnum("selection").notNull(),
    /** quota decimale osservata */
    price: numeric("price", { precision: 8, scale: 3 }).notNull(),
    /** 1/quota, in frazione 0–1 */
    impliedProb: numeric("implied_prob", { precision: 7, scale: 6 }).notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
    /** chiave del collector che ha prodotto il dato */
    source: text("source").notNull(),
    /** true se il provider ha restituito un timestamp più vecchio della soglia */
    isStale: boolean("is_stale").notNull().default(false),
    runId: integer("run_id"),
  },
  (t) => [
    index("odds_match_market_idx").on(t.matchId, t.market, t.selection),
    index("odds_collected_idx").on(t.collectedAt),
    uniqueIndex("odds_dedupe_uq").on(
      t.matchId,
      t.bookmakerId,
      t.market,
      t.selection,
      t.collectedAt,
    ),
  ],
);

/**
 * Linea di chiusura: ultimo prezzo valido prima del calcio d'inizio.
 * È il riferimento per il CLV, l'unica metrica di qualità del segnale.
 */
export const closingLines = pgTable(
  "closing_lines",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    bookmakerId: integer("bookmaker_id")
      .notNull()
      .references(() => bookmakers.id, { onDelete: "cascade" }),
    market: marketTypeEnum("market").notNull(),
    selection: selectionCodeEnum("selection").notNull(),
    closingPrice: numeric("closing_price", { precision: 8, scale: 3 }).notNull(),
    closingProb: numeric("closing_prob", { precision: 7, scale: 6 }).notNull(),
    /**
     * Quota di chiusura senza margine (no-vig), calcolata sull'insieme
     * completo delle selezioni dello stesso bookmaker.
     * NULL = mercato incompleto al momento della chiusura: non calcolabile.
     * Non contiene mai una stima: o c'è la terna completa, o resta NULL.
     */
    fairClosingPrice: numeric("fair_closing_price", { precision: 8, scale: 3 }),
    fairClosingProb: numeric("fair_closing_prob", { precision: 7, scale: 6 }),
    /** margine osservato sul mercato (0.0614 = 106.14%), NULL se non calcolabile */
    marketMargin: numeric("market_margin", { precision: 6, scale: 4 }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    /** minuti di distanza dal kickoff al momento della cattura */
    minutesBeforeKickoff: integer("minutes_before_kickoff"),
  },
  (t) => [
    uniqueIndex("closing_lines_uq").on(
      t.matchId,
      t.bookmakerId,
      t.market,
      t.selection,
    ),
    index("closing_lines_match_idx").on(t.matchId),
  ],
);

/* ------------------------------------------------------------------ */
/* Segnali osservati                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un segnale è la descrizione strutturata di un movimento osservato su una
 * coppia (partita, mercato, selezione). Non è una previsione né un consiglio.
 */
export const dropSignals = pgTable(
  "drop_signals",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    market: marketTypeEnum("market").notNull(),
    selection: selectionCodeEnum("selection").notNull(),

    /* --- ampiezza (consenso di mercato, mediana fra i book) --- */
    openingPrice: numeric("opening_price", { precision: 8, scale: 3 }).notNull(),
    currentPrice: numeric("current_price", { precision: 8, scale: 3 }).notNull(),
    openingProb: numeric("opening_prob", { precision: 7, scale: 6 }).notNull(),
    currentProb: numeric("current_prob", { precision: 7, scale: 6 }).notNull(),
    /** variazione in punti percentuali: (currentProb - openingProb) * 100 */
    deltaPp: numeric("delta_pp", { precision: 6, scale: 2 }).notNull(),
    magnitudeClass: magnitudeClassEnum("magnitude_class").notNull(),

    /* --- conferma fra bookmaker --- */
    booksTotal: integer("books_total").notNull(),
    booksConfirming: integer("books_confirming").notNull(),
    /** 0–1, quota pesata di book che si muovono nella stessa direzione */
    coordinationScore: numeric("coordination_score", {
      precision: 4,
      scale: 3,
    }).notNull(),

    /* --- conferma sharp --- */
    sharpAvailable: boolean("sharp_available").notNull().default(false),
    sharpConfirms: boolean("sharp_confirms"),
    sharpDeltaPp: numeric("sharp_delta_pp", { precision: 6, scale: 2 }),

    /* --- persistenza temporale --- */
    firstMoveAt: timestamp("first_move_at", { withTimezone: true }).notNull(),
    lastMoveAt: timestamp("last_move_at", { withTimezone: true }).notNull(),
    /** minuti per cui il movimento si è mantenuto */
    sustainedMinutes: integer("sustained_minutes").notNull().default(0),
    /** movimento completato in meno di 30 minuti */
    isFlash: boolean("is_flash").notNull().default(false),
    /** la quota è rientrata verso il livello di apertura */
    rebounded: boolean("rebounded").notNull().default(false),
    /** quota di ritracciamento 0–1 rispetto al movimento massimo */
    retracementRatio: numeric("retracement_ratio", { precision: 4, scale: 3 }),

    /* --- prezzo congelato al primo rilevamento --- */
    /**
     * Quota di consenso nell'istante in cui il segnale è stato rilevato la
     * prima volta. NON viene mai riscritta dai ricalcoli successivi: è il
     * riferimento onesto per il CLV. Senza di essa il CLV confronterebbe la
     * chiusura con un prezzo che continua a muoversi.
     */
    detectedPrice: numeric("detected_price", { precision: 8, scale: 3 }),
    detectedProb: numeric("detected_prob", { precision: 7, scale: 6 }),

    /* --- sintesi --- */
    confidenceScore: numeric("confidence_score", {
      precision: 5,
      scale: 2,
    }).notNull(),
    confidenceBand: confidenceBandEnum("confidence_band").notNull(),
    /** copertura dati 0–1: quanto del quadro informativo è disponibile */
    dataCoverage: numeric("data_coverage", { precision: 4, scale: 3 })
      .notNull()
      .default("0.000"),
    /** scomposizione leggibile del punteggio + elenco dati mancanti */
    explanation: jsonb("explanation").notNull(),
    /**
     * Feature di "forma" del movimento (voce 2 del backlog di ricerca),
     * calcolate dalla serie di rilevazioni e riscritte SOLO quando arrivano
     * nuove rilevazioni. NULL = non ancora calcolate. Struttura dichiarata
     * in `src/lib/shape/features.ts`; il punteggio non le usa: sono dato
     * riusabile per la ricerca, non un giudizio.
     */
    shape: jsonb("shape"),

    status: signalStatusEnum("status").notNull().default("forming"),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** versione dell'algoritmo che ha prodotto il record */
    engineVersion: text("engine_version").notNull(),
  },
  (t) => [
    uniqueIndex("drop_signals_uq").on(t.matchId, t.market, t.selection),
    index("drop_signals_status_idx").on(t.status),
    index("drop_signals_detected_idx").on(t.detectedAt),
    index("drop_signals_confidence_idx").on(t.confidenceScore),
  ],
);

/** Audit trail: ogni ricalcolo che cambia stato o classe lascia traccia. */
export const signalEvents = pgTable(
  "signal_events",
  {
    id: serial("id").primaryKey(),
    signalId: integer("signal_id")
      .notNull()
      .references(() => dropSignals.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(), // detected | strengthened | weakened | rebounded | closed
    deltaPp: numeric("delta_pp", { precision: 6, scale: 2 }),
    confidenceScore: numeric("confidence_score", { precision: 5, scale: 2 }),
    note: text("note"),
    payload: jsonb("payload"),
  },
  (t) => [index("signal_events_signal_idx").on(t.signalId, t.at)],
);

/**
 * CLV: confronto fra la quota al momento del rilevamento e la quota di
 * chiusura. È la sola misura di validità del monitor.
 */
export const clvRecords = pgTable(
  "clv_records",
  {
    id: serial("id").primaryKey(),
    signalId: integer("signal_id")
      .notNull()
      .references(() => dropSignals.id, { onDelete: "cascade" }),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    /** quota al momento del rilevamento del segnale */
    signalPrice: numeric("signal_price", { precision: 8, scale: 3 }).notNull(),
    closingPrice: numeric("closing_price", { precision: 8, scale: 3 }).notNull(),
    /** (probChiusura - probSegnale) * 100, positivo = segnale ha battuto la chiusura */
    clvPp: numeric("clv_pp", { precision: 6, scale: 2 }).notNull(),
    /** variazione percentuale della quota: signal/closing - 1 */
    clvPct: numeric("clv_pct", { precision: 7, scale: 3 }).notNull(),
    beatClose: boolean("beat_close").notNull(),
    /**
     * Base di confronto effettivamente usata:
     *   fair_novig     → chiusura depurata dal margine (preferita)
     *   raw_consensus  → chiusura grezza, unico dato disponibile
     * Il campo esiste perché le due basi non sono confrontabili fra loro e
     * un aggregato che le mescolasse senza dirlo sarebbe fuorviante.
     */
    closingBasis: text("closing_basis").notNull().default("raw_consensus"),
    /** margine rimosso, quando la base è fair_novig */
    marketMargin: numeric("market_margin", { precision: 6, scale: 4 }),
    /** punteggio di fiducia del segnale al rilevamento, per il riepilogo per fascia */
    signalScore: numeric("signal_score", { precision: 5, scale: 2 }),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("clv_signal_uq").on(t.signalId),
    index("clv_match_idx").on(t.matchId),
  ],
);

/* ------------------------------------------------------------------ */
/* Osservabilità e qualità del dato                                    */
/* ------------------------------------------------------------------ */

export const collectorRuns = pgTable(
  "collector_runs",
  {
    id: serial("id").primaryKey(),
    collectorKey: text("collector_key").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: runStatusEnum("status").notNull().default("running"),
    matchesSeen: integer("matches_seen").notNull().default(0),
    snapshotsWritten: integer("snapshots_written").notNull().default(0),
    signalsTouched: integer("signals_touched").notNull().default(0),
    durationMs: integer("duration_ms"),
    errors: jsonb("errors"),
    meta: jsonb("meta"),
  },
  (t) => [index("collector_runs_key_idx").on(t.collectorKey, t.startedAt)],
);

/** Registro esplicito di ciò che manca: il sito dichiara i buchi, non li nasconde. */
export const dataGaps = pgTable(
  "data_gaps",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id").references(() => matches.id, {
      onDelete: "cascade",
    }),
    bookmakerId: integer("bookmaker_id").references(() => bookmakers.id, {
      onDelete: "cascade",
    }),
    market: marketTypeEnum("market"),
    reason: gapReasonEnum("reason").notNull(),
    detail: text("detail"),
    observedFrom: timestamp("observed_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    observedTo: timestamp("observed_to", { withTimezone: true }),
    resolved: boolean("resolved").notNull().default(false),
  },
  (t) => [
    index("data_gaps_match_idx").on(t.matchId),
    index("data_gaps_resolved_idx").on(t.resolved),
  ],
);

/**
 * Salute delle fonti dati (una riga per fonte).
 * Alimentata da ogni collector: latenza, errori, fallback, ultimo successo.
 * È ciò che permette al sito di dichiarare "DATI PARZIALI" o "FONTE BLOCCATA"
 * invece di mostrare un quadro incompleto come se fosse completo.
 */
export const sourceHealth = pgTable(
  "source_health",
  {
    id: serial("id").primaryKey(),
    /** chiave della fonte, es. "betexplorer", "livescore" */
    sourceKey: text("source_key").notNull(),
    label: text("label").notNull(),
    status: sourceStatusEnum("status").notNull().default("unknown"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastErrorMessage: text("last_error_message"),
    /** latenza media mobile in millisecondi */
    avgLatencyMs: integer("avg_latency_ms"),
    lastLatencyMs: integer("last_latency_ms"),
    /** contatori cumulati */
    successCount: integer("success_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    partialCount: integer("partial_count").notNull().default(0),
    /** errori consecutivi: guida l'apertura del circuito */
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),
    /**
     * Ultimo rate-limit (429 o limite locale) subito dalla fonte.
     * Tenuto separato da `lastErrorAt` perché non è un guasto nostro né
     * della fonte: è la fonte che ci chiede di rallentare. Senza una data
     * propria l'episodio spariva appena il giro successivo andava a buon
     * fine, e il pannello non poteva distinguerlo da una perdita di dati.
     */
    lastRateLimitAt: timestamp("last_rate_limit_at", { withTimezone: true }),
    lastRateLimitMessage: text("last_rate_limit_message"),
    rateLimitCount: integer("rate_limit_count").notNull().default(0),
    /** true se la fonte sta servendo da fallback di un'altra */
    isFallback: boolean("is_fallback").notNull().default(false),
    /**
     * Cooldown adattivo sui 429 (Sprint backoff): dopo un giro con
     * episodi di rate-limit, il giro successivo di rete aspetta un
     * ritardo crescente. `cooldown_until` è l'istante di sblocco,
     * `cooldown_level` la scala raggiunta (si azzera solo con un giro
     * completo senza 429).
     */
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    cooldownLevel: integer("cooldown_level").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("source_health_key_uq").on(t.sourceKey)],
);

/**
 * Contesto 360° di una partita, generato via LLM e congelato in cache
 * (Sprint contesto). NON entra nel punteggio: è lettura dichiarata
 * "conoscenza modello, da verificare", valuta solo la facciata narrativa
 * del movimento osservato. `status = 'unavailable'` dichiara il fallimento
 * senza inventare nulla; la cache scade e si riprova.
 */
export const matchContext = pgTable(
  "match_context",
  {
    matchId: integer("match_id")
      .primaryKey()
      .references(() => matches.id, { onDelete: "cascade" }),
    /** `ok` = campi presenti; `unavailable` = tentativo fallito, nessun campo */
    status: text("status").notNull(),
    /** modello usato, per tracciabilità della "conoscenza modello" */
    model: text("model"),
    livelloCategorie: text("livello_categorie"),
    anomaliaCampo: text("anomalia_campo"),
    postaInPalo: text("posta_in_palo"),
    rotazioniFatica: text("rotazioni_fatica"),
    /** "sostiene" | "contraddice" | "non c'entra" */
    accordoColDrop: text("accordo_col_drop"),
    /**
     * Struttura v2 con ricerca attiva (grounding): campi con fonte per
     * ciascuno e fonti consultate. NULL = riga dell'era v1, mostrata con
     * il tag "conoscenza modello".
     */
    detail: jsonb("detail"),
    /** fonti del grounding, massimo tre */
    sources: jsonb("sources"),
    /** true se la generazione ha usato la ricerca */
    grounded: boolean("grounded").notNull().default(false),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** scadenza della cache: 24h se ok, 1h se unavailable */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("match_context_expires_idx").on(t.expiresAt)],
);

/**
 * Notizie pubbliche per partita (Sprint notizie). Fonte dichiarata in
 * `src/lib/news/source.ts`: NON Google News RSS — il suo robots.txt vieta
 * /rss/ a ogni user-agent generico — bensì GDELT DOC API, feed RSS
 * pubblico nato per l'uso programmatico.
 *
 * `news_items` e la cache per partita (6h, dedupe per link);
 * `news_fetch` e lo STATO dell'ultima lettura: quante notizie, in che
 * lingua cercata, e perche mancano quando mancano.
 */
export const newsItems = pgTable(
  "news_items",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** testata, quando il feed la dichiara */
    source: text("source"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    link: text("link").notNull(),
    /** lingua della QUERY usata ("it" | "en"), non dell'articolo */
    language: text("language").notNull(),
    /** query effettuata, per tracciabilita */
    query: text("query").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("news_items_match_link_uq").on(t.matchId, t.link),
    index("news_items_match_idx").on(t.matchId),
  ],
);

/**
 * Stato dell'ultima lettura notizie di una partita.
 * `ok` = N notizie; `vuoto` = fonte raggiunta, nessuna notizia (stato
 * VALIDO, non un errore); `irraggiungibile` = fonte non raggiungibile;
 * `rinviato` = cortesia verso la fonte: lettura rimandata, cache vecchia.
 */
export const newsFetch = pgTable("news_fetch", {
  matchId: integer("match_id")
    .primaryKey()
    .references(() => matches.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  itemsCount: integer("items_count").notNull().default(0),
  language: text("language"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** scadenza della cache: 6 ore */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Chiave/valore per stato dei job (cursori, ultimo run, ecc.). */
export const systemState = pgTable(
  "system_state",
  {
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.key] })],
);

/* ------------------------------------------------------------------ */
/* Tipi inferiti                                                       */
/* ------------------------------------------------------------------ */

export type League = typeof leagues.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Bookmaker = typeof bookmakers.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type OddsSnapshot = typeof oddsSnapshots.$inferSelect;
export type ClosingLine = typeof closingLines.$inferSelect;
export type DropSignal = typeof dropSignals.$inferSelect;
export type SignalEvent = typeof signalEvents.$inferSelect;
export type ClvRecord = typeof clvRecords.$inferSelect;
export type CollectorRun = typeof collectorRuns.$inferSelect;
export type DataGap = typeof dataGaps.$inferSelect;
export type SourceHealth = typeof sourceHealth.$inferSelect;
export type MatchContext = typeof matchContext.$inferSelect;
export type NewsItem = typeof newsItems.$inferSelect;
export type NewsFetch = typeof newsFetch.$inferSelect;
export type NewDropSignal = typeof dropSignals.$inferInsert;
export type NewOddsSnapshot = typeof oddsSnapshots.$inferInsert;
export type NewDataGap = typeof dataGaps.$inferInsert;

export type MarketType = (typeof marketTypeEnum.enumValues)[number];
export type SelectionCode = (typeof selectionCodeEnum.enumValues)[number];
export type MagnitudeClass = (typeof magnitudeClassEnum.enumValues)[number];
export type ConfidenceBand = (typeof confidenceBandEnum.enumValues)[number];
export type SignalStatus = (typeof signalStatusEnum.enumValues)[number];
export type MatchStatus = (typeof matchStatusEnum.enumValues)[number];
export type SourceStatus = (typeof sourceStatusEnum.enumValues)[number];
export type GapReason = (typeof gapReasonEnum.enumValues)[number];
export type RunStatus = (typeof runStatusEnum.enumValues)[number];
