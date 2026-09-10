/**
 * Test di CONTRATTO sulla forma reale di The Odds API.
 *
 *   npm run odds:capture                  # crea la fixture live (1 credito)
 *   npm run test:odds-live                # esegue questo test
 *
 * PERCHÉ ESISTE: tutti gli altri fixture sono esempi scritti a mano. Questo
 * test mette il parser e il matching alla prova contro una risposta catturata
 * dal vivo, che `odds:capture` scrive in `fixtures/the-odds-api-odds-live.json`.
 *
 * Se la fixture NON esiste (non è ancora stata catturata), il test NON
 * fallisce: stampa un avviso ed esce con successo. Diventa un gate reale solo
 * quando la fixture è presente. Non fa rete e non tocca il database.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseOddsResponse, type TheOddsApiEvent } from "../the-odds-api-odds";
import { findEvent } from "../odds-api-sharp";

const FIXTURE = resolve(
  __dirname,
  "fixtures/the-odds-api-odds-live.json",
);

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}

if (!existsSync(FIXTURE)) {
  console.log(
    "\nFIXTURE LIVE ASSENTE — test di contratto saltato (non è un fallimento).\n" +
      "Per attivarlo esegui una volta: npm run odds:capture\n" +
      "Poi: npm run test:odds-live",
  );
  console.log("\n0 passed, 0 failed (skip: fixture live non presente)");
  process.exit(0);
}

const raw = readFileSync(FIXTURE, "utf8");
let payload: unknown;
try {
  payload = JSON.parse(raw);
} catch {
  console.error("\nFIXTURE LIVE NON VALIDA — il file non è JSON leggibile.");
  process.exit(1);
}

check("la risposta reale è un elenco di eventi", Array.isArray(payload));
if (!Array.isArray(payload) || payload.length === 0) {
  console.error("\nFIXTURE LIVE VUOTA O NON È UN ELENCO — esegui di nuovo npm run odds:capture.");
  process.exit(1);
}

const now = new Date("2026-09-12T18:00:00Z");
const events = payload as TheOddsApiEvent[];
const eventsWithBooks = events.filter(
  (e) => Array.isArray(e.bookmakers) && e.bookmakers.length > 0,
);

check("almeno un evento ha bookmaker leggibili", eventsWithBooks.length > 0);

let totalQuotes = 0;
let eventsParsed = 0;
let maxSkipped = 0;
let allQuotesValid = true;
let coveredForMatching = 0;

const VALID_MARKETS = new Set(["1x2", "ou_2_5", "btts"]);
const VALID_SELECTIONS = new Set(["home", "draw", "away", "over", "under", "yes", "no"]);

const quoteFailures: string[] = [];

for (const event of eventsWithBooks) {
  let parsed;
  try {
    parsed = parseOddsResponse(event, { fixtureKey: event.id, observedAt: now });
  } catch (error) {
    check(
      `parsing evento ${event.id} senza eccezioni`,
      false,
    );
    quoteFailures.push(`evento ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  check(`evento ${event.id}: bookmaker visti >= usati`, parsed.bookmakersUsed <= parsed.bookmakersSeen);
  check(`evento ${event.id}: nessun esito contato a caso`, parsed.skippedOutcomes >= 0);

  if (parsed.quotes.length > 0) {
    eventsParsed++;
    totalQuotes += parsed.quotes.length;
    for (const q of parsed.quotes) {
      const ok =
        typeof q.bookmakerKey === "string" &&
        q.bookmakerKey !== "" &&
        typeof q.price === "number" &&
        Number.isFinite(q.price) &&
        q.price > 0 &&
        q.isConsensus === false &&
        VALID_MARKETS.has(q.market) &&
        VALID_SELECTIONS.has(q.selection);
      if (!ok) {
        allQuotesValid = false;
        quoteFailures.push(
          `evento ${event.id}: quota non valida (market=${String(q.market)}, selection=${String(q.selection)}, price=${String(q.price)}, book=${String(q.bookmakerKey)})`,
        );
      }
    }
  }
  maxSkipped = Math.max(maxSkipped, parsed.skippedOutcomes);

  /* copertura per il matching: nomi e orario leggibili */
  if (
    typeof event.home_team === "string" &&
    typeof event.away_team === "string" &&
    typeof event.commence_time === "string"
  ) {
    coveredForMatching++;
  }
}

check("almeno un evento produce almeno una quota", totalQuotes > 0);
check("tutte le quote hanno forma valida", allQuotesValid);

/* il matching deve trovare un evento unico su dati reali (stessa regola del
   client). Riesce se la fixture contiene coppie di squadre non ambigue. */
let findEventOk = false;
for (const event of eventsWithBooks) {
  if (
    typeof event.home_team !== "string" ||
    typeof event.away_team !== "string" ||
    typeof event.commence_time !== "string"
  ) {
    continue;
  }
  const kickoff = new Date(event.commence_time);
  if (Number.isNaN(kickoff.getTime())) continue;
  const found = findEvent(payload, event.home_team, event.away_team, kickoff);
  if (found !== null) {
    findEventOk = true;
    break;
  }
}
check("il matching trova un evento unico su dati reali", findEventOk);

console.log(`\nEventi con bookmaker   : ${eventsWithBooks.length}`);
console.log(`Eventi con quote       : ${eventsParsed}`);
console.log(`Quote estratte         : ${totalQuotes}`);
console.log(`Skipped outcomes (max) : ${maxSkipped}`);
console.log(`Eventi coperti per matching: ${coveredForMatching}`);

for (const f of quoteFailures.slice(0, 10)) console.log(`  · ${f}`);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFALLIMENTI:");
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
