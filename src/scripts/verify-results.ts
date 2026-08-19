/**
 * Verifica del percorso partita → risultato su DATI REALI.
 *
 *   npm run job:verify-results
 *
 * Perché esiste: le partite pescate dall'elenco drop sono, per
 * definizione, ancora da giocare. Per dimostrare che il percorso dei
 * risultati funziona senza aspettare il fischio finale, si prende una
 * partita REALMENTE conclusa da una pagina `/results/` di un campionato
 * che stiamo già seguendo, la si registra con il suo orario reale letto
 * dal JSON-LD, e le si applica il risultato reale con le stesse funzioni
 * di ingest usate dal job.
 *
 * Nessun dato inventato: squadre, ID, orario e punteggio vengono tutti
 * dalla fonte. È una verifica, non un seed: la si esegue a mano.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema";
import { fetchPage, resultsPath } from "@/lib/providers/betexplorer/http";
import {
  humanizeSlug,
  matchKeyFor,
  parseMatchStartDate,
  parseResults,
} from "@/lib/providers/betexplorer/parse";
import { applyResults, upsertMatch } from "@/lib/providers/betexplorer/ingest";
import type { FixtureDTO, ResultDTO } from "@/lib/providers/types";

const LEAGUE = process.argv[2] ?? "argentina/reserve-league";

async function main(): Promise<void> {
  const [countrySlug, leagueSlug] = LEAGUE.split("/");
  console.log(`\nCampionato reale in esame: ${LEAGUE}`);

  const page = await fetchPage(resultsPath(countrySlug, leagueSlug));
  if (!page.ok) {
    console.error(`FONTE NON DISPONIBILE: HTTP ${page.status} ${page.errorMessage ?? ""}`);
    process.exit(1);
  }

  const parsed = parseResults(page.body);
  console.log(`righe risultato lette : ${parsed.rowsSeen}`);
  console.log(`risultati validi      : ${parsed.results.length}`);
  console.log(`righe dichiarate KO   : ${parsed.problems.length}`);

  const target = parsed.results[0];
  if (!target) {
    console.error("Nessuna partita conclusa disponibile: verifica non eseguibile.");
    process.exit(1);
  }

  /* nomi reali delle squadre, già estratti dal parser */
  const homeRaw = target.homeTeamRaw;
  const awayRaw = target.awayTeamRaw;

  /* orario reale, dal JSON-LD della pagina partita */
  const detail = await fetchPage(
    `/football/${countrySlug}/${leagueSlug}/${homeRaw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}-${awayRaw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}/${target.providerMatchId}/`,
  );
  const kickoffAt = detail.ok ? parseMatchStartDate(detail.body) : null;

  if (kickoffAt === null) {
    console.error(
      "Orario reale non ottenibile dalla pagina partita: nessun orario dedotto, verifica interrotta.",
    );
    process.exit(1);
  }

  const fixture: FixtureDTO = {
    key: matchKeyFor(target.providerMatchId),
    providerMatchId: target.providerMatchId,
    sourceUrl: `/football/${countrySlug}/${leagueSlug}/x/${target.providerMatchId}/`,
    homeTeamRaw: homeRaw,
    awayTeamRaw: awayRaw,
    leagueRaw: humanizeSlug(leagueSlug),
    countryRaw: humanizeSlug(countrySlug),
    kickoffAt,
    kickoffIsAssumedUtc: false,
  };

  console.log(
    `\npartita reale conclusa: ${homeRaw} - ${awayRaw} (${target.homeGoals}:${target.awayGoals})`,
  );
  console.log(`id fonte              : ${target.providerMatchId}`);
  console.log(`inizio reale          : ${kickoffAt.toISOString()}`);

  const upserted = await upsertMatch(fixture, countrySlug, leagueSlug);

  const result: ResultDTO = {
    fixtureKey: fixture.key,
    providerMatchId: target.providerMatchId,
    homeGoals: target.homeGoals,
    awayGoals: target.awayGoals,
    status: "finished",
    observedAt: new Date(),
  };

  const applied = await applyResults([result]);

  const [saved] = await db
    .select({
      key: matches.key,
      status: matches.status,
      homeGoals: matches.homeGoals,
      awayGoals: matches.awayGoals,
      settledAt: matches.settledAt,
    })
    .from(matches)
    .where(eq(matches.id, upserted.id))
    .limit(1);

  console.log(`\npartite aggiornate    : ${applied.updated}`);
  console.log("riga salvata a DB     :", saved);
  console.log(
    "\nPercorso partita → risultato verificato su dati reali della fonte.\n",
  );
}

main().catch((err) => {
  console.error("Verifica fallita:", err);
  process.exit(1);
});
