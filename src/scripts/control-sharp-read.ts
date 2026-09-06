/**
 * Lettura di CONTROLLO sul percorso di produzione, per un campionato coperto.
 *
 *   npm run odds:control                    # prima partita coperta in archivio
 *   npm run odds:control -- --match-id 123  # partita specifica
 *
 * A differenza dello smoke test (che usa il client direttamente), qui si passa
 * da `getSharpLine` — lo STESSO percorso della pagina partita: vista budget,
 * fotografia del giorno, mappa di budget (`sportKeyFor`), decisione `decide`,
 * lettura reale, conteggio crediti in `system_state`, scrittura snapshot.
 *
 * Serve a validare, su un campionato coperto, mapping + contatori + matching
 * PRIMA di impostare ODDS_ADAPTER_IMPLEMENTED=true. Se in archivio non c'è
 * alcuna partita coperta (domenica fra due turni / sosta nazionali), lo dice e
 * non spende nulla.
 *
 * `signalActive` è passato true in modo dichiarato: è una lettura di controllo
 * voluta, non un segnale prodotto dal monitor. Il budget resta l'autorità su
 * tetti mensili/giornalieri e sul conteggio dei crediti.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { leagues, matches, teams } from "@/db/schema";
import { sportKeyFor } from "@/lib/providers/optional/sport-keys";
import { getSharpLine } from "@/lib/repo/sharp";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const HORIZON_HOURS = Math.max(1, Number(argument("--ore") ?? 168) || 168);

const romeTime = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

async function main(): Promise<number> {
  const now = new Date();
  const until = new Date(now.getTime() + HORIZON_HOURS * 3_600_000);

  console.log("\nLettura di controllo — percorso di produzione (getSharpLine)");
  console.log(`finestra: da adesso a ${romeTime.format(until)} (ora italiana)`);

  const rows = await db
    .select({
      id: matches.id,
      key: matches.key,
      kickoffAt: matches.kickoffAt,
      status: matches.status,
      leagueName: leagues.name,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
    })
    .from(matches)
    .innerJoin(leagues, eq(leagues.id, matches.leagueId))
    .where(and(gte(matches.kickoffAt, now), lte(matches.kickoffAt, until), eq(matches.status, "scheduled")))
    .orderBy(matches.kickoffAt)
    .limit(200);

  const teamIds = [...new Set(rows.flatMap((r) => [r.homeTeamId, r.awayTeamId]))];
  const names = new Map<number, string>();
  if (teamIds.length > 0) {
    const teamRows = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, teamIds));
    for (const t of teamRows) names.set(t.id, t.name);
  }

  const covered = rows
    .map((r) => ({
      id: r.id,
      kickoffAt: r.kickoffAt,
      leagueName: r.leagueName,
      home: names.get(r.homeTeamId) ?? "",
      away: names.get(r.awayTeamId) ?? "",
      sportKey: sportKeyFor(r.leagueName),
    }))
    .filter((r) => r.sportKey !== null && r.home !== "" && r.away !== "");

  if (covered.length === 0) {
    console.log(
      "\nNESSUNA PARTITA DI CAMPIONATO COPERTO IN ARCHIVIO nella finestra.\n" +
        "La lettura di controllo va fatta quando entra il prossimo turno (Serie A/EPL/…).\n" +
        "Crediti spesi: 0.",
    );
    return 0;
  }

  const matchArg = argument("--match-id");
  const target =
    matchArg !== null ? covered.find((r) => r.id === Number(matchArg)) : covered[0];
  if (target === undefined) {
    console.error(`Partita ${matchArg} non trovata fra quelle coperte in archivio.`);
    return 2;
  }

  console.log(
    `\npartita scelta: #${target.id} ${romeTime.format(target.kickoffAt)} ${target.home} — ${target.away}`,
  );
  console.log(`lega: ${target.leagueName} → chiave sport: ${target.sportKey}`);
  console.log("percorso: getSharpLine (budget → mappa → decisione → lettura → contatori)\n");

  const view = await getSharpLine(
    {
      matchId: target.id,
      sportKey: target.sportKey,
      homeTeam: target.home,
      awayTeam: target.away,
      kickoffAt: target.kickoffAt,
      market: "1x2",
      selection: "home",
      consensusOpening: null,
      consensusCurrent: null,
      signalActive: true, // lettura di controllo dichiarata
    },
    now,
  );

  console.log("budget dopo la lettura:");
  console.log(`  mese  : ${view.budget.usedThisMonth}/${view.budget.monthlyCap}`);
  console.log(`  oggi  : ${view.budget.usedToday} (quota odierna ${view.budget.allowanceToday}, tetto ${view.budget.dailyHardCap})`);

  if (view.snapshot === null) {
    console.error(`\nESITO: nessuna linea sharp — ${view.unavailableReason}`);
    return 1;
  }

  console.log("\nESITO: linea sharp letta sul percorso di produzione");
  console.log(`  book sharp : ${view.snapshot.book ?? "nessuno"}`);
  console.log(`  prezzo     : ${view.snapshot.price ?? "n.d."}`);
  console.log(`  verdetto   : ${view.snapshot.verdict}`);
  console.log(`  book osservati: ${view.snapshot.books.length}`);
  console.log(`  letti alle : ${view.snapshot.readAt}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("LETTURA DI CONTROLLO FALLITA — errore non previsto.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
  });
