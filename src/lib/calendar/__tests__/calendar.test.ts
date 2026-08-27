/**
 * Test del calendario football-data (Sprint ENH-1, punto 1).
 * Funzioni pure: nessuna rete, nessuna chiave, nessun database.
 * Eseguire con: npm run test:calendar
 */
import {
  CALENDAR_CACHE_HOURS,
  fixtureKey,
  normName,
  parseFixtures,
  romeDayIso,
  withoutTracked,
} from "../football-data";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}
function eq(name: string, a: unknown, b: unknown) {
  check(`${name} — atteso ${String(b)}, ottenuto ${String(a)}`, Object.is(a, b));
}

const now = new Date("2026-08-27T10:00:00Z");

eq("cache dichiarata a 24h", CALENDAR_CACHE_HOURS, 24);
eq("giorno italiano di oggi", romeDayIso(now, 0), "2026-08-27");
eq("giorno italiano di domani", romeDayIso(now, 1), "2026-08-28");
eq(
  "dopo mezzanotte italiana il giorno cambia",
  romeDayIso(new Date("2026-08-27T22:30:00Z"), 0),
  "2026-08-28",
);

/* --- parsing: mai una partita giocata --- */
const payload = {
  matches: [
    {
      id: 1,
      utcDate: "2026-08-27T18:30:00Z",
      status: "TIMED",
      competition: { name: "Primera Division" },
      homeTeam: { name: "RC Celta de Vigo", shortName: "Celta" },
      awayTeam: { name: "CA Osasuna", shortName: "Osasuna" },
    },
    {
      id: 2,
      utcDate: "2026-08-27T08:00:00Z",
      status: "FINISHED",
      competition: { name: "Serie A" },
      homeTeam: { name: "Milan" },
      awayTeam: { name: "Inter" },
    },
    {
      id: 3,
      utcDate: "2026-08-27T09:00:00Z",
      status: "TIMED",
      competition: { name: "Serie A" },
      homeTeam: { name: "Roma" },
      awayTeam: { name: "Lazio" },
    },
    {
      id: 4,
      utcDate: "non-una-data",
      status: "TIMED",
      competition: { name: "Serie A" },
      homeTeam: { name: "A" },
      awayTeam: { name: "B" },
    },
    {
      id: 5,
      utcDate: "2026-08-28T19:00:00Z",
      status: "SCHEDULED",
      competition: {},
      homeTeam: { name: "Alfa" },
      awayTeam: {},
    },
  ],
};
const fixtures = parseFixtures(payload, now);
eq("resta solo la partita futura valida", fixtures.length, 1);
eq("nome breve preferito", fixtures[0].homeTeam, "Celta");
eq("competizione letta", fixtures[0].competition, "Primera Division");
check("nessuna partita conclusa", !fixtures.some((f) => f.homeTeam === "Milan"));
check("nessuna partita già iniziata", !fixtures.some((f) => f.homeTeam === "Roma"));
check("data invalida scartata", !fixtures.some((f) => f.homeTeam === "A"));
check("squadra mancante scartata", !fixtures.some((f) => f.homeTeam === "Alfa"));
eq("payload vuoto", parseFixtures({}, now).length, 0);
eq("payload non oggetto", parseFixtures(null, now).length, 0);

/* --- identità e deduplica con l'archivio --- */
eq("nome normalizzato senza sigle", normName("Celta de Vigo FC"), "celtadevigo");
const kick = "2026-08-27T18:30:00Z";
eq(
  "stessa partita, stessa chiave anche invertita",
  fixtureKey({ homeTeam: "Celta", awayTeam: "Osasuna", kickoffAt: kick }),
  fixtureKey({ homeTeam: "Osasuna FC", awayTeam: "Celta", kickoffAt: kick }),
);
const soloRadar = withoutTracked(
  [
    { sourceId: 1, homeTeam: "Celta", awayTeam: "Osasuna", competition: "Liga", kickoffAt: kick },
    { sourceId: 2, homeTeam: "Barça", awayTeam: "Athletic", competition: "Liga", kickoffAt: kick },
    { sourceId: 3, homeTeam: "Celta", awayTeam: "Osasuna", competition: "Liga", kickoffAt: kick },
  ],
  [{ homeTeam: "Celta", awayTeam: "Osasuna", kickoffAt: kick }],
);
eq("la partita già monitorata non compare come «in arrivo»", soloRadar.length, 1);
eq("resta quella senza quote", soloRadar[0].homeTeam, "Barça");
check(
  "nessun duplicato interno al calendario",
  new Set(soloRadar.map(fixtureKey)).size === soloRadar.length,
);

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (calendario football-data)`);
