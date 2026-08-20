/**
 * Test delle funzioni pure di presentazione — runner minimale, nessuna
 * dipendenza esterna e nessun accesso al database.
 * Eseguire con: npm run test:view
 *
 * Copre il debito lasciato aperto dallo Sprint 5A (signalLevelOf, freshnessOf,
 * formattatori) e le funzioni pure introdotte dallo Sprint 5B (geometria del
 * grafico, statistiche di serie, profondità dell'osservazione).
 */
import {
  freshnessOf,
  signalLevelOf,
  wideDropPctOf,
  CLV_INCONCLUSIVE_BELOW,
  FRESHNESS_LABELS,
  SIGNAL_LEVEL_LABELS,
} from "../dashboard";
import {
  ND,
  fmtAgo,
  fmtDateTime,
  fmtDay,
  fmtMinutes,
  fmtPct,
  fmtPp,
  fmtPrice,
  fmtRate,
  fmtTime,
  gapReasonLabel,
  sourceStatusLabel,
} from "@/components/format";
import {
  MIN_POINTS_FOR_TREND,
  describeDepth,
  dropPctOf,
  peakOf,
  seriesStats,
} from "../series";
import { buildChart, CHART_HEIGHT, CHART_WIDTH } from "@/components/chart";
import { STALE_SNAPSHOT_MINUTES } from "@/lib/drop/constants";

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
    throw new Error(
      msg ?? `atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`,
    );
  }
}

function assertClose(actual: number, expected: number, tol = 0.001): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`atteso ~${expected}, ottenuto ${actual}`);
  }
}

/** Istante fisso di riferimento: 18/08/2026 20:00 UTC = 22:00 a Roma. */
const NOW = new Date("2026-08-18T20:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

/* ================================================================== */
console.log("\nsignalLevelOf — traduzione di banda e ampiezza in livello");
/* ================================================================== */

test("rumore: nessun segnale, per quanto alta sia la banda", () => {
  assertEqual(signalLevelOf("high", "noise", "active"), "nessuno");
});

test("il rumore prevale anche su uno stato di rimbalzo", () => {
  assertEqual(signalLevelOf("high", "noise", "rebounded"), "nessuno");
});

test("dati insufficienti: nessun segnale, anche con ampiezza molto alta", () => {
  assertEqual(signalLevelOf("insufficient_data", "very_high", "active"), "nessuno");
});

test("banda alta + movimento alto + attivo = segnale forte", () => {
  assertEqual(signalLevelOf("high", "high", "active"), "forte");
});

test("banda media = segnale reale", () => {
  assertEqual(signalLevelOf("medium", "high", "active"), "reale");
});

test("banda bassa = segnale debole", () => {
  assertEqual(signalLevelOf("low", "moderate", "active"), "debole");
});

test("un movimento rimbalzato scende a debole anche con banda alta", () => {
  assertEqual(signalLevelOf("high", "very_high", "rebounded"), "debole");
});

test("un segnale scaduto scende a debole anche con banda alta", () => {
  assertEqual(signalLevelOf("high", "very_high", "expired"), "debole");
});

test("uno stato closed non declassa: conta la banda", () => {
  assertEqual(signalLevelOf("high", "high", "closed"), "forte");
});

test("ogni livello ha un'etichetta leggibile", () => {
  for (const k of ["forte", "reale", "debole", "nessuno"] as const) {
    assert(
      typeof SIGNAL_LEVEL_LABELS[k] === "string" && SIGNAL_LEVEL_LABELS[k].length > 0,
      `etichetta mancante per ${k}`,
    );
  }
});

/* ================================================================== */
console.log("\nfreshnessOf — stato del dato di una partita");
/* ================================================================== */

test("nessuna rilevazione: parziale, età sconosciuta", () => {
  const r = freshnessOf(null, 0, NOW);
  assertEqual(r.level, "partial");
  assertEqual(r.ageMinutes, null);
  assert(r.reason.includes("Nessuna rilevazione"), `motivo inatteso: ${r.reason}`);
});

test("rilevazione recente senza buchi: dati aggiornati", () => {
  const r = freshnessOf(minutesAgo(10), 0, NOW);
  assertEqual(r.level, "live");
  assertEqual(r.ageMinutes, 10);
});

test("un buco dichiarato rende parziale anche un dato appena raccolto", () => {
  const r = freshnessOf(minutesAgo(1), 1, NOW);
  assertEqual(r.level, "partial");
  assertEqual(r.ageMinutes, 1);
});

test("il buco singolo è scritto al singolare", () => {
  const r = freshnessOf(minutesAgo(1), 1, NOW);
  assert(r.reason.includes("1 buco dichiarato"), r.reason);
});

test("più buchi: plurale corretto", () => {
  const r = freshnessOf(minutesAgo(1), 3, NOW);
  assert(r.reason.includes("3 buchi dichiarati"), r.reason);
});

test("il buco dichiarato prevale sulla vecchiaia del dato", () => {
  const r = freshnessOf(minutesAgo(500), 2, NOW);
  assertEqual(r.level, "partial", "la completezza conta più della freschezza");
});

test(`esattamente ${STALE_SNAPSHOT_MINUTES} minuti: ancora live (soglia esclusiva)`, () => {
  assertEqual(freshnessOf(minutesAgo(STALE_SNAPSHOT_MINUTES), 0, NOW).level, "live");
});

test(`${STALE_SNAPSHOT_MINUTES + 1} minuti: dato fermo`, () => {
  const r = freshnessOf(minutesAgo(STALE_SNAPSHOT_MINUTES + 1), 0, NOW);
  assertEqual(r.level, "stale");
  assert(r.reason.includes(String(STALE_SNAPSHOT_MINUTES)), r.reason);
});

test("timestamp nel futuro: età azzerata, mai negativa", () => {
  const r = freshnessOf(new Date(NOW.getTime() + 5 * 60_000), 0, NOW);
  assertEqual(r.ageMinutes, 0);
  assertEqual(r.level, "live");
});

test("ogni stato di freschezza ha un'etichetta", () => {
  for (const k of ["live", "stale", "partial"] as const) {
    assert(FRESHNESS_LABELS[k].length > 0, `etichetta mancante per ${k}`);
  }
});

test("la soglia di non concludenza del CLV resta a 30", () => {
  assertEqual(CLV_INCONCLUSIVE_BELOW, 30);
});

/* ================================================================== */
console.log("\nformat — un'assenza non deve mai somigliare a uno zero");
/* ================================================================== */

test("quota: tre decimali", () => {
  assertEqual(fmtPrice(3.29), "3.290");
  assertEqual(fmtPrice(1.8), "1.800");
});

test("quota assente: n/d, non 0", () => {
  assertEqual(fmtPrice(null), ND);
  assertEqual(ND, "n/d");
});

test("quota non finita: n/d", () => {
  assertEqual(fmtPrice(Number.NaN), ND);
  assertEqual(fmtPrice(Number.POSITIVE_INFINITY), ND);
});

test("percentuale negativa col segno meno tipografico", () => {
  assertEqual(fmtPct(-8.86), "−8.86%");
});

test("percentuale positiva col più", () => {
  assertEqual(fmtPct(4.5), "+4.50%");
});

test("percentuale nulla: nessun segno", () => {
  assertEqual(fmtPct(0), "0.00%");
});

test("punti percentuali con unità esplicita", () => {
  assertEqual(fmtPp(2.69), "+2.69 pp");
  assertEqual(fmtPp(-1.5), "−1.50 pp");
  assertEqual(fmtPp(null), ND);
});

test("frazione resa come percentuale intera", () => {
  assertEqual(fmtRate(0.5), "50%");
  assertEqual(fmtRate(0.336), "34%");
  assertEqual(fmtRate(0), "0%");
  assertEqual(fmtRate(null), ND);
});

test("durate: minuti sotto l'ora", () => {
  assertEqual(fmtMinutes(0), "0 min");
  assertEqual(fmtMinutes(59), "59 min");
});

test("durate: ore tonde senza minuti a zero", () => {
  assertEqual(fmtMinutes(60), "1 h");
  assertEqual(fmtMinutes(240), "4 h");
});

test("durate: ore e minuti", () => {
  assertEqual(fmtMinutes(200), "3 h 20 min");
});

test("durata assente: n/d", () => {
  assertEqual(fmtMinutes(null), ND);
});

test("distanza dal presente: sotto il minuto", () => {
  assertEqual(fmtAgo(minutesAgo(0).toISOString(), NOW), "meno di 1 min fa");
});

test("distanza dal presente: minuti, ore, giorni", () => {
  assertEqual(fmtAgo(minutesAgo(22).toISOString(), NOW), "22 min fa");
  assertEqual(fmtAgo(minutesAgo(180).toISOString(), NOW), "3 h fa");
  assertEqual(fmtAgo(minutesAgo(60 * 50).toISOString(), NOW), "2 g fa");
});

test("distanza da un istante assente: n/d", () => {
  assertEqual(fmtAgo(null, NOW), ND);
});

test("date rese sul fuso italiano, non su UTC", () => {
  /* 20:00 UTC in agosto = 22:00 a Roma */
  assertEqual(fmtDateTime("2026-08-18T20:00:00.000Z"), "18/08, 22:00");
  assertEqual(fmtTime("2026-08-18T20:00:00.000Z"), "22:00");
  assert(fmtDay("2026-08-18T20:00:00.000Z").includes("18/08"), "giorno errato");
});

test("date assenti: n/d ovunque", () => {
  assertEqual(fmtDateTime(null), ND);
  assertEqual(fmtTime(null), ND);
  assertEqual(fmtDay(null), ND);
});

test("motivi dei buchi tradotti in italiano", () => {
  assertEqual(gapReasonLabel("bookmaker_missing"), "quote per singolo bookmaker non pubblicate");
  assertEqual(gapReasonLabel("parse_error"), "lettura della pagina fallita");
});

test("motivo sconosciuto: reso leggibile, mai nascosto", () => {
  assertEqual(gapReasonLabel("motivo_nuovo_di_zecca"), "motivo nuovo di zecca");
});

test("stati delle fonti tradotti", () => {
  assertEqual(sourceStatusLabel("ok"), "attiva");
  assertEqual(sourceStatusLabel("blocked"), "bloccata");
  assertEqual(sourceStatusLabel("stato_ignoto"), "stato_ignoto");
});

/* ================================================================== */
console.log("\nseries — statistiche di una serie realmente osservata");
/* ================================================================== */

const t0 = new Date("2026-08-18T18:35:00.000Z");
const tAt = (m: number) => new Date(t0.getTime() + m * 60_000);

/** La serie reale della partita 59, mercato 1X2, esito 2. */
const realSeries = [
  { at: t0, price: 3.61 },
  { at: tAt(2), price: 3.61 },
  { at: tAt(33), price: 3.47 },
  { at: tAt(39), price: 3.29 },
];

test("il picco di un calo è il minimo osservato", () => {
  assertEqual(peakOf([3.61, 3.61, 3.47, 3.29], "down"), 3.29);
});

test("il picco di un rialzo è il massimo osservato", () => {
  assertEqual(peakOf([2.0, 2.4, 2.2], "up"), 2.4);
});

test("serie vuota: nessun picco inventato", () => {
  assertEqual(peakOf([], "down"), null);
});

test("variazione percentuale della quota", () => {
  assertClose(dropPctOf(3.61, 3.29)!, -8.86, 0.01);
});

test("variazione non calcolabile senza apertura valida", () => {
  assertEqual(dropPctOf(0, 3.29), null);
  assertEqual(dropPctOf(null, 3.29), null);
  assertEqual(dropPctOf(3.61, null), null);
});

test("statistiche della serie reale: apertura, corrente, picco", () => {
  const s = seriesStats(realSeries);
  assertEqual(s.opening, 3.61);
  assertEqual(s.current, 3.29);
  assertEqual(s.peak, 3.29);
  assertEqual(s.pointCount, 4);
});

test("statistiche della serie reale: drop e spostamento di probabilità", () => {
  const s = seriesStats(realSeries);
  assertClose(s.dropPct!, -8.86, 0.01);
  /* 1/3.29 − 1/3.61 = 0.30395 − 0.27701 = +2.69 pp */
  assertClose(s.shiftPp!, 2.69, 0.01);
});

test("l'ampiezza della finestra è quella osservata, non stimata", () => {
  const s = seriesStats(realSeries);
  assertEqual(s.spanMinutes, 39);
  assertEqual(s.firstAt!.getTime(), t0.getTime());
});

test("serie piatta: spostamento nullo, nessun picco distinto", () => {
  const s = seriesStats([
    { at: t0, price: 2.0 },
    { at: tAt(10), price: 2.0 },
  ]);
  assertEqual(s.dropPct, 0);
  assertEqual(s.shiftPp, 0);
  assertEqual(s.peak, 2.0);
});

test("serie vuota: tutto null, niente zeri di comodo", () => {
  const s = seriesStats([]);
  assertEqual(s.opening, null);
  assertEqual(s.current, null);
  assertEqual(s.peak, null);
  assertEqual(s.dropPct, null);
  assertEqual(s.shiftPp, null);
  assertEqual(s.pointCount, 0);
  assertEqual(s.spanMinutes, null);
});

test("punto singolo: nessuna variazione calcolabile", () => {
  const s = seriesStats([{ at: t0, price: 2.5 }]);
  assertEqual(s.opening, 2.5);
  assertEqual(s.current, 2.5);
  assertEqual(s.pointCount, 1);
  assertEqual(s.spanMinutes, 0);
});

test("i punti fuori ordine vengono ordinati per istante", () => {
  const s = seriesStats([
    { at: tAt(39), price: 3.29 },
    { at: t0, price: 3.61 },
  ]);
  assertEqual(s.opening, 3.61);
  assertEqual(s.current, 3.29);
});

/* ================================================================== */
console.log("\ndescribeDepth — dichiarare la profondità, non simularla");
/* ================================================================== */

test("nessuna osservazione: profondità nulla dichiarata", () => {
  const d = describeDepth(seriesStats([]), NOW);
  assertEqual(d.shallow, true);
  assert(d.note.includes("Nessuna rilevazione"), d.note);
});

test("serie corta: dichiara da quanto osserva e quante rilevazioni ha", () => {
  const d = describeDepth(seriesStats(realSeries), NOW);
  assertEqual(d.shallow, true);
  assert(d.note.includes("4 rilevazioni"), d.note);
  assert(/1 h|85 min/.test(d.note), `manca la durata osservata: ${d.note}`);
});

test("serie corta: la nota non promette profondità che non c'è", () => {
  const d = describeDepth(seriesStats(realSeries), NOW);
  assert(
    d.note.toLowerCase().includes("non") || d.note.toLowerCase().includes("troppo"),
    `la nota deve dichiarare il limite: ${d.note}`,
  );
});

test(`serve almeno ${MIN_POINTS_FOR_TREND} punti per parlare di andamento`, () => {
  const many = Array.from({ length: MIN_POINTS_FOR_TREND }, (_, i) => ({
    at: tAt(i * 15),
    price: 3.6 - i * 0.05,
  }));
  const d = describeDepth(seriesStats(many), NOW);
  assertEqual(d.shallow, false);
});

test("un punto in meno della soglia è ancora serie corta", () => {
  const few = Array.from({ length: MIN_POINTS_FOR_TREND - 1 }, (_, i) => ({
    at: tAt(i * 15),
    price: 3.6 - i * 0.05,
  }));
  assertEqual(describeDepth(seriesStats(few), NOW).shallow, true);
});

/* ================================================================== */
console.log("\nbuildChart — geometria del grafico, calcolata in casa");
/* ================================================================== */

test("serie vuota: nessuna geometria, il grafico non si disegna", () => {
  assertEqual(buildChart([]), null);
});

test("punto singolo: un pallino, nessuna linea", () => {
  const c = buildChart([{ t: t0.getTime(), v: 2.5 }])!;
  assertEqual(c.dots.length, 1);
  assertEqual(c.path, "");
});

test("due punti: percorso con partenza e arrivo", () => {
  const c = buildChart([
    { t: t0.getTime(), v: 3.61 },
    { t: tAt(39).getTime(), v: 3.29 },
  ])!;
  assertEqual(c.dots.length, 2);
  assert(c.path.startsWith("M "), `percorso inatteso: ${c.path}`);
  assertEqual((c.path.match(/L /g) ?? []).length, 1);
});

test("quota più alta = più in alto nel grafico", () => {
  const c = buildChart([
    { t: t0.getTime(), v: 3.61 },
    { t: tAt(39).getTime(), v: 3.29 },
  ])!;
  assert(c.dots[0].y < c.dots[1].y, "la quota maggiore deve stare più in alto");
});

test("il tracciato resta dentro il riquadro", () => {
  const c = buildChart(realSeries.map((p) => ({ t: p.at.getTime(), v: p.price })))!;
  for (const d of c.dots) {
    assert(d.x >= 0 && d.x <= CHART_WIDTH, `x fuori scala: ${d.x}`);
    assert(d.y >= 0 && d.y <= CHART_HEIGHT, `y fuori scala: ${d.y}`);
  }
});

test("serie piatta: linea a metà altezza, nessuna divisione per zero", () => {
  const c = buildChart([
    { t: t0.getTime(), v: 2.0 },
    { t: tAt(10).getTime(), v: 2.0 },
  ])!;
  assertEqual(c.flat, true);
  for (const d of c.dots) {
    assert(Number.isFinite(d.y), "coordinata non finita su serie piatta");
  }
  assertClose(c.dots[0].y, c.dots[1].y, 0.0001);
});

test("istanti coincidenti: nessuna divisione per zero sull'asse del tempo", () => {
  const c = buildChart([
    { t: t0.getTime(), v: 2.0 },
    { t: t0.getTime(), v: 2.2 },
  ])!;
  for (const d of c.dots) assert(Number.isFinite(d.x), "coordinata x non finita");
});

test("minimo e massimo riportano i valori realmente osservati", () => {
  const c = buildChart(realSeries.map((p) => ({ t: p.at.getTime(), v: p.price })))!;
  assertEqual(c.min, 3.29);
  assertEqual(c.max, 3.61);
});

test("i punti sono ordinati nel tempo prima di essere disegnati", () => {
  const c = buildChart([
    { t: tAt(39).getTime(), v: 3.29 },
    { t: t0.getTime(), v: 3.61 },
  ])!;
  assert(c.dots[0].t < c.dots[1].t, "punti non ordinati");
  assertEqual(c.dots[0].v, 3.61);
});

test("valori non finiti scartati, non convertiti in zero", () => {
  const c = buildChart([
    { t: t0.getTime(), v: 3.61 },
    { t: tAt(10).getTime(), v: Number.NaN },
    { t: tAt(20).getTime(), v: 3.29 },
  ])!;
  assertEqual(c.dots.length, 2);
});

/* ------------------------------------------------------------------ */
  /* ---------------- wideDropPctOf: fascia drop ampio (T4) ---------------- */

  console.log("\n-- wideDropPctOf — fascia «drop ampio» (T4) --\n");

  test("calo percentuale della quota: 2.00 → 1.70 è 15%", () => {
    assertClose(wideDropPctOf(2.0, 1.7)!, 15, 0.01);
  });
  test("soglia esatta a 15% è drop ampio; a 14,9 non lo è", () => {
    assertEqual(wideDropPctOf(2.0, 1.7)! >= 15, true);
    assertEqual(wideDropPctOf(2.0, 1.702)! >= 15, false);
  });
  test("quota in rialzo: calo negativo, dichiarato, mai nascosto", () => {
    assertClose(wideDropPctOf(2.0, 2.2)!, -10, 0.01);
  });
  test("prezzi assenti: null, non zero", () => {
    assertEqual(wideDropPctOf(null, 1.8), null);
    assertEqual(wideDropPctOf(2.0, null), null);
  });

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Test superati: ${passed} | falliti: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFallimenti:");
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log(`${"─".repeat(60)}\n`);

if (failed > 0) process.exit(1);
