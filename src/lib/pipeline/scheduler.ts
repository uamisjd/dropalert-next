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
import { collectBetexplorer } from "@/lib/providers/betexplorer/collect";
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

/** Chiave di stato che conserva l'esito dell'ultimo giro. */
export const LAST_CYCLE_KEY = "scheduler:last_cycle";

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
  snapshotsWritten: number;
  signalsTouched: number;
  closingLinesCaptured: number;
  clvComputed: number;
}

/** Ultimo giro registrato, null se il sistema non ha mai girato. */
export async function readLastCycle(): Promise<LastCycleState | null> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, LAST_CYCLE_KEY))
    .limit(1);
  if (!row) return null;
  return row.value as LastCycleState;
}

/** Registra l'esito dell'ultimo giro (upsert). */
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

export interface CycleOptions {
  /** salta la raccolta e analizza soltanto ciò che è già a registro */
  skipCollect?: boolean;
  /** ignora l'intervallo minimo (uso manuale e test di percorso) */
  force?: boolean;
  /** limita l'analisi a partite specifiche */
  matchIds?: number[];
  /** istante di riferimento, iniettabile */
  now?: Date;
  /**
   * Chi ha chiesto il giro. Il runner schedulato passa `scheduled`; CLI,
   * API e pulsante restano `manual`, che è anche il default.
   */
  trigger?: RunTrigger;
}

export interface CycleReport {
  status: "success" | "partial" | "failed" | "skipped";
  runId: number;
  startedAt: string;
  durationMs: number;
  config: SchedulerConfig;
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
    matchesProcessed: number;
    marketsAnalyzed: number;
    created: number;
    updated: number;
    gapsRecorded: number;
  };
  closing: {
    matchesProcessed: number;
    linesCaptured: number;
    fairLinesCaptured: number;
    clvComputed: number;
  };
  /** partite monitorate che devono ancora superare il kickoff */
  pending: Array<{ key: string; kickoffAt: string }>;
  errors: string[];
}

/**
 * Esegue un giro completo: raccolta, analisi, chiusura.
 *
 * Ogni fase è isolata: se la raccolta fallisce, l'analisi e la chiusura
 * girano comunque sui dati già a registro, e il fallimento resta scritto
 * in `collector_runs` e in `source_health` invece di essere nascosto.
 */
export async function runCycle(options: CycleOptions = {}): Promise<CycleReport> {
  const now = options.now ?? new Date();
  const config = readSchedulerConfig();
  const handle = await startRun("scheduler-cycle");
  const errors: string[] = [];

  const last = await readLastCycle();
  const gate = shouldRunNow(
    last ? new Date(last.at) : null,
    now,
    config.intervalMinutes,
    options.force ?? options.skipCollect ?? false,
  );

  const report: CycleReport = {
    status: "success",
    runId: handle.id,
    startedAt: now.toISOString(),
    durationMs: 0,
    config,
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
      matchesProcessed: 0,
      marketsAnalyzed: 0,
      created: 0,
      updated: 0,
      gapsRecorded: 0,
    },
    closing: {
      matchesProcessed: 0,
      linesCaptured: 0,
      fairLinesCaptured: 0,
      clvComputed: 0,
    },
    pending: [],
    errors: [],
  };

  try {
    /* --- 1. raccolta ------------------------------------------------ */
    if (!options.skipCollect && gate.run) {
      try {
        const collected = await collectBetexplorer({
          horizonHours: config.horizonHours,
          maxFixtures: config.maxFixtures,
          withResults: config.withResults,
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
          report.status = "partial";
          errors.push("raccolta fallita: analisi eseguita sui soli dati già a registro.");
        }
      } catch (err) {
        report.status = "partial";
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`raccolta interrotta: ${message}`);
      }
    }

    /* --- 2. analisi -------------------------------------------------- */
    const detection = await detectAll(now, { matchIds: options.matchIds });
    report.detection = {
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
      matchesProcessed: closing.matchesProcessed,
      linesCaptured: closing.linesCaptured,
      fairLinesCaptured: closing.fairLinesCaptured,
      clvComputed: closing.clvComputed,
    };
    for (const e of closing.errors) errors.push(`chiusura match ${e.matchId}: ${e.message}`);

    /* --- 4. cosa resta da chiudere ----------------------------------- */
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
        intervalMinutes: config.intervalMinutes,
        intervalSource: config.source,
        collectExecuted: report.collect.executed,
        gate: gate.reason,
        closingLinesCaptured: closing.linesCaptured,
        fairLinesCaptured: closing.fairLinesCaptured,
        clvComputed: closing.clvComputed,
        pendingClosings: report.pending.length,
      },
    });

    if (report.collect.executed) {
      await writeLastCycle({
        at: now.toISOString(),
        status: report.status === "skipped" ? "success" : report.status,
        snapshotsWritten: report.collect.snapshotsWritten,
        signalsTouched: detection.created + detection.updated,
        closingLinesCaptured: closing.linesCaptured,
        clvComputed: closing.clvComputed,
      });
    }

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
