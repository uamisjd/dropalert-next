/**
 * Test delle funzioni pure della lettura temporale (Sprint UX-1).
 * Runner minimale, nessuna dipendenza esterna e nessun database.
 * Eseguire con: npm run test:timeline
 */
import {
  DEFAULT_TIME_CHIP,
  PLAYED_GRACE_MINUTES,
  compareWithinDay,
  dayBucketOf,
  fmtCountdown,
  groupByDay,
  isExpiredFromMain,
  matchesTimeChip,
  chipCounts,
  parseTimeChip,
  recentMovements,
  romeDayDiff,
} from "../timeline";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(`${name} — atteso ${String(expected)}, ottenuto ${String(actual)}`,
    Object.is(actual, expected));
}

/* riferimento: 25 agosto 2026, ore 20:00 italiane (18:00 UTC) */
const now = new Date("2026-08-25T18:00:00Z");
const iso = (h: number) => new Date(now.getTime() + h * 3600000).toISOString();

/* --- chip --- */
eq("chip ignota torna al default", parseTimeChip("boh"), DEFAULT_TIME_CHIP);
eq("chip assente torna al default", parseTimeChip(undefined), DEFAULT_TIME_CHIP);
eq("chip valida conservata", parseTimeChip("giocate"), "giocate");
eq("chip UX-1 dismessa torna al default", parseTimeChip("oggi-e-in-arrivo"), DEFAULT_TIME_CHIP);

/* --- giorno civile italiano --- */
eq("mezzanotte italiana è già domani", romeDayDiff(now, "2026-08-25T22:30:00Z"), 1);
eq("stessa giornata italiana", romeDayDiff(now, "2026-08-25T19:00:00Z"), 0);
eq("bucket oggi", dayBucketOf(iso(1), now), "oggi");
eq("bucket domani", dayBucketOf("2026-08-26T12:00:00Z", now), "domani");
eq("bucket poi", dayBucketOf("2026-08-28T12:00:00Z", now), "poi");

/* --- tolleranza +3h --- */
eq("2h dopo il kickoff resta in lista", isExpiredFromMain(iso(-2), now), false);
eq("4h dopo il kickoff esce", isExpiredFromMain(iso(-4), now), true);
eq("tolleranza dichiarata a 180 minuti", PLAYED_GRACE_MINUTES, 180);

/* --- filtro delle chip (partizione UX-2: da giocare | giocate) --- */
eq("default: futuro incluso", matchesTimeChip(iso(2), "da-giocare", now), true);
eq("default: giocata da 1h inclusa", matchesTimeChip(iso(-1), "da-giocare", now), true);
eq("default: giocata da 5h esclusa", matchesTimeChip(iso(-5), "da-giocare", now), false);
eq("giocate = archiviate oltre +3h", matchesTimeChip(iso(-5), "giocate", now), true);
eq("giocate esclude il futuro", matchesTimeChip(iso(1), "giocate", now), false);
eq("giocate esclude la tolleranza", matchesTimeChip(iso(-1), "giocate", now), false);
eq("tutte non filtra nulla", matchesTimeChip(iso(-99), "tutte", now), true);

/* --- aritmetica dei conteggi: è la regola da rispettare --- */
const pool = [
  { kickoffAt: iso(1) },
  { kickoffAt: iso(3) },
  { kickoffAt: iso(-1) },
  { kickoffAt: iso(-5) },
  { kickoffAt: iso(-30) },
  { kickoffAt: "2026-08-26T12:00:00Z" },
  { kickoffAt: "2026-08-29T12:00:00Z" },
];
const counts = chipCounts(pool, now);
eq("tutte = da giocare + giocate", counts.tutte, counts["da-giocare"] + counts.giocate);
eq("tutte = dimensione dell'insieme", counts.tutte, pool.length);
eq("giocate contate", counts.giocate, 2);
eq("da giocare contate", counts["da-giocare"], 5);
eq("oggi + in arrivo = da giocare", counts.oggi + counts.inArrivo, counts["da-giocare"]);
eq("oggi contate", counts.oggi, 3);
eq("in arrivo contate", counts.inArrivo, 2);
check(
  "il conteggio della chip predefinita è il numero di card visibili",
  pool.filter((p) => matchesTimeChip(p.kickoffAt, "da-giocare", now)).length ===
    counts["da-giocare"],
);

/* --- countdown --- */
eq("countdown ore e minuti", fmtCountdown(iso(2.5), now), "tra 2h 30m");
eq("countdown solo minuti", fmtCountdown(new Date(now.getTime() + 40 * 60000), now), "tra 40m");
eq("giocata da un'ora", fmtCountdown(iso(-1), now), "giocata 1h fa");

/* --- ordine e gruppi --- */
const mk = (id: number, level: string, score: number | null, h: number) => ({
  id,
  level,
  confidenceScore: score,
  kickoffAt: iso(h),
  updatedAt: iso(0),
});
const ordered = [mk(1, "debole", 90, 1), mk(2, "forte", 10, 5), mk(3, "forte", 50, 6)]
  .sort(compareWithinDay)
  .map((x) => x.id);
eq("forte prima di debole", ordered[0], 3);
eq("a parità di livello vince il punteggio", ordered[1], 2);
eq("debole in fondo nonostante il punteggio", ordered[2], 1);

const groups = groupByDay(
  [mk(1, "forte", 5, 1), mk(2, "forte", 5, 20), mk(3, "forte", 5, 80)],
  now,
);
eq("tre gruppi non vuoti", groups.length, 3);
eq("primo gruppo Oggi", groups[0].label, "Oggi");
eq("secondo gruppo Domani", groups[1].label, "Domani");
eq("terzo gruppo Poi", groups[2].label, "Poi");
check(
  "i gruppi vuoti non compaiono",
  groupByDay([mk(1, "forte", 5, 1)], now).length === 1,
);

/* --- striscia ultimi movimenti --- */
const recent = recentMovements(
  [
    { kickoffAt: iso(3), confidenceScore: 1, updatedAt: iso(-0.5) },
    { kickoffAt: iso(3), confidenceScore: 1, updatedAt: iso(-2) },
    { kickoffAt: iso(3), confidenceScore: 1, updatedAt: iso(-6) },
    { kickoffAt: iso(3), confidenceScore: 1 },
  ],
  now,
);
eq("solo le ultime 3 ore", recent.length, 2);
eq("più recente per primo", recent[0].updatedAt, iso(-0.5));

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (timeline UX-1)`);
