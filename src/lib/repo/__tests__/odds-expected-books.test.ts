/**
 * Test del denominatore di copertura — richiede un PostgreSQL raggiungibile.
 * Eseguire con: npm run test:odds-expected
 *
 * Le fixture usano la chiave "exptest-*" e vengono rimosse a fine corsa,
 * sia in caso di successo sia in caso di errore. Nessun dato di test resta
 * nel database e nessuna fixture è mai presentata come dato reale.
 *
 * Cosa si verifica e perché: `getExpectedBookmakerCount` è il denominatore
 * con cui il motore calcola la copertura dati, e il tetto pubblicato
 * dell'indice deve usare lo stesso numero. Le righe scritte dagli smoke test
 * (`*-smoke`) restano in archivio come prova della verifica ma non devono
 * spostarlo (trovato 11/09/2026: denominatore 1x2 a 25, copertura a 0,418).
 */
import { eq, inArray, like } from "drizzle-orm";
import { db, sql } from "@/db/client";
import {
  bookmakers,
  leagues,
  matches,
  oddsSnapshots,
  teams,
} from "@/db/schema";
import {
  getExpectedBookmakerCount,
  hasSharpProductionBook,
} from "../odds";
import {
  BETEXPLORER_SNAPSHOT_SOURCE,
  PRODUCTION_SNAPSHOT_SOURCES,
  THE_ODDS_API_SMOKE_SOURCE,
  THE_ODDS_API_SNAPSHOT_SOURCE,
  THE_ODDS_API_WIRE_SMOKE_SOURCE,
} from "@/lib/providers/snapshot-sources";

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  ✗ ${name}\n      ${msg}`);
  }
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, label = ""): void {
  if (actual !== expected) {
    throw new Error(
      `${label ? label + ": " : ""}atteso ${String(expected)}, ottenuto ${String(actual)}`,
    );
  }
}

function group(name: string): void {
  console.log(`\n▸ ${name}`);
}

const PREFIX = "exptest";

/** Rimuove ogni traccia delle fixture di test. */
async function cleanup(): Promise<void> {
  const m = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.key, `${PREFIX}-%`));
  const ids = m.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(oddsSnapshots).where(inArray(oddsSnapshots.matchId, ids));
    await db.delete(matches).where(inArray(matches.id, ids));
  }
  await db.delete(teams).where(like(teams.key, `${PREFIX}-%`));
  await db.delete(leagues).where(like(leagues.key, `${PREFIX}-%`));
  await db.delete(bookmakers).where(like(bookmakers.key, `${PREFIX}-%`));
}

/** Partita minima con due squadre, per appendere gli snapshot. */
async function makeMatch(key: string): Promise<number> {
  const [league] = await db
    .insert(leagues)
    .values({ key: `${PREFIX}-league`, name: "Lega di test", country: "Test" })
    .onConflictDoNothing()
    .returning({ id: leagues.id });
  const leagueId =
    league?.id ??
    (
      await db
        .select({ id: leagues.id })
        .from(leagues)
        .where(eq(leagues.key, `${PREFIX}-league`))
        .limit(1)
    )[0].id;
  const teamRows = await db
    .insert(teams)
    .values([
      { key: `${PREFIX}-home-${key}`, name: "Test Home" },
      { key: `${PREFIX}-away-${key}`, name: "Test Away" },
    ])
    .onConflictDoNothing()
    .returning({ id: teams.id });
  const homeId =
    teamRows[0]?.id ??
    (
      await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.key, `${PREFIX}-home-${key}`))
        .limit(1)
    )[0].id;
  const awayId =
    teamRows[1]?.id ??
    (
      await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.key, `${PREFIX}-away-${key}`))
        .limit(1)
    )[0].id;
  const [match] = await db
    .insert(matches)
    .values({
      key: `${PREFIX}-${key}`,
      leagueId,
      homeTeamId: homeId,
      awayTeamId: awayId,
      kickoffAt: new Date(Date.now() + 4 * 3600_000),
      status: "scheduled",
    })
    .onConflictDoNothing()
    .returning({ id: matches.id });
  if (match) return match.id;
  const [existing] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.key, `${PREFIX}-${key}`))
    .limit(1);
  return existing.id;
}

async function makeBook(key: string, isSharp: boolean): Promise<number> {
  const [row] = await db
    .insert(bookmakers)
    .values({ key: `${PREFIX}-${key}`, name: `Test ${key}`, isSharp })
    .onConflictDoNothing()
    .returning({ id: bookmakers.id });
  if (row) return row.id;
  const [existing] = await db
    .select({ id: bookmakers.id })
    .from(bookmakers)
    .where(eq(bookmakers.key, `${PREFIX}-${key}`))
    .limit(1);
  return existing.id;
}

async function addSnapshot(
  matchId: number,
  bookmakerId: number,
  source: string,
  market: "1x2" | "ou_2_5" = "1x2",
): Promise<void> {
  await db
    .insert(oddsSnapshots)
    .values({
      matchId,
      bookmakerId,
      market,
      selection: "home",
      price: "2.000",
      impliedProb: (1 / 2).toFixed(6),
      collectedAt: new Date(),
      source,
    })
    .onConflictDoNothing();
}

async function main(): Promise<void> {
  await cleanup();

  group("Sorgenti di produzione");
  await test("le sorgenti di produzione sono consenso + adapter, mai smoke", () => {
    assert(
      PRODUCTION_SNAPSHOT_SOURCES.includes(BETEXPLORER_SNAPSHOT_SOURCE),
      "manca la sorgente del consenso",
    );
    assert(
      PRODUCTION_SNAPSHOT_SOURCES.includes(THE_ODDS_API_SNAPSHOT_SOURCE),
      "manca la sorgente di produzione dell'adapter",
    );
    assert(
      !PRODUCTION_SNAPSHOT_SOURCES.includes(THE_ODDS_API_SMOKE_SOURCE),
      "lo smoke non è produzione",
    );
    assert(
      !PRODUCTION_SNAPSHOT_SOURCES.includes(THE_ODDS_API_WIRE_SMOKE_SOURCE),
      "lo smoke del cablaggio non è produzione",
    );
  });

  /* Scenario: una riga di consenso di produzione + due righe di smoke su
     libri diversi (uno dei due marcato sharp, come Pinnacle negli smoke reali).
     È la fotografia della produzione l'11/09/2026, in piccolo. */
  const matchId = await makeMatch("m1");
  const consensusId = await makeBook("consensus", false);
  const smokeAId = await makeBook("smoke-a", true);
  const smokeBId = await makeBook("smoke-b", false);
  await addSnapshot(matchId, consensusId, BETEXPLORER_SNAPSHOT_SOURCE);
  await addSnapshot(matchId, smokeAId, THE_ODDS_API_SMOKE_SOURCE);
  await addSnapshot(matchId, smokeBId, THE_ODDS_API_SMOKE_SOURCE);

  group("Denominatore di copertura");
  await test("le righe degli smoke non spostano il denominatore", async () => {
    assertEqual(await getExpectedBookmakerCount("1x2"), 1);
  });

  await test("uno sharp visto solo negli smoke non è una linea sharp", async () => {
    assertEqual(await hasSharpProductionBook("1x2"), false);
  });

  await test("un mercato senza righe resta al pavimento di 1", async () => {
    assertEqual(await getExpectedBookmakerCount("ou_2_5"), 1);
  });

  /* Scenario cablaggio acceso: una riga di produzione dell'adapter sullo
     stesso libro dello smoke. Il libro ora conta, e lo sharp anche. */
  await addSnapshot(matchId, smokeAId, THE_ODDS_API_SNAPSHOT_SOURCE);

  await test("una riga di produzione dell'adapter alza il denominatore", async () => {
    assertEqual(await getExpectedBookmakerCount("1x2"), 2);
  });

  await test("uno sharp con righe di produzione è una linea sharp", async () => {
    assertEqual(await hasSharpProductionBook("1x2"), true);
  });

  await test("gli altri mercati non vedono le righe 1x2", async () => {
    assertEqual(await getExpectedBookmakerCount("ou_2_5"), 1);
    assertEqual(await hasSharpProductionBook("ou_2_5"), false);
  });

  /* --- pulizia --- */
  await cleanup();

  await test("la pulizia non lascia tracce", async () => {
    const leftover = await db
      .select({ id: matches.id })
      .from(matches)
      .where(like(matches.key, `${PREFIX}-%`));
    assertEqual(leftover.length, 0);
    const books = await db
      .select({ id: bookmakers.id })
      .from(bookmakers)
      .where(like(bookmakers.key, `${PREFIX}-%`));
    assertEqual(books.length, 0);
  });

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Test superati: ${passed} | falliti: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFallimenti:");
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log(`${"─".repeat(60)}\n`);

  await sql.end();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("Errore fatale nella suite:", err);
  try {
    await cleanup();
    await sql.end();
  } catch {
    /* la pulizia è best-effort */
  }
  process.exit(1);
});
