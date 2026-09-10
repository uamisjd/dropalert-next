/**
 * Ingestione di un evento di The Odds API nella nostra anagrafica.
 *
 * Porta una partita di una lega SERVITA in archivio, così il percorso di
 * produzione (mappa → confronto eventi → lettura reale) può chiudersi con un
 * vero `SMOKE OK`. NON è un'attivazione dell'adapter: `ADAPTER_IMPLEMENTED`
 * resta `false`, questo è un inserimento manuale di verifica.
 *
 * Regole applicate qui:
 *  - il CAMPIONATO si riusa (chiave identica a BetExplorer, `be-<paese>-<lega>`)
 *    ma il nome/campagna vengono FORZATI al titolo «Paese: Lega»: è il formato
 *    che `sportKeyFor` si aspetta, e senza averlo la partita risulterebbe
 *    «non mappata» (era il bug del 06/09/2026: un nome senza paese non decide);
 *  - le SQUADRE si riusano per chiave (`be-<slug>`): stessa identità di
 *    BetExplorer, niente duplicati di anagrafica;
 *  - la PARTITA ha chiave `oddsapi-<id>` (origine tracciata) e `externalRef`
 *    = id reale della fonte: la provenienza non si perde;
 *  - ciò che manca resta mancante (nessun valore inventato, `tier` resta null).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { leagues, matches, teams } from "@/db/schema";
import { leagueKeyFor, slugify, teamKeyFor } from "@/lib/providers/betexplorer/parse";
import type { OddsApiEventLite } from "./odds-match-resolver";
import type { CaptureLeague } from "./odds-capture-league";

export interface IngestedMatch {
  matchId: number;
  matchKey: string;
  /** true se la riga è stata creata ora, false se già esisteva */
  created: boolean;
}

/** Campionato: riusato per chiave, ma nome e paese forzati al formato
 *  «Paese: Lega» (indispensabile per `sportKeyFor`). */
async function upsertLeague(league: CaptureLeague): Promise<number> {
  const key = leagueKeyFor(league.countrySlug, league.leagueSlug);
  const values = {
    key,
    name: league.leagueRaw,
    country: league.countryRaw,
    externalRef: `${league.countrySlug}/${league.leagueSlug}`,
    active: true,
  };
  const [row] = await db
    .insert(leagues)
    .values(values)
    .onConflictDoUpdate({
      target: leagues.key,
      set: {
        name: values.name,
        country: values.country,
        externalRef: values.externalRef,
        active: true,
      },
    })
    .returning({ id: leagues.id });
  return row.id;
}

/** Squadra: riusata per chiave, aggiornato solo il nome canonicalizzato. */
async function ensureTeam(nameRaw: string, country: string | null): Promise<number> {
  const key = teamKeyFor(nameRaw);
  const values = {
    key,
    name: nameRaw,
    country,
    externalRef: slugify(nameRaw),
  };
  const [row] = await db
    .insert(teams)
    .values(values)
    .onConflictDoUpdate({
      target: teams.key,
      set: { name: values.name, country: values.country },
    })
    .returning({ id: teams.id });
  return row.id;
}

/**
 * Inserisce o aggiorna la partita di un evento della fonte.
 * L'orario viene aggiornato se la fonte lo corregge (dato osservato).
 */
export async function ingestOddsEvent(
  event: OddsApiEventLite,
  league: CaptureLeague,
): Promise<IngestedMatch> {
  const leagueId = await upsertLeague(league);
  const homeTeamId = await ensureTeam(event.homeTeam, league.countryRaw);
  const awayTeamId = await ensureTeam(event.awayTeam, league.countryRaw);
  const matchKey = `oddsapi-${event.id}`;

  const [existing] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.key, matchKey))
    .limit(1);

  if (existing) {
    await db
      .update(matches)
      .set({
        kickoffAt: event.commenceTime,
        externalRef: event.id,
        updatedAt: new Date(),
      })
      .where(eq(matches.id, existing.id));
    return { matchId: existing.id, matchKey, created: false };
  }

  const [created] = await db
    .insert(matches)
    .values({
      key: matchKey,
      leagueId,
      homeTeamId,
      awayTeamId,
      kickoffAt: event.commenceTime,
      status: "scheduled",
      externalRef: event.id,
    })
    .onConflictDoNothing()
    .returning({ id: matches.id });

  if (created) return { matchId: created.id, matchKey, created: true };

  const [after] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.key, matchKey))
    .limit(1);
  return { matchId: after.id, matchKey, created: false };
}
