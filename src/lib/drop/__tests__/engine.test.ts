/**
 * Test del motore drop — runner minimale senza dipendenze esterne.
 * Eseguire con: npm run test
 */
import {
  impliedProbability,
  deltaInPercentagePoints,
  bookmakerMargin,
  median,
  normalizeProbabilities,
  isValidPrice,
} from "../math";
import {
  algorithmVersionOf,
  analyzeDrop,
  classifyMagnitude,
  computeCoordination,
  computeMagnitude,
  computePersistence,
  computeSharp,
  consensusAt,
  toConfidenceBand,
} from "../engine";
import { aggregateClv, computeClv, describeClv } from "../clv";
import { fairMarket, fairPriceFor, scoreBucketOf } from "../novig";
import {
  DEFAULT_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  readSchedulerConfig,
  shouldRunNow,
} from "@/lib/pipeline/scheduler";
import type { BookmakerSeries, DropAnalysisInput } from "../types";

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `atteso ${String(expected)}, ottenuto ${String(actual)}`);
  }
}

function assertClose(actual: number, expected: number, tol = 0.01, msg?: string): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(
      msg ?? `atteso ~${expected} (±${tol}), ottenuto ${actual}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Helper di costruzione serie                                         */
/* ------------------------------------------------------------------ */

const T0 = new Date("2026-08-18T10:00:00Z");
const mins = (m: number) => new Date(T0.getTime() + m * 60000);

function series(
  key: string,
  prices: Array<[number, number]>, // [minutiDaT0, quota]
  opts: { sharp?: boolean; weight?: number; id?: number } = {},
): BookmakerSeries {
  return {
    bookmakerId: opts.id ?? key.length,
    bookmakerKey: key,
    bookmakerName: key,
    isSharp: opts.sharp ?? false,
    weight: opts.weight ?? 1,
    points: prices.map(([m, price]) => ({ price, at: mins(m) })),
  };
}

function input(
  s: BookmakerSeries[],
  nowMin = 300,
  expected = 4,
): DropAnalysisInput {
  return {
    matchId: 1,
    market: "1x2",
    selection: "home",
    kickoffAt: mins(600),
    now: mins(nowMin),
    series: s,
    expectedBookmakers: expected,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Aritmetica                                                       */
/* ------------------------------------------------------------------ */

console.log("\n[1] Aritmetica delle quote");

test("probabilità implicita = 1/quota", () => {
  assertClose(impliedProbability(2.0)!, 0.5, 1e-9);
  assertClose(impliedProbability(4.0)!, 0.25, 1e-9);
  assertClose(impliedProbability(1.25)!, 0.8, 1e-9);
});

test("quote non valide restituiscono null", () => {
  assertEqual(impliedProbability(0), null);
  assertEqual(impliedProbability(-3), null);
  assertEqual(impliedProbability(1.0), null);
  assertEqual(impliedProbability(NaN), null);
  assertEqual(impliedProbability(null), null);
  assertEqual(isValidPrice(undefined), false);
});

test("delta in punti percentuali con segno corretto (drop = positivo)", () => {
  // 2.00 -> 1.80 : 50% -> 55.56% = +5.56 pp
  assertClose(deltaInPercentagePoints(2.0, 1.8)!, 5.56, 0.01);
  // rialzo di quota = delta negativo
  assertClose(deltaInPercentagePoints(1.8, 2.0)!, -5.56, 0.01);
});

test("margine bookmaker su 1X2 completo", () => {
  const m = bookmakerMargin([2.0, 3.5, 4.0])!;
  assertClose(m, 0.5 + 0.2857 + 0.25 - 1, 0.001);
});

test("normalizzazione rimuove il margine", () => {
  const probs = normalizeProbabilities([2.0, 3.5, 4.0])!;
  assertClose(probs.reduce((a, b) => a + b, 0), 1, 1e-9);
});

test("mediana robusta ignora valori nulli", () => {
  assertEqual(median([1, null, 3, undefined, 2]), 2);
  assertEqual(median([]), null);
  assertEqual(median([1, 2, 3, 4]), 2.5);
});

/* ------------------------------------------------------------------ */
/* 2. Classificazione ampiezza                                         */
/* ------------------------------------------------------------------ */

console.log("\n[2] Soglie di ampiezza");

test("< 2 pp = rumore", () => {
  assertEqual(classifyMagnitude(0), "noise");
  assertEqual(classifyMagnitude(1.99), "noise");
  assertEqual(classifyMagnitude(-1.5), "noise");
});

test("2–5 pp = moderato", () => {
  assertEqual(classifyMagnitude(2), "moderate");
  assertEqual(classifyMagnitude(4.99), "moderate");
});

test("5–10 pp = alto", () => {
  assertEqual(classifyMagnitude(5), "high");
  assertEqual(classifyMagnitude(9.99), "high");
});

test("> 10 pp = molto alto", () => {
  assertEqual(classifyMagnitude(10), "very_high");
  assertEqual(classifyMagnitude(25), "very_high");
});

/* ------------------------------------------------------------------ */
/* 3. Consenso e ampiezza                                              */
/* ------------------------------------------------------------------ */

console.log("\n[3] Consenso di mercato");

test("consenso = mediana delle ultime quote note (LOCF)", () => {
  const s = [
    series("a", [[0, 2.0], [60, 1.9]]),
    series("b", [[0, 2.1]]),
    series("c", [[30, 2.05]]),
  ];
  // a t=0 solo a e b hanno quota -> mediana(2.0, 2.1) = 2.05
  assertClose(consensusAt(s, mins(0))!, 2.05, 1e-9);
  // a t=60: a=1.9, b=2.1, c=2.05 -> mediana = 2.05
  assertClose(consensusAt(s, mins(60))!, 2.05, 1e-9);
});

test("ampiezza calcolata su apertura e ultimo consenso", () => {
  const s = [
    series("a", [[0, 2.0], [120, 1.75]]),
    series("b", [[0, 2.0], [120, 1.75]]),
  ];
  const m = computeMagnitude(s)!;
  assertClose(m.openingPrice, 2.0, 1e-9);
  assertClose(m.currentPrice, 1.75, 1e-9);
  assertClose(m.deltaPp, 7.14, 0.01);
  assertEqual(m.magnitudeClass, "high");
  assertEqual(m.isSignificant, true);
});

test("ampiezza null con meno di due rilevazioni", () => {
  assertEqual(computeMagnitude([series("a", [[0, 2.0]])]), null);
});

/* ------------------------------------------------------------------ */
/* 4. Coordinazione                                                    */
/* ------------------------------------------------------------------ */

console.log("\n[4] Coordinazione fra bookmaker");

test("drop coordinato su 4 book pesa più di uno isolato", () => {
  const coordinato = computeCoordination(
    [
      series("a", [[0, 2.0], [120, 1.8]]),
      series("b", [[0, 2.0], [120, 1.82]]),
      series("c", [[0, 2.02], [120, 1.83]]),
      series("d", [[0, 1.98], [120, 1.79]]),
    ],
    5.5,
  );
  const isolato = computeCoordination(
    [
      series("a", [[0, 2.0], [120, 1.8]]),
      series("b", [[0, 2.0], [120, 2.0]]),
      series("c", [[0, 2.02], [120, 2.02]]),
      series("d", [[0, 1.98], [120, 1.98]]),
    ],
    5.5,
  );
  assertEqual(coordinato.booksConfirming, 4);
  assertEqual(isolato.booksConfirming, 1);
  assertEqual(isolato.booksFlat, 3);
  assert(
    coordinato.coordinationScore > isolato.coordinationScore,
    "il drop coordinato deve avere score superiore",
  );
  assertClose(coordinato.coordinationScore, 1, 1e-9);
  assertClose(isolato.coordinationScore, 0.25, 1e-9);
});

test("un solo bookmaker non produce coordinazione", () => {
  const c = computeCoordination([series("a", [[0, 2.0], [120, 1.7]])], 8);
  assertEqual(c.booksTotal, 1);
  assertEqual(c.coordinationScore, 0);
});

test("book in direzione opposta viene classificato come oppose", () => {
  const c = computeCoordination(
    [
      series("a", [[0, 2.0], [120, 1.8]]),
      series("b", [[0, 2.0], [120, 2.3]]),
    ],
    5.5,
  );
  assertEqual(c.booksConfirming, 1);
  assertEqual(c.booksOpposing, 1);
});

/* ------------------------------------------------------------------ */
/* 5. Linea sharp                                                      */
/* ------------------------------------------------------------------ */

console.log("\n[5] Conferma sharp");

test("sharp assente viene dichiarato, non stimato", () => {
  const s = computeSharp([series("a", [[0, 2.0], [120, 1.8]])], 5.5);
  assertEqual(s.available, false);
  assertEqual(s.confirms, null);
  assertEqual(s.deltaPp, null);
});

test("sharp che conferma", () => {
  const s = computeSharp(
    [
      series("a", [[0, 2.0], [120, 1.8]]),
      series("pinny", [[0, 2.05], [120, 1.85]], { sharp: true }),
    ],
    5.5,
  );
  assertEqual(s.available, true);
  assertEqual(s.confirms, true);
  assert(s.deltaPp! > 0, "delta sharp positivo");
});

test("sharp che non conferma", () => {
  const s = computeSharp(
    [
      series("a", [[0, 2.0], [120, 1.8]]),
      series("pinny", [[0, 2.0], [120, 2.0]], { sharp: true }),
    ],
    5.5,
  );
  assertEqual(s.available, true);
  assertEqual(s.confirms, false);
});

test("sharp che guida il mercato", () => {
  const s = computeSharp(
    [
      series("a", [[0, 2.0], [120, 1.95]]),
      series("pinny", [[0, 2.0], [120, 1.6]], { sharp: true }),
    ],
    1.28,
  );
  assertEqual(s.leadsMarket, true);
});

/* ------------------------------------------------------------------ */
/* 6. Persistenza, flash e rimbalzo                                    */
/* ------------------------------------------------------------------ */

console.log("\n[6] Persistenza temporale");

test("movimento flash sotto i 30 minuti", () => {
  const s = [
    series("a", [[0, 2.0], [20, 1.8]]),
    series("b", [[0, 2.0], [20, 1.8]]),
  ];
  const p = computePersistence(s, mins(25))!;
  assertEqual(p.isFlash, true);
  assert(p.moveDurationMinutes <= 30, "durata movimento entro 30 minuti");
});

test("movimento sostenuto per ore non è flash", () => {
  const s = [
    series("a", [[0, 2.0], [60, 1.8], [300, 1.78]]),
    series("b", [[0, 2.0], [60, 1.82], [300, 1.79]]),
  ];
  const p = computePersistence(s, mins(300))!;
  assertEqual(p.isFlash, false);
  assert(p.sustainedMinutes >= 240, `attesi >=240 minuti, ottenuti ${p.sustainedMinutes}`);
  assert(p.persistenceScore > 0.8, "score persistenza alto");
});

test("movimento rimbalzato = falso segnale parziale", () => {
  const s = [
    series("a", [[0, 2.0], [60, 1.7], [180, 1.98]]),
    series("b", [[0, 2.0], [60, 1.7], [180, 1.98]]),
  ];
  const p = computePersistence(s, mins(180))!;
  assertEqual(p.rebounded, true);
  assert(p.retracementRatio > 0.5, `ritracciamento ${p.retracementRatio}`);
});

test("movimento tenuto non è rimbalzato", () => {
  const s = [
    series("a", [[0, 2.0], [60, 1.7], [180, 1.72]]),
    series("b", [[0, 2.0], [60, 1.7], [180, 1.72]]),
  ];
  const p = computePersistence(s, mins(180))!;
  assertEqual(p.rebounded, false);
});

test("fiducia superiore per movimento sostenuto rispetto al flash", () => {
  const flash = analyzeDrop(
    input(
      [
        series("a", [[0, 2.0], [20, 1.8]]),
        series("b", [[0, 2.0], [20, 1.81]]),
        series("c", [[0, 2.0], [20, 1.79]]),
        series("p", [[0, 2.0], [20, 1.8]], { sharp: true }),
      ],
      25,
    ),
  );
  const sostenuto = analyzeDrop(
    input(
      [
        series("a", [[0, 2.0], [60, 1.8], [300, 1.8]]),
        series("b", [[0, 2.0], [60, 1.81], [300, 1.81]]),
        series("c", [[0, 2.0], [60, 1.79], [300, 1.79]]),
        series("p", [[0, 2.0], [60, 1.8], [300, 1.8]], { sharp: true }),
      ],
      300,
    ),
  );
  assert(
    sostenuto.confidenceScore > flash.confidenceScore,
    `sostenuto ${sostenuto.confidenceScore} deve superare flash ${flash.confidenceScore}`,
  );
});

/* ------------------------------------------------------------------ */
/* 7. Analisi completa                                                 */
/* ------------------------------------------------------------------ */

console.log("\n[7] Analisi completa");

test("movimento sotto soglia non qualifica come segnale", () => {
  const a = analyzeDrop(
    input([
      series("a", [[0, 2.0], [120, 1.98]]),
      series("b", [[0, 2.0], [120, 1.99]]),
    ]),
  );
  assertEqual(a.qualifiesAsSignal, false);
  assert(a.rejectionReason !== null, "deve indicare il motivo dello scarto");
  assertEqual(a.magnitude.magnitudeClass, "noise");
});

test("rialzo di quota non è un drop", () => {
  const a = analyzeDrop(
    input([
      series("a", [[0, 1.8], [120, 2.1]]),
      series("b", [[0, 1.8], [120, 2.1]]),
    ]),
  );
  assertEqual(a.qualifiesAsSignal, false);
  assert(a.magnitude.deltaPp < 0, "delta negativo");
});

test("drop coordinato con sharp produce fiducia alta", () => {
  const a = analyzeDrop(
    input(
      [
        series("a", [[0, 2.6], [60, 2.0], [300, 1.9]]),
        series("b", [[0, 2.6], [60, 2.02], [300, 1.91]]),
        series("c", [[0, 2.62], [60, 2.01], [300, 1.92]]),
        series("d", [[0, 2.58], [60, 1.99], [300, 1.89]]),
        series("pinny", [[0, 2.65], [60, 1.98], [300, 1.87]], { sharp: true }),
      ],
      300,
      5,
    ),
  );
  assertEqual(a.qualifiesAsSignal, true);
  assertEqual(a.magnitude.magnitudeClass, "very_high");
  assertEqual(a.sharp.confirms, true);
  assertEqual(a.coordination.booksConfirming, 5);
  assert(a.confidenceScore >= 78, `punteggio ${a.confidenceScore} atteso >= 78`);
  assertEqual(a.confidenceBand, "high");
});

test("dati insufficienti: nessuna quotazione", () => {
  const a = analyzeDrop(input([]));
  assertEqual(a.qualifiesAsSignal, false);
  assertEqual(a.confidenceBand, "insufficient_data");
  assert(a.explanation.missingData.length > 0, "deve elencare i dati mancanti");
});

test("una sola rilevazione: nessun movimento misurabile", () => {
  const a = analyzeDrop(input([series("a", [[0, 2.0]])]));
  assertEqual(a.qualifiesAsSignal, false);
  assert(
    a.rejectionReason!.includes("Storico insufficiente"),
    "motivo esplicito sullo storico",
  );
});

test("copertura bassa forza la banda insufficient_data", () => {
  const a = analyzeDrop(
    input([series("a", [[0, 2.0], [10, 1.7]])], 12, 8),
  );
  assert(a.coverage.score < 0.35, `copertura ${a.coverage.score}`);
  assertEqual(a.confidenceBand, "insufficient_data");
});

test("la spiegazione elenca sempre le componenti del punteggio", () => {
  const a = analyzeDrop(
    input([
      series("a", [[0, 2.0], [120, 1.8]]),
      series("b", [[0, 2.0], [120, 1.81]]),
    ]),
  );
  assertEqual(a.explanation.components.length, 5);
  const total = a.explanation.components.reduce((s, c) => s + c.maxPoints, 0);
  assertEqual(total, 100);
  assert(a.explanation.caveats.length > 0, "devono esserci avvertenze");
  assert(
    a.explanation.summary.length > 20,
    "la sintesi deve essere una frase leggibile",
  );
});

test("nessuna spiegazione contiene linguaggio di consiglio", () => {
  const a = analyzeDrop(
    input([
      series("a", [[0, 2.4], [300, 1.9]]),
      series("b", [[0, 2.4], [300, 1.92]]),
      series("p", [[0, 2.4], [300, 1.88]], { sharp: true }),
    ]),
  );
  const vietate = ["punta", "scommetti", "consigl", "vincente", "sicuro", "garantit"];
  const testo = JSON.stringify(a.explanation).toLowerCase();
  for (const p of vietate) {
    assert(!testo.includes(p), `la spiegazione non deve contenere "${p}"`);
  }
});

test("banda di confidenza rispetta le soglie", () => {
  assertEqual(toConfidenceBand(90, 0.9), "high");
  assertEqual(toConfidenceBand(65, 0.9), "medium");
  assertEqual(toConfidenceBand(40, 0.9), "low");
  assertEqual(toConfidenceBand(90, 0.2), "insufficient_data");
});

/* ------------------------------------------------------------------ */
/* 8. CLV                                                              */
/* ------------------------------------------------------------------ */

console.log("\n[8] CLV");

test("CLV positivo quando la quota rilevata batte la chiusura", () => {
  const r = computeClv({ signalPrice: 2.1, closingPrice: 1.9 })!;
  assertEqual(r.beatClose, true);
  assert(r.clvPp > 0, "clvPp positivo");
  assertClose(r.clvPct, 2.1 / 1.9 - 1, 1e-4);
});

test("CLV negativo quando la chiusura è migliore", () => {
  const r = computeClv({ signalPrice: 1.8, closingPrice: 2.0 })!;
  assertEqual(r.beatClose, false);
  assert(r.clvPp < 0, "clvPp negativo");
});

test("CLV nullo con quote non valide", () => {
  assertEqual(computeClv({ signalPrice: 0, closingPrice: 2 }), null);
  assertEqual(computeClv({ signalPrice: 2, closingPrice: NaN }), null);
});

test("aggregato dichiara campione insufficiente sotto 10 osservazioni", () => {
  const recs = [1.9, 1.95, 2.0].map(
    (c) => computeClv({ signalPrice: 2.0, closingPrice: c })!,
  );
  const agg = aggregateClv(recs);
  assertEqual(agg.sampleSize, 3);
  assertEqual(agg.underpowered, true);
  assertEqual(agg.ci95, null);
  assert(
    describeClv(agg).includes("troppo piccolo"),
    "la descrizione deve dichiarare il limite",
  );
});

test("aggregato calcola intervallo di confidenza con campione adeguato", () => {
  const recs = Array.from({ length: 20 }, (_, i) =>
    computeClv({ signalPrice: 2.0, closingPrice: 1.85 + (i % 5) * 0.01 })!,
  );
  const agg = aggregateClv(recs);
  assertEqual(agg.sampleSize, 20);
  assertEqual(agg.underpowered, false);
  assert(agg.ci95 !== null, "ci95 presente");
  assert(agg.avgClvPp > 0, "CLV medio positivo su questo campione");
});

test("aggregato vuoto non inventa numeri", () => {
  const agg = aggregateClv([]);
  assertEqual(agg.sampleSize, 0);
  assertEqual(agg.ci95, null);
  assert(describeClv(agg).includes("non è ancora calcolabile"), "messaggio onesto");
});

/* ------------------------------------------------------------------ */
/* Chiusura fair senza margine                                         */
/* ------------------------------------------------------------------ */

console.log("\n[9] Chiusura fair senza margine");

test("mercato 1x2 completo: le probabilità fair sommano a 1", () => {
  const res = fairMarket({
    market: "1x2",
    prices: { home: 1.78, draw: 3.73, away: 3.43 },
  });
  assert(res.ok, "mercato completo deve essere normalizzabile");
  if (!res.ok) return;
  const sum =
    res.data.fairProbs.home + res.data.fairProbs.draw + res.data.fairProbs.away;
  assert(Math.abs(sum - 1) < 1e-6, `somma fair ${sum}, attesa 1`);
});

test("il margine osservato è positivo e coerente con le quote reali", () => {
  // terna realmente osservata sul match be-YkmBW3Jc alle 20:37 del 18.08.2026
  const res = fairMarket({
    market: "1x2",
    prices: { home: 1.78, draw: 3.73, away: 3.43 },
  });
  assert(res.ok, "atteso ok");
  if (!res.ok) return;
  assertEqual(res.data.margin, 0.1214);
  assertEqual(res.data.method, "proportional");
});

test("la quota fair è sempre più alta di quella grezza", () => {
  const res = fairMarket({
    market: "1x2",
    prices: { home: 1.78, draw: 3.73, away: 3.43 },
  });
  assert(res.ok, "atteso ok");
  if (!res.ok) return;
  assert(res.data.fairPrices.home > 1.78, "fair home > grezza");
  assert(res.data.fairPrices.draw > 3.73, "fair draw > grezza");
  assert(res.data.fairPrices.away > 3.43, "fair away > grezza");
});

test("selezione mancante: nessuna stima, solo il motivo", () => {
  const res = fairMarket({ market: "1x2", prices: { home: 1.78, draw: 3.73 } });
  assert(!res.ok, "mercato incompleto non deve produrre un fair");
  if (res.ok) return;
  assertEqual(res.failure.missing.length, 1);
  assertEqual(res.failure.missing[0], "away");
  assert(res.failure.reason.includes("non calcolabile"), "motivo esplicito");
});

test("quota non valida trattata come non utilizzabile, non corretta", () => {
  const res = fairMarket({
    market: "1x2",
    prices: { home: 1.78, draw: 3.73, away: 0.5 },
  });
  assert(!res.ok, "quota fuori range deve bloccare il calcolo");
  if (res.ok) return;
  assertEqual(res.failure.invalid[0], "away");
});

test("mercato a due esiti: over/under normalizzato", () => {
  const res = fairMarket({ market: "ou_2_5", prices: { over: 1.95, under: 1.9 } });
  assert(res.ok, "atteso ok");
  if (!res.ok) return;
  const sum = res.data.fairProbs.over + res.data.fairProbs.under;
  assert(Math.abs(sum - 1) < 1e-6, "somma fair pari a 1");
  assert(res.data.margin > 0, "margine positivo");
});

test("fairPriceFor restituisce null invece di un numero inventato", () => {
  assertEqual(fairPriceFor("1x2", "away", { home: 1.78, draw: 3.73 }), null);
  const fair = fairPriceFor("1x2", "home", { home: 1.78, draw: 3.73, away: 3.43 });
  assert(fair !== null && fair > 1.78, "fair calcolabile su mercato completo");
});

test("le fasce dell'indice coprono l'intero intervallo senza sovrapposizioni", () => {
  assertEqual(scoreBucketOf(0), "0-24");
  assertEqual(scoreBucketOf(24.9), "0-24");
  assertEqual(scoreBucketOf(25), "25-49");
  assertEqual(scoreBucketOf(49.9), "25-49");
  assertEqual(scoreBucketOf(50), "50-74");
  assertEqual(scoreBucketOf(74.9), "50-74");
  assertEqual(scoreBucketOf(75), "75-100");
  assertEqual(scoreBucketOf(100), "75-100");
});

/* ------------------------------------------------------------------ */
/* Gate dello scheduler                                                */
/* ------------------------------------------------------------------ */

console.log("\n[10] Scheduler — intervallo minimo");

test("primo giro assoluto: parte sempre", () => {
  const d = shouldRunNow(null, new Date("2026-08-18T20:00:00Z"), 15, false);
  assert(d.run, "senza storia il giro deve partire");
  assertEqual(d.waitedMinutes, null);
});

test("intervallo non ancora trascorso: raccolta saltata", () => {
  const d = shouldRunNow(
    new Date("2026-08-18T20:00:00Z"),
    new Date("2026-08-18T20:06:00Z"),
    15,
    false,
  );
  assert(!d.run, "6 minuti < 15: non deve raccogliere");
  assert(d.reason.includes("saltata"), "motivo esplicito");
});

test("intervallo trascorso: il giro riparte", () => {
  const d = shouldRunNow(
    new Date("2026-08-18T20:00:00Z"),
    new Date("2026-08-18T20:16:00Z"),
    15,
    false,
  );
  assert(d.run, "16 minuti > 15: deve raccogliere");
  assertEqual(Math.round(d.waitedMinutes ?? 0), 16);
});

test("force ignora l'intervallo ma lo dichiara", () => {
  const d = shouldRunNow(
    new Date("2026-08-18T20:00:00Z"),
    new Date("2026-08-18T20:01:00Z"),
    15,
    true,
  );
  assert(d.run, "force deve forzare");
  assert(d.reason.includes("forzata"), "il forzamento resta dichiarato");
});

test("intervallo di configurazione limitato entro i valori difendibili", () => {
  const original = process.env.COLLECT_INTERVAL_MINUTES;

  process.env.COLLECT_INTERVAL_MINUTES = "1";
  assertEqual(readSchedulerConfig().intervalMinutes, MIN_INTERVAL_MINUTES);

  process.env.COLLECT_INTERVAL_MINUTES = "30";
  assertEqual(readSchedulerConfig().intervalMinutes, 30);
  assertEqual(readSchedulerConfig().source, "env");

  process.env.COLLECT_INTERVAL_MINUTES = "non-un-numero";
  assertEqual(readSchedulerConfig().intervalMinutes, DEFAULT_INTERVAL_MINUTES);
  assertEqual(readSchedulerConfig().source, "default");

  delete process.env.COLLECT_INTERVAL_MINUTES;
  assertEqual(readSchedulerConfig().intervalMinutes, DEFAULT_INTERVAL_MINUTES);

  if (original !== undefined) process.env.COLLECT_INTERVAL_MINUTES = original;
});

  /* ------------------------------------------------------------------ */
  /* 8. suspicion-v2 — moltiplicatore di iper-reazione                   */
  /* ------------------------------------------------------------------ */

  console.log("\n[8] suspicion-v2 — iper-reazione storica");

  const serieCasa = [
    series("a", [[0, 2.0], [60, 1.8], [300, 1.8]]),
    series("b", [[0, 2.0], [60, 1.81], [300, 1.81]]),
    series("c", [[0, 2.0], [60, 1.79], [300, 1.79]]),
    series("p", [[0, 2.0], [60, 1.8], [300, 1.8]], { sharp: true }),
  ];

  test("v2: drop sulla casa riduce la fiducia col moltiplicatore dichiarato", () => {
    const v1 = analyzeDrop(input(serieCasa, 300));
    const v2 = analyzeDrop(input(serieCasa, 300), "suspicion-v2");
    assert(v2.explanation.suspicion !== undefined, "il blocco sospetto deve esserci");
    const sus = v2.explanation.suspicion!;
    assertEqual(sus.multiplier, 0.75);
    assertEqual(sus.reasons.some((r) => r.code === "drop_casa"), true);
    assertEqual(v2.explanation.engineVersion, "suspicion-v2");
    assertClose(v2.confidenceScore, Math.round(v1.confidenceScore * 0.75 * 100) / 100, 0.01);
    assertEqual(sus.scoreBefore, v1.confidenceScore);
  });

  test("v2: drop sulla casa non sparisce, resta un segnale", () => {
    const v1 = analyzeDrop(input(serieCasa, 300));
    const v2 = analyzeDrop(input(serieCasa, 300), "suspicion-v2");
    assertEqual(v2.qualifiesAsSignal, v1.qualifiesAsSignal);
    assert(v2.confidenceScore > 0, "ridotto, non cancellato");
  });

  test("v2: drop sull'esito sfavorito (apertura > 3.0) riduce la fiducia", () => {
    const serieSfavorito = [
      series("a", [[0, 3.6], [60, 3.1], [300, 3.05]]),
      series("b", [[0, 3.6], [60, 3.12], [300, 3.06]]),
      series("c", [[0, 3.6], [60, 3.08], [300, 3.04]]),
      series("p", [[0, 3.6], [60, 3.1], [300, 3.05]], { sharp: true }),
    ];
    const inp = { ...input(serieSfavorito, 300), selection: "away" as const };
    const v1 = analyzeDrop(inp);
    const v2 = analyzeDrop(inp, "suspicion-v2");
    const sus = v2.explanation.suspicion!;
    assertEqual(sus.reasons.some((r) => r.code === "drop_sfavorito"), true);
    assertEqual(sus.reasons.some((r) => r.code === "drop_casa"), false);
    assertClose(v2.confidenceScore, Math.round(v1.confidenceScore * 0.75 * 100) / 100, 0.01);
  });

  test("v2: a 3.0 esatti non scatta la classe sfavorito, oltre sì", () => {
    const base = [
      series("a", [[0, 3.0], [60, 2.6], [300, 2.55]]),
      series("b", [[0, 3.0], [60, 2.62], [300, 2.57]]),
      series("c", [[0, 3.0], [60, 2.58], [300, 2.54]]),
      series("p", [[0, 3.0], [60, 2.6], [300, 2.55]], { sharp: true }),
    ];
    const alLimite = analyzeDrop(
      { ...input(base, 300), selection: "away" as const },
      "suspicion-v2",
    );
    assertEqual(alLimite.explanation.suspicion, undefined);
    const oltrePrezzi = [
      series("a", [[0, 3.2], [60, 2.75], [300, 2.7]]),
      series("b", [[0, 3.2], [60, 2.77], [300, 2.72]]),
      series("c", [[0, 3.2], [60, 2.73], [300, 2.69]]),
      series("p", [[0, 3.2], [60, 2.75], [300, 2.7]], { sharp: true }),
    ];
    const oltre = analyzeDrop(
      { ...input(oltrePrezzi, 300), selection: "away" as const },
      "suspicion-v2",
    );
    assert(oltre.explanation.suspicion !== undefined, "apertura 3.2 deve scattare");
    assertEqual(
      oltre.explanation.suspicion!.reasons.some((r) => r.code === "drop_sfavorito"),
      true,
    );
  });

  test("v2: le due classi insieme si sommano nei motivi, non nel peso", () => {
    const serieCasaSfavorita = [
      series("a", [[0, 3.6], [60, 3.1], [300, 3.05]]),
      series("b", [[0, 3.6], [60, 3.12], [300, 3.06]]),
      series("c", [[0, 3.6], [60, 3.08], [300, 3.04]]),
      series("p", [[0, 3.6], [60, 3.1], [300, 3.05]], { sharp: true }),
    ];
    const v1 = analyzeDrop(input(serieCasaSfavorita, 300));
    const v2 = analyzeDrop(input(serieCasaSfavorita, 300), "suspicion-v2");
    const sus = v2.explanation.suspicion!;
    assertEqual(sus.reasons.length, 2);
    assertEqual(sus.multiplier, 0.75, "una sola applicazione, mai 0,5625");
    assertClose(v2.confidenceScore, Math.round(v1.confidenceScore * 0.75 * 100) / 100, 0.01);
  });

  test("v1: lo storico non cambia — nessun moltiplicatore, versione v1", () => {
    const v1 = analyzeDrop(input(serieCasa, 300), "v1");
    assertEqual(v1.explanation.suspicion, undefined);
    assertEqual(v1.explanation.engineVersion, "drop-engine/1.0.0");
    assertEqual(v1.confidenceScore, analyzeDrop(input(serieCasa, 300)).confidenceScore);
  });

  test("v2: la banda si ricalcola sul punteggio ridotto", () => {
    const v1 = analyzeDrop(input(serieCasa, 300));
    const v2 = analyzeDrop(input(serieCasa, 300), "suspicion-v2");
    assert(v2.confidenceScore <= v1.confidenceScore, "v2 non può superare v1");
    if (v1.confidenceBand === "high" && v2.confidenceScore < 78) {
      assert(v2.confidenceBand !== "high", "la banda deve seguire il punteggio ridotto");
    }
  });

  test("algorithmVersionOf: le righe v1 restano v1, il resto è suspicion-v2", () => {
    assertEqual(algorithmVersionOf("drop-engine/1.0.0"), "v1");
    assertEqual(algorithmVersionOf("suspicion-v2"), "suspicion-v2");
  });

/* ------------------------------------------------------------------ */

console.log(`\n${"─".repeat(60)}`);
console.log(`Test superati: ${passed} | falliti: ${failed}`);
if (failures.length > 0) {
  console.log("\nFallimenti:");
  for (const f of failures) console.log(`  • ${f}`);
}
console.log(`${"─".repeat(60)}\n`);

if (failed > 0) process.exit(1);
