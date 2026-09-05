/**
 * Scheduler del ciclo di osservazione.
 *
 * Questo modulo espone una funzione che compie UN giro e termina: non sa
 * nulla del tempo che passa. La ripetizione è del runner schedulato in
 * `collect-loop.ts`, che vive dentro l'applicazione e chiama `runCycle` a
 * intervallo fisso. Restano valide anche le porte d'ingresso manuali (CLI
 * e `POST /api/jobs/analyze`), descritte in docs/SCHEDULING.md.
 *
 * Il giro completo è: raccolta → analisi → chiusura/CLV.
 * L'ordine non è negoziabile: senza nuove osservazioni l'analisi ripete sé
 * stessa, e senza analisi la chiusura non ha segnali da misurare.
 *
 * L'intervallo minimo fra due giri è configurabile via ambiente e viene
 * fatto rispettare qui, non da chi chiama: il timer può scattare in
 * ritardo, la stessa funzione può essere invocata a mano nel frattempo, e
 * la fonte va comunque trattata con rispetto. Il gate è l'ultima parola.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { systemState } from "@/db/schema";
import {
  collectBetexplorer,
  type CollectOptions,
  type CollectReport,
} from "@/lib/providers/betexplorer/collect";
import type { CycleMode } from "./cycle-mode";
import { dispatchNotifications, pushConfigured } from "@/lib/repo/push";
import { readLiveValues } from "@/lib/push/live";
import type { RunTrigger } from "@/lib/cov/instrument";
import { detectAll } from "./detect";
import { runClosingJob, pendingClosings } from "./closing";
import { finishRun, startRun } from "./runs";

/* ------------------------------------------------------------------ */
/* Configurazione                                                      */
/* ------------------------------------------------------------------ */

/**
 * Intervallo predefinito fra due raccolte, in minuti.
 *
 * 45 minuti è il valore concordato per il runner schedulato. È abbastanza
 * rado da restare un carico modesto su una fonte pubblica gratuita (circa
 * 32 giri al giorno) e abbastanza fitto da costruire una serie leggibile
 * in meno di un giorno: i 10 giri che servono alla tendenza maturano in
 * circa 7 ore e mezza.
 *
 * Il prezzo è dichiarato: a 45 minuti un movimento flash (< 30 minuti) può
 * cadere per intero fra due giri e non essere mai osservato. La cadenza
 * misura la copertura, non pretende di vedere ogni scatto.
 */
export const DEFAULT_INTERVAL_MINUTES = 45;

/** Limiti di sicurezza: sotto i 5 minuti non si scende. */
export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 24 * 60;

/**
 * Ultimo ciclo completo. È la chiave storica letta dal gate pre-install di
 * Actions: il fallback non deve aggiornarla, altrimenti potrebbe impedire per
 * sempre l'esecuzione di analisi, chiusure e notifiche.
 */
export const LAST_CYCLE_KEY = "scheduler:last_cycle";

/**
 * Ultima raccolta conclusa, indipendentemente dal runner che l'ha eseguita.
 * Il gate della fonte usa questa chiave insieme al claim; Actions e fallback
 * possono così avere due cadenze distinte senza duplicare richieste esterne.
 */
export const LAST_COLLECTION_KEY = "scheduler:last_collection";

/**
 * Chiave di stato che marca il TENTATIVO di giro, scritto prima di toccare
 * la fonte e non dopo la chiusura.
 *
 * Perché esiste: `scheduler:last_collection` viene scritto solo a raccolta
 * chiusa. Un giro interrotto a metà — è il caso storico del chiamante esterno,
 * che su Vercel dispone di 300 secondi mentre un giro completo ne misura ~430
 * — non lo scrive mai. Il gate quindi resterebbe a guardare un registro che
 * non avanza e lascerebbe passare ogni battuta
 * successiva: misurato il 05/09/2026, la seconda gamba ha raccolto alle
 * 12:15, 12:30 e 12:45 (ora italiana) invece che ogni 45 minuti, cioè ~11
 * richieste in più alla fonte ogni quarto d'ora. Il tentativo, non
 * l'esito, è ciò che deve far aspettare il giro dopo: una fonte già limitata
 * non va di nuovo pressata solo perché il giro precedente non è riuscito a dirlo.
 */
export const CYCLE_CLAIM_KEY = "scheduler:cycle_claim";

export interface SchedulerConfig {
  intervalMinutes: number;
  horizonHours: number;
  maxFixtures: number;
  withResults: boolean;
  /** valore grezzo letto dall'ambiente, per la diagnostica */
  source: "env" | "default";
}

/** Legge un intero positivo dall'ambiente, con fallback dichiarato. */
function envInt(name: string, fallback: number): { value: number; fromEnv: boolean } {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return { value: fallback, fromEnv: false };
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: fallback, fromEnv: false };
  }
  return { value: parsed, fromEnv: true };
}

/**
 * Configurazione effettiva del ciclo.
 * Variabili lette: COLLECT_INTERVAL_MINUTES, COLLECT_HORIZON_HOURS,
 * COLLECT_MAX_FIXTURES, COLLECT_WITH_RESULTS.
 */
export function readSchedulerConfig(): SchedulerConfig {
  const interval = envInt("COLLECT_INTERVAL_MINUTES", DEFAULT_INTERVAL_MINUTES);
  const clamped = Math.min(
    MAX_INTERVAL_MINUTES,
    Math.max(MIN_INTERVAL_MINUTES, interval.value),
  );
  const horizon = envInt("COLLECT_HORIZON_HOURS", 72);
  const maxFixtures = envInt("COLLECT_MAX_FIXTURES", 25);
  const withResults = (process.env.COLLECT_WITH_RESULTS ?? "true") !== "false";

  return {
    intervalMinutes: clamped,
    horizonHours: horizon.value,
    maxFixtures: maxFixtures.value,
    withResults,
    source: interval.fromEnv ? "env" : "default",
  };
}

/* ------------------------------------------------------------------ */
/* Stato persistente                                                   */
/* ------------------------------------------------------------------ */

export interface LastCycleState {
  at: string;
  status: "success" | "partial" | "failed";
  /** assente nelle righe storiche; distingue chi ha prodotto lo stato */
  mode?: CycleMode;
  /** assente = vecchio stato, quando ogni ciclo comprendeva la raccolta */
  collectionExecuted?: boolean;
  snapshotsWritten: number;
  signalsTouched: number;
  closingLinesCaptured: number;
  clvComputed: number;
}

/** Ultimo ciclo full registrato, null se il sistema non ha mai girato. */
export async function readLastCycle(): Promise<LastCycleState | null> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, LAST_CYCLE_KEY))
    .limit(1);
  if (!row) return null;
  return row.value as LastCycleState;
}

/** Registra l'esito dell'ultimo ciclo full (upsert). */
export async function writeLastCycle(state: LastCycleState): Promise<void> {
  await db
    .insert(systemState)
    .values({ key: LAST_CYCLE_KEY, value: state, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value: state, updatedAt: new Date() },
    });
}

/**
 * Ultima raccolta conclusa. Prima dell'introduzione della chiave dedicata,
 * `last_cycle` rappresentava anche questo fatto: il fallback mantiene la
 * compatibilità soltanto per gli stati legacy o con raccolta eseguita.
 */
export async function readLastCollection(): Promise<LastCycleState | null> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, LAST_COLLECTION_KEY))
    .limit(1);
  if (row) return row.value as LastCycleState;

  const legacy = await readLastCycle();
  return legacy?.collectionExecuted === false ? null : legacy;
}

/** Registra una raccolta realmente terminata, qualunque sia il runner. */
export async function writeLastCollection(state: LastCycleState): Promise<void> {
  const value = { ...state, collectionExecuted: true };
  await db
    .insert(systemState)
    .values({ key: LAST_COLLECTION_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Marca l'inizio del giro, prima di qualsiasi richiesta alla fonte.
 *
 * È il gemello «sincero» di `writeLastCollection`: quello registra un fatto
 * compiuto, questo registra un'intenzione. Serve perché la chiusura può non
 * arrivare mai (funzione interrotta dal budget del piano) e il gate non può
 * permettersi di comportarsi come se il giro non fosse mai partito.
 */
export async function writeCycleClaim(at: Date): Promise<void> {
  const value = { at: at.toISOString() };
  await db
    .insert(systemState)
    .values({ key: CYCLE_CLAIM_KEY, value, updatedAt: at })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value, updatedAt: at },
    });
}

/** L'istante dell'ultimo tentativo di giro, `null` se non ce n'è registro. */
export async function readCycleClaim(): Promise<Date | null> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, CYCLE_CLAIM_KEY))
    .limit(1);
  if (!row) return null;
  const raw = (row.value as { at?: unknown }).at;
  if (typeof raw !== "string") return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * L'istante che il gate deve rispettare: il più recente fra l'ultima raccolta
 * chiusa e l'ultimo tentativo verso la fonte.
 *
 * Pura, perché la regola «un tentativo conta quanto una chiusura per far
 * aspettare il giro dopo» è il punto intero del fix e va verificata senza
 * database. Un giro che si è chiuso regolarmente scrive lo stesso istante su
 * entrambe le chiavi (`at` è l'inizio del giro), quindi questa scelta non
 * allunga mai l'attesa oltre l'intervallo dichiarato.
 */
export function latestRunMoment(
  closedAt: Date | null,
  claimedAt: Date | null,
): Date | null {
  if (closedAt === null) return claimedAt;
  if (claimedAt === null) return closedAt;
  return claimedAt.getTime() > closedAt.getTime() ? claimedAt : closedAt;
}

/**
 * Legge i due registri e restituisce il momento da rispettare.
 *
 * Un registro illeggibile non ferma il giro: meglio una raccolta in più che
 * un'osservazione persa per un errore di lettura, la stessa regola del gate
 * `serve raccogliere?` nel workflow.
 */
export async function readGateMoment(): Promise<Date | null> {
  const [closed, claim] = await Promise.all([
    readLastCollection()
      .then((l) => (l === null ? null : new Date(l.at)))
      .catch(() => null),
    readCycleClaim().catch(() => null),
  ]);
  const usable = closed !== null && !Number.isNaN(closed.getTime()) ? closed : null;
  return latestRunMoment(usable, claim);
}

/**
 * Decide se il giro può partire.
 * Pura, così è verificabile senza database.
 */
export function shouldRunNow(
  lastAt: Date | null,
  now: Date,
  intervalMinutes: number,
  force: boolean,
): { run: boolean; waitedMinutes: number | null; reason: string } {
  if (force) {
    return {
      run: true,
      waitedMinutes: lastAt ? (now.getTime() - lastAt.getTime()) / 60000 : null,
      reason: "esecuzione forzata: intervallo minimo ignorato su richiesta esplicita.",
    };
  }
  if (!lastAt) {
    return { run: true, waitedMinutes: null, reason: "primo giro registrato." };
  }
  const waited = (now.getTime() - lastAt.getTime()) / 60000;
  if (waited < intervalMinutes) {
    return {
      run: false,
      waitedMinutes: waited,
      reason: `ultimo giro ${waited.toFixed(1)} minuti fa, intervallo minimo ${intervalMinutes} minuti: raccolta saltata per non martellare la fonte.`,
    };
  }
  return {
    run: true,
    waitedMinutes: waited,
    reason: `ultimo giro ${waited.toFixed(1)} minuti fa: intervallo rispettato.`,
  };
}

/* ------------------------------------------------------------------ */
/* Stato del runner schedulato                                         */
/* ------------------------------------------------------------------ */

/** Chiave di stato che descrive il runner schedulato, se acceso. */
export const LOOP_STATE_KEY = "scheduler:loop";

/**
 * Fotografia del runner schedulato.
 *
 * Vive in archivio e non in memoria perché a leggerla è la pagina web, che
 * gira nello stesso processo ma non deve dipendere da una variabile
 * globale: se il processo è appena ripartito, lo stato salvato dice
 * l'ultima cosa vera invece di fingere che il timer non sia mai esistito.
 */
export interface LoopState {
  /** true finché il runner è attivo in questo processo */
  running: boolean;
  intervalMinutes: number;
  /** quando il runner è stato acceso */
  startedAt: string;
  /** ultimo momento in cui il timer ha bussato, riuscito o saltato */
  lastTickAt: string | null;
  /** quando è previsto il prossimo giro */
  nextRunAt: string | null;
  /** giri completati da quando il runner è acceso */
  cyclesCompleted: number;
  /** esito dell'ultimo giro tentato dal runner */
  lastStatus: string | null;
}

/** Stato del runner schedulato, null se non è mai stato acceso. */
export async function readLoopState(): Promise<LoopState | null> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, LOOP_STATE_KEY))
    .limit(1);
  if (!row) return null;
  return row.value as LoopState;
}

/** Registra lo stato del runner schedulato (upsert). */
export async function writeLoopState(state: LoopState): Promise<void> {
  await db
    .insert(systemState)
    .values({ key: LOOP_STATE_KEY, value: state, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value: state, updatedAt: new Date() },
    });
}

/** Quanto manca al prossimo giro. Pura, così è verificabile senza orologio. */
export function minutesUntil(nextRunAt: Date | null, now: Date): number | null {
  if (nextRunAt === null) return null;
  const diff = (nextRunAt.getTime() - now.getTime()) / 60000;
  /* un giro in ritardo non diventa un tempo negativo: è "adesso" */
  return diff <= 0 ? 0 : Math.ceil(diff);
}

/**
 * Quante volte l'intervallo può passare a vuoto prima che lo stato smetta
 * di essere credibile.
 *
 * Due giri: uno mancato può essere un giro lungo o un gate che ha saltato
 * la raccolta, due di fila no. Oltre questa soglia non si dichiara più un
 * orario preciso, perché la riga potrebbe descrivere un processo morto.
 */
export const STALE_INTERVAL_MULTIPLIER = 2;

/**
 * Come sta il runner, secondo la riga di stato.
 *
 * - `running`   — il processo che ha scritto la riga è vivo e il conto alla
 *                 rovescia è affidabile.
 * - `off`       — il runner è dichiarato spento. Dallo Sprint 9 questo non
 *                 significa che la serie non avanza: chi la fa avanzare in
 *                 produzione è GitHub Actions, raccontata altrove
 *                 (`lib/cov/actions`) con l'ultimo giro schedulato letto
 *                 dall'archivio.
 * - `uncertain` — la riga dice "acceso" ma non dà segni di vita da troppo
 *                 tempo. Tipico di un processo terminato senza poter
 *                 chiudere il proprio stato.
 */
export type SchedulerHealth = "running" | "off" | "uncertain";

export interface SchedulerVerdict {
  health: SchedulerHealth;
  /** minuti al prossimo giro; `null` se non è onesto dichiararne uno */
  nextRunMinutes: number | null;
  /** da quanti minuti il runner non dà segni di vita, se calcolabile */
  silentMinutes: number | null;
}

/**
 * Giudica lo stato del runner senza fidarsi ciecamente della riga salvata.
 *
 * Il punto delicato: `running: true` è un'affermazione fatta da un processo
 * che potrebbe non esistere più. Un processo che muore — riavvio, reset del
 * sandbox, crash — non ha modo di correggere la propria riga, e chi legge
 * si ritrova un "prossimo giro fra 27 minuti" che non arriverà mai.
 *
 * L'ultimo segno di vita è il tick più recente; prima del primo tick vale
 * l'accensione. Se è più vecchio di due intervalli, lo stato diventa
 * `uncertain`: meglio dire "non so" che dare un orario inventato.
 *
 * Pura: prende la riga e un istante, così è verificabile senza database.
 */
export function schedulerHealth(
  state: LoopState,
  now: Date,
  intervalMinutesOverride?: number,
): SchedulerVerdict {
  if (!state.running) {
    return { health: "off", nextRunMinutes: null, silentMinutes: null };
  }

  const interval =
    intervalMinutesOverride ??
    (Number.isFinite(state.intervalMinutes) && state.intervalMinutes > 0
      ? state.intervalMinutes
      : DEFAULT_INTERVAL_MINUTES);

  /* ultimo segno di vita: il tick, o l'accensione se non ha ancora ticchettato */
  const lastSign = state.lastTickAt ?? state.startedAt;
  const lastSignAt = lastSign === null ? null : new Date(lastSign);
  const usable =
    lastSignAt !== null && !Number.isNaN(lastSignAt.getTime()) ? lastSignAt : null;

  if (usable === null) {
    /* dichiara di girare ma non dice da quando: non è verificabile */
    return { health: "uncertain", nextRunMinutes: null, silentMinutes: null };
  }

  const silent = (now.getTime() - usable.getTime()) / 60000;
  if (silent > interval * STALE_INTERVAL_MULTIPLIER) {
    return {
      health: "uncertain",
      nextRunMinutes: null,
      silentMinutes: Math.floor(silent),
    };
  }

  return {
    health: "running",
    nextRunMinutes: minutesUntil(
      state.nextRunAt === null ? null : new Date(state.nextRunAt),
      now,
    ),
    silentMinutes: silent < 0 ? 0 : Math.floor(silent),
  };
}

/* ------------------------------------------------------------------ */
/* Il giro                                                             */
/* ------------------------------------------------------------------ */

/**
 * Profilo della seconda gamba serverless.
 *
 * La funzione ha 300 s totali. Il dettaglio della fonte ne può usare al
 * massimo 120 e arricchire 15 righe: restano almeno 180 s per il rate limiter
 * delle quote, le scritture e la chiusura del run. Il retry da 60 s e i
 * risultati restano al giro completo di Actions: farli partire qui renderebbe
 * di nuovo possibile un timeout senza `finished_at`.
 */
export const SERVERLESS_DETAIL_BUDGET_MS = 120_000;
export const SERVERLESS_DETAIL_ROW_CAP = 15;

export interface CycleCollectionPolicy {
  withResults: boolean;
  retryNotReached: boolean;
  fixtureFetchLimits: CollectOptions["fixtureFetchLimits"];
}

/** Pura: rende verificabile che il fallback non possa ereditare il profilo lungo. */
export function collectionPolicyFor(
  mode: CycleMode,
  config: SchedulerConfig,
): CycleCollectionPolicy {
  if (mode === "full") {
    return {
      withResults: config.withResults,
      retryNotReached: true,
      fixtureFetchLimits: undefined,
    };
  }
  return {
    withResults: false,
    retryNotReached: false,
    fixtureFetchLimits: {
      maxRows: Math.min(config.maxFixtures, SERVERLESS_DETAIL_ROW_CAP),
      budgetMs: SERVERLESS_DETAIL_BUDGET_MS,
    },
  };
}

export interface CycleOptions {
  /** `full` per Actions; `collect_only` per la seconda gamba entro 300 s */
  mode?: CycleMode;
  /** salta la raccolta e analizza soltanto ciò che è già a registro */
  skipCollect?: boolean;
  /** ignora l'intervallo minimo (uso manuale e test di percorso) */
  force?: boolean;
  /** limita l'analisi a partite specifiche */
  matchIds?: number[];
  /** istante di riferimento, iniettabile */
  now?: Date;
  /**
   * Non inviare le notifiche dovute. Serve ai test di percorso, che devono
   * poter eseguire un giro senza toccare il servizio push.
   */
  skipNotifications?: boolean;
  /**
   * Chi ha chiesto il giro. Il runner schedulato passa `scheduled`; CLI,
   * API e pulsante restano `manual`, che è anche il default.
   */
  trigger?: RunTrigger;
  /** dipendenza iniettabile nei test di persistenza; in esercizio resta quella reale */
  collector?: (options: CollectOptions) => Promise<CollectReport>;
}

/** Esito della fase di notifica, dichiarata anche quando non parte nulla. */
export interface NotificationsReport {
  /** false quando le chiavi VAPID mancano o la fase è stata saltata */
  executed: boolean;
  /** false quando il server non può inviare: chiavi non configurate */
  configured: boolean;
  subscriptions: number;
  sent: number;
  skipped: number;
  removed: number;
}

export interface CycleReport {
  status: "success" | "partial" | "failed" | "skipped";
  mode: CycleMode;
  runId: number;
  startedAt: string;
  durationMs: number;
  config: SchedulerConfig;
  collectionPolicy: CycleCollectionPolicy;
  gate: { run: boolean; reason: string; waitedMinutes: number | null };
  collect: {
    executed: boolean;
    status: string | null;
    fixturesSeen: number;
    snapshotsWritten: number;
    resultsUpdated: number;
    problems: string[];
  };
  detection: {
    executed: boolean;
    matchesProcessed: number;
    marketsAnalyzed: number;
    created: number;
    updated: number;
    gapsRecorded: number;
  };
  closing: {
    executed: boolean;
    matchesProcessed: number;
    linesCaptured: number;
    fairLinesCaptured: number;
    clvComputed: number;
  };
  /** avvisi inviati a chi segue una partita che ha superato la soglia */
  notifications: NotificationsReport;
  /** partite monitorate che devono ancora superare il kickoff */
  pending: Array<{ key: string; kickoffAt: string }>;
  errors: string[];
}

/**
 * Invia gli avvisi dovuti a chi segue una partita.
 *
 * Nessuna eccezione esce da qui: una notifica mancata non deve costare il
 * giro di osservazione, che ha già raccolto e misurato. Se il registro non è
 * leggibile, il giro lo dichiara fra gli errori invece di fingere che nessuna
 * soglia fosse stata superata.
 */
async function runNotifications(
  now: Date,
  errors: string[],
): Promise<NotificationsReport> {
  const vuoto: NotificationsReport = {
    executed: false,
    configured: false,
    subscriptions: 0,
    sent: 0,
    skipped: 0,
    removed: 0,
  };

  if (!pushConfigured()) {
    /* chiavi VAPID assenti: non è un errore, è una configurazione. La UI
       delle notifiche lo dichiara già a schermo. */
    return vuoto;
  }

  const live = await readLiveValues(now).catch(() => null);
  if (live === null) {
    errors.push("notifiche: dato vivo non leggibile, nessun avviso inviato.");
    return { ...vuoto, configured: true };
  }

  const report = await dispatchNotifications(live, now).catch(() => null);
  if (report === null) {
    errors.push("notifiche: invio interrotto.");
    return { ...vuoto, configured: true };
  }

  return {
    executed: true,
    configured: report.configured,
    subscriptions: report.subscriptions,
    sent: report.sent,
    skipped: report.skipped,
    removed: report.removed,
  };
}

/**
 * Esegue un giro completo: raccolta, analisi, chiusura, notifiche.
 *
 * Ogni fase è isolata: se la raccolta fallisce, l'analisi e la chiusura
 * girano comunque sui dati già a registro, e il fallimento resta scritto
 * in `collector_runs` e in `source_health` invece di essere nascosto.
 */
export async function runCycle(options: CycleOptions = {}): Promise<CycleReport> {
  const now = options.now ?? new Date();
  const config = readSchedulerConfig();
  const mode = options.mode ?? "full";
  const collectionPolicy = collectionPolicyFor(mode, config);
  const collector = options.collector ?? collectBetexplorer;
  const handle = await startRun("scheduler-cycle");
  const errors: string[] = [];

  /* il gate guarda l'ultimo giro *chiuso o tentato*: una chiusura mancata
     non deve trasformarsi in un permesso di ripartire subito (vedi
     `CYCLE_CLAIM_KEY`) */
  const gate = shouldRunNow(
    await readGateMoment(),
    now,
    config.intervalMinutes,
    options.force ?? options.skipCollect ?? false,
  );

  const report: CycleReport = {
    status: "success",
    mode,
    runId: handle.id,
    startedAt: now.toISOString(),
    durationMs: 0,
    config,
    collectionPolicy,
    gate: {
      run: gate.run,
      reason: gate.reason,
      waitedMinutes: gate.waitedMinutes === null ? null : Number(gate.waitedMinutes.toFixed(1)),
    },
    collect: {
      executed: false,
      status: null,
      fixturesSeen: 0,
      snapshotsWritten: 0,
      resultsUpdated: 0,
      problems: [],
    },
    detection: {
      executed: false,
      matchesProcessed: 0,
      marketsAnalyzed: 0,
      created: 0,
      updated: 0,
      gapsRecorded: 0,
    },
    closing: {
      executed: false,
      matchesProcessed: 0,
      linesCaptured: 0,
      fairLinesCaptured: 0,
      clvComputed: 0,
    },
    notifications: {
      executed: false,
      configured: false,
      subscriptions: 0,
      sent: 0,
      skipped: 0,
      removed: 0,
    },
    pending: [],
    errors: [],
  };

  try {
    /* --- 1. raccolta ------------------------------------------------ */
    if (!options.skipCollect && gate.run) {
      /* il tentativo si mette a registro PRIMA di toccare la fonte: se
         questo giro viene interrotto a metà — è ciò che accade quando il
         budget del chiamante è più corto del giro — il gate del giro dopo lo
         sa comunque e non rimanda la stessa pressione addosso alla fonte.
         Un errore di scrittura non ferma la raccolta: al peggio si torna al
         comportamento precedente */
      await writeCycleClaim(now).catch(() => undefined);
      try {
        const collected = await collector({
          horizonHours: config.horizonHours,
          maxFixtures: config.maxFixtures,
          withResults: collectionPolicy.withResults,
          retryNotReached: collectionPolicy.retryNotReached,
          fixtureFetchLimits: collectionPolicy.fixtureFetchLimits,
          cycleMode: mode,
          /* il giro porta la firma di chi lo ha chiesto: solo i giri
             schedulati fanno profondità di serie */
          trigger: options.trigger ?? "manual",
        });
        report.collect = {
          executed: true,
          status: collected.status,
          fixturesSeen: collected.fixturesSeen,
          snapshotsWritten: collected.snapshotsWritten,
          resultsUpdated: collected.resultsUpdated,
          problems: collected.problems.slice(0, 20),
        };
        if (collected.status === "failed") {
          report.status = mode === "collect_only" ? "failed" : "partial";
          errors.push(
            mode === "collect_only"
              ? "raccolta fallita: il fallback non esegue fasi locali."
              : "raccolta fallita: analisi eseguita sui soli dati già a registro.",
          );
        }
      } catch (err) {
        report.status = mode === "collect_only" ? "failed" : "partial";
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`raccolta interrotta: ${message}`);
      }
    }

    /* Il fallback serverless ha finito qui il proprio lavoro. Chiuderlo
       esplicitamente è il punto della modalità: niente zeri spacciati per
       analisi eseguite e nessuna riga `running` lasciata dal timeout. */
    if (mode === "collect_only") {
      if (!report.collect.executed && errors.length === 0) {
        report.status = "skipped";
      } else if (report.collect.status === "partial") {
        report.status = "partial";
      }
      report.errors = errors;
      report.durationMs = Date.now() - now.getTime();

      await finishRun(handle, {
        status: report.status === "skipped" ? "success" : report.status,
        matchesSeen: report.collect.fixturesSeen,
        snapshotsWritten: report.collect.snapshotsWritten,
        signalsTouched: 0,
        errors,
        meta: {
          mode,
          trigger: options.trigger ?? "manual",
          intervalMinutes: config.intervalMinutes,
          intervalSource: config.source,
          collectExecuted: report.collect.executed,
          collectionPolicy,
          analysisExecuted: false,
          closingExecuted: false,
          notificationsExecuted: false,
          gate: gate.reason,
        },
      });

      if (report.collect.executed) {
        /* Non toccare `last_cycle`: il gate pre-install di Actions lo usa
           come heartbeat del ciclo completo. Se il fallback lo avanzasse a
           ogni raccolta, analisi/chiusure/notifiche potrebbero non partire
           mai. La pressione sulla fonte è regolata da questa chiave dedicata
           e dal claim. */
        await writeLastCollection({
          at: now.toISOString(),
          status: report.status === "skipped" ? "success" : report.status,
          mode,
          snapshotsWritten: report.collect.snapshotsWritten,
          signalsTouched: 0,
          closingLinesCaptured: 0,
          clvComputed: 0,
        });
      }
      return report;
    }

    /* --- 2. analisi -------------------------------------------------- */
    const detection = await detectAll(now, { matchIds: options.matchIds });
    report.detection = {
      executed: true,
      matchesProcessed: detection.matchesProcessed,
      marketsAnalyzed: detection.marketsAnalyzed,
      created: detection.created,
      updated: detection.updated,
      gapsRecorded: detection.gapsRecorded,
    };
    for (const e of detection.errors) errors.push(`analisi match ${e.matchId}: ${e.message}`);

    /* --- 3. chiusura e CLV ------------------------------------------- */
    const closing = await runClosingJob(now, { matchIds: options.matchIds });
    report.closing = {
      executed: true,
      matchesProcessed: closing.matchesProcessed,
      linesCaptured: closing.linesCaptured,
      fairLinesCaptured: closing.fairLinesCaptured,
      clvComputed: closing.clvComputed,
    };
    for (const e of closing.errors) errors.push(`chiusura match ${e.matchId}: ${e.message}`);

    /* --- 4. notifiche dovute ------------------------------------------ */
    /* Stanno DENTRO il ciclo e non in una rotta a parte: lo scheduler che
       fa girare l'osservatorio è lo stesso che avvisa chi segue una partita.
       Una rotta separata esisteva già, ma nessuno la chiamava: le
       iscrizioni si salvavano e nessun avviso partiva mai. Un guasto qui non
       tocca i dati raccolti — resta dichiarato e il giro prosegue. */
    if (!options.skipNotifications) {
      report.notifications = await runNotifications(now, errors);
    }

    /* --- 5. cosa resta da chiudere ----------------------------------- */
    const pending = await pendingClosings(now);
    report.pending = pending.map((p) => ({
      key: p.key,
      kickoffAt: p.kickoffAt.toISOString(),
    }));

    if (errors.length > 0 && report.status === "success") report.status = "partial";
    report.errors = errors;
    report.durationMs = Date.now() - now.getTime();

    await finishRun(handle, {
      status: report.status === "skipped" ? "success" : report.status,
      matchesSeen: detection.matchesProcessed,
      snapshotsWritten: report.collect.snapshotsWritten,
      signalsTouched: detection.created + detection.updated,
      errors,
      meta: {
        mode,
        trigger: options.trigger ?? "manual",
        intervalMinutes: config.intervalMinutes,
        intervalSource: config.source,
        collectExecuted: report.collect.executed,
        collectionPolicy,
        analysisExecuted: report.detection.executed,
        closingExecuted: report.closing.executed,
        gate: gate.reason,
        closingLinesCaptured: closing.linesCaptured,
        fairLinesCaptured: closing.fairLinesCaptured,
        clvComputed: closing.clvComputed,
        pendingClosings: report.pending.length,
        notificationsSent: report.notifications.sent,
        notificationsExecuted: report.notifications.executed,
      },
    });

    const completedState: LastCycleState = {
      at: now.toISOString(),
      status: report.status === "skipped" ? "success" : report.status,
      mode,
      collectionExecuted: report.collect.executed,
      snapshotsWritten: report.collect.snapshotsWritten,
      signalsTouched: detection.created + detection.updated,
      closingLinesCaptured: closing.linesCaptured,
      clvComputed: closing.clvComputed,
    };

    if (report.collect.executed) {
      await writeLastCollection(completedState);
    }
    /* Il ciclo completo avanza il proprio heartbeat anche se una raccolta
       recente è stata saltata: le fasi DB sono state realmente eseguite e il
       gate pre-install non deve reinstallarle quattro volte l'ora. */
    await writeLastCycle(completedState);

    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report.status = "failed";
    report.errors = [...errors, message];
    report.durationMs = Date.now() - now.getTime();
    await finishRun(handle, { status: "failed", errors: report.errors });
    return report;
  }
}
