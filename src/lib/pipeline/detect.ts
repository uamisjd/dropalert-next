/**
 * Pipeline di rilevamento: dal motore alla persistenza.
 *
 * Responsabilità:
 *  - eseguire l'analisi su ogni coppia (partita, mercato, selezione);
 *  - fare upsert su drop_signals gestendo le transizioni di stato;
 *  - congelare il prezzo al primo rilevamento (riferimento per il CLV);
 *  - scrivere signal_events a ogni cambiamento rilevante;
 *  - registrare i data_gaps osservati durante l'analisi.
 *
 * Regole invarianti:
 *  - `detectedPrice` non viene MAI riscritto dopo il primo rilevamento;
 *  - un segnale non viene cancellato: cambia stato e lascia traccia;
 *  - un movimento sotto soglia non crea un segnale, ma se un segnale esiste
 *    già viene aggiornato (può essere rientrato).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  dataGaps,
  dropSignals,
  matches,
  signalEvents,
  type DropSignal,
  type GapReason,
  type MarketType,
  type SelectionCode,
  type SignalStatus,
} from "@/db/schema";
import { analyzeDrop } from "@/lib/drop/engine";
import { ENGINE_VERSION } from "@/lib/drop/constants";
import { num } from "@/lib/drop/math";
import {
  getExpectedBookmakerCount,
  getSeriesForMatch,
  parseMarketKey,
} from "@/lib/repo/odds";
import type { DropAnalysis } from "@/lib/drop/types";

/* ------------------------------------------------------------------ */
/* Tipi                                                                */
/* ------------------------------------------------------------------ */

export interface DetectionOutcome {
  matchId: number;
  market: MarketType;
  selection: SelectionCode;
  /** azione eseguita sulla riga di drop_signals */
  action: "created" | "updated" | "unchanged" | "skipped";
  signalId: number | null;
  status: SignalStatus | null;
  confidenceScore: number;
  deltaPp: number;
  /** motivo se `skipped` */
  reason: string | null;
}

export interface DetectionSummary {
  matchesProcessed: number;
  marketsAnalyzed: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  gapsRecorded: number;
  outcomes: DetectionOutcome[];
  errors: Array<{ matchId: number; message: string }>;
}

/* ------------------------------------------------------------------ */
/* Transizioni di stato                                                */
/* ------------------------------------------------------------------ */

/**
 * Stato del segnale a partire dall'analisi corrente.
 *
 *   forming  → movimento appena visto, non ancora consolidato nel tempo
 *   active   → movimento consolidato e ancora in essere
 *   rebounded→ il prezzo è rientrato: falso segnale parziale
 *   closed   → la partita è iniziata
 *   expired  → i dati non sono più sufficienti a sostenerlo
 */
export function nextStatus(
  analysis: DropAnalysis,
  kickoffAt: Date,
  now: Date,
  previous: SignalStatus | null,
): SignalStatus {
  // una volta chiuso, resta chiuso: la storia non si riscrive
  if (previous === "closed") return "closed";
  if (now.getTime() >= kickoffAt.getTime()) return "closed";
  if (analysis.persistence.rebounded) return "rebounded";
  if (analysis.coverage.score < 0.2) return "expired";
  // un movimento flash resta "forming" finché non dimostra tenuta
  if (analysis.persistence.isFlash) return "forming";
  if (!analysis.magnitude.isSignificant) {
    // era un segnale, ora è sotto soglia senza essere rientrato
    return previous ? "expired" : "forming";
  }
  return "active";
}

/** Determina il tipo di evento da registrare confrontando prima e dopo. */
export function classifyEvent(
  prev: { confidenceScore: number; status: SignalStatus } | null,
  next: { confidenceScore: number; status: SignalStatus },
): string | null {
  if (!prev) return "detected";
  if (prev.status !== next.status) {
    if (next.status === "rebounded") return "rebounded";
    if (next.status === "closed") return "closed";
    if (next.status === "expired") return "expired";
    return `status:${next.status}`;
  }
  const delta = next.confidenceScore - prev.confidenceScore;
  if (delta >= 5) return "strengthened";
  if (delta <= -5) return "weakened";
  return null; // variazione non rilevante: non sporchiamo l'audit trail
}

/* ------------------------------------------------------------------ */
/* Registrazione dei buchi dati                                        */
/* ------------------------------------------------------------------ */

/**
 * Registra un buco dati in modo idempotente: se esiste già un gap aperto
 * con la stessa causa non ne crea un altro.
 */
export async function recordGap(params: {
  matchId: number | null;
  bookmakerId?: number | null;
  market?: MarketType | null;
  reason: GapReason;
  detail: string;
}): Promise<boolean> {
  const conditions = [
    params.matchId === null
      ? isNull(dataGaps.matchId)
      : eq(dataGaps.matchId, params.matchId),
    eq(dataGaps.reason, params.reason),
    eq(dataGaps.resolved, false),
  ];
  if (params.market) conditions.push(eq(dataGaps.market, params.market));

  const existing = await db
    .select({ id: dataGaps.id })
    .from(dataGaps)
    .where(and(...conditions))
    .limit(1);

  if (existing.length > 0) return false;

  await db.insert(dataGaps).values({
    matchId: params.matchId,
    bookmakerId: params.bookmakerId ?? null,
    market: params.market ?? null,
    reason: params.reason,
    detail: params.detail,
  });
  return true;
}

/** Chiude i gap che non sono più osservati per una partita/mercato. */
export async function resolveGaps(
  matchId: number,
  market: MarketType,
  reasons: GapReason[],
): Promise<void> {
  if (reasons.length === 0) return;
  await db
    .update(dataGaps)
    .set({ resolved: true, observedTo: new Date() })
    .where(
      and(
        eq(dataGaps.matchId, matchId),
        eq(dataGaps.market, market),
        eq(dataGaps.resolved, false),
        inArray(dataGaps.reason, reasons),
      ),
    );
}

/**
 * Traduce la copertura dell'analisi in buchi dati registrabili.
 * Non inventa: deriva solo da ciò che il motore ha realmente osservato.
 */
export function gapsFromAnalysis(
  analysis: DropAnalysis,
): Array<{ reason: GapReason; detail: string }> {
  const out: Array<{ reason: GapReason; detail: string }> = [];
  const cov = analysis.coverage;

  if (cov.booksObserved < cov.booksExpected) {
    out.push({
      reason: "bookmaker_missing",
      detail: `${cov.booksObserved} bookmaker osservati su ${cov.booksExpected} attesi.`,
    });
  }
  if (cov.staleSeries > 0) {
    out.push({
      reason: "stale_snapshot",
      detail: `${cov.staleSeries} serie con snapshot non aggiornati.`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Upsert del segnale                                                  */
/* ------------------------------------------------------------------ */

/** Confronta il numerico persistito con quello calcolato, con tolleranza. */
function changed(a: number | null, b: number, tol = 0.01): boolean {
  if (a === null) return true;
  return Math.abs(a - b) > tol;
}

/**
 * Scrive o aggiorna un segnale.
 * Il prezzo di rilevamento viene fissato alla creazione e mai più toccato.
 */
export async function upsertSignal(
  analysis: DropAnalysis,
  kickoffAt: Date,
  now: Date,
): Promise<DetectionOutcome> {
  const base: DetectionOutcome = {
    matchId: analysis.matchId,
    market: analysis.market,
    selection: analysis.selection,
    action: "skipped",
    signalId: null,
    status: null,
    confidenceScore: analysis.confidenceScore,
    deltaPp: analysis.magnitude.deltaPp,
    reason: analysis.rejectionReason,
  };

  const [existing] = await db
    .select()
    .from(dropSignals)
    .where(
      and(
        eq(dropSignals.matchId, analysis.matchId),
        eq(dropSignals.market, analysis.market),
        eq(dropSignals.selection, analysis.selection),
      ),
    )
    .limit(1);

  // niente segnale e niente da aggiornare: non creiamo rumore nel DB
  if (!existing && !analysis.qualifiesAsSignal) return base;

  const status = nextStatus(
    analysis,
    kickoffAt,
    now,
    (existing?.status as SignalStatus | undefined) ?? null,
  );

  const common = {
    openingPrice: analysis.magnitude.openingPrice.toFixed(3),
    currentPrice: analysis.magnitude.currentPrice.toFixed(3),
    openingProb: analysis.magnitude.openingProb.toFixed(6),
    currentProb: analysis.magnitude.currentProb.toFixed(6),
    deltaPp: analysis.magnitude.deltaPp.toFixed(2),
    magnitudeClass: analysis.magnitude.magnitudeClass,
    booksTotal: analysis.coordination.booksTotal,
    booksConfirming: analysis.coordination.booksConfirming,
    coordinationScore: analysis.coordination.coordinationScore.toFixed(3),
    sharpAvailable: analysis.sharp.available,
    sharpConfirms: analysis.sharp.confirms,
    sharpDeltaPp:
      analysis.sharp.deltaPp === null ? null : analysis.sharp.deltaPp.toFixed(2),
    firstMoveAt: analysis.persistence.firstMoveAt,
    lastMoveAt: analysis.persistence.lastMoveAt,
    sustainedMinutes: analysis.persistence.sustainedMinutes,
    isFlash: analysis.persistence.isFlash,
    rebounded: analysis.persistence.rebounded,
    retracementRatio: analysis.persistence.retracementRatio.toFixed(3),
    confidenceScore: analysis.confidenceScore.toFixed(2),
    confidenceBand: analysis.confidenceBand,
    dataCoverage: analysis.coverage.score.toFixed(3),
    explanation: analysis.explanation,
    status,
    updatedAt: now,
    engineVersion: ENGINE_VERSION,
  };

  /* --- creazione --- */
  if (!existing) {
    const [row] = await db
      .insert(dropSignals)
      .values({
        matchId: analysis.matchId,
        market: analysis.market,
        selection: analysis.selection,
        // prezzo congelato: riferimento immutabile per il CLV
        detectedPrice: analysis.magnitude.currentPrice.toFixed(3),
        detectedProb: analysis.magnitude.currentProb.toFixed(6),
        detectedAt: now,
        ...common,
      })
      .returning({ id: dropSignals.id });

    await db.insert(signalEvents).values({
      signalId: row.id,
      at: now,
      kind: "detected",
      deltaPp: analysis.magnitude.deltaPp.toFixed(2),
      confidenceScore: analysis.confidenceScore.toFixed(2),
      note: analysis.explanation.summary,
      payload: {
        magnitudeClass: analysis.magnitude.magnitudeClass,
        booksConfirming: analysis.coordination.booksConfirming,
        sharpConfirms: analysis.sharp.confirms,
      },
    });

    return {
      ...base,
      action: "created",
      signalId: row.id,
      status,
      reason: null,
    };
  }

  /* --- aggiornamento --- */
  const prevScore = num(existing.confidenceScore) ?? 0;
  const prevDelta = num(existing.deltaPp) ?? 0;
  const isMaterial =
    changed(prevScore, analysis.confidenceScore, 0.5) ||
    changed(prevDelta, analysis.magnitude.deltaPp, 0.05) ||
    existing.status !== status;

  if (!isMaterial) {
    return {
      ...base,
      action: "unchanged",
      signalId: existing.id,
      status: existing.status as SignalStatus,
      reason: null,
    };
  }

  // detectedPrice deliberatamente assente da `common`: resta quello originale
  await db
    .update(dropSignals)
    .set(common)
    .where(eq(dropSignals.id, existing.id));

  const eventKind = classifyEvent(
    { confidenceScore: prevScore, status: existing.status as SignalStatus },
    { confidenceScore: analysis.confidenceScore, status },
  );

  if (eventKind) {
    await db.insert(signalEvents).values({
      signalId: existing.id,
      at: now,
      kind: eventKind,
      deltaPp: analysis.magnitude.deltaPp.toFixed(2),
      confidenceScore: analysis.confidenceScore.toFixed(2),
      note: analysis.explanation.summary,
      payload: {
        previousScore: prevScore,
        previousStatus: existing.status,
        newStatus: status,
      },
    });
  }

  return {
    ...base,
    action: "updated",
    signalId: existing.id,
    status,
    reason: null,
  };
}

/* ------------------------------------------------------------------ */
/* Esecuzione su una partita                                           */
/* ------------------------------------------------------------------ */

/** Analizza tutti i mercati osservati di una partita e persiste gli esiti. */
export async function detectForMatch(
  matchId: number,
  kickoffAt: Date,
  now: Date = new Date(),
): Promise<{ outcomes: DetectionOutcome[]; gapsRecorded: number }> {
  const grouped = await getSeriesForMatch(matchId);
  const outcomes: DetectionOutcome[] = [];
  let gapsRecorded = 0;

  if (grouped.size === 0) {
    const created = await recordGap({
      matchId,
      reason: "provider_unavailable",
      detail: "Nessuna quotazione disponibile per questa partita.",
    });
    return { outcomes, gapsRecorded: created ? 1 : 0 };
  }

  for (const [key, series] of grouped) {
    const { market, selection } = parseMarketKey(key);
    const expectedBookmakers = await getExpectedBookmakerCount(market);

    const analysis = analyzeDrop({
      matchId,
      market,
      selection,
      kickoffAt,
      now,
      series,
      expectedBookmakers,
    });

    outcomes.push(await upsertSignal(analysis, kickoffAt, now));

    const gaps = gapsFromAnalysis(analysis);
    for (const g of gaps) {
      const created = await recordGap({
        matchId,
        market,
        reason: g.reason,
        detail: g.detail,
      });
      if (created) gapsRecorded += 1;
    }
    // se un buco non è più presente lo chiudiamo
    const openReasons: GapReason[] = ["bookmaker_missing", "stale_snapshot"];
    const stillOpen = new Set(gaps.map((g) => g.reason));
    await resolveGaps(
      matchId,
      market,
      openReasons.filter((r) => !stillOpen.has(r)),
    );
  }

  return { outcomes, gapsRecorded };
}

/**
 * Esecuzione su tutte le partite non ancora concluse.
 * @param now istante di riferimento, iniettabile per i test
 */
export async function detectAll(
  now: Date = new Date(),
  opts: { matchIds?: number[] } = {},
): Promise<DetectionSummary> {
  const rows = opts.matchIds
    ? await db
        .select({ id: matches.id, kickoffAt: matches.kickoffAt })
        .from(matches)
        .where(inArray(matches.id, opts.matchIds))
    : await db
        .select({ id: matches.id, kickoffAt: matches.kickoffAt })
        .from(matches)
        .where(inArray(matches.status, ["scheduled", "live"]));

  const summary: DetectionSummary = {
    matchesProcessed: 0,
    marketsAnalyzed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    gapsRecorded: 0,
    outcomes: [],
    errors: [],
  };

  for (const m of rows) {
    try {
      const { outcomes, gapsRecorded } = await detectForMatch(
        m.id,
        m.kickoffAt,
        now,
      );
      summary.matchesProcessed += 1;
      summary.marketsAnalyzed += outcomes.length;
      summary.gapsRecorded += gapsRecorded;
      for (const o of outcomes) {
        summary.outcomes.push(o);
        if (o.action === "created") summary.created += 1;
        else if (o.action === "updated") summary.updated += 1;
        else if (o.action === "unchanged") summary.unchanged += 1;
        else summary.skipped += 1;
      }
    } catch (err) {
      summary.errors.push({
        matchId: m.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

/** Rilegge un segnale persistito (utile a test e API). */
export async function getSignalRow(
  matchId: number,
  market: MarketType,
  selection: SelectionCode,
): Promise<DropSignal | null> {
  const [row] = await db
    .select()
    .from(dropSignals)
    .where(
      and(
        eq(dropSignals.matchId, matchId),
        eq(dropSignals.market, market),
        eq(dropSignals.selection, selection),
      ),
    )
    .limit(1);
  return row ?? null;
}
