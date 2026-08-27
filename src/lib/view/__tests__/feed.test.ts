/**
 * Test dei feed pubblici e del grafico CLV (Sprint ENH-1, punti 3 e 4).
 * Funzioni pure: nessuna rete, nessun database.
 * Eseguire con: npm run test:feed
 */
import {
  FEED_DISCLAIMER,
  FEED_MAX_ITEMS,
  feedSummary,
  feedTitle,
  xmlEscape,
} from "@/lib/repo/feed";
import {
  CLV_CHART_HEIGHT,
  buildClvChart,
  shortDay,
} from "../clv-chart";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}
function eq(name: string, a: unknown, b: unknown) {
  check(`${name} — atteso ${String(b)}, ottenuto ${String(a)}`, Object.is(a, b));
}

/* --- titoli del feed --- */
const base = {
  homeTeam: "Alfa",
  awayTeam: "Beta",
  league: "Serie X",
  currentPrice: 2.17,
  dropPct: -12.4,
  sustainedMinutes: 180,
};
eq(
  "titolo completo",
  feedTitle(base),
  "Alfa – Beta (Serie X): quota 2.17 −12% in 3h",
);
eq(
  "senza competizione",
  feedTitle({ ...base, league: null }),
  "Alfa – Beta: quota 2.17 −12% in 3h",
);
eq(
  "senza prezzi resta la partita",
  feedTitle({ ...base, currentPrice: null, dropPct: null }),
  "Alfa – Beta (Serie X)",
);
check(
  "quota in salita col segno giusto",
  feedTitle({ ...base, dropPct: 8 }).includes("+8%"),
);
check(
  "senza persistenza niente ore inventate",
  !feedTitle({ ...base, sustainedMinutes: 0 }).includes("in 0h"),
);

/* --- riepilogo --- */
const riepilogo = feedSummary({
  selectionLabel: "Vittoria casa",
  marketLabel: "Esito finale",
  openingPrice: 2.5,
  currentPrice: 2.17,
  levelLabel: "Segnale forte",
  booksConfirming: 4,
  booksTotal: 6,
});
check("il riepilogo cita il percorso", riepilogo.includes("da 2.50 a 2.17"));
check("il riepilogo cita le conferme", riepilogo.includes("4 bookmaker su 6"));
check("ogni elemento porta il disclaimer", riepilogo.endsWith(FEED_DISCLAIMER));
check(
  "un solo bookmaker si dichiara",
  feedSummary({
    selectionLabel: "X",
    marketLabel: "Esito finale",
    openingPrice: null,
    currentPrice: null,
    levelLabel: "Segnale debole",
    booksConfirming: 1,
    booksTotal: 1,
  }).includes("un solo bookmaker"),
);
eq("tetto elementi dichiarato", FEED_MAX_ITEMS, 30);

/* --- escape XML --- */
eq("e commerciale", xmlEscape("Bosnia & Herzegovina"), "Bosnia &amp; Herzegovina");
eq("tag non iniettabili", xmlEscape("<script>"), "&lt;script&gt;");

/* --- grafico CLV --- */
eq("serie vuota non si disegna", buildClvChart([]), null);
eq(
  "punti senza valore non si disegnano",
  buildClvChart([{ day: "2026-08-01", cumulativeAvgPp: null, cumulativeN: 0, inconclusive: true }]),
  null,
);
const geo = buildClvChart([
  { day: "2026-08-01", cumulativeAvgPp: -2.5, cumulativeN: 5, inconclusive: true },
  { day: "2026-08-02", cumulativeAvgPp: -1.0, cumulativeN: 20, inconclusive: true },
  { day: "2026-08-03", cumulativeAvgPp: 0.8, cumulativeN: 40, inconclusive: false },
])!;
eq("tre punti disegnati", geo.dots.length, 3);
check("percorso valido", geo.path.startsWith("M"));
check(
  "lo zero è dentro il riquadro",
  geo.zeroY >= 0 && geo.zeroY <= CLV_CHART_HEIGHT,
);
check("i valori negativi stanno sotto lo zero", geo.dots[0].y > geo.zeroY);
check("i valori positivi stanno sopra lo zero", geo.dots[2].y < geo.zeroY);
check(
  "il campione piccolo resta marcato",
  geo.dots[0].inconclusive && !geo.dots[2].inconclusive,
);
check(
  "nessuna coordinata non finita",
  geo.dots.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y)),
);
const piatta = buildClvChart([
  { day: "2026-08-01", cumulativeAvgPp: 0, cumulativeN: 40, inconclusive: false },
  { day: "2026-08-02", cumulativeAvgPp: 0, cumulativeN: 50, inconclusive: false },
])!;
check("serie tutta a zero non produce NaN", piatta.dots.every((d) => Number.isFinite(d.y)));
eq("data breve", shortDay("2026-08-26"), "26/08");

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (feed e grafico CLV)`);
