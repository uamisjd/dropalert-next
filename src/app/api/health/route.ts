/**
 * GET /api/health — stato del sistema e onestà del dato.
 *
 * Dichiara: raggiungibilità del DB, salute delle fonti, ultimi run dei job,
 * buchi dati aperti, conteggi. Se una fonte è bloccata o i dati sono
 * parziali, lo stato complessivo lo riflette invece di dire "tutto ok".
 */
import { NextResponse } from "next/server";
import { count, eq, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clvRecords,
  dataGaps,
  dropSignals,
  matches,
  oddsSnapshots,
} from "@/db/schema";
import { listRecentRuns, listSourceHealth } from "@/lib/pipeline/runs";
import {
  describeRegistry,
  initProviders,
  perBookmakerOddsUnavailable,
} from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  initProviders();

  try {
    const [
      sources,
      runs,
      openGaps,
      signalCounts,
      matchCount,
      snapshotCount,
      clvCount,
    ] = await Promise.all([
      listSourceHealth(),
      listRecentRuns(5),
      db
        .select({
          reason: dataGaps.reason,
          n: raw<number>`count(*)::int`,
        })
        .from(dataGaps)
        .where(eq(dataGaps.resolved, false))
        .groupBy(dataGaps.reason),
      db
        .select({
          status: dropSignals.status,
          n: raw<number>`count(*)::int`,
        })
        .from(dropSignals)
        .groupBy(dropSignals.status),
      db.select({ n: count() }).from(matches),
      db.select({ n: count() }).from(oddsSnapshots),
      db.select({ n: count() }).from(clvRecords),
    ]);

    const blocked = sources.filter((s) => s.status === "blocked");
    const degraded = sources.filter((s) => s.status === "degraded");
    const totalOpenGaps = openGaps.reduce((a, g) => a + g.n, 0);
    const lastRun = runs[0] ?? null;

    /* Lo stato complessivo è pessimistico per scelta: preferiamo dichiarare
       dati parziali piuttosto che presentare un quadro incompleto. */
    let status: "ok" | "partial_data" | "degraded" | "no_sources";
    let statusLabel: string;

    const registered = describeRegistry();
    const enabledProviders = registered.filter((p) => p.enabled);

    if (sources.length === 0) {
      status = "no_sources";
      statusLabel =
        enabledProviders.length === 0
          ? `NESSUNA FONTE ATTIVA — ${registered.length} fonte/i dichiarata/e nel registry, tutte disattivate. Il sistema non sta raccogliendo dati reali.`
          : "NESSUNA RACCOLTA ESEGUITA — fonti attive presenti ma mai interrogate. Nessun dato reale raccolto finora.";
    } else if (blocked.length > 0) {
      status = "degraded";
      statusLabel = `FONTE BLOCCATA — ${blocked.map((s) => s.label).join(", ")}. I dati mostrati sono incompleti.`;
    } else if (degraded.length > 0 || totalOpenGaps > 0) {
      status = "partial_data";
      statusLabel =
        "DATI PARZIALI — alcune quotazioni non sono disponibili. I buchi sono dichiarati, non stimati.";
    } else {
      status = "ok";
      statusLabel = "Dati completi rispetto alle fonti configurate.";
    }

    return NextResponse.json({
      status,
      statusLabel,
      database: { reachable: true, latencyMs: Date.now() - startedAt },
      sources: sources.map((s) => ({
        key: s.sourceKey,
        label: s.label,
        status: s.status,
        lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
        lastAttemptAt: s.lastAttemptAt?.toISOString() ?? null,
        lastErrorMessage: s.lastErrorMessage,
        avgLatencyMs: s.avgLatencyMs,
        consecutiveErrors: s.consecutiveErrors,
        isFallback: s.isFallback,
      })),
      /* Il registry dice quali fonti ESISTONO; `sources` dice come stanno
         andando. Una fonte dichiarata ma mai interrogata compare qui e non
         là: la differenza è informativa, non un buco. */
      registry: {
        declared: registered.length,
        enabled: enabledProviders.length,
        providers: registered,
      },
      capabilities: {
        perBookmakerOdds: !perBookmakerOddsUnavailable(),
        note: perBookmakerOddsUnavailable()
          ? "Nessuna fonte attiva espone quote per singolo bookmaker: coordinazione fra book e conferma della linea sharp NON sono calcolabili e restano dichiarate come non disponibili."
          : "Quote per singolo bookmaker disponibili.",
      },
      dataGaps: {
        open: totalOpenGaps,
        byReason: Object.fromEntries(openGaps.map((g) => [g.reason, g.n])),
      },
      signals: {
        byStatus: Object.fromEntries(signalCounts.map((s) => [s.status, s.n])),
        total: signalCounts.reduce((a, s) => a + s.n, 0),
      },
      counts: {
        matches: matchCount[0]?.n ?? 0,
        oddsSnapshots: snapshotCount[0]?.n ?? 0,
        clvRecords: clvCount[0]?.n ?? 0,
      },
      lastRun: lastRun
        ? {
            collectorKey: lastRun.collectorKey,
            status: lastRun.status,
            startedAt: lastRun.startedAt.toISOString(),
            finishedAt: lastRun.finishedAt?.toISOString() ?? null,
            durationMs: lastRun.durationMs,
            signalsTouched: lastRun.signalsTouched,
          }
        : null,
      recentRuns: runs.map((r) => ({
        collectorKey: r.collectorKey,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        durationMs: r.durationMs,
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    /* il dettaglio resta nei log del server: la risposta dichiara lo stato
       senza esporre l'SQL o i messaggi interni del driver al client */
    console.error(
      "[api/health] lettura stato fallita:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      {
        status: "error",
        statusLabel:
          "SISTEMA NON DISPONIBILE — impossibile leggere lo stato dal database.",
        database: { reachable: false, latencyMs: Date.now() - startedAt },
        detail: "Stato non leggibile. Il dettaglio è registrato nei log del server.",
      },
      { status: 503 },
    );
  }
}
