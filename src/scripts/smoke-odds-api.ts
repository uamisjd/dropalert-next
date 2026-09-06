/**
 * Smoke test manuale, una sola chiamata a pagamento, per chiudere il gate
 * finale di The Odds API. Non accende il provider nel registry e non va nel
 * cron: `ADAPTER_IMPLEMENTED` resta `false` finché questo script non produce
 * un esito verificabile su dati reali.
 *
 * Uso semplice (consigliato — basta il match id, il resto viene dall'archivio):
 *
 *   npm run odds:find                          # trova le partite leggibili
 *   npm run smoke:odds-api -- --match-id 1234  # 1 credito, scrive gli snapshot
 *
 * Uso esplicito (ogni variabile vince su quella derivata dall'archivio, per
 * correggere a mano una grafia che non combacia senza toccare il codice):
 *
 *   ODDS_API_SMOKE_MATCH_ID, ODDS_API_SMOKE_SPORT_KEY,
 *   ODDS_API_SMOKE_FIXTURE_KEY, ODDS_API_SMOKE_HOME_TEAM,
 *   ODDS_API_SMOKE_AWAY_TEAM, ODDS_API_SMOKE_KICKOFF_AT
 *
 * Più, in entrambi i casi: una chiave fra THE_ODDS_API_KEY / ODDS_API_KEY /
 * theoddsapiKey / THEODDSAPIKEY e DATABASE_URL.
 *
 * Costo: 1 credito (1 mercato × 1 regione). Il pre-check di matching usa
 * l'endpoint gratuito degli eventi e serve a non spendere quel credito su una
 * partita che il client non riconoscerebbe: se il pre-check non trova un
 * evento unico, lo script si ferma PRIMA della chiamata a pagamento.
 *
 * Cosa dimostra, nell'ordine: chiamata reale riuscita, matching di partita e
 * kickoff, quote individuali salvate in `odds_snapshots`, freshness verificata
 * sullo stesso percorso che usa la pagina partita. Non stampa mai la chiave né
 * la connection string.
 */
import { eq } from "drizzle-orm";
import { readOddsApiKey } from "@/lib/providers/optional/odds-api-budget";
import { fetchTheOddsApiOdds } from "@/lib/providers/optional/the-odds-api-client";
import { fetchOddsApiEvents } from "@/lib/providers/optional/the-odds-api-events";
import {
  describeDiagnosis,
  diagnoseEventMatch,
  resolveSmokeMatch,
  type SmokeMatchParams,
} from "@/lib/providers/optional/odds-match-resolver";
import { writeProviderSnapshots } from "@/lib/providers/ingest-snapshots";
import { getMatchDetail } from "@/lib/repo/match-detail";
import { executablePriceFromSeries } from "@/lib/decision/price-evidence";
import { STALE_SNAPSHOT_MINUTES } from "@/lib/drop/constants";
import { db, sql } from "@/db/client";
import { leagues, matches, teams } from "@/db/schema";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_MISCONFIGURED = 2;
const EXIT_PRECHECK = 4;

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? null : value;
}

interface ResolvedParams {
  params: SmokeMatchParams;
  /** da dove arriva ogni valore: serve a sapere cosa si sta davvero testando */
  origin: Record<keyof SmokeMatchParams, "ambiente" | "archivio">;
  notes: string[];
}

/** Carica la partita dall'archivio con i nomi delle squadre e la competizione. */
async function loadMatchRow(matchId: number) {
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

  const teamRows = await db
    .select({ id: teams.id, name: teams.name })
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
    homeTeamName: teamRows[0]?.name ?? null,
    awayTeamName: awayRow?.name ?? null,
  };
}

/**
 * Unisce le variabili esplicite con ciò che deriva dall'archivio.
 * Le variabili esplicite vincono: è l'unico modo onesto di correggere una
 * grafia senza modificare il codice della fonte.
 */
async function resolveParams(matchId: number | null): Promise<ResolvedParams | { error: string }> {
  const explicit = {
    sportKey: env("ODDS_API_SMOKE_SPORT_KEY"),
    fixtureKey: env("ODDS_API_SMOKE_FIXTURE_KEY"),
    homeTeam: env("ODDS_API_SMOKE_HOME_TEAM"),
    awayTeam: env("ODDS_API_SMOKE_AWAY_TEAM"),
    kickoffAt: env("ODDS_API_SMOKE_KICKOFF_AT"),
  };
  const complete =
    explicit.sportKey !== null &&
    explicit.fixtureKey !== null &&
    explicit.homeTeam !== null &&
    explicit.awayTeam !== null &&
    explicit.kickoffAt !== null;

  if (complete && matchId !== null && matchId > 0) {
    const kickoffAt = new Date(explicit.kickoffAt!);
    if (Number.isNaN(kickoffAt.getTime())) {
      return { error: "ODDS_API_SMOKE_KICKOFF_AT non è una data interpretabile." };
    }
    return {
      params: {
        matchId,
        fixtureKey: explicit.fixtureKey!,
        sportKey: explicit.sportKey!,
        homeTeam: explicit.homeTeam!,
        awayTeam: explicit.awayTeam!,
        kickoffAt,
      },
      origin: {
        matchId: "ambiente",
        fixtureKey: "ambiente",
        sportKey: "ambiente",
        homeTeam: "ambiente",
        awayTeam: "ambiente",
        kickoffAt: "ambiente",
      },
      notes: ["tutti i parametri arrivano dalle variabili d'ambiente"],
    };
  }

  if (matchId === null) {
    return {
      error:
        "manca la partita. Esegui prima: npm run odds:find\n" +
        "poi: npm run smoke:odds-api -- --match-id <id>",
    };
  }

  const row = await loadMatchRow(matchId);
  if (row === null) {
    return { error: `partita ${matchId} non presente in archivio.` };
  }

  const resolution = resolveSmokeMatch(row, new Date());
  if (!resolution.ok) {
    return { error: `partita ${matchId} non leggibile sulla fonte: ${resolution.reason}` };
  }

  const derived = resolution.params;
  const kickoffFromEnv =
    explicit.kickoffAt !== null ? new Date(explicit.kickoffAt) : derived.kickoffAt;
  if (Number.isNaN(kickoffFromEnv.getTime())) {
    return { error: "ODDS_API_SMOKE_KICKOFF_AT non è una data interpretabile." };
  }

  const params: SmokeMatchParams = {
    matchId: derived.matchId,
    fixtureKey: explicit.fixtureKey ?? derived.fixtureKey,
    sportKey: explicit.sportKey ?? derived.sportKey,
    homeTeam: explicit.homeTeam ?? derived.homeTeam,
    awayTeam: explicit.awayTeam ?? derived.awayTeam,
    kickoffAt: kickoffFromEnv,
  };

  const origin: Record<keyof SmokeMatchParams, "ambiente" | "archivio"> = {
    matchId: "ambiente",
    fixtureKey: explicit.fixtureKey !== null ? "ambiente" : "archivio",
    sportKey: explicit.sportKey !== null ? "ambiente" : "archivio",
    homeTeam: explicit.homeTeam !== null ? "ambiente" : "archivio",
    awayTeam: explicit.awayTeam !== null ? "ambiente" : "archivio",
    kickoffAt: explicit.kickoffAt !== null ? "ambiente" : "archivio",
  };

  const overridden = (Object.keys(origin) as Array<keyof SmokeMatchParams>).filter(
    (key) => origin[key] === "ambiente",
  );
  const notes = [
    ...resolution.notes,
    overridden.length > 1
      ? `valori presi dalle variabili d'ambiente: ${overridden.join(", ")}`
      : "tutti i valori derivati dall'archivio (nessuna variabile esplicita)",
  ];

  return { params, origin, notes };
}

async function main(): Promise<number> {
  const now = new Date();
  const missing: string[] = [];
  const apiKey = readOddsApiKey();
  if (apiKey === null) missing.push("THE_ODDS_API_KEY / ODDS_API_KEY");
  if (env("DATABASE_URL") === null) missing.push("DATABASE_URL");
  if (missing.length > 0) {
    console.error(`SMOKE NON ESEGUITO — variabili mancanti: ${missing.join(", ")}`);
    return EXIT_MISCONFIGURED;
  }

  const matchIdArgument = argument("--match-id");
  const matchId =
    matchIdArgument !== null
      ? Number(matchIdArgument)
      : env("ODDS_API_SMOKE_MATCH_ID") !== null
        ? Number(env("ODDS_API_SMOKE_MATCH_ID"))
        : null;
  if (matchId !== null && (!Number.isInteger(matchId) || matchId <= 0)) {
    console.error("SMOKE NON ESEGUITO — match id non interpretabile.");
    return EXIT_MISCONFIGURED;
  }

  const resolved = await resolveParams(matchId);
  if ("error" in resolved) {
    console.error(`SMOKE NON ESEGUITO — ${resolved.error}`);
    return EXIT_MISCONFIGURED;
  }

  const { params, origin, notes } = resolved;
  const skipPrecheck = process.argv.includes("--salta-precheck");

  console.log("\nSmoke test The Odds API");
  console.log(`partita      : #${params.matchId}`);
  console.log(`chiave sport : ${params.sportKey} (da ${origin.sportKey})`);
  console.log(`fixture      : ${params.fixtureKey} (da ${origin.fixtureKey})`);
  console.log(`squadre      : ${params.homeTeam} — ${params.awayTeam} (da ${origin.homeTeam})`);
  console.log(`kickoff      : ${params.kickoffAt.toISOString()} (da ${origin.kickoffAt})`);
  for (const note of notes) console.log(`nota         : ${note}`);

  /* PASSO 1 — matching verificato GRATIS, prima di spendere il credito.
     Usa l'endpoint /events (fuori quota) e la stessa regola del client. */
  if (!skipPrecheck) {
    console.log("\n1/4 pre-check di matching (endpoint gratuito, 0 crediti)");
    /* fetch reale: nessuna iniezione, è la chiamata che deve essere verificata. */
    const outcome = await fetchOddsApiEvents({ sportKey: params.sportKey, apiKey: apiKey! });
    if (!outcome.result.ok) {
      console.error(
        `PRE-CHECK NON CONCLUSO — ${outcome.result.error.message}\n` +
          "Nessun credito speso. Per forzare comunque la lettura: aggiungi --salta-precheck.",
      );
      return EXIT_PRECHECK;
    }
    const diagnosis = diagnoseEventMatch(
      {
        matchId: params.matchId,
        homeTeam: params.homeTeam,
        awayTeam: params.awayTeam,
        kickoffAt: params.kickoffAt,
      },
      outcome.result.data,
    );
    console.log(`   eventi sulla fonte: ${outcome.result.data.length} — crediti: ${outcome.creditsUsed ?? "non dichiarati"}`);
    console.log(`   ${describeDiagnosis(diagnosis)}`);

    if (diagnosis.status !== "unico") {
      console.error(
        "\nSMOKE INTERROTTO PRIMA DELLA CHIAMATA A PAGAMENTO — il client non troverebbe un evento unico.\n" +
          "Correggi la grafia con le variabili ODDS_API_SMOKE_HOME_TEAM / ODDS_API_SMOKE_AWAY_TEAM,\n" +
          "oppure scegli un'altra partita: npm run odds:find\n" +
          "Per forzare la lettura comunque (1 credito): aggiungi --salta-precheck.",
      );
      return EXIT_PRECHECK;
    }
  } else {
    console.log("\n1/4 pre-check SALTATO su richiesta (--salta-precheck)");
  }

  /* PASSO 2 — la sola chiamata a pagamento: 1 mercato (h2h) × 1 regione (eu). */
  console.log("\n2/4 lettura quote individuali (1 credito)");
  const result = await fetchTheOddsApiOdds({
    apiKey: apiKey!,
    sportKey: params.sportKey,
    fixtureKey: params.fixtureKey,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    kickoffAt: params.kickoffAt,
  });

  if (!result.ok) {
    console.error(`SMOKE FALLITO — ${result.error.kind}: ${result.error.message}`);
    return EXIT_FAILED;
  }
  if (result.partial) {
    console.error(`SMOKE FALLITO — risposta parziale: ${result.missing.join("; ")}`);
    return EXIT_FAILED;
  }

  const books = [...new Set(result.data.map((quote) => quote.bookmakerKey))];
  console.log(`   quote lette: ${result.data.length} su ${books.length} bookmaker`);
  console.log(`   bookmaker  : ${books.slice(0, 12).join(", ")}${books.length > 12 ? " …" : ""}`);
  if (result.data.some((quote) => quote.isConsensus)) {
    console.error("SMOKE FALLITO — la fonte ha restituito una riga consensus: non è una quota individuale.");
    return EXIT_FAILED;
  }

  /* PASSO 3 — persistenza reale in odds_snapshots. */
  console.log("\n3/4 scrittura in odds_snapshots");
  const persistence = await writeProviderSnapshots(
    params.matchId,
    result.data,
    null,
    "the-odds-api-smoke",
  );
  console.log(
    `   snapshot scritti: ${persistence.written} — duplicati saltati: ${persistence.skipped} — anagrafiche bookmaker: ${persistence.bookmakersEnsured}`,
  );
  if (persistence.written === 0 && persistence.skipped === 0) {
    console.error("SMOKE FALLITO — nessuna riga da scrivere: persistenza non verificata.");
    return EXIT_FAILED;
  }

  /* PASSO 4 — rilettura con lo stesso percorso della pagina partita. */
  console.log(`\n4/4 verifica freshness e prezzo eseguibile (soglia ${STALE_SNAPSHOT_MINUTES} minuti)`);
  const detail = await getMatchDetail(params.matchId, now);
  if (detail === null) {
    console.error("SMOKE FALLITO — la partita non è più leggibile dopo la scrittura.");
    return EXIT_FAILED;
  }

  const smokeSeries = detail.series.filter((serie) =>
    serie.points.some((point) => point.source === "the-odds-api-smoke"),
  );
  console.log(
    `   serie con punto dello smoke: ${smokeSeries.length} — serie totali sulla partita: ${detail.series.length}`,
  );
  if (smokeSeries.length === 0) {
    console.error("SMOKE FALLITO — gli snapshot scritti non compaiono nelle serie della partita.");
    return EXIT_FAILED;
  }

  let executableFound = 0;
  for (const serie of smokeSeries) {
    const evidence = executablePriceFromSeries(
      detail.series,
      serie.market,
      serie.selection,
      now,
      STALE_SNAPSHOT_MINUTES,
    );
    if (evidence === null) continue;
    executableFound += 1;
    console.log(
      `   PREZZO ESEGUIBILE ${serie.market}/${serie.selection}: ${evidence.price.toFixed(3)} da ${evidence.bookmakerKey} (${evidence.source}), età ${evidence.ageMinutes} min`,
    );
  }

  console.log("\nEsito");
  console.log("  chiamata reale        : riuscita");
  console.log("  matching partita      : verificato");
  console.log("  quote individuali     : salvate in odds_snapshots");
  console.log(
    `  freshness             : ${executableFound > 0 ? `verificata su ${executableFound} selezioni` : "NESSUNA linea individuale fresca riconosciuta"}`,
  );

  if (executableFound === 0) {
    console.error(
      "\nSMOKE NON CONCLUSO — i dati sono salvati ma il gate del prezzo eseguibile non li accetta.\n" +
        "Non attivare il provider: senza una linea individuale fresca il sito continua a dire NO BET.",
    );
    return EXIT_FAILED;
  }

  console.log(
    "\nSMOKE OK — gate superati su dati reali. Il provider resta comunque SPENTO:\n" +
      "l'attivazione è un passo separato e controllato, non una conseguenza di questo script.",
  );
  return EXIT_OK;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("SMOKE FALLITO — errore non previsto.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT_FAILED;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
  });
