/**
 * Test del parser di OddsPapi — da JSON della fonte a quote per book.
 *
 * Il test fissa la traduzione della fixture congelata dello schema VERIFICATO
 * (`GET /markets`, `GET /odds`: `bookmakerOdds[book][markets][marketId]
 * [outcomes][outcomeId].players["0"].price`). Controlla le regole di onestà:
 *  - ogni bookmaker è una riga reale (mai consenso finto);
 *  - i bookmaker sharp (pinnacle, singbet, sbobet, betfair-exchange) sono
 *    marcati `isSharp = true` dalla key, non dal prezzo;
 *  - la selezione 1X2 si risolve per ID di esito verificato (101=home,
 *    102=draw, 103=away) e la 2.5 per 1010/1011; un ID non gestito o un
 *    prezzo non valido viene scartato e contato, mai indovinato;
 *  - un book inattivo, un mercato non gestito o una linea diversa da 2.5
 *    non producono quote.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseOddsResponse,
  extractBookLines,
  isSharpBookmaker,
  SOCCER_SPORT_ID,
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
    assert(!keys.has("outdatedbook"), "un book inattivo non deve produrre quote");
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

  await test("risolve la selezione 1X2 per ID di esito verificato (101/102/103)", async () => {
    const lines = extractBookLines(payload, observed).lines;
    const home = lines.filter((l) => l.market === "1x2" && l.selection === "home");
    assert(home.length > 0, "attese quote sulla selezione home (Inter)");
    const away = lines.filter((l) => l.market === "1x2" && l.selection === "away");
    assert(away.length > 0, "attese quote sulla selezione away (Juventus)");
    const draw = lines.filter((l) => l.market === "1x2" && l.selection === "draw");
    assert(draw.length > 0, "attese quote sul pareggio");
    // Il prezzo viene da players["0"].price, non da un campo sui nomi.
    assert(home.every((l) => l.price > 1), "prezzo decimale valido per la home");
  });

  await test("il mercato 1010 (O/U 2.5) è tradotto in over/under", async () => {
    const lines = extractBookLines(payload, observed).lines;
    const over = lines.filter((l) => l.market === "ou_2_5" && l.selection === "over");
    const under = lines.filter((l) => l.market === "ou_2_5" && l.selection === "under");
    assert(over.length >= 2, "attesi almeno il total over di pinnacle e bet365");
    assert(under.length >= 2, "attesi almeno il total under di pinnacle e bet365");
    assert(over.every((l) => l.price > 1), "prezzo valido");
  });

  await test("un esito con ID non gestito viene contato, non indovinato", async () => {
    const odd: OddsPapiOdd = {
      fixtureId: "x",
      participant1Name: "Inter",
      participant2Name: "Juventus",
      bookmakerOdds: {
        pinnacle: {
          bookmakerIsActive: true,
          markets: {
            "101": {
              marketActive: true,
              outcomes: {
                "101": { players: { "0": { active: true, price: 2.1 } } },
                "102": { players: { "0": { active: true, price: 3.4 } } },
                "103": { players: { "0": { active: true, price: 3.75 } } },
                // esito sconosciuto: ID non in 101/102/103
                "999": { players: { "0": { active: true, price: 5.0 } } },
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
      participant1Name: "Inter",
      participant2Name: "Juventus",
      bookmakerOdds: {
        bet365: {
          bookmakerIsActive: true,
          markets: {
            "101": {
              marketActive: true,
              outcomes: {
                "101": { players: { "0": { active: true, price: 0.9 } } },
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

  await test("un book inattivo non produce quote ma conta come visto", async () => {
    const odd: OddsPapiOdd = {
      fixtureId: "x",
      participant1Name: "Inter",
      participant2Name: "Juventus",
      bookmakerOdds: {
        outdatedbook: {
          bookmakerIsActive: false,
          markets: {
            "101": {
              marketActive: true,
              outcomes: {
                "101": { players: { "0": { active: true, price: 2.2 } } },
              },
            },
          },
        },
      },
    };
    const res = extractBookLines(odd, observed);
    assert(res.bookmakersSeen === 1, `atteso 1 bookmaker visto, trovati ${res.bookmakersSeen}`);
    assert(res.lines.length === 0, "book inattivo non produce quote");
  });

  await test("un mercato non gestito non produce quote", async () => {
    const odd: OddsPapiOdd = {
      fixtureId: "x",
      participant1Name: "Inter",
      participant2Name: "Juventus",
      bookmakerOdds: {
        bet365: {
          bookmakerIsActive: true,
          markets: {
            "555": { marketActive: true, outcomes: {} },
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
    assert(res.bookmakersUsed >= 5, `attesi almeno 5 bookmaker usati, trovati ${res.bookmakersUsed}`);
  });

  await test("fixtureKey e observedAt passano nelle quote", async () => {
    const result = parseOddsResponse(payload, { fixtureKey: "be-fixture-1", observedAt: observed });
    assert(result.quotes.every((q) => q.fixtureKey === "be-fixture-1"), "fixtureKey uniforme");
    assert(result.quotes.every((q) => q.observedAt.getTime() === observed.getTime()), "observedAt uniforme");
  });

  await test("il calcio è lo sportId 10 (verificato su GET /sports)", async () => {
    assert(SOCCER_SPORT_ID === 10, `atteso sportId 10, trovato ${SOCCER_SPORT_ID}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
