import {
  executablePriceFromSeries,
  isConsensusBookmakerKey,
} from "../price-evidence";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

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

const now = new Date("2026-09-06T12:00:00.000Z");
const point = (at: string, isStale = false) => ({ at, isStale });

console.log("\nEvidenza del prezzo eseguibile\n");

test("rifiuta il consensus anche quando è fresco", () => {
  const result = executablePriceFromSeries(
    [
      {
        market: "1x2",
        selection: "home",
        bookmakerKey: "betexplorer-consensus",
        current: 2.1,
        lastAt: "2026-09-06T11:59:00.000Z",
        points: [point("2026-09-06T11:59:00.000Z")],
      },
    ],
    "1x2",
    "home",
    now,
    90,
  );
  assert(result === null, "il consensus non deve diventare eseguibile");
});

test("seleziona una linea individuale fresca", () => {
  const result = executablePriceFromSeries(
    [
      {
        market: "1x2",
        selection: "home",
        bookmakerKey: "pinnacle",
        current: 2.12,
        lastAt: "2026-09-06T11:57:00.000Z",
        points: [point("2026-09-06T11:57:00.000Z")],
      },
    ],
    "1x2",
    "home",
    now,
    90,
  );
  assert(result !== null, "linea individuale presente");
  assert(result?.source === "bookmaker", "provenienza bookmaker dichiarata");
  assert(result?.price === 2.12, "quota conservata senza trasformarla");
  assert(result?.ageMinutes === 3, "età calcolata dal timestamp della linea");
});

test("scarta linea vecchia o dichiarata stale", () => {
  const result = executablePriceFromSeries(
    [
      {
        market: "1x2",
        selection: "home",
        bookmakerKey: "pinnacle",
        current: 2.12,
        lastAt: "2026-09-06T10:00:00.000Z",
        points: [point("2026-09-06T10:00:00.000Z", true)],
      },
    ],
    "1x2",
    "home",
    now,
    90,
  );
  assert(result === null, "una linea vecchia o stale non è eseguibile");
});

test("riconosce le chiavi aggregate senza inventare un operatore", () => {
  assert(isConsensusBookmakerKey("betexplorer-consensus"), "consensus noto");
  assert(isConsensusBookmakerKey("market-aggregate"), "aggregate noto");
  assert(!isConsensusBookmakerKey("pinnacle"), "bookmaker individuale distinto");
});

console.log(`\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`);
if (failed > 0) process.exit(1);
