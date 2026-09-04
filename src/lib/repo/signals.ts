/**
 * Lettura dei segnali per le API e la UI.
 * Nessuna logica di analisi qui: solo query e composizione della vista.
 */
import { and, desc, eq, gte, inArray, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clvRecords,
  dataGaps,
  dropSignals,
  leagues,
  matches,
  oddsSnapshots,
  signalEvents,
  teams,
  type ConfidenceBand,
  type MagnitudeClass,
  type MarketType,
  type SelectionCode,
  type SignalStatus,
} from "@/db/schema";
import { num } from "@/lib/drop/math";
import { normalizedOf } from "@/lib/repo/dashboard";
import type { RawScoreComponent } from "@/lib/repo/score-view";
import {
  CONFIDENCE_LABELS_IT,
  MAGNITUDE_LABELS_IT,
  MARKET_LABELS_IT,
  SELECTION_LABELS_IT,
} from "@/lib/drop/constants";

export interface SignalListItem {
  id: number;
  status: SignalStatus;
  match: {
    id: number;
    kickoffAt: string;
    homeTeam: string;
    awayTeam: string;
    league: string | null;
    country: string | null;
    isDemo: boolean;
  };
  market: MarketType;
  marketLabel: string;
  selection: SelectionCode;
  selectionLabel: string;
  openingPrice: number | null;
  currentPrice: number | null;
  detectedPrice: number | null;
  deltaPp: number | null;
  magnitudeClass: MagnitudeClass;
  magnitudeLabel: string;
  booksConfirming: number;
  booksTotal: number;
  sharpAvailable: boolean;
  /** null quando non esiste una linea sharp: assenza di dato, non smentita */
  sharpConfirms: boolean | null;
  sustainedMinutes: number | null;
  isFlash: boolean;
  rebounded: boolean;
  confidenceScore: number | null;
  confidenceBand: ConfidenceBand;
  confidenceLabel: string;
  /**
   * Indice riportato sulla base misurabile: LO STESSO numero che mostra la
   * card e che confronta la notifica push. Chi legge `/preferite` e chi
   * riceve un avviso devono poter confrontare la propria soglia con un solo
   * valore, non con due scale diverse.
   */
  normalizedScore: number | null;
  /** punti realmente ottenibili (100 meno quelli non osservabili) */
  measurableMax: number | null;
  dataCoverage: number | null;
  summary: string;
  detectedAt: string;
  updatedAt: string;
}

export interface SignalListFilters {
  status?: SignalStatus[];
  minConfidence?: number;
  market?: MarketType;
  magnitude?: MagnitudeClass[];
  includeDemo?: boolean;
  limit?: number;
  offset?: number;
}

function toIso(d: Date | string | null): string {
  if (!d) return "";
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/** Una partita è demo se la sua chiave esterna è marcata come tale. */
/** Elenco dei segnali con i dati di contesto della partita. */
export async function listSignals(
  filters: SignalListFilters = {},
): Promise<{ items: SignalListItem[]; total: number }> {
  const conditions = [];

  if (filters.status?.length) {
    conditions.push(inArray(dropSignals.status, filters.status));
  }
  if (filters.minConfidence !== undefined) {
    conditions.push(
      gte(dropSignals.confidenceScore, String(filters.minConfidence)),
    );
  }
  if (filters.market) conditions.push(eq(dropSignals.market, filters.market));
  if (filters.magnitude?.length) {
    conditions.push(inArray(dropSignals.magnitudeClass, filters.magnitude));
  }
  if (!filters.includeDemo) {
    conditions.push(raw`${matches.key} not like 'demo-%'`);
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      signal: dropSignals,
      matchId: matches.id,
      kickoffAt: matches.kickoffAt,
      matchKey: matches.key,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
      leagueName: leagues.name,
      leagueCountry: leagues.country,
    })
    .from(dropSignals)
    .innerJoin(matches, eq(matches.id, dropSignals.matchId))
    .leftJoin(leagues, eq(leagues.id, matches.leagueId))
    .where(where)
    .orderBy(desc(dropSignals.confidenceScore), desc(dropSignals.updatedAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  const [{ count }] = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(dropSignals)
    .innerJoin(matches, eq(matches.id, dropSignals.matchId))
    .where(where);

  const teamIds = [
    ...new Set(rows.flatMap((r) => [r.homeTeamId, r.awayTeamId])),
  ];
  const teamRows = teamIds.length
    ? await db
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(inArray(teams.id, teamIds))
    : [];
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));

  /* Quante rilevazioni esistono per (partita, mercato, selezione). Serve a
     decidere se la tenuta nel tempo è misurabile e quindi quanti punti
     erano davvero ottenibili: senza, l'indice normalizzato qui divergerebbe
     da quello della dashboard, che questo conteggio lo fa già. */
  const matchIds = [...new Set(rows.map((r) => r.matchId))];
  const snapRows = matchIds.length
    ? await db
        .select({
          matchId: oddsSnapshots.matchId,
          market: oddsSnapshots.market,
          selection: oddsSnapshots.selection,
          n: raw<number>`count(*)::int`,
        })
        .from(oddsSnapshots)
        .where(inArray(oddsSnapshots.matchId, matchIds))
        .groupBy(
          oddsSnapshots.matchId,
          oddsSnapshots.market,
          oddsSnapshots.selection,
        )
    : [];
  const snapCount = new Map(
    snapRows.map((r) => [`${r.matchId}::${r.market}::${r.selection}`, r.n]),
  );

  const items = rows.map((r) => {
    const s = r.signal;
    const explanation = (s.explanation ?? {}) as {
      summary?: string;
      components?: RawScoreComponent[];
    };
    const normalized = normalizedOf(
      explanation.components ?? [],
      num(s.confidenceScore),
      {
        booksTotal: s.booksTotal,
        sharpAvailable: s.sharpAvailable,
        sharpConfirms: s.sharpConfirms,
        pointCount:
          snapCount.get(`${r.matchId}::${s.market}::${s.selection}`) ?? 0,
      },
    );
    return {
      id: s.id,
      status: s.status as SignalStatus,
      match: {
        id: r.matchId,
        kickoffAt: toIso(r.kickoffAt),
        homeTeam: teamName.get(r.homeTeamId) ?? "—",
        awayTeam: teamName.get(r.awayTeamId) ?? "—",
        league: r.leagueName,
        country: r.leagueCountry,
        isDemo: (r.matchKey ?? "").startsWith("demo-"),
      },
      market: s.market,
      marketLabel: MARKET_LABELS_IT[s.market] ?? s.market,
      selection: s.selection,
      selectionLabel: SELECTION_LABELS_IT[s.selection] ?? s.selection,
      openingPrice: num(s.openingPrice),
      currentPrice: num(s.currentPrice),
      detectedPrice: num(s.detectedPrice),
      deltaPp: num(s.deltaPp),
      magnitudeClass: s.magnitudeClass as MagnitudeClass,
      magnitudeLabel: MAGNITUDE_LABELS_IT[s.magnitudeClass] ?? s.magnitudeClass,
      booksConfirming: s.booksConfirming,
      booksTotal: s.booksTotal,
      sharpAvailable: s.sharpAvailable,
      sharpConfirms: s.sharpConfirms,
      sustainedMinutes: s.sustainedMinutes,
      isFlash: s.isFlash,
      rebounded: s.rebounded,
      confidenceScore: num(s.confidenceScore),
      confidenceBand: s.confidenceBand as ConfidenceBand,
      confidenceLabel:
        CONFIDENCE_LABELS_IT[s.confidenceBand] ?? s.confidenceBand,
      normalizedScore: normalized.normalizedScore,
      measurableMax: normalized.measurableMax,
      dataCoverage: num(s.dataCoverage),
      summary: explanation.summary ?? "",
      detectedAt: toIso(s.detectedAt),
      updatedAt: toIso(s.updatedAt),
    } satisfies SignalListItem;
  });

  return { items, total: count };
}

/** Dettaglio completo di un segnale: storia, spiegazione, CLV, buchi dati. */
export async function getSignalDetail(id: number) {
  const [row] = await db
    .select({
      signal: dropSignals,
      matchId: matches.id,
      kickoffAt: matches.kickoffAt,
      matchKey: matches.key,
      matchStatus: matches.status,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
      leagueName: leagues.name,
      leagueCountry: leagues.country,
    })
    .from(dropSignals)
    .innerJoin(matches, eq(matches.id, dropSignals.matchId))
    .leftJoin(leagues, eq(leagues.id, matches.leagueId))
    .where(eq(dropSignals.id, id))
    .limit(1);

  if (!row) return null;

  const s = row.signal;

  const [events, clv, gaps, teamRows] = await Promise.all([
    db
      .select()
      .from(signalEvents)
      .where(eq(signalEvents.signalId, id))
      .orderBy(signalEvents.at),
    db.select().from(clvRecords).where(eq(clvRecords.signalId, id)).limit(1),
    db
      .select()
      .from(dataGaps)
      .where(eq(dataGaps.matchId, row.matchId))
      .orderBy(desc(dataGaps.observedFrom)),
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, [row.homeTeamId, row.awayTeamId])),
  ]);

  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));
  const clvRow = clv[0];

  return {
    id: s.id,
    status: s.status,
    engineVersion: s.engineVersion,
    match: {
      id: row.matchId,
      kickoffAt: toIso(row.kickoffAt),
      status: row.matchStatus,
      homeTeam: teamName.get(row.homeTeamId) ?? "—",
      awayTeam: teamName.get(row.awayTeamId) ?? "—",
      league: row.leagueName,
      country: row.leagueCountry,
      isDemo: (row.matchKey ?? "").startsWith("demo-"),
    },
    market: s.market,
    marketLabel: MARKET_LABELS_IT[s.market] ?? s.market,
    selection: s.selection,
    selectionLabel: SELECTION_LABELS_IT[s.selection] ?? s.selection,
    magnitude: {
      openingPrice: num(s.openingPrice),
      currentPrice: num(s.currentPrice),
      detectedPrice: num(s.detectedPrice),
      openingProb: num(s.openingProb),
      currentProb: num(s.currentProb),
      deltaPp: num(s.deltaPp),
      magnitudeClass: s.magnitudeClass,
      magnitudeLabel: MAGNITUDE_LABELS_IT[s.magnitudeClass] ?? s.magnitudeClass,
    },
    coordination: {
      booksTotal: s.booksTotal,
      booksConfirming: s.booksConfirming,
      coordinationScore: num(s.coordinationScore),
    },
    sharp: {
      available: s.sharpAvailable,
      confirms: s.sharpConfirms,
      deltaPp: num(s.sharpDeltaPp),
    },
    persistence: {
      firstMoveAt: toIso(s.firstMoveAt),
      lastMoveAt: toIso(s.lastMoveAt),
      sustainedMinutes: s.sustainedMinutes,
      isFlash: s.isFlash,
      rebounded: s.rebounded,
      retracementRatio: num(s.retracementRatio),
    },
    confidence: {
      score: num(s.confidenceScore),
      band: s.confidenceBand,
      label: CONFIDENCE_LABELS_IT[s.confidenceBand] ?? s.confidenceBand,
      dataCoverage: num(s.dataCoverage),
    },
    explanation: s.explanation,
    clv: clvRow
      ? {
          signalPrice: num(clvRow.signalPrice),
          closingPrice: num(clvRow.closingPrice),
          clvPp: num(clvRow.clvPp),
          clvPct: num(clvRow.clvPct),
          beatClose: clvRow.beatClose,
        }
      : null,
    events: events.map((e) => ({
      at: toIso(e.at),
      kind: e.kind,
      deltaPp: num(e.deltaPp),
      confidenceScore: num(e.confidenceScore),
      note: e.note,
    })),
    dataGaps: gaps.map((g) => ({
      reason: g.reason,
      detail: g.detail,
      observedFrom: toIso(g.observedFrom),
      resolved: g.resolved,
    })),
    detectedAt: toIso(s.detectedAt),
    updatedAt: toIso(s.updatedAt),
  };
}
