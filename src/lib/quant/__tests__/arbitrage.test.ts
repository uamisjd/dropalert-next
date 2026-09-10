/**
 * Suite del criterio di «cross-bookmaker» dello scanner di arbitraggio.
 *
 * Il criterio è il cuore della differenza fra una surebet vera (quote migliori
 * da operatori distinti, somma implicita < 1) e una singola linea di consenso
 * che — contenendo il margine — non può MAI dare un'opportunità. Se tutto
 * viene dalla stessa linea non è «un'opportunità rara che non è comparsa»: è
 * una fonte che non espone un arbitraggio cross-bookmaker, e va dichiarato.
 */
import {
  distinctBookmakerKeys,
  isCrossBookmaker,
} from "../arbitrage";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

const CONSENSUS = "betexplorer-consensus";

function legs(opts: Array<{ selection: string; bookmakerKey: string; odds: number }>) {
  return opts.map((o) => ({
    selection: o.selection as never,
    selectionLabel: o.selection,
    bestOdds: o.odds,
    bookmakerName: o.bookmakerKey,
    bookmakerKey: o.bookmakerKey,
    impliedProb: 1 / o.odds,
    stakePct: 0,
  }));
}

/* --- distinctBookmakerKeys --- */

assert(
  distinctBookmakerKeys([{ bookmakerKey: "betexplorer-consensus" }, { bookmakerKey: "betexplorer-consensus" }]) === 1,
  "una sola linea di consenso conta come UN operatore",
);

assert(
  distinctBookmakerKeys([
    { bookmakerKey: "pinnacle" },
    { bookmakerKey: "bet365" },
    { bookmakerKey: "bet365" },
  ]) === 2,
  "due operatori distinti, anche ripetuti, contano come DUE",
);

assert(
  distinctBookmakerKeys([]) === 0,
  "nessuna gamba ⇒ zero operatori (mai 1 di ripiego)",
);

assert(
  distinctBookmakerKeys([{ bookmakerKey: "  PINNACLE  " }]) === 1,
  "le chiavi sono normalizzate (minuscolo, senza spazi)",
);

assert(
  distinctBookmakerKeys([
    { bookmakerKey: "betex_consensus" },
    { bookmakerKey: "betex-consensus" },
  ]) === 2,
  "chiavi diverse senza normalizzazione restano distinte (conservativo)",
);

/* --- isCrossBookmaker --- */

assert(
  isCrossBookmaker(
    legs([
      { selection: "home", bookmakerKey: CONSENSUS, odds: 2.1 },
      { selection: "draw", bookmakerKey: CONSENSUS, odds: 3.4 },
      { selection: "away", bookmakerKey: CONSENSUS, odds: 4.0 },
    ]),
  ) === false,
  "tre gambe sulla stessa linea di consenso: NON è cross-bookmaker",
);

assert(
  isCrossBookmaker(
    legs([
      { selection: "home", bookmakerKey: "pinnacle", odds: 2.1 },
      { selection: "draw", bookmakerKey: "bet365", odds: 3.4 },
      { selection: "away", bookmakerKey: "pinnacle", odds: 4.0 },
    ]),
  ) === true,
  "quote migliori da due operatori distinti: è cross-bookmaker",
);

assert(
  isCrossBookmaker([]) === false,
  "senza gambe non esiste alcun arbitraggio cross-bookmaker",
);

/* --- La somma implicita di una sola linea sta sempre sopra 1 --- */
const singleLine = legs([
  { selection: "home", bookmakerKey: CONSENSUS, odds: 2.1 },
  { selection: "draw", bookmakerKey: CONSENSUS, odds: 3.4 },
  { selection: "away", bookmakerKey: CONSENSUS, odds: 4.2 },
]);
const sum = singleLine.reduce((acc, l) => acc + l.impliedProb, 0);
assert(
  sum > 1 && isCrossBookmaker(singleLine) === false,
  `una sola linea ha margine (somma ${(sum * 100).toFixed(2)}% > 100%) e non è una surebet`,
);

console.log(
  `\n${passed} test superati | ${failed} falliti\n${failed > 0 ? "FAIL" : "PASS"}`,
);
process.exit(failed > 0 ? 1 : 0);
