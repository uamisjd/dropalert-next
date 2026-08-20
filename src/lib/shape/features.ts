/**
 * Feature di "forma" di un segnale (voce 2 del backlog di ricerca).
 *
 * MODULO PURO: riceve la serie di rilevazioni già lette dal database e
 * restituisce le feature in una struttura dichiarata. Nessun orologio
 * interno, nessuna rete, nessuna scrittura: il riempimento dell'archivio
 * sta nello script `src/scripts/build-shape-features.ts`.
 *
 * Queste feature sono LETTURE, non giudizi: non entrano nel punteggio di
 * fiducia e non cambiano nulla del comportamento del sito. Esistono per
 * essere riusate dalla ricerca (R2, R3) senza ricalcolare ogni volta la
 * forma dai dati grezzi.
 *
 * Struttura salvata in `drop_signals.shape` (jsonb):
 *
 *   version                  1
 *   firstMoveAt              ISO della prima rilevazione oltre la soglia
 *                            di rumore (+2 pp di probabilità implicita
 *                            rispetto all'apertura), null se mai oltre
 *   lastObservedAt           ISO dell'ultima rilevazione della serie
 *   durationMinutes          minuti da firstMoveAt a lastObservedAt,
 *                            null se il movimento non ha mai superato il
 *                            rumore o la serie ha meno di due punti
 *   reboundCount             episodi di ritorno ≥ 2 pp dal massimo di
 *                            probabilità raggiunto; ogni episodio conta
 *                            una volta, fino a un nuovo massimo
 *   flash                    true se la durata misurabile è sotto i 30
 *                            minuti, false se sopra, null se non
 *                            misurabile
 *   detectedToKickoffMinutes minuti fra il rilevamento del segnale e il
 *                            kickoff, solo per i segnali rilevati prima
 *                            del kickoff; null altrimenti
 *   snapshotsUsed            punti distinti usati (dedup per istante)
 *   computedAt               ISO del calcolo: il backfill riscrive solo
 *                            se sono arrivate rilevazioni più recenti
 */
import {
  FLASH_WINDOW_MINUTES,
  MAGNITUDE_THRESHOLDS,
} from "@/lib/drop/constants";

/** Soglia di rumore come frazione di probabilità (2 pp = 0,02). */
const NOISE = MAGNITUDE_THRESHOLDS.noise / 100;

export const SHAPE_VERSION = 1;

export interface ShapePoint {
  /** istante della rilevazione */
  at: Date;
  /** probabilità implicita (1/quota) in frazione 0–1 */
  prob: number;
}

export interface ShapeInput {
  /** serie ordinata o disordinata: qui viene ordinata e deduplicata */
  points: ShapePoint[];
  /** probabilità di apertura del segnale, riferimento del rumore */
  openingProb: number;
  /** istante del rilevamento del segnale (drop_signals.detectedAt) */
  detectedAt: Date;
  /** kickoff; può mancare o essere già passato */
  kickoffAt: Date | null;
  /** istante del calcolo, per la regola di idempotenza */
  now: Date;
}

export interface ShapeFeatures {
  version: number;
  firstMoveAt: string | null;
  lastObservedAt: string | null;
  durationMinutes: number | null;
  reboundCount: number;
  flash: boolean | null;
  detectedToKickoffMinutes: number | null;
  snapshotsUsed: number;
  computedAt: string;
}

/**
 * Ordina per istante e deduplica: due bookmaker che pubblicano lo stesso
 * istante sono una sola lettura (vince l'ultima riga letta, ordine stabile).
 */
export function dedupePoints(points: ShapePoint[]): ShapePoint[] {
  const byAt = new Map<number, ShapePoint>();
  for (const p of points) {
    const t = p.at.getTime();
    byAt.set(t, p);
  }
  return [...byAt.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Calcola le feature di forma. Restituisce `null` se la serie è vuota:
 * un segnale senza rilevazioni non ha forma, e l'assenza si dichiara
 * invece di essere riempita con zeri.
 */
export function buildShapeFeatures(input: ShapeInput): ShapeFeatures | null {
  const points = dedupePoints(input.points);
  if (points.length === 0) return null;

  /* prima rilevazione oltre il rumore, nella direzione del drop */
  let firstMove: ShapePoint | null = null;
  for (const p of points) {
    if (p.prob - input.openingProb >= NOISE) {
      firstMove = p;
      break;
    }
  }

  const last = points[points.length - 1];

  const durationMinutes =
    firstMove !== null && points.length >= 2
      ? Math.round((last.at.getTime() - firstMove.at.getTime()) / 60000)
      : null;

  /* rimbalzi: ogni ritorno ≥ 2 pp dal massimo raggiunto conta una volta,
     finché il massimo non viene superato di nuovo */
  let maxProb = input.openingProb;
  let reboundCount = 0;
  let inRebound = false;
  for (const p of points) {
    if (p.prob >= maxProb) {
      maxProb = p.prob;
      inRebound = false;
    } else if (maxProb - p.prob >= NOISE && !inRebound) {
      reboundCount += 1;
      inRebound = true;
    }
  }

  /* distanza rilevazione→kickoff: solo per segnali pre-kickoff */
  const detectedToKickoffMinutes =
    input.kickoffAt !== null && input.kickoffAt.getTime() > input.detectedAt.getTime()
      ? Math.round((input.kickoffAt.getTime() - input.detectedAt.getTime()) / 60000)
      : null;

  return {
    version: SHAPE_VERSION,
    firstMoveAt: firstMove === null ? null : firstMove.at.toISOString(),
    lastObservedAt: last.at.toISOString(),
    durationMinutes,
    reboundCount,
    flash: durationMinutes === null ? null : durationMinutes < FLASH_WINDOW_MINUTES,
    detectedToKickoffMinutes,
    snapshotsUsed: points.length,
    computedAt: input.now.toISOString(),
  };
}

/**
 * Regola di idempotenza del backfill: una forma si ricalcola soltanto se
 * non esiste, se è illeggibile, o se sono arrivate rilevazioni più recenti
 * dell'ultimo calcolo. Rieseguire lo script a dati fermi non tocca nulla.
 */
export function isShapeStale(
  saved: unknown,
  latestSnapshotAt: Date | null,
): boolean {
  if (typeof saved !== "object" || saved === null) return true;
  const s = saved as { version?: unknown; computedAt?: unknown };
  if (s.version !== SHAPE_VERSION) return true;
  if (typeof s.computedAt !== "string") return true;
  const computed = new Date(s.computedAt).getTime();
  if (!Number.isFinite(computed)) return true;
  if (latestSnapshotAt === null) return false;
  return latestSnapshotAt.getTime() > computed;
}
