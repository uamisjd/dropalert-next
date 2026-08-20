/**
 * Lettura del programma di domani dall'archivio del monitor (Sprint 9).
 *
 * "Domani" è la giornata civile italiana. L'elenco non esce da un
 * calendario esterno: sono le partite con calcio d'inizio domani che
 * l'archivio ha già incontrato, cioè quelle passate dall'elenco dei
 * movimenti della fonte. Una competizione che la fonte non ha esposto
 * qui non compare — ed è dichiarato, non nascosto.
 *
 * Le quote mostrate sono l'ultima rilevazione per selezione: la lettura
 * più recente, non una media né una stima. Una partita senza quote in
 * archivio resta in elenco con la nota «quote in arrivo».
 */
import { and, asc, eq, inArray, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import {
  dropSignals,
  leagues,
  matches,
  oddsSnapshots,
  teams,
  type MarketType,
  type SelectionCode,
} from "@/db/schema";
import { num } from "@/lib/drop/math";
import { MARKET_LABELS_IT, SELECTION_LABELS_IT } from "@/lib/drop/constants";

/** Ultima quota osservata su una selezione, con l'istante della lettura. */
export interface TomorrowOdds {
  market: MarketType;
  marketLabel: string;
  selection: SelectionCode;
  selectionLabel: string;
  price: number;
  collectedAt: string;
}

/** Una partita di domani come la conosce l'archivio. */
export interface TomorrowMatch {
  id: number;
  homeTeam: string;
  awayTeam: string;
  league: string | null;
  country: string | null;
  kickoffAt: string;
  status: string;

  /** rilevazioni totali in archivio per questa partita */
  snapshotCount: number;
  /** ultima quota per ogni selezione osservata; vuota = nessuna quota */
  odds: TomorrowOdds[];
  /** true se esiste almeno un segnale registrato su questa partita */
  hasSignal: boolean;
  /** la nota dedicata: nessuna quota in archivio, le aspettiamo dalla fonte */
  awaitingOdds: boolean;
}

export interface TomorrowView {
  /** istante rappresentativo della giornata di domani, per l'intestazione */
  dayIso: string;
  matches: TomorrowMatch[];
  withOdds: number;
  withoutOdds: number;
}

/**
 * Un istante a metà della giornata italiana di domani, per datare
 * l'intestazione (mezzogiorno UTC ricade sempre nello stesso giorno
 * civile di Roma, attorno ai cambi d'ora).
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
 * Legge il programma di domani.
 *
 * Tre letture separate e una composizione: le partite, l'ultima quota
 * per selezione (DISTINCT ON ordinato per istante di rilevazione), e
 * l'esistenza di segnali. Nessun valore calcolato oltre alla scelta
 * dell'ultima rilevazione — che è una lettura, non una stima.
 */
export async function getTomorrowView(
  now: Date = new Date(),
): Promise<TomorrowView> {
  const isTomorrow = raw`(${matches.kickoffAt} at time zone 'Europe/Rome')::date
      = (${now.toISOString()}::timestamptz at time zone 'Europe/Rome')::date + 1`;

  const rows = await db
    .select({
      id: matches.id,
      kickoffAt: matches.kickoffAt,
      status: matches.status,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
      leagueName: leagues.name,
      leagueCountry: leagues.country,
    })
    .from(matches)
    .leftJoin(leagues, eq(leagues.id, matches.leagueId))
    .where(and(raw`${matches.key} not like 'demo-%'`, isTomorrow))
    .orderBy(asc(matches.kickoffAt));

  if (rows.length === 0) {
    return {
      dayIso: romeDayShiftedIso(now, 1),
      matches: [],
      withOdds: 0,
      withoutOdds: 0,
    };
  }

  const ids = rows.map((r) => r.id);
  const teamIds = [
    ...new Set(rows.flatMap((r) => [r.homeTeamId, r.awayTeamId])),
  ];

  /* DISTINCT ON prende la riga più recente per (partita, mercato,
     selezione): è la lettura valida, non una media fra letture */
  const [teamRows, latestOdds, counts, signalRows] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, teamIds)),
    db
      .selectDistinctOn(
        [
          oddsSnapshots.matchId,
          oddsSnapshots.market,
          oddsSnapshots.selection,
        ],
        {
          matchId: oddsSnapshots.matchId,
          market: oddsSnapshots.market,
          selection: oddsSnapshots.selection,
          price: oddsSnapshots.price,
          collectedAt: oddsSnapshots.collectedAt,
        },
      )
      .from(oddsSnapshots)
      .where(inArray(oddsSnapshots.matchId, ids))
      .orderBy(
        oddsSnapshots.matchId,
        oddsSnapshots.market,
        oddsSnapshots.selection,
        raw`${oddsSnapshots.collectedAt} desc`,
      ),
    db
      .select({
        matchId: oddsSnapshots.matchId,
        n: raw<number>`count(*)::int`,
      })
      .from(oddsSnapshots)
      .where(inArray(oddsSnapshots.matchId, ids))
      .groupBy(oddsSnapshots.matchId),
    db
      .selectDistinct({ matchId: dropSignals.matchId })
      .from(dropSignals)
      .where(inArray(dropSignals.matchId, ids)),
  ]);

  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));
  const countByMatch = new Map(counts.map((c) => [c.matchId, c.n]));
  const signalsByMatch = new Set(signalRows.map((s) => s.matchId));

  const oddsByMatch = new Map<number, TomorrowOdds[]>();
  for (const o of latestOdds) {
    const list = oddsByMatch.get(o.matchId) ?? [];
    list.push({
      market: o.market as MarketType,
      marketLabel: MARKET_LABELS_IT[o.market] ?? o.market,
      selection: o.selection as SelectionCode,
      selectionLabel: SELECTION_LABELS_IT[o.selection] ?? o.selection,
      price: num(o.price) ?? 0,
      collectedAt: o.collectedAt.toISOString(),
    });
    oddsByMatch.set(o.matchId, list);
  }

  const items: TomorrowMatch[] = rows.map((r) => {
    const odds = oddsByMatch.get(r.id) ?? [];
    return {
      id: r.id,
      homeTeam: teamName.get(r.homeTeamId) ?? "—",
      awayTeam: teamName.get(r.awayTeamId) ?? "—",
      league: r.leagueName,
      country: r.leagueCountry,
      kickoffAt: r.kickoffAt.toISOString(),
      status: r.status,
      snapshotCount: countByMatch.get(r.id) ?? 0,
      /* ordine di lettura fisso: il menù non balla fra un render e l'altro */
      odds: [...odds].sort((a, b) =>
        `${a.market}::${a.selection}`.localeCompare(`${b.market}::${b.selection}`),
      ),
      hasSignal: signalsByMatch.has(r.id),
      awaitingOdds: odds.length === 0,
    };
  });

  return {
    dayIso: romeDayShiftedIso(now, 1),
    matches: items,
    withOdds: items.filter((i) => !i.awaitingOdds).length,
    withoutOdds: items.filter((i) => i.awaitingOdds).length,
  };
}
