import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { PerformanceContent } from "../PerformanceContent";
import { ClvSection } from "../ClvSection";
import { buildPerformanceView, type PerformanceRecord } from "@/lib/view/clv-performance";
import { scoreCeiling } from "@/lib/view/score-ceiling";
import type { ClvMaturity } from "@/lib/repo/dashboard";

const now = new Date("2026-09-12T14:00:00Z");
const raw: PerformanceRecord = { at: now, closingBasis: "raw_consensus", clvPp: -2, beatClose: false, signalScore: 30 };
const fair: PerformanceRecord = { ...raw, closingBasis: "fair_novig", clvPp: 98, beatClose: true };
const unknown: PerformanceRecord = { ...raw, closingBasis: null, clvPp: 99, beatClose: true };
let passed = 0;
function test(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }

function withPage(rows: PerformanceRecord[] | null, check: (doc: Document) => void) {
  const view = rows === null ? null : buildPerformanceView(rows, now);
  const dom = new JSDOM(renderToStaticMarkup(createElement(PerformanceContent, { view })));
  try { check(dom.window.document); } finally { dom.window.close(); }
}

test("grafico e tabella non pubblicano media mista; esclusioni prima dei numeri", () => {
  withPage([raw, fair, unknown], (doc) => {
    const text = doc.body.textContent!;
    assert.match(text, /Archivio: 3 osservazioni. Campione mostrato: 1/);
    assert.match(text, /1 con chiusura senza margine/);
    assert.match(text, /1 con base sconosciuta/);
    assert.match(doc.querySelector("svg")!.getAttribute("aria-label")!, /su 1 osservazioni/);
    assert.match(doc.querySelector("circle title")!.textContent!, /-2.00 pp su 1 osservazioni/);
    assert.doesNotMatch(text, /\+98|\+99|48\.00/);
    const bucket = Array.from(doc.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes("indice 25–49"))!;
    assert.equal(bucket.querySelectorAll("td")[1].textContent, "1");
    assert.match(bucket.textContent!, /non concludente/);
    assert.ok(text.indexOf("Archivio:") < text.indexOf("CLV medio progressivo"));
    assert.match(text, /non è un rendimento|Non è un rendimento/);
    assert.match(text, /calcio d’inizio in ora italiana/);
  });
});

test("solo storico non allineato: niente grafico o falso zero", () => {
  withPage([fair, unknown], (doc) => {
    assert.equal(doc.querySelector("svg"), null);
    assert.match(doc.body.textContent!, /Archivio: 2 osservazioni. Campione mostrato: 0/);
    assert.match(doc.body.textContent!, /Nessuna osservazione utilizzabile su base grezza/);
    assert.doesNotMatch(doc.body.textContent!, /0\.00 pp|98\.00 pp|99\.00 pp/);
  });
});

test("registro indisponibile distinto da registro vuoto", () => {
  withPage(null, (doc) => {
    assert.match(doc.body.textContent!, /Registro delle osservazioni non leggibile/);
    assert.equal(doc.querySelector("svg"), null);
    assert.equal(doc.querySelector("table"), null);
    assert.doesNotMatch(doc.body.textContent!, /Archivio: 0/);
  });
  withPage([], (doc) => {
    assert.match(doc.body.textContent!, /Nessuna osservazione di CLV a registro/);
    assert.doesNotMatch(doc.body.textContent!, /non leggibile/);
  });
});

test("le osservazioni senza indice restano dichiarate, non spariscono dalle fasce", () => {
  withPage([{ ...raw, signalScore: null }], (doc) => {
    assert.match(doc.body.textContent!, /1 osservazioni senza indice valido/);
    assert.ok(Array.from(doc.querySelectorAll("tbody tr")).every((tr) => tr.querySelectorAll("td")[1].textContent === "0"));
  });
});

test("riepilogo home usa lo stesso campione e non dichiara inesistente lo storico escluso", () => {
  const view = buildPerformanceView([fair, unknown], now);
  const clv: ClvMaturity = {
    sampleSize: view.totalN, unclassifiedN: view.unclassifiedN, inconclusive: view.inconclusive,
    avgClvPp: view.overallAvgPp, beatCloseCount: view.beatCloseCount, beatCloseRate: view.beatCloseRate,
    buckets: view.buckets.map((b) => ({ ...b, unreachable: false })),
    pendingClosings: 0, nextClosingAt: null, note: "Campione provvisorio.",
    basis: view.basis, basisNote: view.basisNote,
    ceiling: scoreCeiling({ booksObserved: 1, booksExpected: 1, sharpAvailable: false, hasOpeningLine: true }), ceilingNote: "",
  };
  const html = renderToStaticMarkup(createElement(ClvSection, { clv }));
  const dom = new JSDOM(html);
  try {
    assert.match(dom.window.document.body.textContent!, /Archivio: 2 osservazioni/);
    assert.match(dom.window.document.body.textContent!, /Nessuna osservazione di CLV utilizzabile su base grezza/);
    assert.equal(dom.window.document.querySelector("table"), null);
  } finally { dom.window.close(); }
});
console.log(`✓ ${passed} test DOM Performance e riepilogo CLV`);
