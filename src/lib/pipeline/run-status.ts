/**
 * Stato pubblico dei run salvati.
 *
 * Il database conserva il fatto grezzo (`running`): se il processo viene
 * terminato dal runner non ha più modo di correggere la riga. Chi espone
 * quel fatto deve però smettere di chiamarlo «in corso» quando il tempo
 * massimo è passato. Questa proiezione resta pura e non riscrive la storia.
 */

/**
 * Margine oltre il tetto reale dei runner (10 min Actions, 5 min Vercel).
 * A 15 minuti esatti il run è ancora considerato in corso; oltre è troncato.
 */
export const ABANDONED_RUN_AFTER_MINUTES = 15;

/**
 * Traduce una riga `running` troppo vecchia in `aborted` per le sole letture.
 * Gli altri stati passano intatti; `null` significa età non verificabile.
 */
export function resolveRunStatus(
  status: string,
  minutesSince: number | null,
): string {
  if (status !== "running" || minutesSince === null) return status;
  return minutesSince > ABANDONED_RUN_AFTER_MINUTES ? "aborted" : status;
}

/** Età non negativa di un run; `null` se uno dei due istanti non è valido. */
export function runAgeMinutes(
  startedAt: Date,
  now: Date,
): number | null {
  const started = startedAt.getTime();
  const current = now.getTime();
  if (!Number.isFinite(started) || !Number.isFinite(current)) return null;
  return Math.max(0, (current - started) / 60_000);
}

/** Stato pronto per API e pagine, derivato da stato salvato + istante. */
export function publicRunStatus(
  status: string,
  startedAt: Date,
  now: Date,
): string {
  return resolveRunStatus(status, runAgeMinutes(startedAt, now));
}
