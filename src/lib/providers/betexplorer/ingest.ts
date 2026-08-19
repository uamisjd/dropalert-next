/**
 * Normalizzazione e scrittura su DB dei dati BetExplorer (Sprint 3B).
 *
 * Separato dall'adapter di proposito: l'adapter parla HTTP e HTML, questo
 * strato parla di anagrafiche e tabelle. Una fonte futura che produca gli
 * stessi DTO riuserà questo codice senza modifiche, e senza toccare il
 * motore.
 *
 * Regole applicate qui:
 * - anagrafiche create al bisogno (`leagues`, `teams`), mai duplicate;
 * - `odds_snapshots` è append-only: ogni polling aggiunge un punto reale
 *   osservato in quell'istante, non aggiorna il precedente;
 * - un dato che manca resta mancante e finisce in `data_gaps`;
 * - il bookmaker di consenso è dichiarato tale (`isSharp = false`).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bookmakers,
  leagues,
  matches,
  oddsSnapshots,
  teams,
  type MarketType,
  type SelectionCode,
} from "@/db/schema";
import { recordGap } from "@/lib/pipeline/detect";
import { CONSENSUS_BOOKMAKER_KEY } from "./index";
import { leagueKeyFor, slugify, teamKeyFor } from "./parse";
import type { FixtureDTO, OddsQuoteDTO, ResultDTO } from "../types";

/** Sorgente scritta in `odds_snapshots.source`: tracciabilità del dato. */
export const SNAPSHOT_SOURCE = "betexplorer-dropping-odds";

/* ------------------------------------------------------------------ */
/* Anagrafiche                                                         */
/* ------------------------------------------------------------------ */

/**
 * Bookmaker sintetico per la linea di consenso.
 *
 * Esiste come riga vera perché `odds_snapshots.bookmakerId` è obbligatorio,
 * ma il nome dice chiaramente che cos'è. `isSharp = false`: un consenso
 * non è una linea sharp, e non deve mai essere contato come tale.
 */
export async function ensureConsensusBookmaker(): Promise<number> {
  const [existing] = await db
    .select({ id: bookmakers.id })
    .from(bookmakers)
    .where(eq(bookmakers.key, CONSENSUS_BOOKMAKER_KEY))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(bookmakers)
    .values({
      key: CONSENSUS_BOOKMAKER_KEY,
      name: "BetExplorer — consenso di mercato",
      isSharp: false,
      /* peso neutro: non partecipa a un confronto fra book, è l'unico */
      weight: "1.000",
      active: true,
    })
    .onConflictDoNothing()
    .returning({ id: bookmakers.id });

  if (created) return created.id;

  const [after] = await db
    .select({ id: bookmakers.id })
    .from(bookmakers)
    .where(eq(bookmakers.key, CONSENSUS_BOOKMAKER_KEY))
    .limit(1);
  return after.id;
}

/** Campionato, creato al bisogno. */
export async function ensureLeague(fixture: FixtureDTO, countrySlug: string, leagueSlug: string): Promise<number> {
  const key = leagueKeyFor(countrySlug, leagueSlug);
  const [existing] = await db
    .select({ id: leagues.id })
    .from(leagues)
    .where(eq(leagues.key, key))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(leagues)
    .values({
      key,
      name: fixture.leagueRaw,
      country: fixture.countryRaw,
      /* il livello del torneo non è pubblicato dalla fonte: resta null,
         non lo si inventa */
      tier: null,
      externalRef: `${countrySlug}/${leagueSlug}`,
      active: true,
    })
    .onConflictDoNothing()
    .returning({ id: leagues.id });

  if (created) return created.id;
  const [after] = await db
    .select({ id: leagues.id })
    .from(leagues)
    .where(eq(leagues.key, key))
    .limit(1);
  return after.id;
}

/** Squadra, creata al bisogno. */
export async function ensureTeam(nameRaw: string, country: string | null): Promise<number> {
  const key = teamKeyFor(nameRaw);
  const [existing] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.key, key))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(teams)
    .values({ key, name: nameRaw, country, externalRef: slugify(nameRaw) })
    .onConflictDoNothing()
    .returning({ id: teams.id });

  if (created) return created.id;
  const [after] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.key, key))
    .limit(1);
  return after.id;
}

/* ------------------------------------------------------------------ */
/* Partite                                                             */
/* ------------------------------------------------------------------ */

export interface UpsertedMatch {
  id: number;
  key: string;
  created: boolean;
}

/**
 * Inserisce o aggiorna una partita.
 *
 * L'orario viene aggiornato se la fonte lo corregge: è un dato osservato,
 * non una nostra deduzione. Il risultato non viene toccato qui.
 */
export async function upsertMatch(
  fixture: FixtureDTO,
  countrySlug: string,
  leagueSlug: string,
): Promise<UpsertedMatch> {
  const leagueId = await ensureLeague(fixture, countrySlug, leagueSlug);
  const homeTeamId = await ensureTeam(fixture.homeTeamRaw, fixture.countryRaw);
  const awayTeamId = await ensureTeam(fixture.awayTeamRaw, fixture.countryRaw);

  const [existing] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.key, fixture.key))
    .limit(1);

  if (existing) {
    await db
      .update(matches)
      .set({
        kickoffAt: fixture.kickoffAt,
        externalRef: fixture.providerMatchId,
        updatedAt: new Date(),
      })
      .where(eq(matches.id, existing.id));
    return { id: existing.id, key: fixture.key, created: false };
  }

  const [created] = await db
    .insert(matches)
    .values({
      key: fixture.key,
      leagueId,
      homeTeamId,
      awayTeamId,
      kickoffAt: fixture.kickoffAt,
      status: "scheduled",
      externalRef: fixture.providerMatchId,
    })
    .onConflictDoNothing()
    .returning({ id: matches.id });

  if (created) return { id: created.id, key: fixture.key, created: true };

  const [after] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.key, fixture.key))
    .limit(1);
  return { id: after.id, key: fixture.key, created: false };
}

/* ------------------------------------------------------------------ */
/* Quote                                                               */
/* ------------------------------------------------------------------ */

/** Probabilità implicita: 1 / quota. L'unico valore derivato che salviamo. */
export function impliedProbabilityOf(price: number): number {
  return 1 / price;
}

export interface SnapshotWriteReport {
  written: number;
  skipped: number;
}

/**
 * Scrive gli snapshot di quota.
 *
 * Append-only: la chiave unica è (match, book, mercato, selezione,
 * istante). Due polling nello stesso secondo non devono creare un
 * duplicato, quindi i conflitti vengono ignorati e contati.
 */
export async function writeSnapshots(
  matchId: number,
  bookmakerId: number,
  quotes: OddsQuoteDTO[],
  runId: number | null,
): Promise<SnapshotWriteReport> {
  if (quotes.length === 0) return { written: 0, skipped: 0 };

  const rows = quotes.map((q) => ({
    matchId,
    bookmakerId,
    market: q.market as MarketType,
    selection: q.selection as SelectionCode,
    price: q.price.toFixed(3),
    impliedProb: impliedProbabilityOf(q.price).toFixed(6),
    collectedAt: q.observedAt,
    source: SNAPSHOT_SOURCE,
    isStale: false,
    runId,
  }));

  const inserted = await db
    .insert(oddsSnapshots)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: oddsSnapshots.id });

  return { written: inserted.length, skipped: rows.length - inserted.length };
}

/**
 * Dichiara, per ogni partita raccolta, che le quote per singolo bookmaker
 * non sono disponibili da questa fonte.
 *
 * Non è un dettaglio burocratico: è la ragione per cui coordinazione e
 * conferma sharp restano non calcolabili. Meglio un buco dichiarato che
 * un punteggio calcolato su un solo book spacciato per consenso di molti.
 */
export async function declarePerBookmakerGap(
  matchId: number,
  agreement: { confirming: number; total: number } | null,
): Promise<void> {
  const observed =
    agreement === null
      ? "La fonte non pubblica il numero di bookmaker concordi per questa partita."
      : `La fonte dichiara ${agreement.confirming}/${agreement.total} bookmaker concordi, ma non espone le singole quote.`;

  await recordGap({
    matchId,
    reason: "bookmaker_missing",
    detail: `BetExplorer espone solo la quota di consenso: nessuna quota per singolo bookmaker è osservabile entro il robots.txt. ${observed} Coordinazione fra book e conferma della linea sharp NON sono calcolabili e non vengono stimate.`,
  });
}

/* ------------------------------------------------------------------ */
/* Risultati                                                           */
/* ------------------------------------------------------------------ */

export interface ResultWriteReport {
  updated: number;
  unknownMatches: number;
}

/**
 * Applica i risultati alle partite che stiamo seguendo.
 *
 * Le partite sconosciute vengono ignorate senza rumore: la pagina
 * risultati contiene l'intera stagione, e non è nostro compito importare
 * partite che nessuno sta monitorando.
 */
export async function applyResults(results: ResultDTO[]): Promise<ResultWriteReport> {
  if (results.length === 0) return { updated: 0, unknownMatches: 0 };

  const keys = results.map((r) => r.fixtureKey);
  const known = await db
    .select({ id: matches.id, key: matches.key })
    .from(matches)
    .where(inArray(matches.key, keys));

  const byKey = new Map(known.map((m) => [m.key, m.id]));
  let updated = 0;

  for (const result of results) {
    const matchId = byKey.get(result.fixtureKey);
    if (matchId === undefined) continue;

    /* solo le partite non ancora chiuse: un risultato già registrato non
       viene riscritto a ogni giro */
    const touched = await db
      .update(matches)
      .set({
        homeGoals: result.homeGoals,
        awayGoals: result.awayGoals,
        status: result.status,
        settledAt: result.observedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(matches.id, matchId), isNull(matches.settledAt)))
      .returning({ id: matches.id });
    updated += touched.length;
  }

  return { updated, unknownMatches: results.length - byKey.size };
}
