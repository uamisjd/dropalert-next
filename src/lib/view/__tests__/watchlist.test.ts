/**
 * Test della watchlist (Sprint lancio, punto H).
 * Funzioni pure: nessun accesso a window, nessuna rete.
 * Eseguire con: npm run test:watchlist
 */
import {
  THRESHOLD_PRESETS,
  WATCHLIST_KEY,
  parseWatchlist,
  removeEntry,
  serializeWatchlist,
  sortForDisplay,
  thresholdLabel,
  thresholdReached,
  upsertEntry,
  type WatchEntry,
} from "../watchlist";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}
function eq(name: string, a: unknown, b: unknown) {
  check(`${name} — atteso ${String(b)}, ottenuto ${String(a)}`, Object.is(a, b));
}

const base: WatchEntry = {
  key: "alfa|beta@2026-08-26",
  matchId: 7,
  homeTeam: "Alfa",
  awayTeam: "Beta",
  kickoffAt: "2026-08-26T19:00:00.000Z",
  thresholdKind: null,
  thresholdValue: null,
  addedAt: "2026-08-26T10:00:00.000Z",
};

eq("chiave di storage dichiarata", WATCHLIST_KEY, "dropalert.watchlist.v1");
eq("quattro soglie proposte", THRESHOLD_PRESETS.length, 4);

/* --- serializzazione --- */
eq("lista vuota da null", parseWatchlist(null).length, 0);
eq("json rotto non esplode", parseWatchlist("{non json").length, 0);
eq("json non lista scartato", parseWatchlist('{"a":1}').length, 0);
eq("voce senza chiave scartata", parseWatchlist('[{"matchId":1}]').length, 0);
const round = parseWatchlist(serializeWatchlist([base]));
eq("andata e ritorno conserva la voce", round.length, 1);
eq("andata e ritorno conserva la partita", round[0].matchId, 7);
eq(
  "soglia non numerica normalizzata a null",
  parseWatchlist('[{"key":"k","matchId":1,"homeTeam":"A","awayTeam":"B","kickoffAt":"x","thresholdKind":"indice","thresholdValue":"molto"}]')[0]
    .thresholdValue,
  null,
);

/* --- upsert e rimozione --- */
const uno = upsertEntry([], base);
eq("aggiunta", uno.length, 1);
const due = upsertEntry(uno, { ...base, thresholdKind: "indice", thresholdValue: 60 });
eq("stessa partita non si duplica", due.length, 1);
eq("soglia aggiornata", due[0].thresholdValue, 60);
eq("data di aggiunta conservata", due[0].addedAt, base.addedAt);
eq("rimozione", removeEntry(due, base.key).length, 0);
eq("rimozione di chiave assente non tocca nulla", removeEntry(due, "altra").length, 1);

/* --- soglie --- */
eq("senza soglia non si valuta", thresholdReached(base, { score: 90, dropPct: -30 }), null);
const perIndice = { thresholdKind: "indice" as const, thresholdValue: 60 };
eq("indice sopra soglia", thresholdReached(perIndice, { score: 65, dropPct: null }), true);
eq("indice sotto soglia", thresholdReached(perIndice, { score: 40, dropPct: null }), false);
eq("indice esattamente alla soglia", thresholdReached(perIndice, { score: 60, dropPct: null }), true);
eq("indice mancante: non valutabile", thresholdReached(perIndice, { score: null, dropPct: -20 }), null);
const perDrop = { thresholdKind: "drop" as const, thresholdValue: 15 };
eq("calo del 20% supera la soglia", thresholdReached(perDrop, { score: null, dropPct: -20 }), true);
eq("calo del 5% non basta", thresholdReached(perDrop, { score: null, dropPct: -5 }), false);
eq("quota salita non è un calo", thresholdReached(perDrop, { score: null, dropPct: 20 }), false);
eq("calo mancante: non valutabile", thresholdReached(perDrop, { score: 90, dropPct: null }), null);

/* --- etichette --- */
eq("etichetta senza soglia", thresholdLabel(base), "nessuna soglia: seguo la partita");
check("etichetta indice", thresholdLabel(perIndice).includes("indice 60"));
check("etichetta calo", thresholdLabel(perDrop).includes("15%"));

/* --- ordine --- */
const ordinate = sortForDisplay([
  { reached: false, kickoffAt: "2026-08-26T18:00:00.000Z", id: 1 },
  { reached: true, kickoffAt: "2026-08-27T18:00:00.000Z", id: 2 },
  { reached: null, kickoffAt: "2026-08-26T12:00:00.000Z", id: 3 },
]);
eq("prima chi ha raggiunto la soglia", ordinate[0].id, 2);
eq("poi il kickoff più vicino", ordinate[1].id, 3);

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (watchlist)`);
