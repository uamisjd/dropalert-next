/** Performance in sola lettura: un unico campione grezzo contro grezzo.
 * Le basi non allineate restano conteggiate nell'archivio, mai sommate alla
 * serie. Nessuna ribasatura, deduzione di prezzo o modifica dello storico.
 */
import { round } from "@/lib/drop/math";
import { SCORE_BUCKETS, scoreBucketOf } from "@/lib/drop/novig";
import { clvBasisMix, clvBasisOf } from "./clv-basis";

export const CLV_INCONCLUSIVE_BELOW = 30;
export const CLV_MATURITY_NOTE =
  "Con campioni piccoli il CLV oscillante non prova nulla. Serve storico.";

export interface PerformanceRecord {
  clvPp: string | number | null;
  beatClose: boolean;
  at: Date | string;
  closingBasis?: string | null;
  signalScore: string | number | null;
}

export interface ClvDayPoint {
  /** Giornata civile italiana del kickoff, non del calcolo CLV. */
  day: string;
  n: number;
  avgClvPp: number | null;
  cumulativeAvgPp: number | null;
  cumulativeN: number;
  inconclusive: boolean;
}

const romeDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
});

function finiteNumber(value: string | number | null): number | null {
  if (value === null || (typeof value === "string" && value.trim() === "")) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildPerformanceView(rows: PerformanceRecord[], now: Date) {
  const basis = clvBasisMix(rows);
  let invalidAlignedN = 0;
  const aligned: Array<{ pp: number; beat: boolean; day: string; score: number | null }> = [];
  for (const row of rows) {
    if (clvBasisOf(row.closingBasis) !== "raw_consensus") continue;
    const pp = finiteNumber(row.clvPp);
    const date = new Date(row.at);
    if (pp === null || !Number.isFinite(date.getTime()) || typeof row.beatClose !== "boolean") {
      invalidAlignedN++;
      continue;
    }
    const score = finiteNumber(row.signalScore);
    aligned.push({
      pp, beat: row.beatClose, day: romeDay.format(date),
      score: score !== null && score >= 0 && score <= 100 ? score : null,
    });
  }

  const perDay = new Map<string, { sum: number; n: number }>();
  let sum = 0;
  let beat = 0;
  for (const row of aligned) {
    const day = perDay.get(row.day) ?? { sum: 0, n: 0 };
    day.sum += row.pp;
    day.n++;
    perDay.set(row.day, day);
    sum += row.pp;
    if (row.beat) beat++;
  }
  let cumulativeSum = 0;
  let cumulativeN = 0;
  const points: ClvDayPoint[] = [...perDay.keys()].sort().map((day) => {
    const group = perDay.get(day)!;
    cumulativeSum += group.sum;
    cumulativeN += group.n;
    return {
      day, n: group.n, avgClvPp: round(group.sum / group.n, 2),
      cumulativeAvgPp: round(cumulativeSum / cumulativeN, 2), cumulativeN,
      inconclusive: cumulativeN < CLV_INCONCLUSIVE_BELOW,
    };
  });

  const buckets = SCORE_BUCKETS.map((bucket) => {
    const group = aligned.filter((row) => row.score !== null && scoreBucketOf(row.score) === bucket.key);
    return {
      key: bucket.key, label: bucket.label, sampleSize: group.length,
      avgClvPp: group.length ? round(group.reduce((n, row) => n + row.pp, 0) / group.length, 2) : null,
      beatCloseRate: group.length ? round(group.filter((row) => row.beat).length / group.length, 4) : null,
      inconclusive: group.length < CLV_INCONCLUSIVE_BELOW,
    };
  });
  const totalN = aligned.length;
  const excludedN = rows.length - totalN;
  const basisNote = rows.length === 0
    ? "Nessuna osservazione di CLV a registro. Il riepilogo userà soltanto il confronto grezzo contro grezzo."
    : `Archivio: ${rows.length} osservazioni. Campione mostrato: ${totalN}, solo chiusura grezza contro segnale grezzo; il margine è incluso in entrambi i prezzi. ` +
      `Escluse dal grafico, dalle medie e dalle fasce: ${basis.counts.fair_novig} con chiusura senza margine contro segnale grezzo, ` +
      `${basis.counts.sconosciuta} con base sconosciuta e ${invalidAlignedN} su base grezza con dati non validi. ` +
      "Le osservazioni escluse restano in archivio: nessun ricalcolo dello storico. La soglia di campione si applica solo alle osservazioni mostrate, non all’intero archivio.";

  return {
    points, totalN, overallAvgPp: totalN ? round(sum / totalN, 2) : null,
    beatCloseCount: beat, beatCloseRate: totalN ? round(beat / totalN, 4) : null,
    inconclusive: totalN < CLV_INCONCLUSIVE_BELOW, threshold: CLV_INCONCLUSIVE_BELOW,
    buckets, unclassifiedN: aligned.filter((row) => row.score === null).length,
    archiveN: rows.length, excludedN, invalidAlignedN,
    basis, basisNote, generatedAt: now.toISOString(),
  };
}

export type PerformanceView = ReturnType<typeof buildPerformanceView>;
