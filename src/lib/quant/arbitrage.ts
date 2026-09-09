/**
 * Arbitrage Scanner — rileva opportunità di surebet cross-bookmaker.
 *
 * Un'opportunità di arbitraggio esiste quando la somma delle probabilità
 * implicite (1/quota) delle migliori quote disponibili per ogni selezione
 * di un mercato è < 1. In quel caso, scommettendo proporzionalmente su
 * tutti gli esiti si garantisce un profitto indipendentemente dal risultato.
 *
 * Formula:
 *   profitto% = (1 - somma_prob_implicite) × 100
 *
 * Esempio: se le migliori quote per 1X2 sono 2.10, 3.50, 4.00
 *   somma = 1/2.10 + 1/3.50 + 1/4.00 = 0.476 + 0.286 + 0.250 = 1.012
 *   profitto = (1 - 1.012) × 100 = -1.2% → NO arbitraggio
 *
 *   Se le quote fossero 2.20, 3.60, 4.20
 *   somma = 1/2.20 + 1/3.60 + 1/4.20 = 0.455 + 0.278 + 0.238 = 0.971
 *   profitto = (1 - 0.971) × 100 = +2.9% → SÌ arbitraggio
 *
 * Questo modulo è per USO PERSONALE. L'arbitraggio richiede:
 * - Account attivi su più bookmaker
 * - Liquidità sufficiente su tutti i bookmaker
 * - Velocità di esecuzione (le quote cambiano in secondi)
 * - Verifica dei limiti di puntata
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bookmakers,
  matches,
  oddsSnapshots,
  teams,
  leagues,
  type MarketType,
  type SelectionCode,
} from "@/db/schema";

/** Selezioni per ogni tipo di mercato. */
const MARKET_SELECTIONS: Record<MarketType, SelectionCode[]> = {
  "1x2": ["home", "draw", "away"],
  ou_2_5: ["over", "under"],
  btts: ["yes", "no"],
};

/** Etichette leggibili per le selezioni. */
const SELECTION_LABELS: Record<SelectionCode, string> = {
  home: "Casa (1)",
  draw: "Pareggio (X)",
  away: "Trasferta (2)",
  over: "Over 2.5",
  under: "Under 2.5",
  yes: "Gol",
  no: "No Gol",
};

export interface ArbitrageLeg {
  selection: SelectionCode;
  selectionLabel: string;
  bestOdds: number;
  bookmakerName: string;
  bookmakerKey: string;
  impliedProb: number;
  stakePct: number; // percentuale del bankroll da puntare su questa gamba
}

export interface ArbitrageOpportunity {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: Date;
  market: MarketType;
  legs: ArbitrageLeg[];
  totalImpliedProb: number;
  profitPct: number; // (1 - totalImpliedProb) × 100
  maxStake: number; // puntata massima teorica (limitata dal bookmaker con limite più basso)
  collectedAt: Date; // timestamp della lettura più vecchia tra le gambe
}

export interface ArbitrageScanResult {
  opportunities: ArbitrageOpportunity[];
  matchesScanned: number;
  marketsScanned: number;
  scannedAt: Date;
  /** soglia minima di profitto applicata */
  minProfitPct: number;
  /** finestra temporale delle letture considerate (ore) */
  windowHours: number;
  /**
   * Quanti operatori distinti sono stati realmente letti nella finestra.
   * È la grandezza su cui si valuta se l'arbitraggio sia osservabile: 0 =
   * nessuna lettura, 1 = una sola linea (il consenso), ≥2 = multi-bookmaker.
   */
  bookmakersInWindow: number;
  /**
   * Dichiarazione onesta sulla capacità della fonte, pensata per la pagina:
   * distingue «arbitraggio non osservabile perché la fonte espone una sola
   * linea» da «nessuna opportunità trovata fra più operatori». Non è mai un
   * dato inventato: descrive ciò che la scansione ha davvero letto.
   */
  sourceNote: string;
  error: string | null;
}

/** Finestra di lettura: quote più vecchie di così non sono più affidabili. */
const WINDOW_HOURS = 2;

/** Soglia minima di profitto per considerare un'opportunità. */
const MIN_PROFIT_PCT = 0.5;

/**
 * Numero di operatori distinti che hanno prodotto le quote migliori di una
 * combinazione di gambe. Le chiavi sono normalizzate (minuscolo, senza spazi)
 * per non contare due volte lo stesso bookmaker scritto in modo diverso.
 */
export function distinctBookmakerKeys(legs: { bookmakerKey: string }[]): number {
  return new Set(
    legs.map((l) => l.bookmakerKey.trim().toLowerCase()).filter((k) => k !== ""),
  ).size;
}

/**
 * Un arbitraggio genuino richiede che le quote migliori delle selezioni
 * provengano da ALMENO DUE operatori distinti.
 *
 * Se tutte le gambe stanno sulla stessa linea (es. il consenso BetExplorer),
 * la somma delle probabilità implicite è sempre ≥ 1 perché quella linea
 * contiene il margine: non esiste alcun arbitraggio. Non è una questione di
 * «opportunità rare», è la struttura della fonte. Esigere bookmaker distinti
 * impedisce di spacciare una singola linea arrotondata per una surebet.
 */
export function isCrossBookmaker(legs: { bookmakerKey: string }[]): boolean {
  return distinctBookmakerKeys(legs) >= 2;
}

/**
 * Carica le quote più recenti per ogni (match, market, selection, bookmaker).
 * Considera solo letture entro la finestra temporale e non stale.
 */
async function loadLatestOdds(
  matchIds: number[],
  since: Date,
): Promise<
  Array<{
    matchId: number;
    market: MarketType;
    selection: SelectionCode;
    bookmakerId: number;
    bookmakerName: string;
    bookmakerKey: string;
    price: number;
    collectedAt: Date;
  }>
> {
  // Per ogni (match, market, selection, bookmaker), prendi la lettura più recente
  const rows = await db
    .select({
      matchId: oddsSnapshots.matchId,
      market: oddsSnapshots.market,
      selection: oddsSnapshots.selection,
      bookmakerId: oddsSnapshots.bookmakerId,
      bookmakerName: bookmakers.name,
      bookmakerKey: bookmakers.key,
      price: oddsSnapshots.price,
      collectedAt: oddsSnapshots.collectedAt,
      rn: sql<number>`row_number() over (
        partition by ${oddsSnapshots.matchId}, ${oddsSnapshots.market}, ${oddsSnapshots.selection}, ${oddsSnapshots.bookmakerId}
        order by ${oddsSnapshots.collectedAt} desc
      )`.as("rn"),
    })
    .from(oddsSnapshots)
    .innerJoin(bookmakers, eq(oddsSnapshots.bookmakerId, bookmakers.id))
    .where(
      and(
        inArray(oddsSnapshots.matchId, matchIds),
        gte(oddsSnapshots.collectedAt, since),
        eq(oddsSnapshots.isStale, false),
        eq(bookmakers.active, true),
      ),
    )
    .orderBy(desc(oddsSnapshots.collectedAt));

  // Filtra solo la lettura più recente per ogni combinazione
  return rows
    .filter((r) => r.rn === 1)
    .map((r) => ({
      matchId: r.matchId,
      market: r.market as MarketType,
      selection: r.selection as SelectionCode,
      bookmakerId: r.bookmakerId,
      bookmakerName: r.bookmakerName,
      bookmakerKey: r.bookmakerKey,
      price: Number(r.price),
      collectedAt: new Date(r.collectedAt),
    }));
}

/**
 * Per ogni (match, market), trova la quota migliore per ogni selezione.
 * Restituisce null se manca anche una sola selezione.
 */
function findBestOdds(
  odds: Array<{
    matchId: number;
    market: MarketType;
    selection: SelectionCode;
    bookmakerId: number;
    bookmakerName: string;
    bookmakerKey: string;
    price: number;
    collectedAt: Date;
  }>,
  matchId: number,
  market: MarketType,
): ArbitrageLeg[] | null {
  const selections = MARKET_SELECTIONS[market];
  const legs: ArbitrageLeg[] = [];

  for (const sel of selections) {
    // Trova la quota migliore per questa selezione
    const candidates = odds.filter(
      (o) => o.matchId === matchId && o.market === market && o.selection === sel,
    );
    if (candidates.length === 0) return null; // selezione mancante

    const best = candidates.reduce((max, c) => (c.price > max.price ? c : max));
    if (best.price <= 1.01) return null; // quota non valida

    legs.push({
      selection: sel,
      selectionLabel: SELECTION_LABELS[sel],
      bestOdds: best.price,
      bookmakerName: best.bookmakerName,
      bookmakerKey: best.bookmakerKey,
      impliedProb: 1 / best.price,
      stakePct: 0, // calcolato dopo
    });
  }

  return legs;
}

/**
 * Scanner arbitraggio: cerca opportunità di surebet su tutte le partite
 * non ancora al kickoff.
 */
export async function scanArbitrage(
  minProfitPct: number = MIN_PROFIT_PCT,
  now: Date = new Date(),
): Promise<ArbitrageScanResult> {
  try {
    // Carica partite non ancora al kickoff
    const upcomingMatches = await db
      .select({
        id: matches.id,
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId,
        kickoffAt: matches.kickoffAt,
        leagueId: matches.leagueId,
      })
      .from(matches)
      .where(
        and(
          eq(matches.status, "scheduled"),
          gte(matches.kickoffAt, now),
        ),
      );

    if (upcomingMatches.length === 0) {
      return {
        opportunities: [],
        matchesScanned: 0,
        marketsScanned: 0,
        scannedAt: now,
        minProfitPct,
        windowHours: WINDOW_HOURS,
        bookmakersInWindow: 0,
        sourceNote:
          "Nessuna partita futura in archivio da scansionare: non è una questione di opportunità, non c'è un mercato da leggere.",
        error: null,
      };
    }

    const matchIds = upcomingMatches.map((m) => m.id);
    const since = new Date(now.getTime() - WINDOW_HOURS * 3600_000);

    // Carica quote e anagrafiche in parallelo
    const [odds, matchDetails] = await Promise.all([
      loadLatestOdds(matchIds, since),
      db
        .select({
          matchId: matches.id,
          homeTeam: teams.name,
          awayTeam: sql<string>`t2.name`.as("away_team"),
          league: leagues.name,
        })
        .from(matches)
        .innerJoin(teams, eq(matches.homeTeamId, teams.id))
        .innerJoin(
          sql`teams as t2`,
          eq(matches.awayTeamId, sql`t2.id`),
        )
        .innerJoin(leagues, eq(matches.leagueId, leagues.id))
        .where(inArray(matches.id, matchIds)),
    ]);

    const matchDetailMap = new Map(
      matchDetails.map((m) => [m.matchId, m]),
    );
    const matchMap = new Map(
      upcomingMatches.map((m) => [m.id, m]),
    );

    const opportunities: ArbitrageOpportunity[] = [];
    const markets: MarketType[] = ["1x2", "ou_2_5", "btts"];
    let marketsScanned = 0;

    for (const matchId of matchIds) {
      for (const market of markets) {
        marketsScanned++;
        const legs = findBestOdds(odds, matchId, market);
        if (!legs) continue;

        /* Un arbitraggio genuino richiede che le quote migliori vengano da
           operatori distinti. Se le gambe stanno sulla stessa linea (es. il
           consenso), la somma delle probabilità implicite è ≥ 1 e la riga non
           è una surebet: non va spacciata per «nessuna opportunità». */
        if (!isCrossBookmaker(legs)) continue;

        const totalImpliedProb = legs.reduce((sum, l) => sum + l.impliedProb, 0);
        const profitPct = (1 - totalImpliedProb) * 100;

        if (profitPct < minProfitPct) continue;

        // Calcola stake percentuale per ogni gamba (proporzionale alla probabilità implicita)
        for (const leg of legs) {
          leg.stakePct = (leg.impliedProb / totalImpliedProb) * 100;
        }

        const detail = matchDetailMap.get(matchId);
        const match = matchMap.get(matchId);
        if (!detail || !match) continue;

        // Timestamp della lettura più vecchia (l'opportunità è valida solo se tutte le quote sono ancora disponibili)
        const matchOdds = odds.filter(
          (o) => o.matchId === matchId && o.market === market,
        );
        const oldestReading = matchOdds.reduce((min, o) =>
          o.collectedAt < min ? o.collectedAt : min,
          matchOdds[0].collectedAt,
        );

        opportunities.push({
          matchId,
          homeTeam: detail.homeTeam,
          awayTeam: detail.awayTeam,
          league: detail.league,
          kickoffAt: new Date(match.kickoffAt),
          market,
          legs,
          totalImpliedProb: Math.round(totalImpliedProb * 10000) / 10000,
          profitPct: Math.round(profitPct * 100) / 100,
          maxStake: 0, // da calcolare con limiti bookmaker (non disponibili)
          collectedAt: oldestReading,
        });
      }
    }

    // Ordina per profitto decrescente
    opportunities.sort((a, b) => b.profitPct - a.profitPct);

    /* Quanti operatori distinti sono stati realmente letti nella finestra.
       Da qui dipende la dichiarazione onesta della pagina: con una sola linea
       (il consenso) l'arbitraggio cross-bookmaker non è osservabile, e va
       detto, non attribuito all'assenza di «opportunità rare». */
    const bookmakersInWindow = new Set(
      odds.map((o) => o.bookmakerKey.trim().toLowerCase()).filter((k) => k !== ""),
    ).size;

    let sourceNote: string;
    if (bookmakersInWindow === 0) {
      sourceNote =
        "Nessuna lettura di quote nella finestra: non si può scansionare, perché non ci sono prezzi da confrontare.";
    } else if (bookmakersInWindow === 1) {
      sourceNote =
        "La fonte espone una sola linea di consenso: con un solo operatore l'arbitraggio cross-bookmaker non è osservabile, non «raro». Serve una fonte per singolo bookmaker.";
    } else {
      sourceNote = "";
    }

    return {
      opportunities,
      matchesScanned: matchIds.length,
      marketsScanned,
      scannedAt: now,
      minProfitPct,
      windowHours: WINDOW_HOURS,
      bookmakersInWindow,
      sourceNote,
      error: null,
    };
  } catch (err) {
    console.error("[arbitrage] scansione fallita:", err);
    return {
      opportunities: [],
      matchesScanned: 0,
      marketsScanned: 0,
      scannedAt: now,
      minProfitPct,
      windowHours: WINDOW_HOURS,
      bookmakersInWindow: 0,
      sourceNote: "Scansione non riuscita: non c'è un risultato da leggere.",
      error: "scansione non riuscita (dettaglio nel log del server)",
    };
  }
}
