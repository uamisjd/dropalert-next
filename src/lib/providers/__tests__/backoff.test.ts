/**
 * Test del backoff adattivo sui 429 e della riduzione di pressione.
 * Eseguire con: npm run test:backoff
 *
 * Funzioni pure: qui si verifica che la scala sia quella dichiarata
 * (45 → 90 → 180, poi raddoppi fino a 24 ore), che si azzeri SOLO con
 * un giro senza 429, e che una quota «stabile» serva tre giri dimostrati.
 */
import {
  COOLDOWN_CAP_MIN,
  COOLDOWN_STEPS_MIN,
  cooldownMinutesForLevel,
  cooldownUntilForLevel,
  nextLevelAfter429,
  remainingCooldownMinutes,
} from "../backoff";
import {
  RESULTS_LEAGUE_TTL_MIN,
  STABLE_SKIP_CYCLES,
  isStableQuote,
} from "../pressure";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  ✗ ${name}\n      ${msg}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label = ""): void {
  if (actual !== expected) {
    throw new Error(
      `${label ? label + ": " : ""}atteso ${String(expected)}, ottenuto ${String(actual)}`,
    );
  }
}

function main(): void {
  console.log("\n=== Backoff adattivo sui 429 ===\n");

  console.log("-- Scala e tetto --\n");

  test("la scala dichiarata è 45 → 90 → 180 minuti", () => {
    assertEqual(COOLDOWN_STEPS_MIN.length, 3);
    assertEqual(cooldownMinutesForLevel(1), 45);
    assertEqual(cooldownMinutesForLevel(2), 90);
    assertEqual(cooldownMinutesForLevel(3), 180);
  });

  test("oltre la scala si raddoppia: 360, 720, 1440", () => {
    assertEqual(cooldownMinutesForLevel(4), 360);
    assertEqual(cooldownMinutesForLevel(5), 720);
    assertEqual(cooldownMinutesForLevel(6), 1440);
  });

  test("mai oltre il tetto di 24 ore, a qualsiasi livello", () => {
    assertEqual(COOLDOWN_CAP_MIN, 1440);
    assertEqual(cooldownMinutesForLevel(7), 1440);
    assertEqual(cooldownMinutesForLevel(50), 1440);
  });

  test("livello zero: nessun cooldown", () => {
    assertEqual(cooldownMinutesForLevel(0), 0);
    assertEqual(cooldownUntilForLevel(0, new Date()), null);
  });

  console.log("\n-- Escalation e azzeramento --\n");

  test("ogni giro con 429 sale di un livello, saturando al tetto", () => {
    assertEqual(nextLevelAfter429(0), 1);
    assertEqual(nextLevelAfter429(1), 2);
    assertEqual(nextLevelAfter429(2), 3);
    const max = nextLevelAfter429(100);
    assertEqual(cooldownMinutesForLevel(max), 1440, "satura al tetto");
    assertEqual(nextLevelAfter429(max), max, "non cresce oltre il tetto");
  });

  test("l'istante di sblocco è adesso più i minuti dichiarati", () => {
    const now = new Date("2026-08-21T12:00:00Z");
    const until = cooldownUntilForLevel(1, now)!;
    assertEqual(until.toISOString(), "2026-08-21T12:45:00.000Z");
  });

  test("i minuti rimanenti non sono mai negativi: scaduto = libero", () => {
    const now = new Date("2026-08-21T12:00:00Z");
    assertEqual(remainingCooldownMinutes(null, now), 0);
    assertEqual(
      remainingCooldownMinutes(new Date("2026-08-21T11:00:00Z"), now),
      0,
    );
    assertEqual(
      remainingCooldownMinutes(new Date("2026-08-21T12:15:30Z"), now),
      16,
      "15 minuti e mezzo: 16 per eccesso",
    );
    assertEqual(
      remainingCooldownMinutes("2026-08-21T12:30:00.000Z", now),
      30,
    );
  });

  console.log("\n-- Quote stabili e TTL pagine --\n");

  test("una quota è stabile solo dopo tre giri fermi DIMOSTRATI", () => {
    assert(isStableQuote([2.1, 2.1, 2.1], 2.1), "tre identiche più la nuova uguale");
    assert(!isStableQuote([2.1, 2.1], 2.1), "due giri non bastano");
    assert(!isStableQuote([2.1, 2.1, 2.2], 2.1), "cronologia non ferma");
    assert(!isStableQuote([2.1, 2.1, 2.1], 2.05), "prezzo nuovo: non stabile");
  });

  test("le costanti dichiarate sono N=3 e TTL=120", () => {
    assertEqual(STABLE_SKIP_CYCLES, 3);
    assertEqual(RESULTS_LEAGUE_TTL_MIN, 120);
  });

  test("la tolleranza di confronto è un mezzo millesimo, non un arrotondamento", () => {
    assert(isStableQuote([2.1, 2.1, 2.1], 2.1004), "mezzo millesimo: identica");
    assert(!isStableQuote([2.1, 2.1, 2.1], 2.101), "oltre la tolleranza: diversa");
  });

  console.log(
    `\n${passed} superati, ${failed} non superati su ${passed + failed} totali.`,
  );
  if (failed > 0) {
    console.error("\nFallimenti:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main();
