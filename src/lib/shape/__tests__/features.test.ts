/**
 * Test delle feature di forma (voce 2 del backlog).
 * Eseguire con: npm run test:shape
 *
 * Funzioni pure: nessun database. Si verifica che la forma sia una
 * lettura onesta della serie — primo movimento, durata, rimbalzi, flash,
 * distanza dal kickoff — e che la regola di idempotenza non ricalcoli
 * mai a dati fermi.
 */
import {
  SHAPE_VERSION,
  buildShapeFeatures,
  dedupePoints,
  isShapeStale,
  type ShapeInput,
  type ShapePoint,
} from "../features";

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

function assertEqual<T>(actual: T, expected: T, label = ""): void {
  if (actual !== expected) {
    throw new Error(
      `${label ? label + ": " : ""}atteso ${String(expected)}, ottenuto ${String(actual)}`,
    );
  }
}

/* ------------------------------------------------------------------ */

const NOW = new Date("2026-08-21T12:00:00Z");

function shape(
  over: Partial<ShapeInput> = {},
): ReturnType<typeof buildShapeFeatures> {
  const points: ShapePoint[] = [
    { at: new Date("2026-08-21T10:00:00Z"), prob: 0.5 },
    { at: new Date("2026-08-21T10:40:00Z"), prob: 0.55 },
    { at: new Date("2026-08-21T11:20:00Z"), prob: 0.53 },
  ];
  return buildShapeFeatures({
    points: over.points ?? points,
    openingProb: over.openingProb ?? 0.5,
    detectedAt: over.detectedAt ?? new Date("2026-08-21T10:45:00Z"),
    kickoffAt: over.kickoffAt ?? new Date("2026-08-21T20:45:00Z"),
    now: over.now ?? NOW,
  });
}

function main(): void {
  console.log("\n=== Shape features ===\n");

  console.log("-- Primo movimento e durata --\n");

  test("serie vuota: nessuna forma, null dichiarato", () => {
    assertEqual(shape({ points: [] }), null);
  });

  test("primo movimento: la prima rilevazione oltre i 2 pp di rumore", () => {
    const f = shape()!;
    /* 10:00 è a +0 pp (rumore), 10:40 è a +5 pp: il movimento inizia lì */
    assertEqual(f.firstMoveAt, "2026-08-21T10:40:00.000Z", "firstMoveAt");
  });

  test("mai oltre il rumore: firstMoveAt null e durata null", () => {
    const f = shape({
      points: [
        { at: new Date("2026-08-21T10:00:00Z"), prob: 0.5 },
        { at: new Date("2026-08-21T11:00:00Z"), prob: 0.51 },
      ],
    })!;
    assertEqual(f.firstMoveAt, null);
    assertEqual(f.durationMinutes, null);
    /* senza durata misurabile il flash non si indovina */
    assertEqual(f.flash, null);
  });

  test("durata: minuti dal primo movimento all'ultima rilevazione", () => {
    const f = shape()!;
    assertEqual(f.durationMinutes, 40, "durata 10:40 → 11:20");
    assertEqual(f.lastObservedAt, "2026-08-21T11:20:00.000Z");
  });

  test("un solo punto: niente durata su una fotografia singola", () => {
    const f = shape({ points: [{ at: new Date("2026-08-21T10:00:00Z"), prob: 0.6 }] })!;
    assertEqual(f.durationMinutes, null);
    assertEqual(f.snapshotsUsed, 1);
  });

  console.log("\n-- Tenuta: flash o sostenuto --\n");

  test("sotto i 30 minuti è flash", () => {
    const f = shape({
      points: [
        { at: new Date("2026-08-21T10:00:00Z"), prob: 0.5 },
        { at: new Date("2026-08-21T10:20:00Z"), prob: 0.55 },
      ],
    })!;
    assertEqual(f.flash, true);
  });

  test("oltre i 30 minuti è sostenuto", () => {
    const f = shape()!; /* durata 40 minuti */
    assertEqual(f.flash, false);
  });

  test("a 30 minuti esatti non è flash: la finestra è oltre, non oltre-o-uguale", () => {
    const f = shape({
      points: [
        { at: new Date("2026-08-21T10:00:00Z"), prob: 0.5 },
        { at: new Date("2026-08-21T10:10:00Z"), prob: 0.55 },
        { at: new Date("2026-08-21T10:40:00Z"), prob: 0.56 },
      ],
    })!;
    /* il movimento inizia a 10:10 (prima rilevazione oltre il rumore) */
    assertEqual(f.firstMoveAt, "2026-08-21T10:10:00.000Z");
    assertEqual(f.durationMinutes, 30);
    assertEqual(f.flash, false);
  });

  console.log("\n-- Rimbalzi --\n");

  test("un ritorno di 2 pp dal massimo conta un rimbalzo", () => {
    const f = shape()!; /* 0,50 → 0,55 → 0,53: un ritorno di 2 pp */
    assertEqual(f.reboundCount, 1);
  });

  test("un ritorno sotto i 2 pp è rumore, non rimbalzo", () => {
    const f = shape({
      points: [
        { at: new Date("2026-08-21T10:00:00Z"), prob: 0.5 },
        { at: new Date("2026-08-21T10:40:00Z"), prob: 0.55 },
        { at: new Date("2026-08-21T11:20:00Z"), prob: 0.535 },
      ],
    })!;
    assertEqual(f.reboundCount, 0);
  });

  test("due episodi distinti contano due rimbalzi", () => {
    const f = shape({
      points: [
        { at: new Date("2026-08-21T10:00:00Z"), prob: 0.5 },
        { at: new Date("2026-08-21T10:20:00Z"), prob: 0.54 },
        { at: new Date("2026-08-21T10:40:00Z"), prob: 0.51 },
        { at: new Date("2026-08-21T11:00:00Z"), prob: 0.525 },
        { at: new Date("2026-08-21T11:20:00Z"), prob: 0.55 },
        { at: new Date("2026-08-21T11:40:00Z"), prob: 0.515 },
      ],
    })!;
    /* massimo 0,54 → ritorno a 0,51 (3 pp): 1; nuovo massimo 0,55 →
       ritorno a 0,515 (3,5 pp): 2 */
    assertEqual(f.reboundCount, 2);
  });

  test("salite costanti senza ritorni: zero rimbalzi", () => {
    const f = shape({
      points: [
        { at: new Date("2026-08-21T10:00:00Z"), prob: 0.5 },
        { at: new Date("2026-08-21T10:40:00Z"), prob: 0.55 },
        { at: new Date("2026-08-21T11:20:00Z"), prob: 0.58 },
      ],
    })!;
    assertEqual(f.reboundCount, 0);
  });

  console.log("\n-- Rilevamento → kickoff --\n");

  test("segnale pre-kickoff: minuti fra rilevamento e fischio", () => {
    const f = shape()!; /* 10:45 → 20:45 */
    assertEqual(f.detectedToKickoffMinutes, 600);
  });

  test("segnale post-kickoff: null, non un numero negativo", () => {
    const f = shape({
      detectedAt: new Date("2026-08-21T21:00:00Z"),
      kickoffAt: new Date("2026-08-21T20:45:00Z"),
    })!;
    assertEqual(f.detectedToKickoffMinutes, null);
  });

  console.log("\n-- Dedup e versione --\n");

  test("istanti duplicati: una sola lettura per istante", () => {
    const pts = dedupePoints([
      { at: new Date("2026-08-21T10:00:00Z"), prob: 0.5 },
      { at: new Date("2026-08-21T10:00:00Z"), prob: 0.52 },
      { at: new Date("2026-08-21T10:30:00Z"), prob: 0.55 },
    ]);
    assertEqual(pts.length, 2);
    assertEqual(pts[0].prob, 0.52, "vince l'ultima riga dello stesso istante");
  });

  test("la struttura dichiara la propria versione", () => {
    const f = shape()!;
    assertEqual(f.version, SHAPE_VERSION);
  });

  console.log("\n-- Idempotenza --\n");

  test("forma assente: si ricalcola", () => {
    assertEqual(isShapeStale(null, null), true);
    assertEqual(isShapeStale(undefined, new Date()), true);
  });

  test("dati fermi: non si ricalcola nulla", () => {
    const f = shape()!;
    assertEqual(isShapeStale(f, new Date("2026-08-21T11:20:00Z")), false);
  });

  test("una rilevazione più recente del calcolo: si ricalcola", () => {
    const f = shape()!;
    assertEqual(isShapeStale(f, new Date("2026-08-21T12:01:00Z")), true);
  });

  test("versione futura o struttura illeggibile: si ricalcola", () => {
    const f = shape()!;
    const altra = { ...f, version: f.version + 1 };
    assertEqual(isShapeStale(altra, null), true);
    assertEqual(isShapeStale({ computedAt: "non-una-data" }, null), true);
    assertEqual(isShapeStale("spazzata", null), true);
  });

  /* ---------------------------------------------------------------- */

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
