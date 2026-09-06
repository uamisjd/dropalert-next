/**
 * Smoke test manuale, una sola chiamata, per chiudere il gate finale di
 * The Odds API. Non accende il provider nel registry e non va nel cron.
 *
 * Variabili richieste:
 * ODDS_API_KEY (uno dei nomi accettati), DATABASE_URL,
 * ODDS_API_SMOKE_MATCH_ID, ODDS_API_SMOKE_SPORT_KEY,
 * ODDS_API_SMOKE_FIXTURE_KEY, ODDS_API_SMOKE_HOME_TEAM,
 * ODDS_API_SMOKE_AWAY_TEAM, ODDS_API_SMOKE_KICKOFF_AT.
 *
 * La chiamata consuma un credito e, se completa, scrive gli snapshot reali
 * nella partita indicata. Non stampa mai la chiave o la connection string.
 */
import { readOddsApiKey } from "@/lib/providers/optional/odds-api-budget";
import { fetchTheOddsApiOdds } from "@/lib/providers/optional/the-odds-api-client";
import { writeProviderSnapshots } from "@/lib/providers/ingest-snapshots";
import { sql } from "@/db/client";

const required = [
  "DATABASE_URL",
  "ODDS_API_SMOKE_MATCH_ID",
  "ODDS_API_SMOKE_SPORT_KEY",
  "ODDS_API_SMOKE_FIXTURE_KEY",
  "ODDS_API_SMOKE_HOME_TEAM",
  "ODDS_API_SMOKE_AWAY_TEAM",
  "ODDS_API_SMOKE_KICKOFF_AT",
] as const;

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? null : value;
}

async function main(): Promise<void> {
  const missing: string[] = required.filter((name) => env(name) === null);
  if (readOddsApiKey() === null) missing.push("THE_ODDS_API_KEY / ODDS_API_KEY");
  if (missing.length > 0) {
    console.error(`SMOKE NON ESEGUITO — variabili mancanti: ${missing.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  const matchId = Number(env("ODDS_API_SMOKE_MATCH_ID"));
  const kickoffAt = new Date(env("ODDS_API_SMOKE_KICKOFF_AT")!);
  if (!Number.isInteger(matchId) || matchId <= 0 || Number.isNaN(kickoffAt.getTime())) {
    console.error("SMOKE NON ESEGUITO — match id o kickoff non interpretabile.");
    process.exitCode = 2;
    return;
  }

  const result = await fetchTheOddsApiOdds({
    apiKey: readOddsApiKey()!,
    sportKey: env("ODDS_API_SMOKE_SPORT_KEY")!,
    fixtureKey: env("ODDS_API_SMOKE_FIXTURE_KEY")!,
    homeTeam: env("ODDS_API_SMOKE_HOME_TEAM")!,
    awayTeam: env("ODDS_API_SMOKE_AWAY_TEAM")!,
    kickoffAt,
  });

  if (!result.ok) {
    console.error(`SMOKE FALLITO — ${result.error.kind}: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  if (result.partial) {
    console.error(`SMOKE FALLITO — risposta parziale: ${result.missing.join("; ")}`);
    process.exitCode = 1;
    return;
  }

  const persistence = await writeProviderSnapshots(
    matchId,
    result.data,
    null,
    "the-odds-api-smoke",
  );
  console.log(
    `SMOKE OK — quote: ${result.data.length}, bookmaker: ${new Set(result.data.map((q) => q.bookmakerKey)).size}, snapshot scritti: ${persistence.written}, duplicati: ${persistence.skipped}.`,
  );
}

main()
  .catch((error) => {
    console.error("SMOKE FALLITO — errore non previsto.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
  });
