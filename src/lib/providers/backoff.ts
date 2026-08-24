/**
 * Backoff adattivo sui 429 della fonte (Sprint backoff).
 *
 * MODULO PURO: scala, tetto e regola di azzeramento dichiarati qui e
 * testati. La scrittura sta nel collector, la lettura nel pannello.
 *
 * Perché: il backoff intra-chiamata (secondi, Retry-After) non ferma la
 * pressione che conta — il cron che riparte uguale ogni 45 minuti. Con
 * episodi 429 in escalation (2→3→13 dal 20/08) serve che anche il GIRO
 * successivo di rete si allontani: 45 → 90 → 180 minuti, poi raddoppio
 * fino al tetto di 24 ore. Si azzera solo con un giro completo senza
 * nessun 429: mezza tregua non è tregua.
 */

/** Scala dichiarata: minuti di cooldown dopo 1°, 2°, 3° giro con 429. */
export const COOLDOWN_STEPS_MIN = [45, 90, 180] as const;

/** Oltre la scala si raddoppia, mai oltre questo tetto. */
export const COOLDOWN_CAP_MIN = 24 * 60;

/** Minuti di cooldown per il livello raggiunto (0 = nessun cooldown). */
export function cooldownMinutesForLevel(level: number): number {
  if (level <= 0) return 0;
  if (level <= COOLDOWN_STEPS_MIN.length) {
    return COOLDOWN_STEPS_MIN[level - 1];
  }
  /* livello 4+: raddoppi dall'ultimo passo, con il tetto */
  let minutes = COOLDOWN_STEPS_MIN[COOLDOWN_STEPS_MIN.length - 1];
  for (let i = COOLDOWN_STEPS_MIN.length; i < level; i += 1) {
    minutes *= 2;
  }
  return Math.min(minutes, COOLDOWN_CAP_MIN);
}

/** Il livello dopo un altro giro con 429: cresce sempre, mai oltre il tetto. */
export function nextLevelAfter429(currentLevel: number): number {
  const next = currentLevel + 1;
  /* il livello massimo è quello che satura il tetto */
  let level = 1;
  while (cooldownMinutesForLevel(level) < COOLDOWN_CAP_MIN) level += 1;
  return Math.min(next, level);
}

/** Istante di sblocco per un livello, a partire da adesso. */
export function cooldownUntilForLevel(level: number, now: Date): Date | null {
  const minutes = cooldownMinutesForLevel(level);
  if (minutes === 0) return null;
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Minuti rimanenti di cooldown, mai negativi: zero significa libero.
 */
export function remainingCooldownMinutes(
  cooldownUntil: Date | string | null,
  now: Date,
): number {
  if (cooldownUntil === null) return 0;
  const until =
    typeof cooldownUntil === "string" ? new Date(cooldownUntil) : cooldownUntil;
  const ms = until.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 60_000);
}
