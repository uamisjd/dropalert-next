/**
 * Test delle mappature OddsPapi verificate (09/09/2026).
 *
 * Blocca il contratto letto sui docs pubblici (`GET /sports`, `/markets`,
 * `/odds`): sport calcio = 10, 1X2 = 101 (101=home,102=draw,103=away),
 * O/U 2.5 = 1010 (1010=over,1011=under). Nessuna mappatura qui sotto deve
 * essere "dedotta": è la traduzione di identificativi verificati.
 */
import {
  SOCCER_SPORT_ID,
  FULL_TIME_RESULT_MARKET,
  OVER_UNDER_2_5_MARKET,
  H2H_OUTCOME_HOME,
  H2H_OUTCOME_DRAW,
  H2H_OUTCOME_AWAY,
  OU_OUTCOME_OVER,
  OU_OUTCOME_UNDER,
  isSharpBookmaker,
  sportIdForSportKey,
  marketIdFor,
  h2hOutcomeIdFor,
  ouOutcomeIdFor,
  outcomeIdFor,
  selectionForOutcome,
} from "../oddspapi-maps";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
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

test("il calcio è sportId 10 (verificato su GET /sports)", () => {
  assert(SOCCER_SPORT_ID === 10, "sportId calcio = 10");
  assert(sportIdForSportKey("soccer_epl") === 10, "soccer_epl → 10");
  assert(sportIdForSportKey("soccer_italy_serie_a") === 10, "soccer_italy → 10");
  assert(sportIdForSportKey("basketball_nba") === null, "basketball non mappato → null");
  assert(sportIdForSportKey(undefined) === null, "sportKey assente → null");
});

test("mercato interno → marketId OddsPapi (verificato)", () => {
  assert(marketIdFor("1x2") === FULL_TIME_RESULT_MARKET, "1x2 → 101");
  assert(FULL_TIME_RESULT_MARKET === "101", "1X2 = 101");
  assert(marketIdFor("ou_2_5") === OVER_UNDER_2_5_MARKET, "ou_2_5 → 1010");
  assert(OVER_UNDER_2_5_MARKET === "1010", "O/U 2.5 = 1010");
  assert(marketIdFor("other" as never) === null, "mercato non gestito → null");
});

test("selezione interna → outcomeId OddsPapi (1X2 e O/U 2.5)", () => {
  assert(h2hOutcomeIdFor("home") === H2H_OUTCOME_HOME, "home → 101");
  assert(h2hOutcomeIdFor("draw") === H2H_OUTCOME_DRAW, "draw → 102");
  assert(h2hOutcomeIdFor("away") === H2H_OUTCOME_AWAY, "away → 103");
  assert(ouOutcomeIdFor("over") === OU_OUTCOME_OVER, "over → 1010");
  assert(ouOutcomeIdFor("under") === OU_OUTCOME_UNDER, "under → 1011");
  assert(h2hOutcomeIdFor("over" as never) === null, "over non è un esito 1X2");
});

test("outcomeIdFor combina mercato + selezione", () => {
  assert(outcomeIdFor("1x2", "home") === "101", "1x2/home → 101");
  assert(outcomeIdFor("ou_2_5", "over") === "1010", "ou_2_5/over → 1010");
  assert(outcomeIdFor("ou_2_5", "home") === null, "home non è un esito O/U");
});

test("selectionForOutcome (inverso, per il parser) non indovina", () => {
  assert(selectionForOutcome("1x2", "101") === "home", "1x2/101 → home");
  assert(selectionForOutcome("1x2", "102") === "draw", "1x2/102 → draw");
  assert(selectionForOutcome("1x2", "103") === "away", "1x2/103 → away");
  assert(selectionForOutcome("ou_2_5", "1010") === "over", "ou_2_5/1010 → over");
  assert(selectionForOutcome("ou_2_5", "1011") === "under", "ou_2_5/1011 → under");
  assert(selectionForOutcome("1x2", "999") === null, "ID non gestito → null (contato, mai indovinato)");
  assert(selectionForOutcome("other" as never, "101") === null, "mercato non gestito → null");
});

test("sharp riconosciuto dalla key dichiarata, mai dal prezzo", () => {
  assert(isSharpBookmaker("pinnacle"), "pinnacle sharp");
  assert(isSharpBookmaker("BETFAIR-EXCHANGE"), "case-insensitive");
  assert(isSharpBookmaker("sbobet"), "sbobet sharp");
  assert(!isSharpBookmaker("bet365"), "bet365 non sharp");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
