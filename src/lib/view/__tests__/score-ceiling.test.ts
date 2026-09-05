/**
 * Test del tetto strutturale dell'indice.
 * Runner minimale, nessuna dipendenza esterna e nessun database.
 * Eseguire con: npm run test:score-ceiling
 *
 * Il numero di riferimento non è scelto: è quello che restituisce
 * `analyzeDrop` chiamato con la configurazione reale di produzione (un solo
 * bookmaker di consenso, non sharp) e il miglior caso possibile — drop da 2,00
 * a 1,60 sostenuto otto ore. Il test lo verifica contro il motore vero, così
 * una modifica ai pesi che sposta il tetto fa fallire qui invece di spostare
 * in silenzio il significato della tabella CLV.
 */
import {
  bandReachability,
  describeCeiling,
  scoreCeiling,
} from "../score-ceiling";
import { analyzeDrop } from "@/lib/drop/engine";
import { SCORE_BUCKETS } from "@/lib/drop/novig";
import type { DropAnalysisInput } from "@/lib/drop/types";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(
    `${name} — atteso ${String(expected)}, ottenuto ${String(actual)}`,
    Object.is(actual, expected),
  );
}

function near(name: string, actual: number, expected: number, tol = 0.005) {
  check(
    `${name} — atteso ≈${expected}, ottenuto ${actual}`,
    Math.abs(actual - expected) <= tol,
  );
}

/* --- il caso reale: una sola linea di consenso, non sharp --- */
const single = scoreCeiling({
  booksObserved: 1,
  booksExpected: 4,
  sharpAvailable: false,
  hasOpeningLine: true,
});

eq("fonte singola rilevata", single.singleSource, true);
near("copertura massima = 0,45·¼ + 0,30 + 0 + 0,10", single.maxCoverageScore, 0.51);
near("tetto grezzo = 30 + 0 + 0 + 15 + 5,13", single.maxRaw, 50.13);
near("tetto con moltiplicatore 0,75", single.maxWithSuspicion, 37.6);
near("punti non misurabili = 25 + 20", single.unreachablePoints, 45);

/* --- il tetto dichiarato coincide con ciò che il motore produce davvero --- */
const now = new Date("2026-09-05T18:00:00Z");
const t = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000);
const input: DropAnalysisInput = {
  matchId: 1,
  market: "1x2",
  selection: "away",
  kickoffAt: new Date(now.getTime() + 6 * 3600_000),
  now,
  series: [
    {
      bookmakerId: 1,
      bookmakerKey: "betexplorer-consensus",
      bookmakerName: "BetExplorer (consenso)",
      isSharp: false,
      weight: 1,
      points: [
        { at: t(480), price: 2.0 },
        { at: t(470), price: 1.95 },
        { at: t(460), price: 1.85 },
        { at: t(450), price: 1.75 },
        { at: t(440), price: 1.68 },
        { at: t(430), price: 1.62 },
        { at: t(420), price: 1.6 },
        { at: t(10), price: 1.6 },
      ],
    },
  ],
};
const best = analyzeDrop(input, "v1");
near(
  "il motore, nel miglior caso possibile, si ferma al tetto dichiarato",
  best.confidenceScore,
  single.maxRaw,
);
eq("e la banda grezza resta «low»", best.confidenceBand, "low");

/* v2 sulla trasferta a quota 2,00: nessuna delle due classi di iper-reazione
   scatta (non è casa, e l'apertura non supera 3,0), quindi il moltiplicatore
   non si applica e il punteggio resta identico a v1. Non è un difetto: è la
   regola dichiarata in `suspicionReasonsOf`. */
const bestV2Away = analyzeDrop(input, "suspicion-v2");
near(
  "v2 senza classe di iper-reazione non riduce il punteggio",
  bestV2Away.confidenceScore,
  single.maxRaw,
);

/* v2 sulla casa: scatta `drop_casa`, il moltiplicatore 0,75 si applica */
const bestV2Home = analyzeDrop({ ...input, selection: "home" }, "suspicion-v2");
near(
  "v2 sulla casa si ferma al tetto ridotto dal moltiplicatore",
  bestV2Home.confidenceScore,
  single.maxWithSuspicion,
);
check(
  "il moltiplicatore applicato è dichiarato nella spiegazione",
  bestV2Home.explanation.suspicion?.multiplier === 0.75,
);

/* --- le fasce della tabella CLV --- */
const bands = bandReachability(SCORE_BUCKETS, single.maxRaw);
eq("le fasce sono quattro", bands.length, 4);
eq("0–24 raggiungibile", bands[0].reachable, true);
eq("25–49 raggiungibile", bands[1].reachable, true);
eq("50–74 sopra il tetto di 50,13? no: 50 < 50,13", bands[2].reachable, true);
eq("50–74 non è interamente vuota", bands[2].empty, false);
eq("75–100 strutturalmente vuota", bands[3].empty, true);
eq("75–100 non raggiungibile", bands[3].reachable, false);

/* con il moltiplicatore applicato anche la terza fascia si svuota */
const bandsV2 = bandReachability(SCORE_BUCKETS, single.maxWithSuspicion);
eq("con 0,75 la fascia 50–74 è vuota", bandsV2[2].empty, true);
eq("con 0,75 la fascia 25–49 resta raggiungibile", bandsV2[1].reachable, true);

/* --- una configurazione con più fonti alza il tetto --- */
const multi = scoreCeiling({
  booksObserved: 4,
  booksExpected: 4,
  sharpAvailable: true,
  hasOpeningLine: true,
});
eq("quattro book con sharp: non è fonte singola", multi.singleSource, false);
eq("nessun punto non misurabile", multi.unreachablePoints, 0);
near("copertura piena", multi.maxCoverageScore, 1);
near("tetto pieno = 100", multi.maxRaw, 100);

const bandsMulti = bandReachability(SCORE_BUCKETS, multi.maxRaw);
check(
  "con la copertura completa tutte le fasce sono raggiungibili",
  bandsMulti.every((b) => b.reachable),
);

/* --- il testo pubblicato --- */
const detto = describeCeiling(single);
check("dichiara la fonte singola", /una sola linea di consenso/i.test(detto));
check("dichiara i punti non misurabili", detto.includes("45"));
check("dichiara il tetto", detto.includes("50,13") || detto.includes("50.13"));
check("dice che le fasce alte sono irraggiungibili", /irraggiungibili/i.test(detto));

const dettoMulti = describeCeiling(multi);
check("con più fonti non parla di fonte singola", !/una sola linea/i.test(dettoMulti));

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (tetto strutturale dell'indice)`);
