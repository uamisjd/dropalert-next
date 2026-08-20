/**
 * Lettura dei segnali di ieri con l'esito descrittivo (Sprint 9).
 *
 * "Ieri" è la giornata civile italiana. Un segnale appartiene a ieri se
 * la partita su cui è registrato ha avuto calcio d'inizio ieri: l'esito
 * centrata/mancata si calcola dai gol finali di quella partita, nel
 * modulo puro `lib/settle/outcome` — qui si legge soltanto.
 *
 * Il CLV non viene toccato: esito e CLV misurano cose diverse e il
 * contratto della pagina è dirlo, non sommarle.
 */
import { and, desc, eq, inArray, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import {
  dataGaps,
  dropSignals,
  leagues,
  matches,
  teams,
  type ConfidenceBand,
  type MarketType,
  type SelectionCode,
  type SignalStatus,
} from "@/db/schema";
import { num } from "@/lib/drop/math";
import {
  CONFIDENCE_LABELS_IT,
  MARKET_LABELS_IT,
  SELECTION_LABELS_IT,
} from "@/lib/drop/constants";
import {
  MIN_OUTCOMES_FOR_TREND,
  OUTCOME_DISCLAIMER,
  OUTCOME_LABELS_IT,
  RESULT_GRACE_HOURS,
  isResultOverdue,
  isUnderpowered,
  outcomeOf,
  settledCount,
  tallyOutcomes,
  type OutcomeTally,
  type OutcomeVerdict,
  type SettleMarket,
  type SettleSelection,
} from "@/lib/settle/outcome";

/** Un segnale di ieri con il suo esito calcolato dai gol finali. */
export interface YesterdayItem {
  id: number;
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string | null;
  country: string | null;
  kickoffAt: string;
  status: SignalStatus;

  market: MarketType;
  marketLabel: string;
  selection: SelectionCode;
  selectionLabel: string;

  /** quota congelata al primo rilevamento: il riferimento onesto del segnale */
  detectedPrice: number | null;
  confidenceScore: number | null;
  confidenceBand: ConfidenceBand;
  confidenceLabel: string;

  homeGoals: number | null;
  awayGoals: number | null;
  verdict: OutcomeVerdict;
  verdictLabel: string;
  /**
   * true quando l'attesa è scaduta: kickoff oltre le 3 ore e ancora
   * nessun risultato. L'attesa eterna non esiste: o il risultato
   * arriva, o la fonte non l'ha pubblicato e si dichiara.
   */
  resultOverdue: boolean;
  /** motivo registrato dal collector (data_gaps), se la fonte ha dichiarato l'assenza */
  resultNote: string | null;
}

export interface YesterdayView {
  /** istante rappresentativo della giornata di ieri, per l'intestazione */
  dayIso: string;
  items: YesterdayItem[];
  tally: OutcomeTally;
  /** esiti con un risultato registrato */
  settled: number;
  /** true finché gli esiti risolti sono meno di dieci */
  underpowered: boolean;
  /** soglia dichiarata, esposta per non hardcodarla nella pagina */
  minForTrend: number;
  disclaimer: string;
  /** ore oltre le quali un'esito mancante si dichiara non pubblicato */
  graceHours: number;
  /** partite in attesa oltre la grazia: attesa scaduta, fonte che non pubblica */
  overduePending: number;
}

/**
 * Un istante a metà della giornata italiana di ieri, solo per datare
 * l'intestazione: mezzogiorno UTC ricade sempre nello stesso giorno
 * civile di Roma (UTC+1/UTC+2), quindi l'etichetta è stabile anche
     * attorno ai cambi d'ora.
 */
function romeDayShiftedIso(now: Date, days: number): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const shifted = new Date(`${ymd}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString();
}

/**
 * Legge i segnali le cui partite si sono giocate ieri.
 *
 * Nessun valore derivato: i gol arrivano da `matches`, il verdetto dal
 * modulo puro, i prezzi da ciò che il motore ha congelato al rilevamento.
 */
export async function getYesterdayView(
  now: Date = new Date(),
): Promise<YesterdayView> {
  /* la giornata è italiana, decisa da PostgreSQL che conosce fuso e ora legale */
  const isYesterday = raw`(${matches.kickoffAt} at time zone 'Europe/Rome')::date
      = (${now.toISOString()}::timestamptz at time zone 'Europe/Rome')::date - 1`;

  const rows = await db
    .select({
      signal: dropSignals,
      matchId: matches.id,
      kickoffAt: matches.kickoffAt,
      homeGoals: matches.homeGoals,
      awayGoals: matches.awayGoals,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
      leagueName: leagues.name,
      leagueCountry: leagues.country,
    })
    .from(dropSignals)
    .innerJoin(matches, eq(matches.id, dropSignals.matchId))
    .leftJoin(leagues, eq(leagues.id, matches.leagueId))
    .where(and(raw`${matches.key} not like 'demo-%'`, isYesterday))
    .orderBy(desc(dropSignals.confidenceScore), desc(dropSignals.detectedAt));

  const teamIds = [
    ...new Set(rows.flatMap((r) => [r.homeTeamId, r.awayTeamId])),
  ];

  const teamRows =
    teamIds.length > 0
      ? await db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, teamIds))
      : [];
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));

  const items: YesterdayItem[] = rows.map((r) => {
    const s = r.signal;
    const homeGoals = r.homeGoals;
    const awayGoals = r.awayGoals;

    /* il verdetto nasce qui, dai gol finali, e in nessun altro modo */
    const verdict = outcomeOf({
      market: s.market as SettleMarket,
      selection: s.selection as SettleSelection,
      homeGoals,
      awayGoals,
    });

    const band = s.confidenceBand as ConfidenceBand;

    return {
      id: s.id,
      matchId: r.matchId,
      homeTeam: teamName.get(r.homeTeamId) ?? "—",
      awayTeam: teamName.get(r.awayTeamId) ?? "—",
      league: r.leagueName,
      country: r.leagueCountry,
      kickoffAt: r.kickoffAt.toISOString(),
      status: s.status as SignalStatus,
      market: s.market as MarketType,
      marketLabel: MARKET_LABELS_IT[s.market] ?? s.market,
      selection: s.selection as SelectionCode,
      selectionLabel: SELECTION_LABELS_IT[s.selection] ?? s.selection,
      detectedPrice: num(s.detectedPrice),
      confidenceScore: num(s.confidenceScore),
      confidenceBand: band,
      confidenceLabel: CONFIDENCE_LABELS_IT[band] ?? band,
      homeGoals,
      awayGoals,
      verdict,
      verdictLabel: OUTCOME_LABELS_IT[verdict],
      resultOverdue: false,
      resultNote: null,
    };
  });

  /* il motivo delle attese scadute, dove il collector l'ha registrato */
  const overdueIds = items.filter((i) => i.verdict === "in_attesa" && isResultOverdue(i.kickoffAt, now)).map((i) => i.matchId);
  const notesByMatch = new Map<number, string>();
  if (overdueIds.length > 0) {
    const gaps = await db
      .select({ matchId: dataGaps.matchId, detail: dataGaps.detail, observedFrom: dataGaps.observedFrom })
      .from(dataGaps)
      .where(
        and(
          inArray(dataGaps.matchId, overdueIds),
          eq(dataGaps.reason, "result_not_published"),
          eq(dataGaps.resolved, false),
        ),
      );
    for (const g of gaps) {
      if (g.matchId !== null && g.detail !== null) notesByMatch.set(g.matchId, g.detail);
    }
  }

  for (const item of items) {
    if (item.verdict !== "in_attesa") continue;
    item.resultOverdue = isResultOverdue(item.kickoffAt, now);
    item.resultNote = notesByMatch.get(item.matchId) ?? null;
  }

  const tally = tallyOutcomes(items.map((i) => i.verdict));

  return {
    dayIso: romeDayShiftedIso(now, -1),
    items,
    tally,
    settled: settledCount(tally),
    underpowered: isUnderpowered(tally),
    minForTrend: MIN_OUTCOMES_FOR_TREND,
    disclaimer: OUTCOME_DISCLAIMER,
    graceHours: RESULT_GRACE_HOURS,
    overduePending: items.filter((i) => i.verdict === "in_attesa" && i.resultOverdue).length,
  };
}
