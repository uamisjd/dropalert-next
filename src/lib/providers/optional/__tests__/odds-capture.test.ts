/**
 * Test del modulo di cattura: quale lega serve possiamo portare in archivio.
 *
 * Verifica la regola di onestà: la base è esplicita e verificata, e per una
 * chiave fuori base (o non servita dal piano, come MLS) si risponde `null`
 * invece di inventare un titolo «Paese: Lega» che la mappa non riconoscerebbe.
 */
import { captureLeagueFor, eventToFixture, type CaptureLeague } from "../odds-capture-league";

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

test("Serie A è catturabile con il titolo «Italy: Serie A»", () => {
  const league = captureLeagueFor("soccer_italy_serie_a");
  assert(league !== null, "Serie A deve essere catturabile");
  const l = league as CaptureLeague;
  assert(l.leagueRaw === "Italy: Serie A", "il titolo deve essere nel formato atteso da sportKeyFor");
  assert(l.countryRaw === "Italy", "paese");
  assert(l.countrySlug === "italy" && l.leagueSlug === "serie-a", "slug");
});

test("MLS NON è catturabile (non servito dal piano): null, non inventato", () => {
  assert(captureLeagueFor("soccer_mls") === null, "MLS non è in base di cattura → null");
});

test("chiave vuota o assente → null (fail closed)", () => {
  assert(captureLeagueFor(null) === null, "null → null");
  assert(captureLeagueFor(undefined) === null, "undefined → null");
  assert(captureLeagueFor("") === null, "vuota → null");
});

test("chiave del catalogo ma non dichiarata catturabile → null (mai inventare un titolo)", () => {
  // Argentina è servita e ATTIVA nel catalogo ma NON è in CAPTURABLE: la
  // cattura resta non dichiarata, non si inventa un titolo «Paese: Lega».
  assert(captureLeagueFor("soccer_argentina_primera_division") === null, "servita ma non in base → null");
  assert(captureLeagueFor("soccer_austria_bundesliga") === null, "chiave fuori base → null");
});

test("eventToFixture: chiave, squadre e orario dalla fonte", () => {
  const league = captureLeagueFor("soccer_italy_serie_a");
  assert(league !== null, "lega");
  const event = {
    id: "evt-1",
    sportKey: "soccer_italy_serie_a",
    homeTeam: "Inter",
    awayTeam: "Juve",
    commenceTime: new Date("2026-09-12T18:45:00.000Z"),
  };
  const fixture = eventToFixture(event, league as CaptureLeague);
  assert(fixture.key === "oddsapi-evt-1", "chiave con prefisso oddsapi-");
  assert(fixture.providerMatchId === "evt-1", "id reale conservato");
  assert(fixture.homeTeamRaw === "Inter" && fixture.awayTeamRaw === "Juve", "squadre");
  assert(fixture.leagueRaw === "Italy: Serie A", "titolo lega");
  assert(fixture.kickoffIsAssumedUtc === false, "l'orario dichiara il fuso, non assunto UTC");
  assert(fixture.kickoffAt.toISOString() === "2026-09-12T18:45:00.000Z", "kickoff");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
