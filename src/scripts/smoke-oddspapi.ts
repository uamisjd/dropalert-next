/**
 * Smoke test manuale OddsPapi — una chiamata reale, per chiudere il gate
 * finale dell'adapter. Non accende il provider nel registry e non va nel cron:
 * `ODDS_PAPI_ADAPTER_IMPLEMENTED` resta `false` finché questo script non
 * produce un esito verificabile su dati reali.
 *
 * Uso (la chiave si legge da env, mai stampata):
 *
 *   ODDS_PAPI_KEY=... DATABASE_URL=... npm run smoke:oddspapi
 *   ODDS_PAPI_KEY=... npm run smoke:oddspapi -- --seleziona-torneo 17
 *
 * Cosa dimostra, nell'ordine:
 *   1. la chiave e la configurazione d'ambiente sono presenti;
 *   2. la scoperta per torneo produce fixture con quote (solo se si lascia
 *      fare la scoperta automatica);
 *   3. una chiamata reale a `/v4/odds` su un fixture selezionato traduce
 *      quote per-bookmaker (1X2 = market 101, O/U 2.5 = market 1010);
 *   4. vengono riconosciuti bookmaker "sharp" secondo la lista dichiarata
 *      (che va confermata contro `GET /v4/bookmakers`).
 *
 * Non stampa mai la chiave né la connection string. È volutamente un
 * pre-check: NON scrive in `odds_snapshots`. La scrittura vera e propria e
 * l'attivazione del provider restano un passo separato e controllato.
 */
import { fetchOddsPapiOdds } from "@/lib/providers/optional/oddspapi-client";
import { extractBookLines, type OddsPapiOdd } from "@/lib/providers/optional/oddspapi-odds";
import {
  SOCCER_SPORT_ID,
  isSharpBookmaker,
} from "@/lib/providers/optional/oddspapi-maps";
import {
  pickTournaments,
  fixturesWithOdds,
  type OddsPapiTournament,
} from "@/lib/providers/optional/oddspapi-discovery";

const ENDPOINT = "https://api.oddspapi.io";
const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_MISCONFIGURED = 2;

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function jsonGet<T>(
  path: string,
  params: Record<string, string>,
  toleranceMs = 8000,
): Promise<T> {
  const url = `${ENDPOINT}${path}?${new URLSearchParams(params).toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), toleranceMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<number> {
  const apiKey = env("ODDS_PAPI_KEY");
  if (apiKey === null) {
    console.error("Manca ODDS_PAPI_KEY: non posso fare una chiamata reale.");
    return EXIT_MISCONFIGURED;
  }

  console.log("\nSmoke test OddsPapi (nessuna scrittura in DB, pre-check)");
  console.log(`  sport      : calcio (sportId ${SOCCER_SPORT_ID})`);
  console.log(`  mercati    : 1X2 = 101, O/U 2.5 = 1010 (schema verificato)`);
  console.log("");

  // 1) scoperta di un fixture con quote (se richiesta)
  let fixtureId = arg("--fixture-id");
  if (fixtureId === null) {
    console.log("1/3 scoperta torneo → fixture con quote");
    const sports = await jsonGet<OddsPapiTournament[]>("/v4/tournaments", {
      apiKey,
      sportId: String(SOCCER_SPORT_ID),
    });
    // seleziona un torneo con fixture in arrivo, altrimenti il primo con qualche match
    const candidates = pickTournaments(Array.isArray(sports) ? sports : []);
    if (candidates.length === 0) {
      console.error("   nessun torneo con fixture imminente.");
      return EXIT_FAILED;
    }
    const chosen = candidates[0];
    console.log(`   torneo: ${chosen.tournamentName ?? chosen.tournamentSlug} (id ${chosen.tournamentId})`);
    const byTournament = await jsonGet<unknown>("/v4/odds-by-tournaments", {
      apiKey,
      tournamentIds: String(chosen.tournamentId),
      verbosity: "1",
    });
    const fixtures = fixturesWithOdds(byTournament);
    if (fixtures.length === 0) {
      console.error("   nessun fixture con quote nel torneo scelto.");
      return EXIT_FAILED;
    }
    fixtureId = fixtures[0].fixtureId;
    console.log(`   fixture: ${fixtures[0].participant1Name ?? "?"} — ${fixtures[0].participant2Name ?? "?"} (id ${fixtureId})`);
  } else {
    console.log("1/3 fixture fornito a mano");
  }

  // 2) chiamata /odds reale
  console.log("2/3 lettura quote per-bookmaker (chiamata reale)");
  const odds = await fetchOddsPapiOdds({
    sportKey: "soccer",
    providerMatchId: fixtureId!,
    fixtureKey: `smoke-${fixtureId}`,
    homeTeam: "",
    awayTeam: "",
    kickoffAt: new Date(),
    apiKey,
  });
  if (!odds.ok) {
    console.error(`   chiamata fallita: ${odds.error.kind} — ${odds.error.message}`);
    return EXIT_FAILED;
  }
  const parsed = extractBookLines(odds.data as unknown as OddsPapiOdd, new Date());
  console.log(`   rimosso wrapper -> ${parsed.lines.length} linee, ${parsed.bookmakersSeen} bookmaker visti, ${parsed.skippedOutcomes} esiti scartati`);
  if (parsed.lines.length === 0) {
    console.error("   nessuna linea per-bookmaker tradotta.");
    return EXIT_FAILED;
  }

  const books = new Set(parsed.lines.map((l) => l.bookmakerKey));
  const sharps = parsed.lines.filter((l) => l.isSharp).map((l) => l.bookmakerKey);
  console.log(`   bookmaker  : ${[...books].slice(0, 12).join(", ")}${books.size > 12 ? " …" : ""}`);
  console.log(`   sharp      : ${[...new Set(sharps)].join(", ") || "nessuno (lista da confermare su /bookmakers)"}`);
  console.log(`   mercati    : ${[...new Set(parsed.lines.map((l) => l.market))].join(", ")}`);

  const h2h = parsed.lines.filter((l) => l.market === "1x2").length > 0;
  const first = parsed.lines[0];
  console.log(`   esempio    : ${first.bookmakerKey} ${first.market}/${first.selection} = ${first.price.toFixed(3)} (${isSharpBookmaker(first.bookmakerKey) ? "sharp" : "book"})`);

  // 3) verifica criteri di gating
  console.log("3/3 verifica criteri");
  if (!h2h) {
    console.error("   nessuna selezione 1X2 tradotta: il parser non ha risolto il mercato 101.");
    return EXIT_FAILED;
  }

  console.log("\nEsito");
  console.log(`  chiamata reale per-bookmaker : riuscita (${parsed.lines.length} linee)`);
  console.log(`  mercato 1X2 (101)            : ${h2h ? "tradotto" : "assente"}`);
  console.log(`  bookmaker sharp riconosciuti : ${[...new Set(sharps)].join(", ") || "nessuno"}`);
  console.log(
    `\nSMOKE OK su dati reali. L'adapter resta comunque SPENTO:\n` +
      `  l'attivazione è un passo separato e controllato, non una conseguenza di questo script.\n` +
      `  Conferma la lista sharp contro GET /v4/bookmakers prima di attivare.`,
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
  });
