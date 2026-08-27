/**
 * Calendario in cache (Sprint ENH-1, punto 1).
 *
 * Una lettura al giorno, conservata in `system_state` come gli altri budget
 * del progetto: nessuna migrazione, un solo posto dove guardare.
 *
 * Il calendario NON crea partite in archivio, non crea segnali e non tocca
 * il collector: è una lista di ciò che sta arrivando, mostrata accanto ai
 * movimenti con l'etichetta «quote in arrivo».
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { systemState } from "@/db/schema";
import {
  CALENDAR_CACHE_HOURS,
  fetchCalendar,
  romeDayIso,
  type CalendarFixture,
} from "@/lib/calendar/football-data";

export interface CalendarView {
  fixtures: CalendarFixture[];
  /** motivo dichiarato quando il calendario non c'è */
  unavailableReason: string | null;
  /** istante della lettura conservata */
  fetchedAt: string | null;
}

interface Envelope {
  expiresAt: string;
  fetchedAt: string;
  fixtures: CalendarFixture[];
}

function cacheKey(from: string, to: string): string {
  return `calendar:football-data:${from}:${to}`;
}

async function readCache(
  key: string,
  now: Date,
): Promise<Envelope | null> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, key))
    .limit(1);
  if (row === undefined) return null;
  const env = row.value as Partial<Envelope>;
  if (typeof env.expiresAt !== "string" || !Array.isArray(env.fixtures)) {
    return null;
  }
  const exp = new Date(env.expiresAt).getTime();
  if (!Number.isFinite(exp) || exp <= now.getTime()) return null;
  return env as Envelope;
}

async function writeCache(
  key: string,
  fixtures: CalendarFixture[],
  now: Date,
): Promise<void> {
  const value: Envelope = {
    expiresAt: new Date(
      now.getTime() + CALENDAR_CACHE_HOURS * 3_600_000,
    ).toISOString(),
    fetchedAt: now.toISOString(),
    fixtures,
  };
  await db
    .insert(systemState)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: now } });
}

/**
 * Il calendario dei prossimi giorni.
 *
 * `daysAhead` è la finestra: 0 = solo oggi, 1 = oggi e domani. La cache
 * copre esattamente la finestra richiesta, così la pagina «Domani» e la home
 * non si rubano la lettura a vicenda.
 */
export async function getCalendar(
  daysAhead: number,
  now: Date = new Date(),
): Promise<CalendarView> {
  const from = romeDayIso(now, 0);
  const to = romeDayIso(now, Math.max(0, daysAhead));
  const key = cacheKey(from, to);

  const cached = await readCache(key, now).catch(() => null);
  if (cached !== null) {
    /* le partite già iniziate escono anche dalla cache: «mai una giocata» */
    return {
      fixtures: cached.fixtures.filter(
        (f) => new Date(f.kickoffAt).getTime() > now.getTime(),
      ),
      unavailableReason: null,
      fetchedAt: cached.fetchedAt,
    };
  }

  const outcome = await fetchCalendar(from, to, { now }).catch(() => ({
    ok: false as const,
    reason: "calendario non disponibile: errore della fonte",
  }));

  if (!outcome.ok) {
    return { fixtures: [], unavailableReason: outcome.reason, fetchedAt: null };
  }

  await writeCache(key, outcome.fixtures, now).catch(() => undefined);
  return {
    fixtures: outcome.fixtures,
    unavailableReason: null,
    fetchedAt: now.toISOString(),
  };
}
