import { toProviderSnapshotRecords } from "../../ingest-snapshots";
import type { OddsQuoteDTO } from "../../types";

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

const observedAt = new Date("2026-09-06T12:00:00.000Z");
const quotes: OddsQuoteDTO[] = [
  {
    fixtureKey: "fixture-1",
    bookmakerKey: "pinnacle",
    isConsensus: false,
    isSharp: true,
    market: "1x2",
    selection: "home",
    price: 2.1,
    openingPrice: null,
    observedAt,
    agreement: null,
  },
  {
    fixtureKey: "fixture-1",
    bookmakerKey: "betexplorer-consensus",
    isConsensus: true,
    market: "1x2",
    selection: "home",
    price: 2.08,
    openingPrice: null,
    observedAt,
    agreement: null,
  },
  {
    fixtureKey: "fixture-1",
    bookmakerKey: "bad",
    isConsensus: false,
    market: "1x2",
    selection: "away",
    price: 1,
    openingPrice: null,
    observedAt,
    agreement: null,
  },
];

console.log("\nPersistenza quote provider\n");

test("conserva fonte, timestamp e natura individuale/consensus", () => {
  const records = toProviderSnapshotRecords(7, quotes, 12, "the-odds-api");
  assert(records.length === 2, "quota invalida scartata senza sostituzione");
  const sharp = records.find((record) => record.bookmakerKey === "pinnacle");
  assert(sharp !== undefined, "bookmaker individuale conservato");
  assert(sharp?.isSharp === true, "metadata sharp conservata");
  assert(sharp?.isConsensus === false, "individuale distinta dal consensus");
  assert(sharp?.source === "the-odds-api", "sorgente persistita");
  assert(sharp?.collectedAt === observedAt, "timestamp della fonte conservato");
});

test("non crea righe se la sorgente è vuota", () => {
  assert(toProviderSnapshotRecords(7, quotes, null, "").length === 0, "sorgente obbligatoria");
});

test("l'implicita è il solo derivato persistito", () => {
  const [record] = toProviderSnapshotRecords(7, [quotes[0]!], null, "fixture");
  assert(record !== undefined, "record presente");
  assert(Math.abs((record?.impliedProb ?? 0) - 1 / 2.1) < 0.000001, "implicita corretta");
});

console.log(`\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`);
if (failed > 0) process.exit(1);
