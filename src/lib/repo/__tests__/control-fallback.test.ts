/**
 * Test del ripiego «dalla fonte» della lettura di controllo — funzioni pure,
 * nessun accesso a rete o database. Eseguire con: npm run test:control-fallback
 */
import { pickUpcomingEvent, syntheticMatchId } from "../control-fallback";
import type { OddsApiEventLite } from "@/lib/providers/optional/odds-match-resolver";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} — atteso ${b}, ottenuto ${a}`);
}

function evento(id: string, iso: string): OddsApiEventLite {
  return {
    id,
    sportKey: "soccer_italy_serie_a",
    homeTeam: "Casa",
    awayTeam: "Ospiti",
    commenceTime: new Date(iso),
  };
}

test("id sintetico: negativo e deterministico", () => {
  const a = syntheticMatchId("48aeedf874678e9410c7f340e17477d0");
  const b = syntheticMatchId("48aeedf874678e9410c7f340e17477d0");
  assertEqual(a, b, "stesso evento, stesso id");
  if (a >= 0) throw new Error(`id sintetico non negativo: ${a}`);
  assertEqual(a, -Number.parseInt("48aeedf8", 16), "derivato dai primi 8 hex");
});

test("id sintetico: eventi diversi, id diversi", () => {
  const a = syntheticMatchId("48aeedf874678e9410c7f340e17477d0");
  const c = syntheticMatchId("00000001000000000000000000000000");
  if (a === c) throw new Error("collisione fra eventi diversi");
});

test("id sintetico: id non esadecimale → -1, pur restando negativo", () => {
  assertEqual(syntheticMatchId("zzzz-non-hex"), -1, "fallback sicuro");
});

test("scelta evento: ignora passati e oltre la finestra, prende il primo", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  const until = new Date("2026-09-07T12:00:00Z");
  const passato = evento("a1000000000000000000000000000001", "2026-09-06T10:00:00Z");
  const lontano = evento("b2000000000000000000000000000002", "2026-09-08T10:00:00Z");
  const sera = evento("c3000000000000000000000000000003", "2026-09-06T18:45:00Z");
  const dopo = evento("d4000000000000000000000000000004", "2026-09-06T16:00:00Z");
  const scelto = pickUpcomingEvent([passato, lontano, sera, dopo], now, until);
  assertEqual(scelto?.id, dopo.id, "il più vicino nella finestra");
});

test("scelta evento: finestra vuota → null dichiarato", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  const until = new Date("2026-09-06T13:00:00Z");
  assertEqual(
    pickUpcomingEvent([evento("e5000000000000000000000000000005", "2026-09-06T18:45:00Z")], now, until),
    null,
    "nessun evento nella finestra",
  );
  assertEqual(pickUpcomingEvent([], now, until), null, "elenco vuoto");
});

console.log(`\n${"─".repeat(60)}`);
console.log(`control-fallback — superati: ${passed} | falliti: ${failed}`);
for (const f of failures) console.log(`  • ${f}`);
console.log(`${"─".repeat(60)}\n`);

if (failed > 0) process.exit(1);
