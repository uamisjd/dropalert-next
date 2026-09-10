/**
 * Test del parser del catalogo `GET /v4/sports` di The Odds API.
 *
 * L'endpoint è fuori quota (gratuito) e serve a decidere, con dati reali,
 * quali campionati mappare in `sport-keys.ts` senza spendere crediti.
 * Il test fissa la traduzione della fixture: righe non oggetto o senza key
 * vengono scartate e contate, mai stimate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSportsCatalog, activeSoccerKeys } from "../odds-api-sports";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(
      `  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const fixture = join(__dirname, "fixtures", "odds-api-sports.json");
const payload: unknown = JSON.parse(readFileSync(fixture, "utf8"));

(async () => {
  await test("estrae solo calcio dal catalogo e ordina per chiave", async () => {
    const result = parseSportsCatalog(payload);
    assert(result.sports.length === 44, `attesi 44 sport, trovati ${result.sports.length}`);
    assert(result.discarded === 0, `attese 0 righe scartate, trovate ${result.discarded}`);
    assert(result.soccer.length > 0, "atteso almeno un campionato di calcio");
    const allSoccer = result.soccer.every((s) => /soccer/i.test(s.group));
    assert(allSoccer, "tutti i campionati estratti devono appartenere al gruppo Soccer");
    const keys = result.soccer.map((s) => s.key);
    assert(keys[0] <= keys[keys.length - 1], "le chiavi devono essere ordinate");
    assert(keys.includes("soccer_epl"), "manca soccer_epl");
    assert(keys.includes("soccer_brazil_campeonato"), "manca soccer_brazil_campeonato");
  });

  await test("catalog ha anche sport non calcistici nel totale", async () => {
    const result = parseSportsCatalog(payload);
    assert(result.sports.some((s) => /nfl/i.test(s.key)), "atteso americanfootball_nfl");
    assert(result.sports.some((s) => /nba/i.test(s.key)), "atteso basketball_nba");
    assert(!result.soccer.some((s) => /nfl/i.test(s.key)), "NFL non deve essere in soccer");
  });

  await test("activeSoccerKeys filtra solo le competizioni in stagione", async () => {
    const result = parseSportsCatalog(payload);
    const active = activeSoccerKeys(result);
    assert(active.includes("soccer_epl"), "soccer_epl deve essere attivo");
    assert(!active.includes("soccer_austria_bundesliga"), "Austria Bundesliga non è attiva");
    assert(!active.includes("soccer_usa_mls"), "usa_mls non attivo non deve comparire");
    assert(active.includes("soccer_world_cup"), "World Cup deve essere attivo");
  });

  await test("mappa 12 campionati monitor che esistono su The Odds API", async () => {
    const result = parseSportsCatalog(payload);
    const keys = new Set(activeSoccerKeys(result));
    const mapped = [
      "soccer_italy_serie_a",
      "soccer_italy_serie_b",
      "soccer_epl",
      "soccer_efl_champ",
      "soccer_spain_la_liga",
      "soccer_germany_bundesliga",
      "soccer_france_ligue_one",
      "soccer_netherlands_eredivisie",
      "soccer_portugal_primeira_liga",
      "soccer_uefa_champs_league",
      "soccer_uefa_europa_league",
      "soccer_uefa_europa_conference_league",
    ];
    for (const k of mapped) {
      assert(keys.has(k), `la fonte dovrebbe esporre ${k}`);
    }
  });

  await test("gestisce payload non array senza errori", async () => {
    const result = parseSportsCatalog({});
    assert(result.sports.length === 0 && result.soccer.length === 0, "null/obj → lista vuota");
  });

  await test("una riga non oggetto viene scartata e contata", async () => {
    const result = parseSportsCatalog([
      "non un oggetto",
      123,
      null,
      { key: "soccer_epl", group: "Soccer", title: "EPL", active: true },
    ]);
    assert(result.discarded === 3, `attese 3 scartate, trovate ${result.discarded}`);
    assert(result.sports.length === 1, `atteso 1 sport, trovati ${result.sports.length}`);
    assert(result.soccer.length === 1, "atteso 1 campionato di calcio");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
