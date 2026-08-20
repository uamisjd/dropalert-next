/**
 * Test dell'esito descrittivo calcolato dai gol finali (Sprint 9).
 * Eseguire con: npm run test:settle
 *
 * Funzioni pure: nessun database, nessuna rete. Qui si verifica che
 * l'esito venga dai gol e solo dai gol, che l'assenza di risultato resti
 * «in attesa», e che il conteggio non possa promuovere una manciata di
 * esiti a tendenza.
 */
import {
  MIN_OUTCOMES_FOR_TREND,
  OUTCOME_DISCLAIMER,
  OUTCOME_LABELS_IT,
  isUnderpowered,
  isResultOverdue,
  outcomeOf,
  settledCount,
  tallyOutcomes,
  type SettleInput,
} from "../outcome";

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

/* ------------------------------------------------------------------ */

function settle(
  selection: SettleInput["selection"],
  homeGoals: number | null,
  awayGoals: number | null,
  market: SettleInput["market"] = "1x2",
): string {
  return outcomeOf({ market, selection, homeGoals, awayGoals });
}

function main(): void {
  console.log("\n=== Esito dai gol finali ===\n");

  /* ---------------- 1X2 ---------------- */

  console.log("-- 1X2 --\n");

  test("1 (casa): vittoria di casa è centrata", () => {
    assertEqual(settle("home", 2, 0), "centrata");
  });
  test("1 (casa): sconfitta di casa è mancata", () => {
    assertEqual(settle("home", 1, 3), "mancata");
  });
  test("1 (casa): il pareggio non è una vittoria di casa", () => {
    assertEqual(settle("home", 1, 1), "mancata");
  });
  test("X (pareggio): l'1-1 è centrato", () => {
    assertEqual(settle("draw", 1, 1), "centrata");
  });
  test("X (pareggio): lo 0-0 è centrato", () => {
    assertEqual(settle("draw", 0, 0), "centrata");
  });
  test("X (pareggio): il 2-1 è mancato", () => {
    assertEqual(settle("draw", 2, 1), "mancata");
  });
  test("2 (trasferta): vittoria esterna è centrata", () => {
    assertEqual(settle("away", 0, 2), "centrata");
  });
  test("2 (trasferta): il pareggio non è una vittoria esterna", () => {
    assertEqual(settle("away", 2, 2), "mancata");
  });

  /* ---------------- Over/Under 2.5 ---------------- */

  console.log("\n-- Over/Under 2.5 --\n");

  test("over: 3 gol totali è centrato", () => {
    assertEqual(settle("over", 2, 1, "ou_2_5"), "centrata");
  });
  test("over: 2 gol totali è mancato, il confine è 2.5", () => {
    assertEqual(settle("over", 1, 1, "ou_2_5"), "mancata");
    assertEqual(settle("over", 2, 0, "ou_2_5"), "mancata");
  });
  test("under: 2 gol totali è centrato", () => {
    assertEqual(settle("under", 1, 1, "ou_2_5"), "centrata");
    assertEqual(settle("under", 0, 0, "ou_2_5"), "centrata");
  });
  test("under: 3 gol totali è mancato", () => {
    assertEqual(settle("under", 3, 0, "ou_2_5"), "mancata");
  });

  /* ---------------- BTTS ---------------- */

  console.log("\n-- Entrambe segnano --\n");

  test("sì: entrambe a segno è centrato", () => {
    assertEqual(settle("yes", 1, 1, "btts"), "centrata");
    assertEqual(settle("yes", 2, 3, "btts"), "centrata");
  });
  test("sì: una rete soltanto è mancata", () => {
    assertEqual(settle("yes", 0, 2, "btts"), "mancata");
    assertEqual(settle("yes", 5, 0, "btts"), "mancata");
  });
  test("no: porta a zero in campo è centrato", () => {
    assertEqual(settle("no", 0, 0, "btts"), "centrata");
    assertEqual(settle("no", 0, 1, "btts"), "centrata");
  });
  test("no: entrambe a segno è mancato", () => {
    assertEqual(settle("no", 1, 2, "btts"), "mancata");
  });

  /* ---------------- assenza di risultato ---------------- */

  console.log("\n-- Senza risultato registrato --\n");

  test("senza gol registrati l'esito resta in attesa", () => {
    assertEqual(settle("home", null, null), "in_attesa");
    assertEqual(settle("draw", null, 1), "in_attesa");
    assertEqual(settle("over", 2, null), "in_attesa");
    assertEqual(settle("yes", null, null, "btts"), "in_attesa");
  });
  test("in attesa non è né centrata né mancata: nessuna promozione", () => {
    const v = outcomeOf({
      market: "1x2",
      selection: "home",
      homeGoals: null,
      awayGoals: null,
    });
    assert(v === "in_attesa", `atteso in_attesa, ottenuto ${v}`);
    assert(v !== "centrata" && v !== "mancata", "un esito mancante non si indovina");
  });
  test("0-0 è un risultato registrato, non un'assenza", () => {
    assertEqual(settle("home", 0, 0), "mancata");
    assertEqual(settle("under", 0, 0, "ou_2_5"), "centrata");
  });

  /* ---------------- conteggio e soglia ---------------- */

  console.log("\n-- Conteggio e soglia --\n");

  test("il conteggio separa i tre verdetti", () => {
    const t = tallyOutcomes(["centrata", "centrata", "mancata", "in_attesa"]);
    assertEqual(t.centrata, 2);
    assertEqual(t.mancata, 1);
    assertEqual(t.in_attesa, 1);
  });
  test("gli esiti in attesa non fanno conteggio per la soglia", () => {
    const verdicts = [
      ...Array.from({ length: 5 }, () => "centrata" as const),
      ...Array.from({ length: 4 }, () => "mancata" as const),
      ...Array.from({ length: 20 }, () => "in_attesa" as const),
    ];
    const t = tallyOutcomes(verdicts);
    assertEqual(settledCount(t), 9);
    assert(isUnderpowered(t), "9 risolti non sono una tendenza");
  });
  test("la soglia è sotto dieci: a dieci risolti si legge", () => {
    const nove = tallyOutcomes([
      ...Array.from({ length: 5 }, () => "centrata" as const),
      ...Array.from({ length: 4 }, () => "mancata" as const),
    ]);
    assert(isUnderpowered(nove), "9 è sotto la soglia");
    const dieci = tallyOutcomes([
      ...Array.from({ length: 5 }, () => "centrata" as const),
      ...Array.from({ length: 5 }, () => "mancata" as const),
    ]);
    assertEqual(settledCount(dieci), 10);
    assert(!isUnderpowered(dieci), "10 risolti non sono più sotto la soglia");
  });
  test("lista vuota: tutto a zero, sotto la soglia", () => {
    const t = tallyOutcomes([]);
    assertEqual(t.centrata, 0);
    assertEqual(t.mancata, 0);
    assertEqual(t.in_attesa, 0);
    assert(isUnderpowered(t), "zero esiti risolti restano sotto la soglia");
  });

  /* ---------------- etichette ---------------- */

  console.log("\n-- Etichette --\n");

  test("ogni verdetto ha la sua etichetta italiana", () => {
    assertEqual(OUTCOME_LABELS_IT.centrata, "Centrata");
    assertEqual(OUTCOME_LABELS_IT.mancata, "Mancata");
    assertEqual(OUTCOME_LABELS_IT.in_attesa, "In attesa");
  });
  test("la soglia dichiarata è dieci", () => {
    assertEqual(MIN_OUTCOMES_FOR_TREND, 10);
  });
  test("l'avviso fisso dice che non è un rendimento né un consiglio", () => {
    assert(
      OUTCOME_DISCLAIMER === "Non è un rendimento né un consiglio.",
      `testo inatteso: ${OUTCOME_DISCLAIMER}`,
    );
  });

  /* ---------------- attesa scaduta ---------------- */

  console.log("\n-- Attesa scaduta: oltre le 3 ore --\n");

  const NOW = new Date("2026-08-20T18:00:00Z");

  test("meno di tre ore dal kickoff: resta in attesa", () => {
    assertEqual(isResultOverdue("2026-08-20T15:01:00Z", NOW), false);
  });
  test("tre ore esatte: ancora dentro la grazia, non oltre", () => {
    assertEqual(isResultOverdue("2026-08-20T15:00:00Z", NOW), false);
  });
  test("oltre le tre ore: l'attesa scade e si dichiara", () => {
    assertEqual(isResultOverdue("2026-08-20T14:59:00Z", NOW), true);
  });
  test("partita non ancora giocata: mai scaduta", () => {
    assertEqual(isResultOverdue("2026-08-20T20:00:00Z", NOW), false);
  });
  test("ventidue ore dopo: scaduta, nessuna attesa eterna", () => {
    assertEqual(isResultOverdue("2026-08-19T20:00:00Z", NOW), true);
  });
  test("istante illeggibile: non si dichiara scadenza su un dato rotto", () => {
    assertEqual(isResultOverdue("non-una-data", NOW), false);
  });

  /* ---------------- mai dal CLV ---------------- */

  test("il modulo non importa né legge il CLV", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../outcome.ts", import.meta.url), "utf-8"),
    );
    assert(!source.includes("clv"), "il modulo puro non deve nominare il CLV");
    assert(!source.includes("closing"), "il modulo puro non deve leggere chiusure");
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
