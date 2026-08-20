/**
 * Repository di lettura del dettaglio partita.
 *
 * Ricostruisce il quadro completo di una singola partita a partire da ciò che
 * è realmente registrato: le rilevazioni di `odds_snapshots`, gli eventi di
 * `signal_events`, le lacune di `data_gaps`. Nessun valore viene derivato per
 * riempire un vuoto: dove il dato manca la struttura restituisce `null` e il
 * motivo, e la pagina lo dichiara.
 */
import { and, asc, desc, eq, inArray, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bookmakers,
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
  type MatchStatus,
  type SelectionCode,
  type SignalStatus,
} from "@/db/schema";
import { num } from "@/lib/drop/math";
import {
  CONFIDENCE_LABELS_IT,
  MAGNITUDE_LABELS_IT,
  MARKET_LABELS_IT,
  SELECTION_LABELS_IT,
} from "@/lib/drop/constants";
import {
  FRESHNESS_LABELS,
  SIGNAL_LEVEL_LABELS,
  freshnessOf,
  signalLevelOf,
  type DataFreshness,
  type SignalLevel,
} from "./dashboard";
import { describeDepth, seriesStats, type SeriesPoint } from "./series";
import {
  scoreComponentsView,
  scoreReachability,
  type RawScoreComponent,
  type ScoreComponentView,
} from "./score-view";

/* ------------------------------------------------------------------ */
/* Tipi della vista                                                    */
/* ------------------------------------------------------------------ */

export interface DetailPoint {
  at: string;
  price: number;
  impliedProb: number | null;
  isStale: boolean;
  source: string;
}

/** Una serie osservata su una coppia mercato/selezione. */
export interface MarketSeries {
  market: MarketType;
  marketLabel: string;
  selection: SelectionCode;
  selectionLabel: string;
  bookmakerKey: string;
  bookmakerName: string;
  isSharp: boolean;
  points: DetailPoint[];
  opening: number | null;
  current: number | null;
  peak: number | null;
  dropPct: number | null;
  shiftPp: number | null;
  pointCount: number;
  spanMinutes: number | null;
  firstAt: string | null;
  lastAt: string | null;
  depthNote: string;
  shallow: boolean;
  /** true se esiste un segnale registrato su questa coppia mercato/selezione */
  hasSignal: boolean;
}

export interface TimelineEntry {
  at: string;
  kind: string;
  label: string;
  description: string;
  deltaPp: number | null;
  confidenceScore: number | null;
  note: string | null;
}

export interface DetailSignal {
  id: number;
  status: SignalStatus;
  statusLabel: string;
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
  confidenceScore: number | null;
  confidenceBand: ConfidenceBand;
  confidenceLabel: string;
  level: SignalLevel;
  levelLabel: string;
  dataCoverage: number | null;
  booksTotal: number;
  booksConfirming: number;
  sharpAvailable: boolean;
  sharpConfirms: boolean | null;
  sustainedMinutes: number;
  isFlash: boolean;
  rebounded: boolean;
  firstMoveAt: string;
  lastMoveAt: string;
  detectedAt: string;
  updatedAt: string;
  engineVersion: string;
  summary: string;
  caveats: string[];
  missingData: string[];
  components: ScoreComponentView[];
  reachability: ReturnType<typeof scoreReachability>;
  timeline: TimelineEntry[];
  /** presente solo se il moltiplicatore di iper-reazione è applicato */
  suspicion: {
    version: string;
    multiplier: number;
    reasons: Array<{ code: string; label: string; detail: string }>;
    scoreBefore: number;
  } | null;
}

export interface DetailGap {
  id: number;
  reason: string;
  reasonLabel: string;
  detail: string | null;
  observedFrom: string;
  market: MarketType | null;
}

export interface MatchDetail {
  match: {
    id: number;
    key: string;
    homeTeam: string;
    awayTeam: string;
    league: string | null;
    country: string | null;
    kickoffAt: string;
    status: MatchStatus;
    statusLabel: string;
    homeGoals: number | null;
    awayGoals: number | null;
    settledAt: string | null;
    isDemo: boolean;
  };
  freshness: DataFreshness;
  freshnessLabel: string;
  freshnessReason: string;
  lastSnapshotAt: string | null;
  ageMinutes: number | null;
  totalSnapshots: number;
  series: MarketSeries[];
  signals: DetailSignal[];
  openGaps: DetailGap[];
  resolvedGaps: number;
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Etichette                                                           */
/* ------------------------------------------------------------------ */

export const MATCH_STATUS_LABELS: Record<string, string> = {
  scheduled: "In programma",
  live: "In corso",
  finished: "Conclusa",
  postponed: "Rinviata",
  cancelled: "Annullata",
  unknown: "Stato non noto",
};

export const SIGNAL_STATUS_LABELS: Record<string, string> = {
  forming: "In formazione",
  active: "Attivo",
  rebounded: "Rimbalzato",
  expired: "Scaduto",
  closed: "Chiuso",
};

/** Come si legge ogni transizione registrata nell'audit trail. */
const EVENT_LABELS: Record<string, { label: string; description: string }> = {
  detected: {
    label: "Rilevato",
    description:
      "Il movimento supera la soglia di rumore e viene registrato come segnale osservato.",
  },
  strengthened: {
    label: "Rafforzato",
    description:
      "Un ricalcolo successivo ha alzato l'indice di almeno 5 punti.",
  },
  weakened: {
    label: "Indebolito",
    description:
      "Un ricalcolo successivo ha abbassato l'indice di almeno 5 punti.",
  },
  rebounded: {
    label: "Rimbalzato",
    description:
      "La quota è rientrata verso il livello di apertura: il movimento si è rivelato falso in tutto o in parte.",
  },
  expired: {
    label: "Scaduto",
    description:
      "La copertura dei dati è scesa sotto la soglia minima: il segnale non è più sostenuto da osservazioni sufficienti.",
  },
  closed: {
    label: "Chiuso",
    description:
      "La partita ha superato il calcio d'inizio: il segnale non viene più aggiornato.",
  },
};

function describeEvent(kind: string): { label: string; description: string } {
  const known = EVENT_LABELS[kind];
  if (known) return known;
  if (kind.startsWith("status:")) {
    const to = kind.slice("status:".length);
    return {
      label: `Passaggio a ${SIGNAL_STATUS_LABELS[to] ?? to}`,
      description: "Cambio di stato registrato dal motore.",
    };
  }
  return { label: kind, description: "Evento registrato dal motore." };
}

const GAP_REASON_LABELS: Record<string, string> = {
  provider_unavailable: "fonte non raggiungibile",
  market_not_offered: "mercato non quotato dalla fonte",
  bookmaker_missing: "quote per singolo bookmaker non pubblicate",
  stale_snapshot: "rilevazione più vecchia della soglia",
  parse_error: "lettura della pagina fallita",
  rate_limited: "limite di richieste raggiunto",
};

function toIso(d: Date | string | null): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function toIsoReq(d: Date | string): string {
  return toIso(d) ?? "";
}

/* ------------------------------------------------------------------ */
/* Query                                                               */
/* ------------------------------------------------------------------ */

/**
 * Dettaglio completo di una partita.
 * @returns null se la partita non esiste: la pagina risponde 404, non finge.
 */
export async function getMatchDetail(
  matchId: number,
  now = new Date(),
): Promise<MatchDetail | null> {
  if (!Number.isInteger(matchId) || matchId <= 0) return null;

  const [row] = await db
    .select({
      match: matches,
      leagueName: leagues.name,
      leagueCountry: leagues.country,
    })
    .from(matches)
    .leftJoin(leagues, eq(leagues.id, matches.leagueId))
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!row) return null;

  const m = row.match;

  const [snapshotRows, signalRows, gapRows, teamRows] = await Promise.all([
    db
      .select({
        market: oddsSnapshots.market,
        selection: oddsSnapshots.selection,
        price: oddsSnapshots.price,
        impliedProb: oddsSnapshots.impliedProb,
        collectedAt: oddsSnapshots.collectedAt,
        isStale: oddsSnapshots.isStale,
        source: oddsSnapshots.source,
        bookmakerKey: bookmakers.key,
        bookmakerName: bookmakers.name,
        isSharp: bookmakers.isSharp,
      })
      .from(oddsSnapshots)
      .innerJoin(bookmakers, eq(bookmakers.id, oddsSnapshots.bookmakerId))
      .where(eq(oddsSnapshots.matchId, matchId))
      .orderBy(asc(oddsSnapshots.collectedAt)),
    db
      .select()
      .from(dropSignals)
      .where(eq(dropSignals.matchId, matchId))
      .orderBy(desc(dropSignals.confidenceScore)),
    db
      .select()
      .from(dataGaps)
      .where(eq(dataGaps.matchId, matchId))
      .orderBy(desc(dataGaps.observedFrom)),
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, [m.homeTeamId, m.awayTeamId])),
  ]);

  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));

  /* --- eventi di tutti i segnali della partita, in una sola query --- */
  const signalIds = signalRows.map((s) => s.id);
  const eventRows = signalIds.length
    ? await db
        .select()
        .from(signalEvents)
        .where(inArray(signalEvents.signalId, signalIds))
        .orderBy(asc(signalEvents.at))
    : [];

  const eventsBySignal = new Map<number, TimelineEntry[]>();
  for (const e of eventRows) {
    const { label, description } = describeEvent(e.kind);
    const entry: TimelineEntry = {
      at: toIsoReq(e.at),
      kind: e.kind,
      label,
      description,
      deltaPp: num(e.deltaPp),
      confidenceScore: num(e.confidenceScore),
      note: e.note,
    };
    const list = eventsBySignal.get(e.signalId);
    if (list) list.push(entry);
    else eventsBySignal.set(e.signalId, [entry]);
  }

  /* --- serie storiche, raggruppate per mercato/selezione/bookmaker --- */
  const grouped = new Map<
    string,
    {
      market: MarketType;
      selection: SelectionCode;
      bookmakerKey: string;
      bookmakerName: string;
      isSharp: boolean;
      points: DetailPoint[];
      raw: SeriesPoint[];
    }
  >();

  for (const r of snapshotRows) {
    const price = num(r.price);
    if (price === null) continue;
    const k = `${r.market}|${r.selection}|${r.bookmakerKey}`;
    let g = grouped.get(k);
    if (!g) {
      g = {
        market: r.market,
        selection: r.selection,
        bookmakerKey: r.bookmakerKey,
        bookmakerName: r.bookmakerName,
        isSharp: r.isSharp,
        points: [],
        raw: [],
      };
      grouped.set(k, g);
    }
    g.points.push({
      at: toIsoReq(r.collectedAt),
      price,
      impliedProb: num(r.impliedProb),
      isStale: r.isStale,
      source: r.source,
    });
    g.raw.push({ at: r.collectedAt, price });
  }

  const signalKeys = new Set(
    signalRows.map((s) => `${s.market}|${s.selection}`),
  );

  const series: MarketSeries[] = [...grouped.values()]
    .map((g) => {
      const stats = seriesStats(g.raw);
      const depth = describeDepth(stats, now);
      return {
        market: g.market,
        marketLabel: MARKET_LABELS_IT[g.market] ?? g.market,
        selection: g.selection,
        selectionLabel: SELECTION_LABELS_IT[g.selection] ?? g.selection,
        bookmakerKey: g.bookmakerKey,
        bookmakerName: g.bookmakerName,
        isSharp: g.isSharp,
        points: g.points,
        opening: stats.opening,
        current: stats.current,
        peak: stats.peak,
        dropPct: stats.dropPct,
        shiftPp: stats.shiftPp,
        pointCount: stats.pointCount,
        spanMinutes: stats.spanMinutes,
        firstAt: toIso(stats.firstAt),
        lastAt: toIso(stats.lastAt),
        depthNote: depth.note,
        shallow: depth.shallow,
        hasSignal: signalKeys.has(`${g.market}|${g.selection}`),
      } satisfies MarketSeries;
    })
    /* prima le selezioni con un segnale, poi il movimento più ampio */
    .sort((a, b) => {
      if (a.hasSignal !== b.hasSignal) return a.hasSignal ? -1 : 1;
      return Math.abs(b.shiftPp ?? 0) - Math.abs(a.shiftPp ?? 0);
    });

  /* --- segnali con scomposizione dell'indice --- */
  const signals: DetailSignal[] = signalRows.map((s) => {
    const explanation = (s.explanation ?? {}) as {
      summary?: string;
      components?: RawScoreComponent[];
      missingData?: string[];
      caveats?: string[];
      suspicion?: {
        version: string;
        multiplier: number;
        reasons: Array<{ code: string; label: string; detail: string }>;
        scoreBefore: number;
      };
    };

    const seriesForSignal = series.find(
      (x) => x.market === s.market && x.selection === s.selection,
    );

    const components = scoreComponentsView(explanation.components ?? [], {
      booksTotal: s.booksTotal,
      sharpAvailable: s.sharpAvailable,
      sharpConfirms: s.sharpConfirms,
      pointCount: seriesForSignal?.pointCount ?? 0,
    });

    return {
      id: s.id,
      status: s.status as SignalStatus,
      statusLabel: SIGNAL_STATUS_LABELS[s.status] ?? s.status,
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
      confidenceScore: num(s.confidenceScore),
      confidenceBand: s.confidenceBand as ConfidenceBand,
      confidenceLabel:
        CONFIDENCE_LABELS_IT[s.confidenceBand] ?? s.confidenceBand,
      level: signalLevelOf(
        s.confidenceBand as ConfidenceBand,
        s.magnitudeClass as MagnitudeClass,
        s.status as SignalStatus,
      ),
      levelLabel:
        SIGNAL_LEVEL_LABELS[
          signalLevelOf(
            s.confidenceBand as ConfidenceBand,
            s.magnitudeClass as MagnitudeClass,
            s.status as SignalStatus,
          )
        ],
      dataCoverage: num(s.dataCoverage),
      booksTotal: s.booksTotal,
      booksConfirming: s.booksConfirming,
      sharpAvailable: s.sharpAvailable,
      sharpConfirms: s.sharpConfirms,
      sustainedMinutes: s.sustainedMinutes,
      isFlash: s.isFlash,
      rebounded: s.rebounded,
      firstMoveAt: toIsoReq(s.firstMoveAt),
      lastMoveAt: toIsoReq(s.lastMoveAt),
      detectedAt: toIsoReq(s.detectedAt),
      updatedAt: toIsoReq(s.updatedAt),
      engineVersion: s.engineVersion,
      suspicion: explanation.suspicion ?? null,
      summary: explanation.summary ?? "",
      caveats: explanation.caveats ?? [],
      missingData: explanation.missingData ?? [],
      components,
      reachability: scoreReachability(components),
      timeline: eventsBySignal.get(s.id) ?? [],
    } satisfies DetailSignal;
  });

  /* --- lacune dichiarate --- */
  const openGapRows = gapRows.filter((g) => !g.resolved);
  const openGaps: DetailGap[] = openGapRows.map((g) => ({
    id: g.id,
    reason: g.reason,
    reasonLabel: GAP_REASON_LABELS[g.reason] ?? g.reason.replace(/_/g, " "),
    detail: g.detail,
    observedFrom: toIsoReq(g.observedFrom),
    market: g.market,
  }));

  /* --- stato del dato, con la stessa regola della dashboard --- */
  const lastSnapshotAt =
    snapshotRows.length > 0
      ? snapshotRows.reduce<Date>(
          (acc, r) => (r.collectedAt > acc ? r.collectedAt : acc),
          snapshotRows[0].collectedAt,
        )
      : null;

  const fresh = freshnessOf(lastSnapshotAt, openGaps.length, now);

  return {
    match: {
      id: m.id,
      key: m.key,
      homeTeam: teamName.get(m.homeTeamId) ?? "—",
      awayTeam: teamName.get(m.awayTeamId) ?? "—",
      league: row.leagueName,
      country: row.leagueCountry,
      kickoffAt: toIsoReq(m.kickoffAt),
      status: m.status as MatchStatus,
      statusLabel: MATCH_STATUS_LABELS[m.status] ?? m.status,
      homeGoals: m.homeGoals,
      awayGoals: m.awayGoals,
      settledAt: toIso(m.settledAt),
      isDemo: m.key.startsWith("demo-") || m.key.startsWith("seed-demo"),
    },
    freshness: fresh.level,
    freshnessLabel: FRESHNESS_LABELS[fresh.level],
    freshnessReason: fresh.reason,
    lastSnapshotAt: toIso(lastSnapshotAt),
    ageMinutes: fresh.ageMinutes,
    totalSnapshots: snapshotRows.length,
    series,
    signals,
    openGaps,
    resolvedGaps: gapRows.length - openGapRows.length,
    generatedAt: now.toISOString(),
  };
}

/**
 * Elenco degli id di partita con almeno una rilevazione.
 * Usato solo per diagnostica: la pagina di dettaglio è dinamica.
 */
export async function listMonitoredMatchIds(limit = 200): Promise<number[]> {
  const rows = await db
    .select({ id: matches.id })
    .from(matches)
    .innerJoin(oddsSnapshots, eq(oddsSnapshots.matchId, matches.id))
    .where(and(raw`${matches.key} not like 'demo-%'`))
    .groupBy(matches.id)
    .limit(limit);
  return rows.map((r) => r.id);
}
