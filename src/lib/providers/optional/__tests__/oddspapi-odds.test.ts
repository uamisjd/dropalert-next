/**
 * Test del parser di OddsPapi — da JSON della fonte a quote per book.
 *
 * Il test fissa la traduzione della fixture congelata dello schema documentato
 * (`bookmakerOdds[book][markets][marketKey][outcomes]`). Controlla le regole
 * di onestà del progetto:
 *  - ogni bookmaker è una riga reale (mai consenso finto);
 *  - i bookmaker sharp (pinnacle, singbet, sbobet, betfair-exchange) sono
 *    marcati `isSharp = true`;
 *  - un esito che non corrisponde a casa/trasferta/pareggio o con prezzo non
 *    valido viene scartato e contato, mai indovinato;
 *  - i mercati non gestiti o le linee diverse da 2.5 non producono quote.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseOddsResponse,
  extractBookLines,
  isSharpBookmaker,
  type OddsPapiOdd,
} from "../oddspapi-odds";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const fixture = join(__dirname, "fixtures", "oddspapi-odds.json");
const payload: OddsPapiOdd = JSON.parse(readFileSync(fixture, "utf8"));
const observed = new Date("2026-09-12T18:55:00Z");

(async () => {
  await test("traduce i bookmaker reali in quote, mai consenso finto", async () => {
    const result = parseOddsResponse(payload, { fixtureKey: "be-test123", observedAt: observed });
    assert(result.quotes.length > 0, "attese almeno una quota");
    assert(result.quotes.every((q) => q.isConsensus === false), "tutte le quote devono essere per-bookmaker");
    const keys = new Set(result.quotes.map((q) => q.bookmakerKey));
    assert(keys.has("pinnacle"), "manca pinnacle");
    assert(keys.has("bet365"), "manca bet365");
    assert(keys.has("draftkings"), "manca draftkings");
    assert(!keys.has("outdatedbook"), "un book con esiti inattivi non deve produrre quote");
  });

  await test("marca come sharp solo i bookmaker della lista dichiarata", async () => {
    const result = parseOddsResponse(payload, { fixtureKey: "be-test123", observedAt: observed });
    const sharpKeys = new Set(result.quotes.filter((q) => q.isSharp).map((q) => q.bookmakerKey));
    assert(sharpKeys.has("pinnacle"), "pinnacle deve essere sharp");
    assert(sharpKeys.has("singbet"), "singbet deve essere sharp");
    assert(sharpKeys.has("betfair-exchange"), "betfair-exchange deve essere sharp");
    assert(!sharpKeys.has("bet365"), "bet365 non è sharp");
    assert(!sharpKeys.has("draftkings"), "draftkings non è sharp");
  });

  await test("lo sharp si riconosce dalla key, non dal prezzo", async () => {
    assert(isSharpBookmaker("pinnacle"), "pinnacle per key");
    assert(isSharpBookmaker("BETFAIR-EXCHANGE"), "case-insensitive");
    assert(!isSharpBookmaker("bet365"), "bet365 non per key");
  });

  await test("risolve la selezione 1X2 per nome di squadra", async () => {
    const lines = extractBookLines(payload, observed).lines;
    const interPrices = lines.filter((l) => l.market === "1x2" && l.selection === "home");
    assert(interPrices.length > 0, "attese quote sulla selezione home (Inter)");
    const juvePrices = lines.filter((l) => l.market === "1x2" && l.selection === "away");
    assert(juvePrices.length > 0, "attese quote sulla selezione away (Juventus)");
    const drawPrices = lines.filter((l) => l.market === "1x2" && l.selection === "draw");
    assert(drawPrices.length > 0, "attese quote sul pareggio");
  });

  await test("il mercato totals con linea 2.5 è tradotto in over/under", async () => {
    const lines = extractBookLines(payload, observed).lines;
    const over = lines.filter((l) => l.market === "ou_2_5" && l.selection === "over");
    const under = lines.filter((l) => l.market === "ou_2_5" && l.selection === "under");
    assert(over.length >= 2, "attesi almeno il total over di pinnacle e bet365");
    assert(under.length >= 2, "attesi almeno il total under di pinnacle e bet365");
    assert(over.every((l) => l.price > 1), "prezzo valido");
  });

  await test("un esito non risolvibile viene contato, non indovinato", async () => {
    const odd: OddsPapiOdd = {
      fixtureId: "x",
      participants: { home: { name: "Inter" }, away: { name: "Juventus" } },
      bookmakerOdds: {
        pinnacle: {
          markets: {
            "131": {
              name: "Money Line",
              outcomes: {
                "131": { id: "131", name: "Inter", price: 2.1, active: true },
                "132": { id: "132", name: "Draw", price: 3.4, active: true },
                "133": { id: "133", name: "Juventus", price: 3.75, active: true },
                // esito sconosciuto: né casa, né trasferta, né pareggio
                "999": { id: "999", name: "Mistero", price: 5.0, active: true },
              },
            },
          },
        },
      },
    };
    const res = extractBookLines(odd, observed);
    assert(res.skippedOutcomes === 1, `atteso 1 esito scartato, trovati ${res.skippedOutcomes}`);
    assert(res.lines.length === 3, "le tre selezioni 1X2 valide restano");
  });

  await test("un prezzo non valido viene scartato e contato", async () => {
    const odd: OddsPapiOdd = {
      fixtureId: "x",
      participants: { home: { name: "Inter" }, away: { name: "Juventus" } },
      bookmakerOdds: {
        bet365: {
          markets: {
            "131": {
              name: "Money Line",
              outcomes: {
                "131": { id: "131", name: "Inter", price: 0.9, active: true },
              },
            },
          },
        },
      },
    };
    const res = extractBookLines(odd, observed);
    assert(res.skippedOutcomes === 1, `atteso 1 prezzo scartato, trovati ${res.skippedOutcomes}`);
    assert(res.lines.length === 0, "prezzo sotto 1 non produce quote");
  });

  await test("un mercato non gestito non produce quote", async () => {
    const odd: OddsPapiOdd = {
      fixtureId: "x",
      participants: { home: { name: "Inter" }, away: { name: "Juventus" } },
      bookmakerOdds: {
        bet365: {
          markets: {
            // mercato diverso da moneyline e totals 2.5
            "555": { name: "Correct Score", outcomes: {} },
          },
        },
      },
    };
    const res = extractBookLines(odd, observed);
    assert(res.lines.length === 0, "mercato non gestito non produce quote");
  });

  await test("bookmakerSeen conta anche i book senza quote valide", async () => {
    const res = parseOddsResponse(payload, { fixtureKey: "be-test123", observedAt: observed });
    assert(res.bookmakersSeen === 7, `attesi 7 bookmaker visti, trovati ${res.bookmakersSeen}`);
    // L'adapter ha scritto quote per almeno i 5 book "vivi" (il "outdatedbook"
    // è inattivo e non traduce quote).
    assert(typeof res.bookmakersUsed === "number", "bookmakersUsed deve essere un numero");
    assert(res.bookmakersUsed >= 5, `attesi almeno 5 bookmaker usati, trovati ${res.bookmakersUsed}`);
  });

  await test("fixtureKey e observedAt passano nelle quote", async () => {
    const result = parseOddsResponse(payload, { fixtureKey: "be-fixture-1", observedAt: observed });
    assert(result.quotes.every((q) => q.fixtureKey === "be-fixture-1"), "fixtureKey uniforme");
    assert(result.quotes.every((q) => q.observedAt.getTime() === observed.getTime()), "observedAt uniforme");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
