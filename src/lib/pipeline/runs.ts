/**
 * Tracciamento delle esecuzioni (collector_runs) e salute delle fonti
 * (source_health).
 *
 * Ogni job passa da qui: se un'esecuzione fallisce resta comunque una riga
 * con lo stato di errore. Un job che non lascia traccia è un job che non
 * possiamo verificare.
 */
import { eq, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import {
  collectorRuns,
  sourceHealth,
  type RunStatus,
  type SourceStatus,
} from "@/db/schema";

export interface RunHandle {
  id: number;
  startedAt: Date;
}

/** Apre una riga di run e restituisce l'handle per chiuderla. */
export async function startRun(collectorKey: string): Promise<RunHandle> {
  const startedAt = new Date();
  const [row] = await db
    .insert(collectorRuns)
    .values({ collectorKey, startedAt, status: "running" })
    .returning({ id: collectorRuns.id });
  return { id: row.id, startedAt };
}

/** Chiude una riga di run con l'esito. */
export async function finishRun(
  handle: RunHandle,
  result: {
    status: RunStatus;
    matchesSeen?: number;
    snapshotsWritten?: number;
    signalsTouched?: number;
    errors?: unknown[];
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  const finishedAt = new Date();
  await db
    .update(collectorRuns)
    .set({
      finishedAt,
      status: result.status,
      matchesSeen: result.matchesSeen ?? 0,
      snapshotsWritten: result.snapshotsWritten ?? 0,
      signalsTouched: result.signalsTouched ?? 0,
      durationMs: finishedAt.getTime() - handle.startedAt.getTime(),
      errors: result.errors && result.errors.length > 0 ? result.errors : null,
      meta: result.meta ?? null,
    })
    .where(eq(collectorRuns.id, handle.id));
}

/**
 * Esegue un job tracciandolo automaticamente.
 * In caso di eccezione la riga viene chiusa con stato `failed` e l'errore
 * viene rilanciato: il chiamante decide come rispondere.
 */
export async function withRun<T>(
  collectorKey: string,
  fn: (handle: RunHandle) => Promise<{ result: T; stats: Parameters<typeof finishRun>[1] }>,
): Promise<T> {
  const handle = await startRun(collectorKey);
  try {
    const { result, stats } = await fn(handle);
    await finishRun(handle, stats);
    return result;
  } catch (err) {
    await finishRun(handle, {
      status: "failed",
      errors: [err instanceof Error ? err.message : String(err)],
    });
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Salute delle fonti                                                  */
/* ------------------------------------------------------------------ */

export interface SourcePing {
  sourceKey: string;
  label: string;
  outcome: "ok" | "partial" | "error" | "disabled";
  latencyMs?: number;
  errorMessage?: string;
  isFallback?: boolean;
}

/** Numero di errori consecutivi oltre il quale la fonte è dichiarata bloccata. */
export const BLOCKED_AFTER_CONSECUTIVE_ERRORS = 3;

/** Deriva lo stato pubblico della fonte dall'esito e dalla storia recente. */
export function deriveSourceStatus(
  outcome: SourcePing["outcome"],
  consecutiveErrors: number,
): SourceStatus {
  if (outcome === "disabled") return "disabled";
  if (outcome === "ok") return "ok";
  if (outcome === "partial") return "degraded";
  return consecutiveErrors >= BLOCKED_AFTER_CONSECUTIVE_ERRORS
    ? "blocked"
    : "degraded";
}

/**
 * Registra l'esito di un'interrogazione a una fonte.
 * La latenza media è una media mobile esponenziale: non serve conservare
 * tutta la storia per avere un valore utile.
 */
export async function recordSourcePing(ping: SourcePing): Promise<SourceStatus> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(sourceHealth)
    .where(eq(sourceHealth.sourceKey, ping.sourceKey))
    .limit(1);

  const isError = ping.outcome === "error";
  const consecutiveErrors = isError ? (existing?.consecutiveErrors ?? 0) + 1 : 0;
  const status = deriveSourceStatus(ping.outcome, consecutiveErrors);

  const avgLatencyMs =
    ping.latencyMs === undefined
      ? (existing?.avgLatencyMs ?? null)
      : existing?.avgLatencyMs
        ? Math.round(existing.avgLatencyMs * 0.7 + ping.latencyMs * 0.3)
        : ping.latencyMs;

  const values = {
    sourceKey: ping.sourceKey,
    label: ping.label,
    status,
    lastAttemptAt: now,
    lastSuccessAt:
      ping.outcome === "ok" || ping.outcome === "partial"
        ? now
        : (existing?.lastSuccessAt ?? null),
    lastErrorAt: isError ? now : (existing?.lastErrorAt ?? null),
    lastErrorMessage: isError
      ? (ping.errorMessage ?? "errore non specificato")
      : (existing?.lastErrorMessage ?? null),
    avgLatencyMs,
    lastLatencyMs: ping.latencyMs ?? null,
    consecutiveErrors,
    isFallback: ping.isFallback ?? false,
    updatedAt: now,
  };

  if (!existing) {
    await db.insert(sourceHealth).values({
      ...values,
      successCount: ping.outcome === "ok" ? 1 : 0,
      errorCount: isError ? 1 : 0,
      partialCount: ping.outcome === "partial" ? 1 : 0,
    });
    return status;
  }

  await db
    .update(sourceHealth)
    .set({
      ...values,
      successCount:
        ping.outcome === "ok"
          ? raw`${sourceHealth.successCount} + 1`
          : existing.successCount,
      errorCount: isError
        ? raw`${sourceHealth.errorCount} + 1`
        : existing.errorCount,
      partialCount:
        ping.outcome === "partial"
          ? raw`${sourceHealth.partialCount} + 1`
          : existing.partialCount,
    })
    .where(eq(sourceHealth.sourceKey, ping.sourceKey));

  return status;
}

/** Elenco completo della salute delle fonti. */
export async function listSourceHealth() {
  return db.select().from(sourceHealth).orderBy(sourceHealth.sourceKey);
}

/** Ultimi run, per la diagnostica. */
export async function listRecentRuns(limit = 20) {
  return db
    .select()
    .from(collectorRuns)
    .orderBy(raw`${collectorRuns.startedAt} desc`)
    .limit(limit);
}
