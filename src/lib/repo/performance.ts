/**
 * Evoluzione del CLV nel tempo (Sprint ENH-1, punto 3).
 *
 * Lettura pura del registro `clv_records`: nessun ricalcolo, nessuna
 * metrica nuova. La pagina /performance mostra come si muove nel tempo
 * l'unica misura di qualità che pubblichiamo, con il suo campione accanto.
 *
 * Disciplina, la stessa di sempre:
 *  - sotto le 30 osservazioni un valore è NON CONCLUDENTE e resta marcato
 *    come tale, anche se è positivo;
 *  - i valori negativi si pubblicano come sono;
 *  - un giorno senza osservazioni è un buco, non uno zero: la serie salta
 *    il punto invece di appiattirlo sull'asse.
 */
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { clvRecords } from "@/db/schema";
import { num, round } from "@/lib/drop/math";
import { CLV_INCONCLUSIVE_BELOW } from "@/lib/repo/dashboard";

const ROME = "Europe/Rome";

const romeDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: ROME,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Un punto della serie: un giorno civile italiano di osservazioni. */
export interface ClvDayPoint {
  /** giorno in formato ISO breve, es. "2026-08-26" */
  day: string;
  /** osservazioni chiuse quel giorno */
  n: number;
  /** CLV medio del giorno, in punti percentuali */
  avgClvPp: number | null;
  /** media progressiva su tutte le osservazioni fino a quel giorno */
  cumulativeAvgPp: number | null;
  /** osservazioni totali fino a quel giorno */
  cumulativeN: number;
  /** true finché il campione cumulato è sotto la soglia dichiarata */
  inconclusive: boolean;
}

export interface PerformanceView {
  points: ClvDayPoint[];
  totalN: number;
  overallAvgPp: number | null;
  beatCloseCount: number;
  beatCloseRate: number | null;
  inconclusive: boolean;
  threshold: number;
  generatedAt: string;
}

/**
 * Serie giornaliera del CLV.
 *
 * Aggrega per giorno civile italiano l'istante di calcolo: è quello il
 * momento in cui l'osservazione è entrata a registro. Se il registro è
 * vuoto la vista lo dice, invece di disegnare una linea piatta.
 */
export async function getPerformanceView(
  now: Date = new Date(),
): Promise<PerformanceView> {
  const rows = await db
    .select({
      clvPp: clvRecords.clvPp,
      beatClose: clvRecords.beatClose,
      computedAt: clvRecords.computedAt,
    })
    .from(clvRecords)
    .orderBy(asc(clvRecords.computedAt));

  const perDay = new Map<string, { sum: number; n: number }>();
  let sumAll = 0;
  let nAll = 0;
  let beat = 0;

  for (const r of rows) {
    const v = num(r.clvPp);
    if (v === null) continue;
    const day = romeDay.format(new Date(r.computedAt));
    const cur = perDay.get(day) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    perDay.set(day, cur);
    sumAll += v;
    nAll += 1;
    if (r.beatClose) beat += 1;
  }

  /* la progressiva si costruisce sui giorni in ordine, non sull'ordine di
     inserimento nella mappa */
  const days = [...perDay.keys()].sort();
  let runSum = 0;
  let runN = 0;
  const points: ClvDayPoint[] = days.map((day) => {
    const d = perDay.get(day)!;
    runSum += d.sum;
    runN += d.n;
    return {
      day,
      n: d.n,
      avgClvPp: d.n > 0 ? round(d.sum / d.n, 2) : null,
      cumulativeAvgPp: runN > 0 ? round(runSum / runN, 2) : null,
      cumulativeN: runN,
      inconclusive: runN < CLV_INCONCLUSIVE_BELOW,
    };
  });

  return {
    points,
    totalN: nAll,
    overallAvgPp: nAll > 0 ? round(sumAll / nAll, 2) : null,
    beatCloseCount: beat,
    beatCloseRate: nAll > 0 ? round(beat / nAll, 4) : null,
    inconclusive: nAll < CLV_INCONCLUSIVE_BELOW,
    threshold: CLV_INCONCLUSIVE_BELOW,
    generatedAt: now.toISOString(),
  };
}
