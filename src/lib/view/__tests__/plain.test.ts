/**
 * Test della lingua piana e del raggruppamento per partita (Sprint UX-2).
 * Runner minimale, funzioni pure, nessun database e nessuna rete.
 * Eseguire con: npm run test:plain
 */
import type { DashboardSignal } from "@/lib/repo/dashboard";
import {
  PLAIN_STRENGTH_LABELS,
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

const f4 = plainSentence(sig({ openingPrice: 2.0, currentPrice: 2.5, selection: "away" }), now);
check("frase: quota salita", f4.includes("è salita da 2,00 a 2,50"));
check("frase: allontanamento", f4.includes("si sta allontanando da Beta"));

/* --- una card per partita --- */
const groups = groupByMatch([
  sig({ id: 1, matchId: 7, level: "reale", confidenceScore: 50 }),
  sig({ id: 2, matchId: 7, level: "forte", confidenceScore: 60 }),
  sig({ id: 3, matchId: 8, level: "debole", confidenceScore: 90 }),
  sig({ id: 4, matchId: 7, level: "debole", confidenceScore: 10 }),
]);
eq("due partite, due card", groups.length, 2);
eq("in vista il segnale più forte", groups[0].primary.id, 2);
eq("gli altri restano disponibili", groups[0].others.length, 2);
eq("ordine di arrivo conservato", groups[1].matchId, 8);
eq("partita con un solo segnale non espande", groups[1].others.length, 0);
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

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (lingua piana UX-2)`);
