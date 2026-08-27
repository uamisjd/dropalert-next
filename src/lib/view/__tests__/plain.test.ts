/**
 * Test della lingua piana e del raggruppamento per partita (Sprint UX-2).
 * Runner minimale, funzioni pure, nessun database e nessuna rete.
 * Eseguire con: npm run test:plain
 */
import type { DashboardSignal } from "@/lib/repo/dashboard";
import { buildSparkline, MIN_POINTS_FOR_SPARKLINE } from "../sparkline";
import {
  NORMALIZED_BAND_NOTE,
  downsample,
  normalizedBandOf,
  normalizedOf,
} from "@/lib/repo/dashboard";
import {
  PLAIN_STRENGTH_LABELS,
  contextSnippet,
  matchIdentityKey,
  subjectOf,
  groupByMatch,
  movementHours,
  othersLabel,
  plainSentence,
  plainStrengthOf,
  sourcesLabel,
} from "../plain";

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

const now = new Date("2026-08-25T18:00:00Z");

function sig(over: Partial<DashboardSignal> = {}): DashboardSignal {
  return {
    id: 1,
    matchId: 100,
    status: "active",
    homeTeam: "Alfa",
    awayTeam: "Beta",
    league: "Serie X",
    country: "IT",
    kickoffAt: "2026-08-25T19:00:00.000Z",
    market: "1x2",
    marketLabel: "Esito finale",
    selection: "home",
    selectionLabel: "Vittoria casa",
    openingPrice: 2.5,
    peakPrice: 2.0,
    currentPrice: 2.0,
    dropPct: -20,
    shiftPp: 10,
    magnitudeClass: "large",
    magnitudeLabel: "ampio",
    confidenceScore: 80,
    confidenceBand: "high",
    confidenceLabel: "alta",
    level: "forte",
    levelLabel: "Segnale forte",
    booksConfirming: 4,
    booksTotal: 6,
    sharpConfirms: true,
    sharpAvailable: true,
    sustainedMinutes: 180,
    isFlash: false,
    rebounded: false,
    freshness: "live",
    freshnessLabel: "Dati aggiornati",
    freshnessReason: "",
    lastSnapshotAt: now.toISOString(),
    ageMinutes: 5,
    openGaps: 0,
    summary: "",
    updatedAt: now.toISOString(),
    algorithmVersion: "suspicion-v2",
    suspicion: null,
    wideDropPct: 20,
    wideDrop: true,
    contextCompact: null,
    newsCount: null,
    newsEmpty: false,
    sparkline: [],
    normalizedScore: null,
    measurableMax: null,
    gapMax: null,
    normalizedBand: null,
    normalizedLabel: null,
    ...over,
  } as DashboardSignal;
}

/* --- etichette piane --- */
eq("rumore", plainStrengthOf({ magnitudeClass: "noise", level: "debole", sustainedMinutes: 200, isFlash: false }), "rumore");
eq("senza livello è rumore", plainStrengthOf({ magnitudeClass: "large", level: "nessuno", sustainedMinutes: 200, isFlash: false }), "rumore");
eq("ampio e sostenuto", plainStrengthOf({ magnitudeClass: "large", level: "forte", sustainedMinutes: 120, isFlash: false }), "ampio");
eq("flash non è mai ampio", plainStrengthOf({ magnitudeClass: "large", level: "forte", sustainedMinutes: 120, isFlash: true }), "in-movimento");
eq("in movimento", plainStrengthOf({ magnitudeClass: "medium", level: "reale", sustainedMinutes: 40, isFlash: false }), "in-movimento");
eq("tre etichette dichiarate", Object.keys(PLAIN_STRENGTH_LABELS).length, 3);
eq("testo rumore", PLAIN_STRENGTH_LABELS.rumore, "Movimento piccolo, probabilmente rumore");

/* --- durata --- */
eq("180 minuti = 3 ore", movementHours(180), 3);
eq("durata assente resta assente", movementHours(0), null);

/* --- frase piana --- */
const f1 = plainSentence(sig({ newsEmpty: true }), now);
check("frase: soggetto con nome squadra", f1.startsWith("La quota della vittoria di Alfa"));
check("frase: nessun codice esito", !/quota di (1|x|2)\b/i.test(f1));
check("frase: quota scesa", f1.includes("è scesa da 2,50 a 2,00"));
check("frase: durata in ore", f1.includes("in 3 ore"));
check("frase: verso la squadra", f1.includes("verso Alfa"));
check("frase: nessuna notizia", f1.includes("Nessuna notizia pubblica trovata."));
check("frase: bookmaker", f1.includes("Movimento su 4 bookmaker su 6."));
check("frase: nessun pronostico", !/vincer|probabil/i.test(f1));

const f2 = plainSentence(sig({ booksTotal: 1, booksConfirming: 1, newsCount: 3, newsEmpty: false }), now);
check("frase: un solo bookmaker", f2.includes("Movimento su un solo bookmaker."));
check("frase: notizie contate", f2.includes("Notizie: 3"));

const f3 = plainSentence(sig({ openingPrice: null, currentPrice: null }), now);
check("frase: senza prezzi non inventa", f3.includes("non è raccontabile in numeri"));

const fx = plainSentence(sig({ selection: "draw", selectionLabel: "Pareggio" }), now);
check("frase: pareggio senza nome squadra", fx.startsWith("La quota del pareggio"));
check("frase: verso il pareggio", fx.includes("verso il pareggio"));
const fxUp = plainSentence(
  sig({ selection: "draw", selectionLabel: "Pareggio", openingPrice: 2, currentPrice: 3 }),
  now,
);
check("frase: elisione dal pareggio", fxUp.includes("allontanando dal pareggio"));
check("frase: mai «da il»", !fxUp.includes("da il "));

eq("soggetto trasferta", subjectOf(sig({ selection: "away" })), "La quota della vittoria di Beta");

/* --- snippet di contesto --- */
eq("snippet corto resta intero", contextSnippet("Coppa nazionale, turno unico."), "Coppa nazionale, turno unico.");
eq("snippet assente resta assente", contextSnippet(null), null);
eq("snippet vuoto è assente", contextSnippet("   "), null);
const longOne = "a".repeat(200);
const cutHard = contextSnippet(longOne, 20);
eq("taglio duro con ellissi", cutHard, `${"a".repeat(20)}…`);
const twoSentences = "Prima frase breve. " + "parola ".repeat(40);
eq("prima frase completa se entra", contextSnippet(twoSentences), "Prima frase breve.");
const wordy = contextSnippet("alfa beta gamma delta epsilon zeta eta theta iota", 20)!;
check("nessuna parola mozzata", wordy.endsWith("…") && !wordy.includes("  "));
check("taglio entro il budget", wordy.length <= 21);

/* --- mini-grafico --- */
eq("meno di due punti: niente grafico", buildSparkline([{ t: 1, v: 2 }]), null);
eq("soglia dichiarata", MIN_POINTS_FOR_SPARKLINE, 2);
const geo = buildSparkline([
  { t: 1000, v: 3 },
  { t: 2000, v: 2 },
  { t: 3000, v: 2.4 },
])!;
check("geometria prodotta", geo !== null);
eq("tutti i punti disegnati", geo.dots.length, 3);
eq("serie in discesa", geo.falling, true);
eq("picco = minimo nella direzione", geo.peak.v, 2);
eq("ultimo punto conservato", geo.last.v, 2.4);
check("percorso non vuoto", geo.path.startsWith("M"));
check("nessun NaN nelle coordinate", geo.dots.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y)));
const flat = buildSparkline([
  { t: 1, v: 2 },
  { t: 2, v: 2 },
])!;
eq("serie ferma dichiarata piatta", flat.flat, true);
check("piatta senza NaN", flat.dots.every((d) => Number.isFinite(d.y)));
const sameInstant = buildSparkline([
  { t: 5, v: 2 },
  { t: 5, v: 3 },
])!;
check("istanti uguali distribuiti", sameInstant.dots[0].x !== sameInstant.dots[1].x);
eq("prezzi non validi scartati", buildSparkline([{ t: 1, v: 0 }, { t: 2, v: -1 }, { t: 3, v: 2 }]), null);

/* --- campionamento --- */
const many = Array.from({ length: 500 }, (_, i) => i);
const ds = downsample(many, 60);
eq("campionamento al tetto", ds.length, 60);
eq("primo punto conservato", ds[0], 0);
eq("ultimo punto conservato", ds[ds.length - 1], 499);
eq("serie corta intatta", downsample([1, 2, 3], 60).length, 3);

const f4 = plainSentence(sig({ openingPrice: 2.0, currentPrice: 2.5, selection: "away" }), now);
check("frase: quota salita", f4.includes("è salita da 2,00 a 2,50"));
check("frase: allontanamento", f4.includes("si sta allontanando da Beta"));

/* --- una card per partita --- */
const groups = groupByMatch([
  sig({ id: 1, matchId: 7, level: "reale", confidenceScore: 50 }),
  sig({ id: 2, matchId: 7, level: "forte", confidenceScore: 60 }),
  sig({ id: 3, matchId: 8, homeTeam: "Gamma", awayTeam: "Delta", level: "debole", confidenceScore: 90 }),
  sig({ id: 4, matchId: 7, level: "debole", confidenceScore: 10 }),
]);
eq("due partite, due card", groups.length, 2);
eq("in vista il segnale più forte", groups[0].primary.id, 2);
eq("gli altri restano disponibili", groups[0].others.length, 2);
eq("ordine di arrivo conservato", groups[1].matchId, 8);
eq("partita con un solo segnale non espande", groups[1].others.length, 0);
/* --- A2: una card per coppia di squadre, anche con matchId diversi --- */
const kick = "2026-08-25T19:00:00.000Z";
eq(
  "stessa sfida, stessa chiave malgrado FC e ordine",
  matchIdentityKey({ homeTeam: "Bromley U21", awayTeam: "West Brom U21", kickoffAt: kick }),
  matchIdentityKey({ homeTeam: "West Brom U21 FC", awayTeam: "Bromley U21", kickoffAt: kick }),
);
check(
  "partite diverse restano distinte",
  matchIdentityKey({ homeTeam: "Bromley U21", awayTeam: "West Brom U21", kickoffAt: kick }) !==
    matchIdentityKey({ homeTeam: "Bromley U21", awayTeam: "Fulham U21", kickoffAt: kick }),
);
check(
  "stessa coppia in giorni diversi resta distinta",
  matchIdentityKey({ homeTeam: "Bromley U21", awayTeam: "West Brom U21", kickoffAt: kick }) !==
    matchIdentityKey({ homeTeam: "Bromley U21", awayTeam: "West Brom U21", kickoffAt: "2026-09-01T19:00:00.000Z" }),
);
const dupe = groupByMatch([
  sig({ id: 10, matchId: 101, homeTeam: "Bromley U21", awayTeam: "West Brom U21", kickoffAt: kick, level: "reale", confidenceScore: 40 }),
  sig({ id: 11, matchId: 202, homeTeam: "Bromley U21", awayTeam: "West Brom U21", kickoffAt: kick, level: "forte", confidenceScore: 70 }),
  sig({ id: 12, matchId: 303, homeTeam: "Alfa", awayTeam: "Beta", kickoffAt: kick, level: "forte", confidenceScore: 90 }),
]);
eq("il duplicato Bromley non si riproduce", dupe.length, 2);
eq("in vista il segnale più forte del duplicato", dupe[0].primary.id, 11);
eq("il link punta al match mostrato", dupe[0].matchId, 202);
eq("l'altro segnale resta espandibile", dupe[0].others.length, 1);

eq("accordo singolare", othersLabel(1), "altro 1 segnale su questa partita");
eq("accordo plurale", othersLabel(3), "altri 3 segnali su questa partita");

/* --- etichetta fonti --- */
const lab = sourcesLabel(
  [{ status: "degraded", lastSuccessAt: new Date(now.getTime() - 12 * 60000).toISOString() }],
  now,
);
eq("fonte degradata spiegata", lab, "Fonti: 0 ok · 1 degradata (ultimo successo 12 min fa)");
check("mai un rapporto nudo", !lab.includes("0/1"));
eq(
  "nessun successo dichiarato",
  sourcesLabel([{ status: "blocked", lastSuccessAt: null }], now),
  "Fonti: 0 ok · 1 bloccata (nessun successo a registro)",
);
eq(
  "plurale delle degradate",
  sourcesLabel(
    [
      { status: "ok", lastSuccessAt: now.toISOString() },
      { status: "degraded", lastSuccessAt: null },
      { status: "degraded", lastSuccessAt: null },
    ],
    now,
  ),
  "Fonti: 1 ok · 2 degradate (ultimo successo meno di 1 min fa)",
);
eq("nessuna fonte", sourcesLabel([], now), "Fonti: nessuna registrata");



/* --- F: indice normalizzato sulla base misurabile --- */
const ctxOk = { booksTotal: 6, sharpAvailable: true, sharpConfirms: true, pointCount: 10 };
const ctxGap = { booksTotal: 1, sharpAvailable: false, sharpConfirms: null, pointCount: 10 };
const comps = [
  { key: "magnitude" as const, label: "Ampiezza", points: 20, maxPoints: 30, detail: "" },
  { key: "coordination" as const, label: "Coordinazione", points: 0, maxPoints: 25, detail: "" },
  { key: "sharp" as const, label: "Sharp", points: 0, maxPoints: 20, detail: "" },
  { key: "persistence" as const, label: "Persistenza", points: 15.5, maxPoints: 25, detail: "" },
];
const norm = normalizedOf(comps, 35.5, ctxGap);
eq("base misurabile esclude i GAP", norm.measurableMax, 55);
eq("punti non osservabili dichiarati", norm.gapMax, 45);
eq("35,5 su 55 diventa 65 su 100", norm.normalizedScore, 65);

const pieno = normalizedOf(comps, 35.5, ctxOk);
eq("senza GAP la base resta 100", pieno.measurableMax, 100);
eq("senza GAP il numero non cambia", pieno.normalizedScore, 36);
eq("senza GAP nulla è non osservabile", pieno.gapMax, 0);

const vuoto = normalizedOf([], 35.5, ctxOk);
eq("senza scomposizione non si normalizza", vuoto.normalizedScore, null);
eq("senza scomposizione nessuna base inventata", vuoto.measurableMax, null);

const tuttoGap = normalizedOf(
  [
    { key: "coordination" as const, label: "C", points: 0, maxPoints: 50, detail: "" },
    { key: "sharp" as const, label: "S", points: 0, maxPoints: 50, detail: "" },
  ],
  0,
  ctxGap,
);
eq("base misurabile nulla: nessun numero", tuttoGap.normalizedScore, null);
eq("ma i punti non osservabili si dichiarano", tuttoGap.gapMax, 100);
check("normalizzato mai oltre 100", (normalizedOf(comps, 90, ctxGap).normalizedScore ?? 0) <= 100);

/* --- FIX-1/2: la banda si legge sulla scala normalizzata --- */
eq("89% è banda alta", normalizedBandOf(89), "high");
eq("soglia alta esatta", normalizedBandOf(78), "high");
eq("appena sotto è media", normalizedBandOf(77), "medium");
eq("soglia media esatta", normalizedBandOf(60), "medium");
eq("sotto la media è bassa", normalizedBandOf(59), "low");
eq("senza indice nessuna banda", normalizedBandOf(null), null);
check("le soglie sono dichiarate", NORMALIZED_BAND_NOTE.includes("78") && NORMALIZED_BAND_NOTE.includes("60"));

/* il caso dell'audit: 48,76 su 55 misurabili non può essere «bassa» */
const caso = normalizedOf(comps, 48.76, ctxGap);
eq("48,76 su 55 vale 89", caso.normalizedScore, 89);
eq("e la fascia diventa alta", caso.normalizedBand, "high");
eq("etichetta coerente con l'hero", caso.normalizedLabel, "Alta");
check(
  "la banda del motore sul grezzo resta un'altra cosa",
  caso.normalizedBand !== null && 48.76 < 60,
);


if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (lingua piana e mini-grafico UX-2/UX-3)`);
