/**
 * GET /api/coverage — copertura della raccolta: ultimo giro e storico.
 *
 * Sola lettura, nessuna richiesta alla fonte: espone ciò che i giri di
 * raccolta hanno già misurato e salvato in `collector_runs.meta`.
 *
 * Parametri:
 *   ?limit=N   quanti run leggere (default 50, massimo 200)
 *
 * NOTA: il file vive in `app/api/cov/` e non in `app/api/coverage/` perché
 * le directory chiamate `coverage` vengono escluse dagli snapshot
 * dell'ambiente di lavoro. L'URL pubblico resta `/api/coverage`, mappato in
 * `next.config.ts`.
 */
import { NextResponse } from "next/server";
import { getCoverageHistory } from "@/lib/repo/coverage-history";
import { buildActionsView } from "@/lib/cov/actions";
import {
  EXCLUSION_LABELS,
  MIN_RUNS_FOR_TREND,
} from "@/lib/cov/instrument";

export const dynamic = "force-dynamic";

const DISCLAIMER =
  "DropAlert è un osservatorio statistico sui movimenti di quota. Questa misura descrive la copertura dei dati raccolti e non contiene indicazioni di scommessa.";

export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();

  try {
    const url = new URL(request.url);
    const raw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 50;

    const history = await getCoverageHistory(limit);

    const notes = [...(history.latest?.notes ?? [])];
    if (history.runsWithoutMeasure > 0) {
      notes.push(
        `${history.runsWithoutMeasure} giri letti non hanno la misura di copertura: sono precedenti alla strumentazione. Contano come NON MISURATI, non come copertura zero.`,
      );
    }

    return NextResponse.json({
      status: history.latest === null ? "NON MISURATO" : "OK",
      measuredAt: history.latestStartedAt,
      latest:
        history.latest === null
          ? null
          : {
              runId: history.latestRunId,
              startedAt: history.latestStartedAt,
              seen: history.latest.seen,
              football: history.latest.football,
              worked: history.latest.worked,
              imported: history.latest.imported,
              lost: history.latest.lost,
              coverage: history.latest.coverage,
              byReason: history.latest.byReason,
              byCompetition: history.latest.byCompetition,
              exclusions: history.latest.exclusions,
            },
      history: {
        points: history.points,
        stats: history.stats,
        depth: history.depth,
        inconclusive: history.stats.inconclusive,
        minRunsForTrend: MIN_RUNS_FOR_TREND,
        /* la soglia si conta sui soli giri schedulati: i giri chiesti a
           mano sono dichiarati a parte, non sommati alla profondità */
        scheduledRuns: history.stats.scheduledPoints,
        manualRuns: history.stats.manualPoints,
        runsInspected: history.runsInspected,
        runsWithoutMeasure: history.runsWithoutMeasure,
      },
      /* stato del runner: quando arriverà il prossimo punto della serie */
      scheduler: history.scheduler,
      /* raccolta automatica via GitHub Actions, letta dall'archivio */
      githubActions: buildActionsView({
        lastScheduledRun: history.lastScheduledRun,
        now: new Date(),
      }),
      legend: EXCLUSION_LABELS,
      notes,
      tookMs: Date.now() - startedAt,
      disclaimer: DISCLAIMER,
    });
  } catch (error) {
    /* mai riempire il buco con stime: si dichiara il guasto. Il dettaglio
       resta nei log del server, senza esporre l'SQL al client. */
    console.error(
      "[api/cov] lettura copertura fallita:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        status: "DATI PARZIALI",
        detail:
          "Copertura non leggibile in questo momento. Il dettaglio è registrato nei log del server.",
        latest: null,
        history: null,
        tookMs: Date.now() - startedAt,
        disclaimer: DISCLAIMER,
      },
      { status: 503 },
    );
  }
}
