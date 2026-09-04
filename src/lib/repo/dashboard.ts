/**
 * Lettura aggregata per la dashboard dell'osservatorio.
 *
 * Nessuna logica di analisi qui: il motore ha già deciso tutto e ha scritto
 * a registro. Questo modulo legge, compone la vista e — soprattutto —
 * dichiara ciò che manca.
 *
 * Regola che governa l'intero file: se un dato non c'è, il campo è `null` e
 * accanto viaggia il motivo. Mai uno zero al posto di un'assenza, mai una
 * stima al posto di una lacuna.
 */
import { and, asc, desc, eq, gte, inArray, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clvRecords,
  collectorRuns,
  dataGaps,
  dropSignals,
  leagues,
  matches,
  oddsSnapshots,
  sourceHealth,
  teams,
  type ConfidenceBand,
  type MagnitudeClass,
  type MarketType,
  type SelectionCode,
  type SignalStatus,
} from "@/db/schema";
import { num, round } from "@/lib/drop/math";
import {
  CONFIDENCE_BANDS,
  CONFIDENCE_LABELS_IT,
  MAGNITUDE_LABELS_IT,
  MARKET_LABELS_IT,
  SELECTION_LABELS_IT,
  STALE_SNAPSHOT_MINUTES,
} from "@/lib/drop/constants";
import { SCORE_BUCKETS, scoreBucketOf, type ScoreBucketKey } from "@/lib/drop/novig";
import { WIDE_DROP_THRESHOLD } from "@/lib/drop/constants";
import {
  normalizedReachabilityScore,
  scoreComponentsView,
  scoreReachability,
  type ComponentContext,
  type RawScoreComponent,
} from "@/lib/repo/score-view";
import { getContextSummaries } from "@/lib/repo/context";
import { getNewsCounts } from "@/lib/repo/news";
import { normalizeDisplayName } from "@/lib/providers/betexplorer/parse";

/* ------------------------------------------------------------------ */
/* Soglie di lettura                                                   */
/* ------------------------------------------------------------------ */

/**
 * Sotto questo numero di osservazioni il CLV è dichiarato NON CONCLUDENTE.
 * È una soglia di prudenza deliberatamente più severa del minimo statistico
 * usato altrove (10): un campione piccolo che oscilla non prova nulla.
 */
export const CLV_INCONCLUSIVE_BELOW = 30;

/** Riga fissa che accompagna ogni numero di CLV provvisorio. */
export const CLV_MATURITY_NOTE =
  "Con campioni piccoli il CLV oscillante non prova nulla. Serve storico.";

/* ------------------------------------------------------------------ */
/* Livello del segnale                                                 */
/* ------------------------------------------------------------------ */

export type SignalLevel = "forte" | "reale" | "debole" | "nessuno";

export const SIGNAL_LEVEL_LABELS: Record<SignalLevel, string> = {
  forte: "Segnale forte",
  reale: "Segnale reale",
  debole: "Segnale debole",
  nessuno: "Nessun segnale",
};

/**
 * Traduce banda di fiducia e ampiezza in un livello leggibile.
 *
 * Non introduce una nuova metrica: è una rilettura di ciò che il motore ha
 * già calcolato. Un movimento classificato come rumore non può essere un
 * segnale, per quanto alto sia il punteggio; e senza dati sufficienti il
 * livello resta "nessuno" invece di essere indovinato.
 */
export function signalLevelOf(
  band: ConfidenceBand,
  magnitude: MagnitudeClass,
  status: SignalStatus,
): SignalLevel {
  if (magnitude === "noise") return "nessuno";
  if (band === "insufficient_data") return "nessuno";
  if (status === "rebounded" || status === "expired") return "debole";
  if (band === "high") return "forte";
  if (band === "medium") return "reale";
  return "debole";
}

/**
 * Calo percentuale della quota rispetto alla prima rilevazione, puro:
 * 1 − corrente/apertura. `null` senza i prezzi per dichiararlo, mai 0
 * per sbaglio. Soglia «drop ampio» dichiarata: 15% (R1.5, test 4).
 */
export function wideDropPctOf(
  openingPrice: number | null,
  currentPrice: number | null,
): number | null {
  if (openingPrice === null || currentPrice === null || openingPrice <= 0) {
    return null;
  }
  return round((1 - currentPrice / openingPrice) * 100, 1);
}

/* ------------------------------------------------------------------ */
/* Freschezza del dato                                                 */
/* ------------------------------------------------------------------ */

export type DataFreshness = "live" | "stale" | "partial";

export const FRESHNESS_LABELS: Record<DataFreshness, string> = {
  live: "Dati aggiornati",
  stale: "Dati fermi",
  partial: "Dati parziali",
};

/**
 * Stato del dato di una singola partita.
 *
 * `partial` prevale su tutto: un buco dichiarato è più importante della
 * freschezza, perché riguarda la completezza e non solo l'orario.
 */
export function freshnessOf(
  lastSnapshotAt: Date | null,
  openGaps: number,
  now: Date,
): { level: DataFreshness; ageMinutes: number | null; reason: string } {
  if (lastSnapshotAt === null) {
    return {
      level: "partial",
      ageMinutes: null,
      reason: "Nessuna rilevazione a registro per questa partita.",
    };
  }
  const ageMinutes = Math.max(
    0,
    Math.round((now.getTime() - lastSnapshotAt.getTime()) / 60000),
  );
  if (openGaps > 0) {
    return {
      level: "partial",
      ageMinutes,
      reason: `${openGaps} ${openGaps === 1 ? "buco dichiarato" : "buchi dichiarati"} su questa partita: il quadro è incompleto.`,
    };
  }
  if (ageMinutes > STALE_SNAPSHOT_MINUTES) {
    return {
      level: "stale",
      ageMinutes,
      reason: `Ultima rilevazione ${ageMinutes} minuti fa: oltre la soglia di ${STALE_SNAPSHOT_MINUTES}.`,
    };
  }
  return {
    level: "live",
    ageMinutes,
    reason: `Ultima rilevazione ${ageMinutes} minuti fa.`,
  };
}

/* ------------------------------------------------------------------ */
/* Tipi della vista                                                    */
/* ------------------------------------------------------------------ */

export interface DashboardSignal {
  id: number;
  matchId: number;
  status: SignalStatus;
  homeTeam: string;
  awayTeam: string;
  league: string | null;
  country: string | null;
  kickoffAt: string;
  market: MarketType;
  marketLabel: string;
  selection: SelectionCode;
  selectionLabel: string;

  /** apertura, picco del movimento e ultima rilevazione */
  openingPrice: number | null;
  peakPrice: number | null;
  currentPrice: number | null;
  /** variazione percentuale della quota, negativa se è scesa */
  dropPct: number | null;
  /** spostamento della probabilità implicita in punti percentuali */
  shiftPp: number | null;

  magnitudeClass: MagnitudeClass;
  magnitudeLabel: string;
  confidenceScore: number | null;
  confidenceBand: ConfidenceBand;
  confidenceLabel: string;
  level: SignalLevel;
  levelLabel: string;

  booksConfirming: number;
  booksTotal: number;
  /** null = non osservabile dalla fonte, non "non conferma" */
  sharpConfirms: boolean | null;
  sharpAvailable: boolean;
  sustainedMinutes: number;
  isFlash: boolean;
  rebounded: boolean;

  freshness: DataFreshness;
  freshnessLabel: string;
  freshnessReason: string;
  lastSnapshotAt: string | null;
  ageMinutes: number | null;
  openGaps: number;

  summary: string;
  updatedAt: string;

  /* --- suspicion-v2 --- */
  /** versione dell'algoritmo che ha prodotto il punteggio (v1 o suspicion-v2) */
  algorithmVersion: string;
  /** presente solo quando il moltiplicatore di iper-reazione è applicato */
  suspicion: {
    multiplier: number;
    reasons: Array<{ code: string; label: string; detail: string }>;
    scoreBefore: number;
  } | null;
  /** calo percentuale della quota rispetto all'apertura (fascia T4 se ≥15%) */
  wideDropPct: number | null;
  /** true quando il calo della quota è ≥ 15% */
  wideDrop: boolean;

  /* --- indice normalizzato (punto F) --- */
  /**
   * Indice riportato su base 100 usando SOLO i punti realmente ottenibili.
   *
   * L'indice grezzo (`confidenceScore`) resta quello di sempre e la logica
   * che lo calcola non è stata toccata: qui si cambia soltanto come si
   * LEGGE. Un 35,5 su 55 punti misurabili non è «poca fiducia», è 65 su
   * base misurabile con 45 punti non osservabili — due storie diverse che
   * il numero grezzo confondeva.
   */
  normalizedScore: number | null;
  /** punti realmente ottenibili (100 meno quelli non osservabili) */
  measurableMax: number | null;
  /** punti non osservabili per dati mancanti */
  gapMax: number | null;
  /** banda letta sulla scala normalizzata; la banda del motore resta intatta */
  normalizedBand: ConfidenceBand | null;
  normalizedLabel: string | null;

  /* --- mini-grafico (UX-3) --- */
  /**
   * Punti realmente registrati della serie del segnale, per la sparkline:
   * nessuna interpolazione e nessun punto costruito. Meno di due punti
   * significa niente grafico, non un grafico piatto per finta.
   */
  sparkline: Array<{ t: number; v: number }>;

  /* --- Contesto 360° (solo cache, mai generato dalla lista) --- */
  /** forma compatta "livello · campo · posta", null se non in cache */
  contextCompact: string | null;

  /* --- Notizie (solo cache, mai generate dalla lista) --- */
  /** quante notizie in cache, null se mai letta */
  newsCount: number | null;
  /** true quando la fonte ha detto: nessuna notizia pubblica trovata */
  newsEmpty: boolean;
}

export interface SourceRow {
  key: string;
  label: string;
  status: string;
  lastSuccessAt: string | null;
  consecutiveErrors: number;
  avgLatencyMs: number | null;
  lastErrorMessage: string | null;
  /** ultimo rate-limit subito: limite della fonte, non perdita nostra */
  lastRateLimitAt: string | null;
  lastRateLimitMessage: string | null;
  rateLimitCount: number;
  /** cooldown adattivo sui 429: istante di sblocco, null se libero */
  cooldownUntil: string | null;
  cooldownLevel: number;
}

export interface DashboardStatus {
  sources: SourceRow[];
  sourcesOk: number;
  sourcesBlocked: number;
  openGaps: number;
  gapsByReason: Array<{ reason: string; count: number }>;
  lastRun: {
    collectorKey: string;
    status: string;
    startedAt: string;
    durationMs: number | null;
    snapshotsWritten: number;
  } | null;
  lastSuccessfulRun: {
    collectorKey: string;
    startedAt: string;
  } | null;
  matchesToday: number;
  matchesMonitored: number;
  snapshotsToday: number;
  /** stato complessivo, pessimistico per scelta */
  overall: "ok" | "partial" | "blocked" | "no_data";
  overallLabel: string;
}

export interface ClvMaturity {
  sampleSize: number;
  inconclusive: boolean;
  avgClvPp: number | null;
  beatCloseCount: number;
  beatCloseRate: number | null;
  buckets: Array<{
    key: ScoreBucketKey;
    label: string;
    sampleSize: number;
    avgClvPp: number | null;
    beatCloseRate: number | null;
    inconclusive: boolean;
  }>;
  /** partite monitorate che devono ancora superare il kickoff */
  pendingClosings: number;
  nextClosingAt: string | null;
  note: string;
}

export interface DashboardFilters {
  level?: SignalLevel[];
  league?: string;
  team?: string;
  sort?: "score" | "drop" | "kickoff";
  includeDemo?: boolean;
}

export interface DashboardData {
  signals: DashboardSignal[];
  totalSignals: number;
  leagues: string[];
  status: DashboardStatus;
  clv: ClvMaturity;
  generatedAt: string;
}

/**
 * Numero massimo di punti trasportati fino alla card.
 * Il campionamento tiene sempre primo e ultimo punto e non inventa valori
 * intermedi: scarta rilevazioni, non le fonde.
 */
export const SPARKLINE_MAX_POINTS = 60;

export function downsample<T>(points: T[], max = SPARKLINE_MAX_POINTS): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round(i * step)]);
  }
  return out;
}

/**
 * Banda LETTA sulla scala normalizzata.
 *
 * Il motore continua a calcolare la sua banda sul punteggio grezzo su 100 e
 * quella logica non si tocca: è la stessa che alimenta storico, v2 e CLV.
 * Qui si risponde a un'altra domanda — «rispetto a ciò che era misurabile,
 * quanto è alto questo indice?» — e la risposta usa le stesse tre soglie del
 * motore applicate alla percentuale sulla base misurabile. Senza di questa,
 * un 48,76 su 55 (l'89% del misurabile) restava etichettato «bassa» perché
 * confrontato con una scala che comprendeva punti non osservabili.
 */
export function normalizedBandOf(
  normalizedScore: number | null,
): ConfidenceBand | null {
  if (normalizedScore === null) return null;
  if (normalizedScore >= CONFIDENCE_BANDS.high) return "high";
  if (normalizedScore >= CONFIDENCE_BANDS.medium) return "medium";
  return "low";
}

/** Le soglie, dichiarate una volta sola per legenda e tooltip. */
export const NORMALIZED_BAND_NOTE = `Sulla base misurabile: alta da ${CONFIDENCE_BANDS.high}, media da ${CONFIDENCE_BANDS.medium}, altrimenti bassa.`;

/**
 * Normalizzazione dell'indice sulla base misurabile.
 *
 * Non ricalcola nulla: prende i componenti già scritti a registro dal motore,
 * separa i punti non osservabili (GAP) da quelli misurati e riporta il
 * punteggio ottenuto sulla scala di ciò che era davvero ottenibile.
 * Senza scomposizione a registro restituisce `null` su tutto: meglio nessun
 * numero che un numero costruito su una base ipotizzata.
 */
export function normalizedOf(
  components: RawScoreComponent[],
  rawScore: number | null,
  ctx: ComponentContext,
): {
  normalizedScore: number | null;
  measurableMax: number | null;
  gapMax: number | null;
  normalizedBand: ConfidenceBand | null;
  normalizedLabel: string | null;
} {
  const vuoto = {
    normalizedScore: null,
    measurableMax: null,
    gapMax: null,
    normalizedBand: null,
    normalizedLabel: null,
  };
  if (components.length === 0) return vuoto;
  const views = scoreComponentsView(components, ctx);
  const reach = scoreReachability(views);
  if (reach.measurableMax <= 0) {
    return {
      ...vuoto,
      measurableMax: reach.measurableMax,
      gapMax: reach.gapMax,
    };
  }
  const normalizedScore = normalizedReachabilityScore(reach, rawScore);
  const normalizedBand = normalizedBandOf(normalizedScore);
  return {
    normalizedScore,
    measurableMax: reach.measurableMax,
    gapMax: reach.gapMax,
    normalizedBand,
    normalizedLabel:
      normalizedBand === null ? null : CONFIDENCE_LABELS_IT[normalizedBand],
  };
}

function toIso(d: Date | string | null): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/* ------------------------------------------------------------------ */
/* Pannello "Stato dati"                                               */
/* ------------------------------------------------------------------ */

export async function getDashboardStatus(now = new Date()): Promise<DashboardStatus> {
  /* "Oggi" è la giornata civile italiana, non quella UTC: il confronto di date
     lo fa PostgreSQL, che conosce il fuso e l'ora legale meglio di noi. */
  const sameRomeDay = raw`(${matches.kickoffAt} at time zone 'Europe/Rome')::date
      = (${now.toISOString()}::timestamptz at time zone 'Europe/Rome')::date`;
  const snapshotToday = raw`(${oddsSnapshots.collectedAt} at time zone 'Europe/Rome')::date
      = (${now.toISOString()}::timestamptz at time zone 'Europe/Rome')::date`;

  const [sources, gaps, runs, okRuns, todayMatches, monitored, todaySnaps] =
    await Promise.all([
      db.select().from(sourceHealth).orderBy(sourceHealth.sourceKey),
      db
        .select({ reason: dataGaps.reason, n: raw<number>`count(*)::int` })
        .from(dataGaps)
        .where(eq(dataGaps.resolved, false))
        .groupBy(dataGaps.reason),
      db.select().from(collectorRuns).orderBy(desc(collectorRuns.id)).limit(1),
      db
        .select()
        .from(collectorRuns)
        .where(eq(collectorRuns.status, "success"))
        .orderBy(desc(collectorRuns.id))
        .limit(1),
      db
        .select({ n: raw<number>`count(*)::int` })
        .from(matches)
        .where(and(raw`${matches.key} not like 'demo-%'`, sameRomeDay)),
      db
        .select({ n: raw<number>`count(distinct ${matches.id})::int` })
        .from(matches)
        .innerJoin(oddsSnapshots, eq(oddsSnapshots.matchId, matches.id))
        .where(raw`${matches.key} not like 'demo-%'`),
      db
        .select({ n: raw<number>`count(*)::int` })
        .from(oddsSnapshots)
        .innerJoin(matches, eq(matches.id, oddsSnapshots.matchId))
        .where(and(raw`${matches.key} not like 'demo-%'`, snapshotToday)),
    ]);

  const sourceRows: SourceRow[] = sources.map((s) => ({
    key: s.sourceKey,
    label: s.label,
    status: s.status,
    lastSuccessAt: toIso(s.lastSuccessAt),
    consecutiveErrors: s.consecutiveErrors,
    avgLatencyMs: s.avgLatencyMs,
    lastErrorMessage: s.lastErrorMessage,
    lastRateLimitAt: toIso(s.lastRateLimitAt),
    lastRateLimitMessage: s.lastRateLimitMessage,
    rateLimitCount: s.rateLimitCount,
    cooldownUntil: toIso(s.cooldownUntil),
    cooldownLevel: s.cooldownLevel,
  }));

  /* "disabled" non è un guasto: è una scelta di configurazione.
     Il rosso «FONTE BLOCCATA» si usa SOLO quando l'ultimo giro ha perso
     dati reali per colpa della fonte: circuito aperto (errori consecutivi)
     o giro fallito. Una fonte degradata, in cooldown per 429 o un giro
     parziale PER NOSTRA SCELTA (tetti, TTL, quote stabili saltate) è
     «DATI PARZIALI», ambra: dichiarato, non urlato. */
  const hardBlocked = sourceRows.filter((s) => s.status === "blocked");
  const degraded = sourceRows.filter(
    (s) => s.status === "degraded" || (s.cooldownUntil !== null && new Date(s.cooldownUntil) > now),
  );
  const okCount = sourceRows.filter((s) => s.status === "ok").length;
  const openGaps = gaps.reduce((a, g) => a + g.n, 0);
  const lastRun = runs[0] ?? null;
  const lastOk = okRuns[0] ?? null;

  let overall: DashboardStatus["overall"];
  let overallLabel: string;

  if (sourceRows.length === 0 || (todaySnaps[0]?.n ?? 0) === 0) {
    overall = "no_data";
    overallLabel =
      sourceRows.length === 0
        ? "NESSUNA FONTE INTERROGATA — il monitor non ha ancora raccolto dati reali."
        : "NESSUNA RILEVAZIONE OGGI — l'ultima raccolta riuscita è precedente a oggi.";
  } else if (hardBlocked.length > 0 || lastRun?.status === "failed") {
    overall = "blocked";
    overallLabel = `FONTE BLOCCATA — ${hardBlocked.map((s) => s.label).join(", ") || "ultimo giro fallito"}. I dati mostrati sono incompleti.`;
  } else if (degraded.length > 0) {
    overall = "partial";
    const cooling = degraded.filter(
      (s) => s.cooldownUntil !== null && new Date(s.cooldownUntil) > now,
    );
    overallLabel =
      cooling.length > 0
        ? `DATI PARZIALI — fonte in cooldown per 429 (riparte entro ${Math.max(1, Math.ceil((new Date(cooling[0].cooldownUntil!).getTime() - now.getTime()) / 60000))} min). Giro di rete sospeso per cortesia verso la fonte.`
        : "DATI PARZIALI — fonte degradata: legge lentamente o in parte. I buchi sono dichiarati, non stimati.";
  } else if (openGaps > 0) {
    overall = "partial";
    overallLabel =
      "DATI PARZIALI — alcune informazioni non sono disponibili. I buchi sono dichiarati, non stimati.";
  } else {
    overall = "ok";
    overallLabel = "Raccolta regolare rispetto alle fonti configurate.";
  }

  return {
    sources: sourceRows,
    sourcesOk: okCount,
    sourcesBlocked: hardBlocked.length,
    openGaps,
    gapsByReason: gaps.map((g) => ({ reason: g.reason, count: g.n })),
    lastRun: lastRun
      ? {
          collectorKey: lastRun.collectorKey,
          status: lastRun.status,
          startedAt: toIso(lastRun.startedAt)!,
          durationMs: lastRun.durationMs,
          snapshotsWritten: lastRun.snapshotsWritten,
        }
      : null,
    lastSuccessfulRun: lastOk
      ? { collectorKey: lastOk.collectorKey, startedAt: toIso(lastOk.startedAt)! }
      : null,
    matchesToday: todayMatches[0]?.n ?? 0,
    matchesMonitored: monitored[0]?.n ?? 0,
    snapshotsToday: todaySnaps[0]?.n ?? 0,
    overall,
    overallLabel,
  };
}

/* ------------------------------------------------------------------ */
/* Lista dei segnali                                                   */
/* ------------------------------------------------------------------ */

/**
 * Segnali con il contesto della partita, l'ultima rilevazione e il picco
 * del movimento.
 *
 * Il "picco" è il prezzo estremo realmente osservato nella direzione del
 * movimento: per un drop è il minimo delle quote registrate. Non è
 * ricostruito né interpolato — se non ci sono snapshot, resta null.
 */
export async function getDashboardSignals(
  filters: DashboardFilters = {},
  now = new Date(),
): Promise<{ items: DashboardSignal[]; total: number; leagues: string[] }> {
  const conditions = [];
  if (!filters.includeDemo) {
    conditions.push(raw`${matches.key} not like 'demo-%'`);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      signal: dropSignals,
      matchId: matches.id,
      matchKey: matches.key,
      kickoffAt: matches.kickoffAt,
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
    .limit(200);

  if (rows.length === 0) {
    return { items: [], total: 0, leagues: [] };
  }

  const matchIds = [...new Set(rows.map((r) => r.matchId))];
  const teamIds = [...new Set(rows.flatMap((r) => [r.homeTeamId, r.awayTeamId]))];

  const [teamRows, sparkRows, snapAgg, gapRows] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, teamIds)),
    /* serie storica compatta per il mini-grafico di card: gli stessi punti
       di odds_snapshots usati dal dettaglio, media fra bookmaker sullo stesso
       istante (la fonte pubblica una linea di consenso). Nessuna raccolta
       nuova: è lettura dell'archivio. */
    db
      .select({
        matchId: oddsSnapshots.matchId,
        market: oddsSnapshots.market,
        selection: oddsSnapshots.selection,
        collectedAt: oddsSnapshots.collectedAt,
        price: raw<string>`avg(${oddsSnapshots.price})`,
      })
      .from(oddsSnapshots)
      .where(inArray(oddsSnapshots.matchId, matchIds))
      .groupBy(
        oddsSnapshots.matchId,
        oddsSnapshots.market,
        oddsSnapshots.selection,
        oddsSnapshots.collectedAt,
      )
      .orderBy(asc(oddsSnapshots.collectedAt)),
    /* ultima rilevazione e prezzo minimo per (partita, mercato, selezione) */
    db
      .select({
        matchId: oddsSnapshots.matchId,
        market: oddsSnapshots.market,
        selection: oddsSnapshots.selection,
        lastAt: raw<Date>`max(${oddsSnapshots.collectedAt})`,
        minPrice: raw<string>`min(${oddsSnapshots.price})`,
        maxPrice: raw<string>`max(${oddsSnapshots.price})`,
        n: raw<number>`count(*)::int`,
      })
      .from(oddsSnapshots)
      .where(inArray(oddsSnapshots.matchId, matchIds))
      .groupBy(
        oddsSnapshots.matchId,
        oddsSnapshots.market,
        oddsSnapshots.selection,
      ),
    db
      .select({ matchId: dataGaps.matchId, n: raw<number>`count(*)::int` })
      .from(dataGaps)
      .where(and(eq(dataGaps.resolved, false), inArray(dataGaps.matchId, matchIds)))
      .groupBy(dataGaps.matchId),
  ]);

  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));
  const gapsByMatch = new Map(gapRows.map((g) => [g.matchId, g.n]));
  const contextByMatch = await getContextSummaries(matchIds);
  const newsByMatch = await getNewsCounts(matchIds);
  const snapByKey = new Map(
    snapAgg.map((s) => [`${s.matchId}::${s.market}::${s.selection}`, s]),
  );

  /* punti della sparkline, già ordinati dalla query */
  const sparkByKey = new Map<string, Array<{ t: number; v: number }>>();
  for (const r of sparkRows) {
    const v = num(r.price);
    if (v === null || v <= 0) continue;
    const t = new Date(r.collectedAt).getTime();
    if (!Number.isFinite(t)) continue;
    const k = `${r.matchId}::${r.market}::${r.selection}`;
    const list = sparkByKey.get(k);
    if (list) list.push({ t, v });
    else sparkByKey.set(k, [{ t, v }]);
  }

  const items: DashboardSignal[] = rows.map((r) => {
    const s = r.signal;
    const explanation = (s.explanation ?? {}) as {
      summary?: string;
      components?: RawScoreComponent[];
      suspicion?: {
        multiplier: number;
        reasons: Array<{ code: string; label: string; detail: string }>;
        scoreBefore: number;
      };
    };
    const snap = snapByKey.get(`${r.matchId}::${s.market}::${s.selection}`);
    const openGaps = gapsByMatch.get(r.matchId) ?? 0;

    const opening = num(s.openingPrice);
    const current = num(s.currentPrice);
    const deltaPp = num(s.deltaPp);

    /* Il picco è il prezzo estremo osservato nella direzione del movimento.
       deltaPp > 0 significa probabilità in aumento, cioè quota in discesa. */
    const observedMin = snap ? num(snap.minPrice) : null;
    const observedMax = snap ? num(snap.maxPrice) : null;
    const peak =
      deltaPp === null ? null : deltaPp >= 0 ? observedMin : observedMax;

    const dropPct =
      opening !== null && current !== null && opening > 0
        ? round((current / opening - 1) * 100, 2)
        : null;

    /* il calo in % sulla quota (fascia del test T4), distinto dal segno */
    const wideDropPct = wideDropPctOf(opening, current);

    const lastAt = snap?.lastAt ? new Date(snap.lastAt) : null;
    const fresh = freshnessOf(lastAt, openGaps, now);

    const band = s.confidenceBand as ConfidenceBand;
    const magnitude = s.magnitudeClass as MagnitudeClass;
    const status = s.status as SignalStatus;
    /* L'indice normalizzato si calcola prima del livello: il livello letto in
       pagina e l'etichetta dell'indice devono derivare dalla stessa scala,
       altrimenti la stessa carta dice «debole» nel badge e «media» nell'indice.
       La banda grezza del motore resta per il CLV storico. */
    const normalized = normalizedOf(explanation.components ?? [], num(s.confidenceScore), {
      booksTotal: s.booksTotal,
      sharpAvailable: s.sharpAvailable,
      sharpConfirms: s.sharpConfirms,
      pointCount: snap?.n ?? 0,
    });
    const level = signalLevelOf(normalized.normalizedBand ?? band, magnitude, status);

    return {
      id: s.id,
      matchId: r.matchId,
      status,
      homeTeam: teamName.get(r.homeTeamId) ?? "—",
      awayTeam: teamName.get(r.awayTeamId) ?? "—",
      league: normalizeDisplayName(r.leagueName),
      country: normalizeDisplayName(r.leagueCountry),
      kickoffAt: toIso(r.kickoffAt)!,
      market: s.market,
      marketLabel: MARKET_LABELS_IT[s.market] ?? s.market,
      selection: s.selection,
      selectionLabel: SELECTION_LABELS_IT[s.selection] ?? s.selection,
      openingPrice: opening,
      peakPrice: peak,
      currentPrice: current,
      dropPct,
      shiftPp: deltaPp,
      magnitudeClass: magnitude,
      magnitudeLabel: MAGNITUDE_LABELS_IT[magnitude] ?? magnitude,
      confidenceScore: num(s.confidenceScore),
      confidenceBand: band,
      confidenceLabel: CONFIDENCE_LABELS_IT[band] ?? band,
      level,
      levelLabel: SIGNAL_LEVEL_LABELS[level],
      booksConfirming: s.booksConfirming,
      booksTotal: s.booksTotal,
      sharpConfirms: s.sharpConfirms,
      sharpAvailable: s.sharpAvailable,
      sustainedMinutes: s.sustainedMinutes,
      isFlash: s.isFlash,
      rebounded: s.rebounded,
      freshness: fresh.level,
      freshnessLabel: FRESHNESS_LABELS[fresh.level],
      freshnessReason: fresh.reason,
      lastSnapshotAt: toIso(lastAt),
      ageMinutes: fresh.ageMinutes,
      openGaps,
      summary: explanation.summary ?? "",
      updatedAt: toIso(s.updatedAt)!,
      algorithmVersion: s.engineVersion,
      suspicion: explanation.suspicion ?? null,
      wideDropPct,
      wideDrop: wideDropPct !== null && wideDropPct >= WIDE_DROP_THRESHOLD * 100,
      ...normalized,
      sparkline: downsample(
        sparkByKey.get(`${r.matchId}::${s.market}::${s.selection}`) ?? [],
      ),
      contextCompact: (() => {
        const c = contextByMatch.get(r.matchId);
        if (c === undefined) return null;
        return [c.livelloCategorie, c.anomaliaCampo, c.postaInPalo]
          .map((x) => x.trim())
          .filter((x) => x.length > 0 && x.toLowerCase() !== "non noto")
          .join(" · ") || null;
      })(),
      newsCount: newsByMatch.get(r.matchId)?.count ?? null,
      newsEmpty: newsByMatch.get(r.matchId)?.state === "vuoto",
    };
  });

  /* elenco competizioni prima dei filtri, così il menù non si svuota da solo */
  const leagueNames = [
    ...new Set(items.map((i) => i.league).filter((l): l is string => !!l)),
  ].sort((a, b) => a.localeCompare(b, "it"));

  let filtered = items;
  if (filters.level?.length) {
    const set = new Set(filters.level);
    filtered = filtered.filter((i) => set.has(i.level));
  }
  if (filters.league) {
    filtered = filtered.filter((i) => i.league === filters.league);
  }
  if (filters.team) {
    const q = filters.team.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(
        (i) =>
          i.homeTeam.toLowerCase().includes(q) ||
          i.awayTeam.toLowerCase().includes(q),
      );
    }
  }

  const sort = filters.sort ?? "score";
  filtered = [...filtered].sort((a, b) => {
    if (sort === "kickoff") {
      return new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime();
    }
    if (sort === "drop") {
      /* il drop più marcato è il più negativo; i valori assenti vanno in fondo */
      const av = a.dropPct ?? Number.POSITIVE_INFINITY;
      const bv = b.dropPct ?? Number.POSITIVE_INFINITY;
      return av - bv;
    }
    return (b.confidenceScore ?? -1) - (a.confidenceScore ?? -1);
  });

  return { items: filtered, total: items.length, leagues: leagueNames };
}

/* ------------------------------------------------------------------ */
/* CLV in maturazione                                                  */
/* ------------------------------------------------------------------ */

/**
 * Riepilogo del CLV pensato per essere mostrato ANCHE quando è provvisorio.
 *
 * Il contratto con chi legge è esplicito: sotto le 30 osservazioni il dato
 * è marcato non concludente e non deve mai essere usato per costruire
 * classifiche o affermazioni di merito.
 */
export async function getClvMaturity(now = new Date()): Promise<ClvMaturity> {
  const [records, pending] = await Promise.all([
    db
      .select({
        clvPp: clvRecords.clvPp,
        beatClose: clvRecords.beatClose,
        signalScore: clvRecords.signalScore,
      })
      .from(clvRecords),
    db
      .select({
        kickoffAt: raw<Date>`min(${matches.kickoffAt})`,
        n: raw<number>`count(distinct ${matches.id})::int`,
      })
      .from(matches)
      .innerJoin(oddsSnapshots, eq(oddsSnapshots.matchId, matches.id))
      .where(
        and(
          raw`${matches.key} not like 'demo-%'`,
          gte(matches.kickoffAt, now),
        ),
      ),
  ]);

  const n = records.length;
  const values = records
    .map((r) => num(r.clvPp))
    .filter((v): v is number => v !== null);
  const beat = records.filter((r) => r.beatClose).length;

  const buckets = SCORE_BUCKETS.map((b) => {
    const rows = records.filter((r) => {
      const score = num(r.signalScore);
      return score !== null && scoreBucketOf(score) === b.key;
    });
    const vals = rows
      .map((r) => num(r.clvPp))
      .filter((v): v is number => v !== null);
    return {
      key: b.key,
      label: b.label,
      sampleSize: rows.length,
      avgClvPp:
        vals.length > 0
          ? round(vals.reduce((a, v) => a + v, 0) / vals.length, 2)
          : null,
      beatCloseRate:
        rows.length > 0
          ? round(rows.filter((r) => r.beatClose).length / rows.length, 4)
          : null,
      inconclusive: rows.length < CLV_INCONCLUSIVE_BELOW,
    };
  });

  return {
    sampleSize: n,
    inconclusive: n < CLV_INCONCLUSIVE_BELOW,
    avgClvPp:
      values.length > 0
        ? round(values.reduce((a, v) => a + v, 0) / values.length, 2)
        : null,
    beatCloseCount: beat,
    beatCloseRate: n > 0 ? round(beat / n, 4) : null,
    buckets,
    pendingClosings: pending[0]?.n ?? 0,
    nextClosingAt: pending[0]?.kickoffAt ? toIso(pending[0].kickoffAt) : null,
    note: CLV_MATURITY_NOTE,
  };
}

/* ------------------------------------------------------------------ */

/** Tutto ciò che serve alla dashboard, in un solo passaggio. */
export async function getDashboardData(
  filters: DashboardFilters = {},
  now = new Date(),
): Promise<DashboardData> {
  try {
    const [signals, status, clv] = await Promise.all([
      getDashboardSignals(filters, now),
      getDashboardStatus(now),
      getClvMaturity(now),
    ]);

    return {
      signals: signals.items,
      totalSignals: signals.total,
      leagues: signals.leagues,
      status,
      clv,
      generatedAt: now.toISOString(),
    };
  } catch {
    return {
      signals: [],
      totalSignals: 0,
      leagues: [],
      status: {
        sources: [],
        sourcesOk: 0,
        sourcesBlocked: 0,
        openGaps: 0,
        gapsByReason: [],
        lastRun: null,
        lastSuccessfulRun: null,
        matchesToday: 0,
        matchesMonitored: 0,
        snapshotsToday: 0,
        overall: "no_data",
        overallLabel: "Nessun dato a registro",
      },
      clv: {
        sampleSize: 0,
        inconclusive: true,
        avgClvPp: null,
        beatCloseCount: 0,
        beatCloseRate: null,
        buckets: [],
        pendingClosings: 0,
        nextClosingAt: null,
        note: CLV_MATURITY_NOTE,
      },
      generatedAt: now.toISOString(),
    };
  }
}
