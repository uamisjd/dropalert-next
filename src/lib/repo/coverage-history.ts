/**
 * Lettura della copertura dai run salvati (Sprint 6B).
 *
 * Sola lettura: interroga `collector_runs` e traduce il campo `meta` in
 * punti della serie storica. Non scrive nulla e non ricalcola nulla — la
 * misura viene fatta durante la raccolta, qui si legge soltanto.
 *
 * I run precedenti alla strumentazione non hanno la sezione `coverage`:
 * vengono contati come **non misurati**, che è cosa diversa da copertura
 * zero. Confondere le due cose farebbe apparire un crollo dove c'è solo
 * assenza di misura.
 */
import { and, desc, eq, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import { collectorRuns } from "@/db/schema";
import { COLLECTOR_KEY } from "@/lib/providers/betexplorer/collect";
import type { ScheduledRun } from "@/lib/cov/actions";
import {
  readLoopState,
  schedulerHealth,
  type SchedulerHealth,
} from "@/lib/pipeline/scheduler";
import {
  coverageOfRun,
  coverageSeriesStats,
  describeSeriesDepth,
  type CoveragePoint,
  type CoverageSeriesStats,
  type RunCoverage,
} from "@/lib/cov/instrument";

export interface CoverageHistory {
  /** bilancio completo dell'ultimo giro strumentato, `null` se non ce n'è */
  latest: RunCoverage | null;
  /** run a cui appartiene `latest` */
  latestRunId: number | null;
  latestStartedAt: string | null;
  /** serie storica, dal più vecchio al più recente */
  points: CoveragePoint[];
  stats: CoverageSeriesStats;
  /** frase che dichiara la profondità dell'osservazione */
  depth: string;
  /** run letti in totale, compresi quelli senza misura */
  runsInspected: number;
  /** run senza sezione di copertura: precedenti alla strumentazione */
  runsWithoutMeasure: number;
  /**
   * Stato del runner schedulato, `null` se non è mai stato acceso o se
   * l'archivio non ha saputo dirlo. Non è una misura: è un'indicazione
   * operativa su quando arriverà il prossimo punto della serie.
   */
  scheduler: SchedulerStatus | null;
  /**
   * Ultimo giro **schedulato** letto dai run salvati (Sprint 9): è la
   * base della riga sulla raccolta automatica via GitHub Actions. Con
   * il runner in-process spento è l'unico posto dove la serie continua
   * ad avanzare, e l'unico da cui si può dire se la raccolta si è fermata.
   * `null` se non esiste o se la lettura fallisce.
   */
  lastScheduledRun: ScheduledRun | null;
}

export interface SchedulerStatus {
  running: boolean;
  intervalMinutes: number;
  nextRunMinutes: number | null;
  cyclesCompleted: number;
  /**
   * Giudizio sulla riga di stato: `running` acceso e credibile, `off`
   * spento, `uncertain` dichiarato acceso ma senza segni di vita recenti.
   */
  health: SchedulerHealth;
  /** da quanti minuti il runner non dà segni di vita */
  silentMinutes: number | null;
}

/**
 * Legge lo stato del runner schedulato.
 *
 * Non propaga errori: se lo stato non è leggibile, il pannello di
 * copertura deve comunque mostrare la misura. Il conto alla rovescia è un
 * accessorio, i numeri no.
 */
async function readSchedulerStatus(now: Date): Promise<SchedulerStatus | null> {
  try {
    const state = await readLoopState();
    if (state === null) return null;

    /* la riga non viene creduta sulla parola: un processo morto lascia
       scritto "running: true" e nessuno può più correggerlo al posto suo */
    const verdict = schedulerHealth(state, now);

    return {
      running: verdict.health === "running",
      intervalMinutes: state.intervalMinutes,
      nextRunMinutes: verdict.nextRunMinutes,
      cyclesCompleted: state.cyclesCompleted,
      health: verdict.health,
      silentMinutes: verdict.silentMinutes,
    };
  } catch {
    return null;
  }
}

/**
 * Legge l'ultimo giro schedulato dai run salvati.
 *
 * L'autorità è `meta.trigger = "scheduled"`: i giri manuali non dicono
 * niente sulla salute della raccolta automatica, perciò vengono saltati
 * anche quando sono più recenti. Un run che non dichiara nulla vale
 * `manual`, come ovunque.
 *
 * Non propaga errori: questa riga è un'indicazione operativa, la misura
 * sta altrove. Se l'archivio non risponde, `null` — e la pagina resta
 * valida senza la riga, mai con una riga inventata.
 */
async function readLastScheduledRun(): Promise<ScheduledRun | null> {
  try {
    const rows = await db
      .select({
        id: collectorRuns.id,
        startedAt: collectorRuns.startedAt,
        status: collectorRuns.status,
      })
      .from(collectorRuns)
      .where(
        and(
          eq(collectorRuns.collectorKey, COLLECTOR_KEY),
          raw`${collectorRuns.meta}->>'trigger' = 'scheduled'`,
        ),
      )
      .orderBy(desc(collectorRuns.startedAt))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return {
      runId: row.id,
      startedAt: row.startedAt.toISOString(),
      status: row.status,
    };
  } catch {
    return null;
  }
}

/**
 * Legge gli ultimi run del collector e ne ricava la serie di copertura.
 *
 * @param limit quanti run leggere, dal più recente
 */
export async function getCoverageHistory(
  limit = 50,
  now: Date = new Date(),
): Promise<CoverageHistory> {
  const rows = await db
    .select({
      id: collectorRuns.id,
      startedAt: collectorRuns.startedAt,
      status: collectorRuns.status,
      meta: collectorRuns.meta,
    })
    .from(collectorRuns)
    .where(eq(collectorRuns.collectorKey, COLLECTOR_KEY))
    .orderBy(desc(collectorRuns.startedAt))
    .limit(limit);

  const points: CoveragePoint[] = [];
  let latest: RunCoverage | null = null;
  let latestRunId: number | null = null;
  let latestStartedAt: string | null = null;
  let runsWithoutMeasure = 0;

  /* `rows` è dal più recente: il primo con misura è l'ultimo giro utile */
  for (const row of rows) {
    const point = coverageOfRun(row.id, row.startedAt, row.status, row.meta);
    if (point === null) {
      runsWithoutMeasure += 1;
      continue;
    }
    points.push(point);

    if (latest === null) {
      const meta = row.meta as { coverage?: RunCoverage } | null;
      latest = meta?.coverage ?? null;
      latestRunId = row.id;
      latestStartedAt = row.startedAt.toISOString();
    }
  }

  /* la serie si legge in avanti nel tempo */
  points.reverse();

  const stats = coverageSeriesStats(points);
  const scheduler = await readSchedulerStatus(now);
  const lastScheduledRun = await readLastScheduledRun();

  return {
    latest,
    latestRunId,
    latestStartedAt,
    points,
    stats,
    depth: describeSeriesDepth(stats),
    runsInspected: rows.length,
    runsWithoutMeasure,
    scheduler,
    lastScheduledRun,
  };
}
