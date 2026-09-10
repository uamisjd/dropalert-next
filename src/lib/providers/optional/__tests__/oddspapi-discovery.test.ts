/**
 * Test della scoperta fixture OddsPapi (pure functions, nessuna rete/DB).
 *
 * Blocca il comportamento con la struttura del docs verificato
 * (`GET /v4/tournaments`, `GET /v4/odds-by-tournaments`), in particolare
 * l'onestà: un wrapper `{ data }` è gestito, ma una struttura non
 * riconoscibile produce `[]` (lo smoke fallisce chiuso, non deduce).
 */
import {
  pickTournaments,
  fixturesWithOdds,
  CALCIO_SPORT_ID,
  type OddsPapiTournament,
} from "../oddspapi-discovery";

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

const tournaments: OddsPapiTournament[] = [
  { tournamentId: 8, tournamentName: "LaLiga", upcomingFixtures: 0, futureFixtures: 300 },
  { tournamentId: 7, tournamentName: "UEFA Champions League", upcomingFixtures: 4, futureFixtures: 108 },
  { tournamentId: 1, tournamentName: "UEFA Euro", upcomingFixtures: 0, futureFixtures: 0 },
];

test("pickTournaments preferisce i tornei con fixture in arrivo", () => {
  const picked = pickTournaments(tournaments);
  assert(picked[0].tournamentId === 7, "il torneo con upcomingFixtures vince");
  assert(picked.length === 2, "il torneo senza fixture è escluso");
  assert(picked[1].tournamentId === 8, "il secondo è il torneo con futureFixtures");
});

test("pickTournaments su lista vuota restituisce vuoto", () => {
  assert(pickTournaments([]).length === 0, "list vuota → vuoto");
});

test("fixturesWithOdds accetta wrapper { data }", () => {
  const payload = {
    data: [
      { fixtureId: "id1000001", participant1Name: "Liverpool", participant2Name: "Man Utd", hasOdds: true, statusId: 0 },
      { fixtureId: "id1000002", hasOdds: false },
      { fixtureId: "" },
    ],
  };
  const fixtures = fixturesWithOdds(payload);
  assert(fixtures.length === 1, "solo il fixture con hasOdds e id valido");
  assert(fixtures[0].fixtureId === "id1000001", "fixture corretto");
});

test("fixturesWithOdds accetta array nudo", () => {
  const fixtures = fixturesWithOdds([{ fixtureId: "idX", hasOdds: true }]);
  assert(fixtures.length === 1, "array nudo → 1 fixture");
});

test("fixturesWithOdds su struttura non riconoscibile restituisce []", () => {
  assert(fixturesWithOdds("boh").length === 0, "stringa → []");
  assert(fixturesWithOdds(42).length === 0, "numero → []");
  assert(fixturesWithOdds({ nonData: 1 }).length === 0, "oggetto senza data → []");
});

test("il calcio è sportId 10 anche nello strato di scoperta", () => {
  assert(CALCIO_SPORT_ID === 10, "sportId calcio = 10");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
