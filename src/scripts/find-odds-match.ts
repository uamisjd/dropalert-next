/**
 * Trova una partita futura valida per lo smoke test live di The Odds API.
 *
 *   npm run odds:find                     # prossime 48 ore
 *   npm run odds:find -- --ore 72         # allarga la finestra
 *   npm run odds:find -- --senza-fonte    # solo archivio, nessuna chiamata
 *
 * COSTO: zero crediti. L'elenco degli eventi arriva dall'endpoint
 * `/v4/sports/{sport}/events`, che la documentazione della fonte dichiara
 * fuori quota. Le quote — quelle che costano — si leggono solo nello smoke
 * test, una volta sola, sulla partita scelta qui.
 *
 * Cosa fa: legge le partite in archivio, scarta quelle non leggibili sulla
 * fonte (competizione non mappata, kickoff passato), scarica l'elenco eventi
 * dei campionati coperti e confronta le identità con la STESSA regola che
 * userà il client. Una partita segnata `OK` è una partita su cui lo smoke
 * test trova l'evento; una segnata `GRAFIA` ha i nomi interni diversi da
 * quelli della fonte e va corretta a mano.
 *
 * Non scrive nulla nel database e non stampa mai la chiave.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { leagues, matches, teams } from "@/db/schema";
import { readOddsApiKey } from "@/lib/providers/optional/odds-api-budget";
import {
  describeDiagnosis,
  diagnoseEventMatch,
  resolveSmokeMatch,
  type DbMatchRow,
  type OddsApiEventLite,
} from "@/lib/providers/optional/odds-match-resolver";
import { fetchOddsApiEvents } from "@/lib/providers/optional/the-odds-api-events";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

/* 72 = l'orizzonte con cui il giro di raccolta riempie il database
   (COLLECT_HORIZON_HOURS): oltre non ci sono righe da leggere. */
const HORIZON_HOURS = Math.max(1, Number(argument("--ore") ?? 72) || 72);
const LIMIT = Math.max(1, Math.min(60, Number(argument("--limite") ?? 15) || 15));
const WITHOUT_SOURCE = process.argv.includes("--senza-fonte");

const romeTime = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

interface CandidateRow extends DbMatchRow {
  resolution: ReturnType<typeof resolveSmokeMatch>;
}

async function loadCandidates(now: Date, until: Date): Promise<CandidateRow[]> {
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
    .where(and(gte(matches.kickoffAt, now), lte(matches.kickoffAt, until)))
    .orderBy(matches.kickoffAt)
    .limit(200);

  const teamIds = [...new Set(rows.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];
  const names = new Map<number, string>();
  if (teamIds.length > 0) {
    const teamRows = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, teamIds));
    for (const team of teamRows) names.set(team.id, team.name);
  }

  return rows
    .map((row) => {
      const candidate: DbMatchRow = {
        id: row.id,
        key: row.key,
        kickoffAt: row.kickoffAt,
        status: row.status,
        leagueName: row.leagueName,
        homeTeamName: names.get(row.homeTeamId) ?? null,
        awayTeamName: names.get(row.awayTeamId) ?? null,
      };
      return { ...candidate, resolution: resolveSmokeMatch(candidate, now) };
    })
    .slice(0, LIMIT);
}

async function main(): Promise<void> {
  const now = new Date();
  const until = new Date(now.getTime() + HORIZON_HOURS * 3_600_000);
  const apiKey = readOddsApiKey();

  console.log("\nRicerca partita per lo smoke test di The Odds API");
  console.log(`finestra: da adesso a ${romeTime.format(until)} (ora italiana)`);

  if (!WITHOUT_SOURCE && apiKey === null) {
    console.error(
      "\nCHIAVE NON CONFIGURATA — nessuna chiamata alla fonte.\n" +
        "Serve una fra THE_ODDS_API_KEY, ODDS_API_KEY, theoddsapiKey, THEODDSAPIKEY.\n" +
        "Per vedere comunque le partite in archivio: npm run odds:find -- --senza-fonte",
    );
    process.exitCode = 2;
    return;
  }

  const candidates = await loadCandidates(now, until);
  if (candidates.length === 0) {
    console.error(
      `\nNESSUNA PARTITA IN ARCHIVIO nella finestra. Allarga la finestra: npm run odds:find -- --ore 120`,
    );
    process.exitCode = 3;
    return;
  }

  /* Sonda gratuita: per una chiave sport scelta a mano (anche fuori dalla
     mappa di budget) confronta TUTTE le partite in archivio con gli eventi
     della fonte e stampa il comando pronto. Serve a verificare l'infrastruttura
     su una lega reale minore senza toccare la mappa di produzione. 0 crediti. */
  const sonda = argument("--sonda");
  if (sonda !== null) {
    if (apiKey === null) {
      console.error("SONDA NON ESEGUITA — serve la chiave (endpoint gratuito ma autenticato).");
      process.exitCode = 2;
      return;
    }
    const outcome = await fetchOddsApiEvents({ sportKey: sonda, apiKey: apiKey! });
    if (!outcome.result.ok) {
      console.error(`SONDA NON CONCLUSA — ${outcome.result.error.message}`);
      process.exitCode = 1;
      return;
    }
    const events = outcome.result.data;
    console.log(`\nSONDA su [${sonda}]: ${events.length} eventi dalla fonte — crediti: ${outcome.creditsUsed ?? "non dichiarati"}`);
    let found = 0;
    for (const row of candidates) {
      if (row.homeTeamName === null || row.awayTeamName === null) continue;
      if (row.kickoffAt.getTime() <= now.getTime()) continue;
      const diagnosis = diagnoseEventMatch(
        { matchId: row.id, homeTeam: row.homeTeamName, awayTeam: row.awayTeamName, kickoffAt: row.kickoffAt },
        events,
      );
      const head = `  #${String(row.id).padEnd(6)} ${romeTime.format(row.kickoffAt)}  ${row.homeTeamName} — ${row.awayTeamName}  [${row.leagueName}]`;
      if (diagnosis.status === "unico") {
        found += 1;
        console.log(`${head}\n          OK — ${describeDiagnosis(diagnosis)}`);
        console.log(`          comando: npm run smoke:odds-api -- --match-id ${row.id} --sport-key ${sonda}`);
      } else {
        console.log(`${head}\n          ${diagnosis.status}`);
      }
    }
    console.log(`\ncrediti spesi dalla sonda: ${outcome.creditsUsed ?? 0}`);
    if (found === 0) {
      console.error("NESSUNA PARTITA DELL'ARCHIVIO COMBACIA CON QUESTA CHIAVE SPORT.");
      process.exitCode = 3;
    }
    return;
  }

  const readable = candidates.filter((c) => c.resolution.ok);
  const skipped = candidates.filter((c) => !c.resolution.ok);

  console.log(`\npartite in archivio: ${candidates.length}`);
  console.log(`leggibili sulla fonte: ${readable.length}`);
  if (skipped.length > 0) {
    console.log(`non leggibili: ${skipped.length}`);
    const reasons = new Map<string, number>();
    for (const row of skipped) {
      const reason = row.resolution.ok ? "" : row.resolution.reason;
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    for (const [reason, count] of reasons) console.log(`  · ${count}× ${reason}`);
  }
  if (readable.length === 0) {
    console.error("\nNESSUNA PARTITA LEGGIBILE: smoke test non eseguibile in questa finestra.");
    process.exitCode = 3;
    return;
  }

  if (WITHOUT_SOURCE) {
    console.log("\nMODALITÀ SENZA FONTE — nessun confronto con The Odds API, zero chiamate.");
    console.log("I nomi sotto sono quelli interni: la fonte potrebbe scriverli diversamente.\n");
    for (const row of readable) {
      const params = row.resolution.ok ? row.resolution.params : null;
      if (params === null) continue;
      console.log(
        `  #${String(row.id).padEnd(6)} ${romeTime.format(row.kickoffAt)}  ${params.homeTeam} — ${params.awayTeam}  [${params.sportKey}]`,
      );
    }
    console.log("\nPer il confronto reale: npm run odds:find (richiede la chiave, 0 crediti).");
    return;
  }

  /* Una sola chiamata per chiave sport, riusata da tutte le partite:
     l'endpoint è gratuito, ma ripeterlo per ogni riga sarebbe comunque
     traffico inutile verso la fonte. */
  const sportKeys = [...new Set(readable.map((row) => (row.resolution.ok ? row.resolution.params.sportKey : "")).filter((k) => k !== ""))];
  const eventsBySport = new Map<string, OddsApiEventLite[]>();
  let creditsUsed = 0;
  let creditsUnknown = false;

  for (const sportKey of sportKeys) {
    /* nessuna fetchImpl: qui si usa il fetch reale, ed è esattamente il punto. */
    const outcome = await fetchOddsApiEvents({ sportKey, apiKey: apiKey! });
    if (outcome.creditsUsed === null) creditsUnknown = true;
    else creditsUsed += outcome.creditsUsed;

    if (!outcome.result.ok) {
      console.log(`\n[${sportKey}] FONTE NON DISPONIBILE — ${outcome.result.error.message}`);
      continue;
    }
    eventsBySport.set(sportKey, outcome.result.data);
    const detail = outcome.result.partial ? ` (parziale: ${outcome.result.missing.join("; ")})` : "";
    console.log(
      `\n[${sportKey}] ${outcome.result.data.length} eventi dalla fonte${detail} — crediti dichiarati: ${outcome.creditsUsed ?? "non dichiarati"}`,
    );
  }

  console.log("\nConfronto partita interna ↔ evento della fonte\n");
  const usable: number[] = [];

  for (const row of readable) {
    if (!row.resolution.ok) continue;
    const params = row.resolution.params;
    const events = eventsBySport.get(params.sportKey);
    const head = `  #${String(row.id).padEnd(6)} ${romeTime.format(row.kickoffAt)}  ${params.homeTeam} — ${params.awayTeam}`;

    if (events === undefined) {
      console.log(`${head}\n          NON VERIFICATO — elenco eventi non disponibile per ${params.sportKey}`);
      continue;
    }

    const diagnosis = diagnoseEventMatch(
      { matchId: row.id, homeTeam: params.homeTeam, awayTeam: params.awayTeam, kickoffAt: params.kickoffAt },
      events,
    );

    if (diagnosis.status === "unico") {
      usable.push(row.id);
      console.log(`${head}\n          OK — ${describeDiagnosis(diagnosis)}`);
      continue;
    }
    console.log(`${head}\n          ${describeDiagnosis(diagnosis)}`);
  }

  console.log(
    `\ncrediti spesi in questa ricerca: ${creditsUnknown ? "almeno 0 (la fonte non li ha dichiarati tutti)" : creditsUsed}`,
  );

  if (usable.length === 0) {
    console.error(
      "\nNESSUNA PARTITA CON EVENTO UNICO SULLA FONTE: smoke test non eseguibile adesso.\n" +
        "Riprova quando i bookmaker pubblicano il turno successivo, oppure allarga la finestra (--ore).",
    );
    process.exitCode = 3;
    return;
  }

  console.log(`\nPARTITE PRONTE PER LO SMOKE TEST (${usable.length}). Il match id basta da solo:`);
  for (const id of usable.slice(0, 5)) {
    console.log(`  npm run smoke:odds-api -- --match-id ${id}`);
  }
  console.log(
    "\nLa lettura delle quote costa 1 credito e scrive gli snapshot reali nella partita scelta.",
  );
}

main()
  .catch((error) => {
    console.error("RICERCA FALLITA — errore non previsto.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
  });
