import assert from "node:assert/strict";
import { buildPerformanceView, type PerformanceRecord } from "../clv-performance";
import { clvBasisMix, describeClvBasisMix } from "../clv-basis";

const now = new Date("2026-09-12T14:00:00Z");
const record = (overrides: Partial<PerformanceRecord> = {}): PerformanceRecord => ({
  clvPp: "-2", beatClose: false, at: "2026-09-10T12:00:00Z",
  closingBasis: "raw_consensus", signalScore: "30", ...overrides,
});
let passed = 0;
function test(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }

test("basi miste: grafico, media, frequenza e fasce usano solo il campione allineato", () => {
  const rows = [record(), record({ clvPp: "4", beatClose: true }),
    record({ closingBasis: "fair_novig", clvPp: "90", beatClose: true }),
    record({ closingBasis: "unexpected", clvPp: "99", beatClose: true })];
  const before = JSON.stringify(rows);
  const v = buildPerformanceView(rows, now);
  assert.equal(v.archiveN, 4);
  assert.equal(v.totalN, 2);
  assert.equal(v.excludedN, 2);
  assert.equal(v.overallAvgPp, 1);
  assert.equal(v.beatCloseRate, 0.5);
  assert.equal(v.points[0].cumulativeAvgPp, 1);
  assert.equal(v.points[0].cumulativeN, 2);
  assert.equal(v.buckets[1].avgClvPp, 1);
  assert.equal(v.buckets[1].sampleSize, 2);
  assert.equal(v.buckets[1].beatCloseRate, 0.5);
  assert.equal(JSON.stringify(rows), before, "non muta né ribasa le righe ricevute");
});

test("la progressiva pesa le osservazioni, non le medie giornaliere", () => {
  const v = buildPerformanceView([
    record({ clvPp: 6, at: "2026-09-12T10:00:00Z" }),
    record({ clvPp: -3 }), record({ clvPp: 0 }),
  ], now);
  assert.equal(v.overallAvgPp, 1);
  assert.deepEqual(v.points.map((p) => p.day), ["2026-09-10", "2026-09-12"]);
  assert.equal(v.points[1].cumulativeAvgPp, 1);
  assert.equal(v.points[1].cumulativeN, 3);
});

test("giornate italiane a mezzanotte e cambio di ora legale", () => {
  const v = buildPerformanceView([
    record({ at: "2026-03-28T23:30:00Z" }), // 29 marzo, 00:30 CET
    record({ at: "2026-03-29T22:30:00Z" }), // 30 marzo, 00:30 CEST
    record({ at: "2026-10-24T22:30:00Z" }), // 25 ottobre, 00:30 CEST
    record({ at: "2026-10-25T23:30:00Z" }), // 26 ottobre, 00:30 CET
  ], now);
  assert.deepEqual(v.points.map((p) => p.day), ["2026-03-29", "2026-03-30", "2026-10-25", "2026-10-26"]);
});

test("29 allineate + 100 non allineate non superano la soglia", () => {
  const raw = Array.from({ length: 29 }, () => record());
  const fair = Array.from({ length: 100 }, () => record({ closingBasis: "fair_novig" }));
  const v = buildPerformanceView([...raw, ...fair], now);
  assert.equal(v.inconclusive, true);
  assert.equal(v.buckets[1].inconclusive, true);
  assert.equal(v.points[0].inconclusive, true);
  const mature = buildPerformanceView([...raw, record(), ...fair], now);
  assert.equal(mature.inconclusive, false);
  assert.equal(mature.buckets[1].inconclusive, false);
});

test("ogni fascia ha la propria soglia, anche se il totale la supera", () => {
  const v = buildPerformanceView(Array.from({ length: 40 }, (_, i) => record({ signalScore: i < 20 ? 20 : 50 })), now);
  assert.equal(v.inconclusive, false);
  assert.ok(v.buckets.every((b) => b.inconclusive));
});

test("archivio vuoto e archivio soltanto non allineato non diventano zeri", () => {
  for (const rows of [[], [record({ closingBasis: "fair_novig" })], [record({ closingBasis: null })]]) {
    const v = buildPerformanceView(rows, now);
    assert.equal(v.totalN, 0);
    assert.equal(v.overallAvgPp, null);
    assert.equal(v.beatCloseRate, null);
    assert.deepEqual(v.points, []);
    assert.ok(v.buckets.every((b) => b.sampleSize === 0 && b.avgClvPp === null));
    assert.equal(v.archiveN, rows.length);
    assert.equal(v.excludedN, rows.length);
  }
});

test("CLV non valido o data illeggibile esclusi da tutti i denominatori", () => {
  const rows = [record({ clvPp: null }), record({ clvPp: "NaN" }), record({ clvPp: Infinity }),
    record({ clvPp: "" }), record({ clvPp: "3oops" }), record({ at: "not-a-date" }), record()];
  const v = buildPerformanceView(rows, now);
  assert.equal(v.totalN, 1);
  assert.equal(v.invalidAlignedN, 6);
  assert.equal(v.overallAvgPp, -2);
  assert.equal(v.buckets[1].sampleSize, 1);
  assert.equal(v.archiveN, v.totalN + v.excludedN);
  assert.match(v.basisNote, /6 su base grezza con dati non validi/);
});

test("indici mancanti o fuori scala restano nel totale ma non nelle fasce", () => {
  const v = buildPerformanceView([null, "", "bad", -1, 101, NaN].map((signalScore) => record({ signalScore })), now);
  assert.equal(v.totalN, 6);
  assert.equal(v.unclassifiedN, 6);
  assert.equal(v.buckets.reduce((n, b) => n + b.sampleSize, 0), 0);
});

test("confini delle fasce e quadratura con il totale", () => {
  const v = buildPerformanceView([0, 24.99, 25, 49.99, 50, 74.99, 75, 100, null].map((signalScore) => record({ signalScore })), now);
  assert.deepEqual(v.buckets.map((b) => b.sampleSize), [2, 2, 2, 2]);
  assert.equal(v.buckets.reduce((n, b) => n + b.sampleSize, v.unclassifiedN), v.totalN);
});

test("base sconosciuta mai descritta come grezzo contro grezzo", () => {
  const note = describeClvBasisMix(clvBasisMix([{ closingBasis: null }]));
  assert.match(note, /non è verificabile/);
  assert.doesNotMatch(note, /stesso piano|grezzo contro grezzo/);
});

console.log(`✓ ${passed} test performance: basi separate, campioni e tempo civile`);
