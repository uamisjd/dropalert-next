/**
 * Test del modulo di cattura: quale lega servita possiamo portare in archivio.
 *
 * Verifica le regole di onestà:
 *  - la base è derivata dal catalogo reale (nessuna lista a mano di «sole
 *    leghe grandi»), meno le esclusioni dichiarate con motivo;
 *  - ogni voce deve fare ROUND-TRIP: il titolo «Paese: Lega» riscritto
 *    nell'anagrafica deve risolvere indietro alla STESSA `sportKey` via
 *    `sportKeyFor`, altrimenti la partita catturata resterebbe irrisolvibile
 *    allo smoke;
 *  - nessuna voce del catalogo può cadere dalla base in silenzio: è
 *    catturabile oppure esclusa esplicitamente;
 *  - per una chiave fuori base (o non servita dal piano, come MLS) si
 *    risponde `null` con motivo, invece di inventare un titolo.
 */
import {
  CAPTURABLE,
  captureExclusionReason,
  captureLeagueFor,
  eventToFixture,
  type CaptureLeague,
} from "../odds-capture-league";
import { sportKeyFor } from "../sport-keys";
import { SOURCE_SOCCER_CATALOG } from "../sport-catalog";

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

test("MLS NON è catturabile (non servito dal piano) e dichiara il motivo", () => {
  assert(captureLeagueFor("soccer_mls") === null, "MLS non è in base di cattura → null");
  const reason = captureExclusionReason("soccer_mls");
  assert(reason !== null && reason.length > 0, "l'esclusione di MLS deve avere un motivo");
});

test("World Cup NON è catturabile (nessun round-trip) e dichiara il motivo", () => {
  assert(captureLeagueFor("soccer_world_cup") === null, "World Cup non è in base → null");
  assert(captureExclusionReason("soccer_world_cup") !== null, "World Cup deve avere un motivo");
});

test("chiave vuota o assente → null (fail closed)", () => {
  assert(captureLeagueFor(null) === null, "null → null");
  assert(captureLeagueFor(undefined) === null, "undefined → null");
  assert(captureLeagueFor("") === null, "vuota → null");
  assert(captureExclusionReason(null) === null, "motivo di esclusione nullo per chiave assente");
});

test("chiave fuori catalogo → null (mai inventare un titolo)", () => {
  // `soccer_austria_bundesliga` non è fra le 39 attive del catalogo.
  assert(captureLeagueFor("soccer_austria_bundesliga") === null, "fuori catalogo → null");
  assert(captureLeagueFor("tennis_atp") === null, "sport diverso → null");
});

test("una lega servita e attiva ma non «maggiore» ora è catturabile (catalogo, non lista)", () => {
  // Argentina è attiva nel catalogo: con la base derivata dal catalogo deve
  // essere catturabile, non più esclusa da una lista di «sole leghe grandi».
  const league = captureLeagueFor("soccer_argentina_primera_division");
  assert(league !== null, "Argentina deve essere catturabile");
  assert((league as CaptureLeague).leagueRaw === "Argentina: Primera División", "titolo derivato dal catalogo");
});

test("ROUND-TRIP: ogni lega catturabile risolve indietro alla propria sportKey", () => {
  for (const league of CAPTURABLE) {
    const resolved = sportKeyFor(league.leagueRaw);
    assert(
      resolved === league.sportKey,
      `round-trip rotto per ${league.sportKey}: «${league.leagueRaw}» risolve in ${resolved}`,
    );
  }
});

test("COMPLETEZZA: ogni voce del catalogo è catturabile oppure esclusa con motivo", () => {
  for (const entry of SOURCE_SOCCER_CATALOG) {
    const capturable = captureLeagueFor(entry.key) !== null;
    const excluded = captureExclusionReason(entry.key) !== null;
    assert(
      capturable || excluded,
      `la voce ${entry.key} non è né catturabile né esclusa esplicitamente`,
    );
  }
});

test("ogni descrittore ha slug non vuote e titolo «Paese: Lega»", () => {
  for (const league of CAPTURABLE) {
    assert(league.countrySlug.length > 0 && league.leagueSlug.length > 0, `slug vuote per ${league.sportKey}`);
    assert(
      league.leagueRaw.includes(": "),
      `il titolo di ${league.sportKey} deve avere il formato «Paese: Lega»`,
    );
  }
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
