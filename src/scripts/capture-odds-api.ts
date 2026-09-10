/**
 * Cattura UNA risposta reale di The Odds API (`/odds`) e la salva come fixture
 * per il test di contratto del parser.
 *
 *   npm run odds:capture                                  # Serie A (default)
 *   npm run odds:capture -- --sport-key soccer_epl        # altro campionato
 *   npm run odds:capture -- --sport-key x --max-events 2  # riduci il fixture
 *   npm run odds:capture -- --salta-precheck              # salta il pre-check gratuito
 *
 * PERCHÉ ESISTE: nessun test oggi usa una risposta catturata dal vivo — i
 * fixture sono esempi scritti a mano. Questo script chiude quel buco con una
 * sola chiamata a pagamento, così il parser viene messo alla prova contro la
 * forma REALE della fonte e non contro ciò che abbiamo immaginato.
 *
 * COSTO: 1 credito (1 mercato `h2h` × 1 regione `eu`, come il client). Il
 * pre-check usa `/events`, che la fonte dichiara fuori quota (0 crediti), solo
 * per non spendere quel credito su una chiave senza partite.
 *
 * GARANZIE: non tocca il database; non stampa MAI la chiave né l'URL con la
 * chiave; scrive soltanto il body (`JSON`) nel file fixture, mai la query
 * string. Riusa le stesse costanti del client, così il fixture riflette
 * esattamente ciò che `fetchTheOddsApiOdds` vedrebbe in produzione.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readOddsApiKey } from "@/lib/providers/optional/odds-api-budget";
import { fetchOddsApiEvents } from "@/lib/providers/optional/the-odds-api-events";
import {
  THE_ODDS_API_MARKETS,
  THE_ODDS_API_REGION,
  THE_ODDS_API_TIMEOUT_MS,
} from "@/lib/providers/optional/the-odds-api-client";

const ENDPOINT = "https://api.the-odds-api.com/v4/sports";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_MISCONFIGURED = 2;

const DEFAULT_SPORT_KEY = "soccer_italy_serie_a";
const DEFAULT_OUT = "src/lib/providers/optional/__tests__/fixtures/the-odds-api-odds-live.json";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? null : value;
}

function headerNumber(response: Response, name: string): number | null {
  const value = response.headers?.get?.(name);
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function main(): Promise<number> {
  const apiKey = readOddsApiKey();
  if (apiKey === null) {
    console.error(
      "CAPTURE NON ESEGUITO — chiave mancante.\n" +
        "Serve una fra THE_ODDS_API_KEY, ODDS_API_KEY, theoddsapiKey, THEODDSAPIKEY.",
    );
    return EXIT_MISCONFIGURED;
  }

  const sportKey =
    argument("--sport-key") ??
    env("ODDS_API_CAPTURE_SPORT_KEY") ??
    DEFAULT_SPORT_KEY;

  const outPath = resolve(
    argument("--out") ?? env("ODDS_API_CAPTURE_OUT") ?? DEFAULT_OUT,
  );

  const maxEventsRaw = argument("--max-events");
  const maxEvents =
    maxEventsRaw !== null ? Math.max(1, Number(maxEventsRaw) || 1) : null;
  const skipPrecheck = process.argv.includes("--salta-precheck");

  console.log("\nCattura risposta reale The Odds API");
  console.log(`chiave sport : ${sportKey}`);
  console.log(`output       : ${outPath}`);
  console.log(`mercato      : ${THE_ODDS_API_MARKETS} · regione ${THE_ODDS_API_REGION}`);

  /* PASSO 1 — pre-check GRATUITO (/events): evita di bruciare il credito su
     una chiave senza partite. Se salti il pre-check, il costo resta a rischio. */
  if (!skipPrecheck) {
    console.log("\n1/2 pre-check eventi (endpoint gratuito, 0 crediti)");
    const check = await fetchOddsApiEvents({ sportKey, apiKey });
    if (!check.result.ok) {
      console.error(
        `PRE-CHECK NON CONCLUSO — ${check.result.error.message}\n` +
          "Nessun credito speso. Se vuoi forzare comunque la lettura: aggiungi --salta-precheck.",
      );
      return EXIT_FAILED;
    }
    const events = check.result.data;
    console.log(`   eventi in programma: ${events.length}`);
    if (check.creditsRemaining !== null) {
      console.log(`   crediti residui nel mese: ${check.creditsRemaining}`);
    }
    if (events.length === 0) {
      console.error(
        "\nPRE-CHECK NON CONCLUSO — la fonte non pubblica eventi per questa chiave sport.\n" +
          "Scegli un'altra competizione (es. --sport-key soccer_epl) o aggiungi --salta-precheck.",
      );
      return EXIT_FAILED;
    }
  } else {
    console.log("\n1/2 pre-check SALTATO su richiesta (--salta-precheck)");
  }

  /* PASSO 2 — la sola chiamata a pagamento. Costruisce l'URL identico al
     client, ma conserva il body GREZZO (non lo trasforma in DTO). */
  console.log("\n2/2 lettura quote individuali (1 credito)");
  const url = `${ENDPOINT}/${encodeURIComponent(sportKey)}/odds`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THE_ODDS_API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `${url}?apiKey=${encodeURIComponent(apiKey)}&regions=${THE_ODDS_API_REGION}&markets=${THE_ODDS_API_MARKETS}&oddsFormat=decimal`,
      { signal: controller.signal },
    );
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    console.error(
      `CAPTURE FALLITO — ${timeout ? `timeout dopo ${THE_ODDS_API_TIMEOUT_MS} ms` : "errore di rete"}.`,
    );
    return EXIT_FAILED;
  } finally {
    clearTimeout(timer);
  }

  const creditsUsed = headerNumber(response, "x-requests-last");
  const creditsRemaining = headerNumber(response, "x-requests-remaining");
  const body = await response.text();

  if (!response.ok) {
    console.error(
      `CAPTURE FALLITO — risposta HTTP ${response.status} sulla lettura quote.` +
        (response.status === 429 ? " (quota mensile esaurita?)" : ""),
    );
    return EXIT_FAILED;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    console.error("CAPTURE FALLITO — la fonte non ha restituito JSON interpretabile.");
    return EXIT_FAILED;
  }

  if (!Array.isArray(payload)) {
    console.error("CAPTURE FALLITO — la risposta non è un elenco di eventi.");
    return EXIT_FAILED;
  }

  /* Riduzione opzionale: mantiene un sottoinsieme VERTIM (ogni evento resta
     com'è), utile per tenere la fixture piccola nel repository. */
  const kept: unknown[] =
    maxEvents !== null ? payload.slice(0, maxEvents) : payload;
  const dropped = payload.length - kept.length;

  await mkdir(dirname(outPath), { recursive: true });
  const fixture = JSON.stringify(kept, null, 2);
  await writeFile(outPath, fixture, "utf8");

  console.log(`   eventi catturati: ${kept.length}${dropped > 0 ? ` (${dropped} troncati da --max-events)` : ""}`);
  console.log(`   peso fixture   : ${(Buffer.byteLength(fixture, "utf8") / 1024).toFixed(1)} KB`);
  console.log(`   crediti usati  : ${creditsUsed ?? "non dichiarati"}`);
  console.log(`   crediti residui: ${creditsRemaining ?? "non dichiarati"}`);
  if (creditsRemaining !== null && creditsRemaining < 5) {
    console.warn(`   ATTENZIONE: restano ${creditsRemaining} crediti nel mese.`);
  }

  console.log(`\nFixture salvata in: ${outPath}`);
  console.log(
    "Verifica: aggiungi il test di contratto e poi rimuovi la fixture se troppo grande\n" +
      "(o rigenerala con --max-events). La chiave non è mai stata scritta su disco.",
  );
  return EXIT_OK;
}

main().then((code) => {
  process.exitCode = code;
});
