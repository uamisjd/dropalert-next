/**
 * Test degli strumenti di calcolo sul lato betting.
 * Eseguire con: npm run test:tools
 *
 * Funzioni pure: nessun database, nessuna rete, nessun browser.
 *
 * Qui si verifica soprattutto l'onestà dei numeri: che il margine sia
 * distinto dalla trattenuta, che un metodo non applicabile lo dichiari
 * invece di restituire un valore forzato, e che la simulazione sia
 * riproducibile. Un calcolatore che sbaglia in silenzio è peggio di un
 * calcolatore che non c'è.
 */
import {
  DEVIG_METHODS,
  devigAdditive,
  devigAll,
  devigPower,
  devigProportional,
  marginOf,
} from "../margin";
import {
  KELLY_NOTE,
  RUIN_THRESHOLD_PCT,
  SIM_LIMITS,
  STAKE_DISCLAIMER,
  breakEvenWinRate,
  expectedValue,
  kellyFraction,
  mulberry32,
  simulate,
} from "../stake";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean): void {
  if (cond) passed++;
  else failures.push(name);
}
function eq(name: string, a: unknown, b: unknown): void {
  check(`${name} — atteso ${String(b)}, ottenuto ${String(a)}`, Object.is(a, b));
}
function near(name: string, a: number, b: number, tol = 0.01): void {
  check(
    `${name} — atteso ~${b} (±${tol}), ottenuto ${a}`,
    Math.abs(a - b) <= tol,
  );
}

/* Mercato di riferimento: 1X2 con margine contenuto, quote realistiche. */
const MERCATO = [1.72, 4.0, 4.8];
/* Mercato sbilanciato: due favorite e una quota alta. */
const SBILANCIATO = [1.6667, 1.6667, 20];

/* ------------------------------------------------------------------ */
/* Margine e trattenuta                                                */
/* ------------------------------------------------------------------ */

const m = marginOf(MERCATO);
check("mercato valido: margine calcolato", m.ok);
if (m.ok) {
  /* 1/1.72 + 1/4 + 1/4.8 = 103,97% */
  near("overround", m.data.overroundPct, 103.97);
  near("margine in punti", m.data.marginPct, 3.97);
  /* la trattenuta NON è il margine: è margine/overround */
  near("trattenuta teorica", m.data.holdPct, 3.82);
  eq("tre selezioni", m.data.outcomes, 3);
  eq(
    "probabilità implicite: una per selezione",
    m.data.impliedPct.length,
    3,
  );
  near("implicita della favorita", m.data.impliedPct[0] ?? 0, 58.14);
  /* identità che definisce la trattenuta: 1 − 1/overround */
  near(
    "la trattenuta è ciò che resta coprendo ogni esito",
    m.data.holdPct / 100,
    1 - 100 / m.data.overroundPct,
    0.001,
  );
}

const dueVie = marginOf([1.9, 1.9]);
check("mercato a due vie valido", dueVie.ok);
if (dueVie.ok) near("margine del 1.90/1.90", dueVie.data.marginPct, 5.26);

const unaSola = marginOf([1.9]);
check("una sola quota: rifiutata", !unaSola.ok);
if (!unaSola.ok) {
  check(
    "una sola quota: il motivo parla di mercato, non di numero",
    unaSola.failure.reason.includes("mercato"),
  );
}

const vuota = marginOf([]);
check("nessuna quota: rifiutata", !vuota.ok);

const invalida = marginOf([1.9, null, 4.8]);
check("quota mancante: rifiutata", !invalida.ok);
if (!invalida.ok) {
  eq("posizione della quota mancante", invalida.failure.invalidIndexes[0], 1);
}

const assurda = marginOf([1.9, 0.5]);
check("quota sotto 1,01: rifiutata", !assurda.ok);

/* ------------------------------------------------------------------ */
/* Rimozione del margine                                               */
/* ------------------------------------------------------------------ */

eq("tre metodi dichiarati", DEVIG_METHODS.length, 3);
check(
  "ogni metodo ha una nota: nessuno è presentato senza spiegazione",
  DEVIG_METHODS.every((d) => d.note.length > 20),
);

function somma(probs: number[]): number {
  return probs.reduce((a, b) => a + b, 0);
}

const prop = devigProportional(MERCATO);
check("proporzionale: calcolato", prop.ok);
if (prop.ok) {
  near("proporzionale: le probabilità sommano a 100", somma(prop.data.fairPct), 100, 0.05);
  eq("proporzionale: metodo dichiarato", prop.data.method, "proportional");
  near("proporzionale: favorita al 55,9%", prop.data.fairPct[0] ?? 0, 55.92);
  check(
    "proporzionale: la quota fair è sopra quella pubblicata",
    (prop.data.fairPrice[0] ?? 0) > MERCATO[0],
  );
}

const add = devigAdditive(MERCATO);
check("additivo: calcolato su mercato regolare", add.ok);
if (add.ok) {
  near("additivo: somma a 100", somma(add.data.fairPct), 100, 0.05);
  /* sottrarre la stessa quantità assoluta pesa di più sulle quote alte:
     l'additivo toglie proporzionalmente di più alla sfavorita */
  check(
    "additivo: la sfavorita vale meno che col proporzionale",
    (add.data.fairPct[2] ?? 0) < (prop.ok ? (prop.data.fairPct[2] ?? 0) : 0),
  );
  check(
    "additivo: la favorita vale più che col proporzionale",
    (add.data.fairPct[0] ?? 0) > (prop.ok ? (prop.data.fairPct[0] ?? 0) : 0),
  );
}

const addSbil = devigAdditive(SBILANCIATO);
check(
  "additivo su mercato molto sbilanciato: rifiutato, non forzato",
  !addSbil.ok,
);
if (!addSbil.ok) {
  eq("additivo: il metodo che fallisce è dichiarato", addSbil.failure.method, "additive");
  check(
    "additivo: il motivo dice che non viene forzato a zero",
    addSbil.failure.reason.includes("non viene forzato"),
  );
}

const pow = devigPower(MERCATO);
check("power: calcolato", pow.ok);
if (pow.ok) {
  near("power: somma a 100", somma(pow.data.fairPct), 100, 0.05);
  eq("power: metodo dichiarato", pow.data.method, "power");
  /* il power dà più peso alla favorita: è la differenza documentata */
  check(
    "power: la favorita vale più che col proporzionale",
    (pow.data.fairPct[0] ?? 0) > (prop.ok ? (prop.data.fairPct[0] ?? 0) : 0),
  );
  check(
    "power: la sfavorita vale meno che col proporzionale",
    (pow.data.fairPct[2] ?? 0) < (prop.ok ? (prop.data.fairPct[2] ?? 0) : 0),
  );
}

const powSenzaMargine = devigPower([2.0, 2.0]);
check("power senza margine: rifiutato", !powSenzaMargine.ok);
if (!powSenzaMargine.ok) {
  check(
    "power senza margine: il motivo parla di margine assente",
    powSenzaMargine.failure.reason.includes("margine"),
  );
}

const tutti = devigAll(MERCATO);
eq("devigAll: tre tentativi", tutti.results.length, 3);
eq("devigAll: nessun fallimento su mercato regolare", tutti.failures.length, 0);
check("devigAll: lo scostamento fra metodi è misurato", tutti.spreadPct !== null);
check(
  "devigAll: lo scostamento è piccolo ma non nullo",
  (tutti.spreadPct ?? 0) > 0 && (tutti.spreadPct ?? 0) < 3,
);

const tuttiSbil = devigAll(SBILANCIATO);
eq("devigAll su sbilanciato: un metodo fallisce", tuttiSbil.failures.length, 1);
eq(
  "devigAll su sbilanciato: il fallimento è nominato",
  tuttiSbil.failures[0]?.method,
  "additive",
);
check(
  "devigAll su sbilanciato: gli altri due restano disponibili",
  tuttiSbil.results.filter((r) => r.ok).length === 2,
);

/* ------------------------------------------------------------------ */
/* Pareggio, rendimento atteso, Kelly                                  */
/* ------------------------------------------------------------------ */

eq("pareggio a quota 2.00", breakEvenWinRate(2.0), 50);
eq("pareggio a quota 1.90", breakEvenWinRate(1.9), 52.63);
eq("pareggio con quota nulla", breakEvenWinRate(null), null);
eq("pareggio con quota assurda", breakEvenWinRate(1.001), null);

eq("rendimento nullo al punto di pareggio", expectedValue(50, 2.0), 0);
near("rendimento negativo sotto il pareggio", expectedValue(45, 2.0) ?? 0, -0.1);
near("rendimento positivo sopra il pareggio", expectedValue(55, 2.0) ?? 0, 0.1);
eq("rendimento con probabilità assurda", expectedValue(150, 2.0), null);
eq("rendimento con probabilità mancante", expectedValue(null, 2.0), null);

/* Con la probabilità IMPLICITA della stessa quota il rendimento è zero per
   costruzione: è la definizione di probabilità implicita, non un vantaggio.
   Il costo del prezzo compare solo rispetto alla probabilità fair, cioè al
   netto del margine: giocare al prezzo pubblicato con la probabilità fair
   costa esattamente la trattenuta del banco. */
eq(
  "con la probabilità implicita della quota il rendimento è zero per definizione",
  expectedValue(100 / MERCATO[0], MERCATO[0]),
  0,
);
if (prop.ok && m.ok) {
  near(
    "alla quota del banco, con la probabilità fair, si perde la trattenuta",
    expectedValue(prop.data.fairPct[0] ?? 0, MERCATO[0]) ?? 0,
    -m.data.holdPct / 100,
    0.001,
  );
}

const kelly = kellyFraction(60, 2.0);
check("kelly con vantaggio: calcolato", kelly !== null);
eq("kelly 60% a quota 2.00 = 20%", kelly?.fractionPct, 20);
check("kelly 60% a quota 2.00: vantaggio presente", kelly?.hasEdge === true);

const noEdge = kellyFraction(40, 2.0);
eq("kelly senza vantaggio: frazione 0", noEdge?.fractionPct, 0);
check("kelly senza vantaggio: dichiarato", noEdge?.hasEdge === false);
eq("kelly con quota non valida", kellyFraction(60, null), null);

check("il testo del limite nega la garanzia", STAKE_DISCLAIMER.includes("vincite"));
check("l'avviso su Kelly esiste", KELLY_NOTE.includes("raccomandazione"));
eq("soglia di rovina dichiarata", RUIN_THRESHOLD_PCT, 20);

/* ------------------------------------------------------------------ */
/* Simulazione                                                         */
/* ------------------------------------------------------------------ */

const rnd = mulberry32(42);
const primi = [rnd(), rnd(), rnd()];
const rnd2 = mulberry32(42);
eq("stesso seme, stessa sequenza", rnd2(), primi[0]);
check("valori nel rango 0–1", primi.every((v) => v >= 0 && v < 1));
check("la sequenza non è costante", new Set(primi).size === 3);

const base = {
  bankroll: 1000,
  price: 1.9,
  winPct: 50,
  bets: 200,
  stakePct: 5,
  trials: 500,
  seed: 7,
};

const s1 = simulate(base);
check("simulazione eseguita", s1 !== null);
if (s1 !== null) {
  eq("quante sequenze", s1.trials, 500);
  eq("quante giocate", s1.bets, 200);
  /* 50% a quota 1.90 è un rendimento atteso del −5% per giocata */
  near("rendimento atteso per giocata", s1.evPerBetPct, -5);
  check(
    "con rendimento negativo la maggioranza delle sequenze chiude in perdita",
    s1.lossSharePct > 80,
  );
  check(
    "con rendimento negativo una quota rilevante si rovina",
    s1.ruinSharePct > 10,
  );
  check("il 5° percentile sta sotto la mediana", s1.finalP5 <= s1.finalMedian);
  check("il 95° percentile sta sopra la mediana", s1.finalP95 >= s1.finalMedian);
  check("il peggiore sta sotto il migliore", s1.worstPct <= s1.bestPct);
  check(
    "la varianza domina: la forbice 5–95 è ampia",
    s1.finalP95 - s1.finalP5 > 200,
  );
}

/* riproducibilità: stesso seme, stessi numeri */
const s2 = simulate(base);
eq(
  "stessa configurazione, stesso risultato (seme fisso)",
  JSON.stringify(s1),
  JSON.stringify(s2),
);

const s3 = simulate({ ...base, seed: 8 });
check(
  "seme diverso, risultato diverso",
  JSON.stringify(s1) !== JSON.stringify(s3),
);

/* un vantaggio reale ma piccolo: la distribuzione resta larga */
const conVantaggio = simulate({ ...base, price: 2.1, winPct: 50, seed: 11 });
if (conVantaggio !== null) {
  near("vantaggio del 5% per giocata", conVantaggio.evPerBetPct, 5);
  check(
    "anche con vantaggio il 5° percentile resta in forte perdita",
    conVantaggio.finalP5 < 1000,
  );
  check(
    "anche con vantaggio una parte delle sequenze chiude in perdita",
    conVantaggio.lossSharePct > 5,
  );
}

/* puntate enormi: la rovina diventa la norma, e va detto */
const aggressivo = simulate({ ...base, stakePct: 50, bets: 100, seed: 3 });
if (aggressivo !== null && s1 !== null) {
  check(
    "puntare metà del capitale a ogni giro rovina molto più spesso",
    aggressivo.ruinSharePct > s1.ruinSharePct,
  );
}

/* input non validi: nessun numero inventato */
eq("simulazione con quota non valida", simulate({ ...base, price: 1.001 }), null);
eq("simulazione con capitale zero", simulate({ ...base, bankroll: 0 }), null);
eq("simulazione con probabilità assurda", simulate({ ...base, winPct: 130 }), null);
eq("simulazione con zero giocate", simulate({ ...base, bets: 0 }), null);
eq(
  "simulazione oltre il tetto di giocate",
  simulate({ ...base, bets: SIM_LIMITS.maxBets + 1 }),
  null,
);
eq(
  "simulazione oltre il tetto di sequenze",
  simulate({ ...base, trials: SIM_LIMITS.maxTrials + 1 }),
  null,
);
eq("simulazione con puntata nulla", simulate({ ...base, stakePct: 0 }), null);
eq(
  "simulazione con puntata sopra il capitale",
  simulate({ ...base, stakePct: SIM_LIMITS.maxStakePct + 1 }),
  null,
);

/* ------------------------------------------------------------------ */

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (strumenti di calcolo)`);
