/** Test della gerarchia informativa nella sintesi del dettaglio partita. */
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchSummary } from "@/components/MatchSummary";
import type { DetailSignal, MarketSeries } from "@/lib/repo/match-detail";

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
    console.error(
      `  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const signal = {
  id: 1,
  status: "active",
  statusLabel: "Attivo",
  market: "1x2",
  marketLabel: "Esito finale",
  selection: "home",
  selectionLabel: "Vittoria casa",
  openingPrice: 8.62,
  currentPrice: 7.13,
  detectedPrice: 7.29,
  deltaPp: 2.42,
  magnitudeClass: "moderate",
  magnitudeLabel: "Moderato",
  confidenceScore: 26.63,
  confidenceBand: "low",
  confidenceLabel: "Bassa",
  level: "reale",
  levelLabel: "Segnale reale",
  dataCoverage: 0.85,
  booksTotal: 1,
  booksConfirming: 1,
  sharpAvailable: false,
  sharpConfirms: null,
  sustainedMinutes: 330,
  isFlash: false,
  rebounded: false,
  firstMoveAt: "2026-09-04T10:00:00.000Z",
  lastMoveAt: "2026-09-04T15:30:00.000Z",
  detectedAt: "2026-09-04T10:00:00.000Z",
  updatedAt: "2026-09-04T15:30:00.000Z",
  engineVersion: "test",
  summary: "",
  caveats: [],
  missingData: [],
  components: [],
  reachability: {
    earned: 35.5,
    measurableMax: 55,
    gapMax: 45,
    totalMax: 100,
  },
  timeline: [],
  suspicion: null,
} as unknown as DetailSignal;

const series: MarketSeries = {
  market: "1x2",
  marketLabel: "Esito finale",
  selection: "home",
  selectionLabel: "Vittoria casa",
  bookmakerKey: "consensus",
  bookmakerName: "Consenso",
  isSharp: false,
  points: [],
  opening: 8.62,
  current: 7.13,
  peak: 7.13,
  dropPct: -17.29,
  shiftPp: 2.42,
  pointCount: 26,
  spanMinutes: 676,
  firstAt: "2026-09-04T07:15:00.000Z",
  lastAt: "2026-09-04T18:31:00.000Z",
  depthNote: "26 rilevazioni",
  shallow: false,
  hasSignal: true,
};

const markup = renderToStaticMarkup(
  createElement(MatchSummary, { signal, series }),
);
const text = new JSDOM(`<!doctype html><body>${markup}</body>`).window.document
  .body.textContent!;

test("dice subito quale quota si è mossa e fra quali valori", () => {
  assert(text.includes("vittoria casa è scesa da 8.620 a 7.130"), text);
});

test("usa la stessa normalizzazione della home, inclusi i moltiplicatori", () => {
  assert(text.includes("48/100"), `punteggio normalizzato assente: ${text}`);
  assert(
    !text.includes("65/100"),
    "la somma pre-moltiplicatore non deve tornare come indice",
  );
  assert(
    text.includes("Base verificabile55%"),
    `base osservabile assente: ${text}`,
  );
});

test("non presenta 1/1 come concordanza fra bookmaker", () => {
  assert(!text.includes("1/1"), "1/1 non è una verifica tra operatori");
  assert(
    text.includes(
      "non sono osservabili né il confronto tra singoli bookmaker né una linea indipendente sharp",
    ),
    "limite delle fonti non dichiarato",
  );
});

console.log(
  `\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`,
);
if (failed > 0) process.exit(1);
