/**
 * Test della ribasatura del CLV — funzioni pure, nessun database.
 * Eseguire con: npm run test:clv-rebasis
 *
 * I numeri attesi sono calcolati a mano dalla definizione
 * `clvPp = (1/chiusura − 1/segnale) × 100` e scritti qui espliciti: se la
 * formula cambia, questi test devono fallire.
 */
import {
  ALIGNED_BASIS,
  PRICE_EPSILON,
  accumulate,
  decideRebase,
  describeRebase,
  emptySummary,
  type ClvRow,
} from "../rebasis";

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

/* La base su cui il segnale grezzo sta sullo stesso piano della chiusura. */
eq("base allineata", ALIGNED_BASIS, "raw_consensus");
check("epsilon sotto il terzo decimale", PRICE_EPSILON < 0.002);

/* ------------------------------------------------------------------ */
/* riparazione: chiusura senza margine → chiusura grezza                */
/* ------------------------------------------------------------------ */

/* segnale 2.10 (prob .476190), chiusura fair 2.20 (prob .454545) → −2.16 pp.
   Chiusura grezza 2.00 (prob .500000) → +2.38 pp. Delta +4.54 pp. */
const rigaSporca: ClvRow = {
  id: 1,
  signalPrice: 2.1,
  closingPrice: 2.2,
  clvPp: -2.16,
  closingBasis: "fair_novig",
};

const riparata = decideRebase(rigaSporca, { price: 2.0, booksUsed: 12 });
eq("azione repair", riparata.action, "repair");
if (riparata.action === "repair") {
  eq("nuovo CLV +2.38", riparata.update.clvPp, 2.38);
  eq("delta +4.54 pp", riparata.deltaPp, 4.54);
  eq("base allineata scritta", riparata.update.closingBasis, "raw_consensus");
  eq("chiusura grezza scritta", riparata.update.closingPrice, 2);
  eq("nessun margine sulla base allineata", riparata.update.marketMargin, null);
  eq("batte la chiusura", riparata.update.beatClose, true);
  check("il motivo spiega la base", /stessa base/i.test(riparata.reason));
  check("il motivo cita i book usati", /12 book/.test(riparata.reason));
}

/* ------------------------------------------------------------------ */
/* già allineata e stessa chiusura: non si tocca                        */
/* ------------------------------------------------------------------ */

const rigaPulita: ClvRow = {
  id: 2,
  signalPrice: 2.1,
  closingPrice: 2.0,
  clvPp: 2.38,
  closingBasis: "raw_consensus",
};
const immutata = decideRebase(rigaPulita, { price: 2.0, booksUsed: 12 });
eq("azione unchanged", immutata.action, "unchanged");
check("motivo dichiarato", /niente da ricalcolare/i.test(immutata.reason));

/* ------------------------------------------------------------------ */
/* stessa base ma mediana aggiornata: ricalcolo, non riparazione        */
/* ------------------------------------------------------------------ */

/* chiusura 2.05 → prob .487805 → clvPp +1.16; delta −1.22 */
const aggiornata = decideRebase(rigaPulita, { price: 2.05, booksUsed: 18 });
eq("azione refresh", aggiornata.action, "refresh");
if (aggiornata.action === "refresh") {
  eq("nuovo CLV +1.16", aggiornata.update.clvPp, 1.16);
  eq("delta −1.22 pp", aggiornata.deltaPp, -1.22);
  eq("base resta allineata", aggiornata.update.closingBasis, "raw_consensus");
}

/* una differenza sotto l'epsilon non è un movimento */
const rumore = decideRebase(rigaPulita, { price: 2.0005, booksUsed: 12 });
eq("rumore di arrotondamento ignorato", rumore.action, "unchanged");

/* ------------------------------------------------------------------ */
/* casi non ricalcolabili: dichiarati, mai inventati                    */
/* ------------------------------------------------------------------ */

eq(
  "nessuna chiusura a registro",
  decideRebase(rigaSporca, null).action,
  "impossible",
);
eq(
  "prezzo non valido",
  decideRebase(rigaSporca, { price: 1, booksUsed: 3 }).action,
  "impossible",
);
eq(
  "prezzo assurdo",
  decideRebase(rigaSporca, { price: Number.NaN, booksUsed: 3 }).action,
  "impossible",
);
eq(
  "segnale non valido",
  decideRebase({ ...rigaSporca, signalPrice: 0.9 }, { price: 2, booksUsed: 3 })
    .action,
  "impossible",
);
const baseIgnota = decideRebase(
  { ...rigaSporca, closingBasis: "valore_inatteso" },
  { price: 2, booksUsed: 5 },
);
eq("base non registrata → riparata", baseIgnota.action, "repair");

/* ------------------------------------------------------------------ */
/* riepilogo: conta anche ciò che non è cambiato                        */
/* ------------------------------------------------------------------ */

let s = emptySummary();
s = accumulate(s, rigaSporca, riparata);
s = accumulate(s, rigaPulita, immutata);
s = accumulate(s, rigaPulita, aggiornata);
s = accumulate(s, rigaSporca, { action: "impossible", reason: "x" });

eq("righe viste", s.rowsSeen, 4);
eq("riparate", s.repaired, 1);
eq("ricalcolate", s.refreshed, 1);
eq("già allineate", s.unchanged, 1);
eq("non ricalcolabili", s.impossible, 1);
/* +4.54 e −1.22 → totale +3.32, media +1.66 */
eq("delta totale", s.totalDeltaPp, 3.32);
eq("delta medio", s.avgDeltaPp, 1.66);
/* −2.16 → +2.38 cambia verso; +2.38 → +1.16 no */
eq("una riga cambia verso", s.flipped, 1);

const detto = describeRebase(s);
check("riepilogo cita le righe viste", /Su 4 righe/.test(detto));
check("riepilogo cita le riparate", /1 riportate sulla base allineata/.test(detto));
check("riepilogo cita il cambio di verso", /1 righe cambiano verso/.test(detto));
check(
  "riepilogo vuoto non inventa",
  /niente da ribasare/i.test(describeRebase(emptySummary())),
);

const nessuna = describeRebase({ ...emptySummary(), rowsSeen: 3, unchanged: 3 });
check("nessun cambiamento dichiarato", /Nessun valore è cambiato/.test(nessuna));

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (ribasatura CLV)`);
