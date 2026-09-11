/**
 * Smoke test del cablaggio per-bookmaker — la verifica che precede l'attivazione.
 *
 *   npm run smoke:odds-wire            # elenco candidati, zero crediti
 *   npm run smoke:odds-wire -- --read <id>   # lettura reale di una partita (1 credito)
 *
 * PERCHÉ ESISTE. L'accensione del cablaggio (ODDS_WIRE_COLLECT +
 * DROP_EXCLUDE_CONSENSUS_BOOKS) è una decisione umana, ma non va presa alla
 * cieca: prima bisogna vedere, sui dati veri, QUALI partite il ciclo leggerebbe
 * e QUALE partita verrebbe scartata e perché. Questo strumento risponde alla
 * prima domanda a costo zero (usa la STESSA selezione del ciclo, non una copia)
 * e alla seconda con una lettura reale da un credito attraverso il MEDESIMO
 * percorso di persistenza del ciclo.
 *
 * REGOLE DI ONESTÀ:
 *  - senza `--read` non esce alcuna richiesta a pagamento: solo lettura del
 *    database e la selezione pura `pickWireCandidates`;
 *  - con `--read` la sorgente scritta è `the-odds-api-wire-smoke`, distinta da
 *    quella di produzione, come già fa `smoke:odds-api` (`the-odds-api-smoke`);
 *  - il credito è dichiarato solo quando la richiesta esce davvero verso la
 *    fonte (stessa convenzione di `creditsSpentFor`);
 *  - lo stato dei flag (`wireGate`) è stampato per primo: se la fase è spenta
 *    lo smoke lo dice, ma la lettura esplicita resta possibile per verificare
 *    il percorso prima di accenderla.
 */
import { eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { leagues, matches, teams } from "@/db/schema";
import {
  creditsSpentFor,
  listWireSignalRows,
  listWireSignalStats,
  pickWireCandidates,
  wireGate,
  WIRE_MIN_CONFIDENCE,
} from "@/lib/providers/optional/odds-collect-wire";
import { resolveSmokeMatch, type DbMatchRow } from "@/lib/providers/optional/odds-match-resolver";
import { collectAndPersistTheOddsApiOdds } from "@/lib/providers/optional/collect-the-odds-api";
import { THE_ODDS_API_WIRE_SMOKE_SOURCE } from "@/lib/providers/snapshot-sources";

const SMOKE_SOURCE = THE_ODDS_API_WIRE_SMOKE_SOURCE;

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

/** Carica la riga partita con i campi che la risoluzione smoke richiede. */
async function loadMatchRow(matchId: number): Promise<DbMatchRow | null> {
  const [row] = await db
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
    .leftJoin(leagues, eq(leagues.id, matches.leagueId))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!row) return null;

  const homeRows = await db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.id, row.homeTeamId));
  const [awayRow] = await db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.id, row.awayTeamId))
    .limit(1);

  return {
    id: row.id,
    key: row.key,
    kickoffAt: row.kickoffAt,
    status: row.status,
    leagueName: row.leagueName,
    homeTeamName: homeRows[0]?.name ?? null,
    awayTeamName: awayRow?.name ?? null,
  };
}

async function listCandidates(): Promise<void> {
  const gate = wireGate(process.env);
  console.log("=== CABLAGGIO PER-BOOKMAKER — SMOKE (0 crediti) ===");
  console.log(
    `flag                  : ${gate.enabled ? "ACCESO" : "SPENTO"}${
      gate.reason ? ` — ${gate.reason}` : ""
    }`,
  );

  const stats = await listWireSignalStats();
  console.log(
    `segnali attivi in DB   : ${stats.activeTotal} (di cui ${stats.activeEligible} con indice ≥ ${WIRE_MIN_CONFIDENCE}, la soglia del cablaggio)`,
  );

  const rows = await listWireSignalRows();
  const { candidates, skipped } = pickWireCandidates(rows, new Date());

  console.log(`\nCandidati del ciclo (${candidates.length}):`);
  for (const c of candidates) {
    console.log(
      `  #${c.matchId} ${c.homeTeam} — ${c.awayTeam} · ${c.sportKey} · indice ${c.confidenceScore} · kickoff ${c.kickoffAt.toISOString()}`,
    );
  }
  if (candidates.length === 0) {
    console.log(
      "  nessuno in questo istante: guarda i segnali attivi qui sopra e gli scartati qui sotto per capire il perché.",
    );
  }

  if (skipped.length > 0) {
    console.log(`\nScartati dalla selezione (${skipped.length}):`);
    for (const s of skipped.slice(0, 12)) {
      console.log(`  #${s.matchId}: ${s.reason}`);
    }
    if (skipped.length > 12) {
      console.log(`  … e altri ${skipped.length - 12}`);
    }
  }

  console.log(
    "\nPer la lettura reale di una partita (1 credito):",
  );
  console.log("  npm run smoke:odds-wire -- --read <id>");
}

async function readMatch(matchId: number): Promise<void> {
  const row = await loadMatchRow(matchId);
  if (row === null) {
    console.error(`SMOKE FALLITO — partita ${matchId} non presente in archivio.`);
    process.exitCode = 2;
    return;
  }

  const resolution = resolveSmokeMatch(row, new Date(), null);
  if (!resolution.ok) {
    console.error(`SMOKE FALLITO — partita ${matchId} non leggibile: ${resolution.reason}`);
    process.exitCode = 2;
    return;
  }

  const params = resolution.params;
  console.log("=== CABLAGGIO PER-BOOKMAKER — LETTURA REALE (1 credito) ===");
  console.log(
    `partita               : #${params.matchId} ${params.homeTeam} — ${params.awayTeam} (${params.sportKey})`,
  );

  const outcome = await collectAndPersistTheOddsApiOdds({
    matchId: params.matchId,
    fixtureKey: params.fixtureKey,
    sportKey: params.sportKey,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    kickoffAt: params.kickoffAt,
    runId: null,
    source: SMOKE_SOURCE,
  });

  const credits = creditsSpentFor(outcome.result);
  if (!outcome.result.ok) {
    console.error(
      `SMOKE FALLITO — ${outcome.result.error.kind}: ${outcome.result.error.message}`,
    );
    console.log(`crediti spesi         : ${credits} (la richiesta è uscita solo se 1)`);
    process.exitCode = 3;
    return;
  }

  const books = [...new Set(outcome.result.data.map((q) => q.bookmakerKey))];
  console.log(`quote lette           : ${outcome.result.data.length} su ${books.length} bookmaker`);
  console.log(`bookmaker             : ${books.slice(0, 14).join(", ")}${books.length > 14 ? " …" : ""}`);
  console.log(`crediti spesi         : ${credits}`);
  if (outcome.persistenceError !== null) {
    console.log(`persistenza           : FALLITA — ${outcome.persistenceError}`);
    console.log("\nSMOKE PARZIALE — lettura riuscita ma scrittura in odds_snapshots fallita.");
    process.exitCode = 4;
    return;
  }
  console.log(
    `snapshot scritti      : ${outcome.persistence?.written ?? 0} (sorgente ${SMOKE_SOURCE})`,
  );
  console.log(
    `anagrafiche bookmaker : ${outcome.persistence?.bookmakersEnsured ?? 0}`,
  );
  if (outcome.result.partial) {
    console.log(`parziale              : ${outcome.result.missing.join("; ")}`);
  }
  console.log("\nSMOKE OK — il percorso di lettura+persistenza del cablaggio funziona.");
}

async function main(): Promise<void> {
  const readId = arg("--read");
  if (readId !== null) {
    const id = Number(readId);
    if (!Number.isInteger(id) || id <= 0) {
      console.error("SMOKE FALLITO — --read richiede un id numerico positivo.");
      process.exitCode = 2;
      return;
    }
    await readMatch(id);
  } else {
    await listCandidates();
  }
  console.log(
    "\nNota: nessuna vincita garantita. La lettura è una verifica del percorso, non un consiglio di giocata.",
  );
}

main()
  .then(async () => {
    await sql.end({ timeout: 5 });
  })
  .catch(async (err) => {
    console.error("Smoke interrotto:", err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
