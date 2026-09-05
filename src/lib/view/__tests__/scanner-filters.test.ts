/**
 * Test dei filtri di lettura dell'elenco divari (`/value-bets`).
 * Runner minimale, funzioni pure, nessun database e nessuna rete.
 * Eseguire con: npm run test:filters
 *
 * Perché esistono: su dati reali la pagina mostrava «nessuna riga» mentre aveva
 * dodici divari calcolati, tutti negativi. L'opzione «Mostra tutto, anche i negativi»
 * valeva 0 e il confronto `edgePct < 0` scartava proprio ciò che la etichetta prometteva
 * di tenere. Un pavimento travestito da filtro: la stessa classe di difetto che la
 * correzione dello scanner voleva togliere.
 */
import {
  DEFAULT_SCANNER_FILTERS,
  SHOW_ALL_EDGES,
  applyScannerFilters,
  describeEmptyScanner,
  type FilterableGap,
} from "../scanner-filters";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function gap(partial: Partial<FilterableGap> & Pick<FilterableGap, "edgePct">): FilterableGap {
  return {
    currentOdds: 2.5,
    homeTeam: "Alpha",
    awayTeam: "Beta",
    league: "League One",
    selectionLabel: "1 (Casa)",
    ...partial,
  };
}

const ALL_NEGATIVE: FilterableGap[] = [
  gap({ edgePct: -8.66 }),
  gap({ edgePct: -10.04 }),
  gap({ edgePct: -11.58 }),
];

// 1 — la promessa dell'etichetta: «mostra tutto» non scarta i negativi
{
  const kept = applyScannerFilters(ALL_NEGATIVE, DEFAULT_SCANNER_FILTERS);
  assert(kept.length === 3, "soglia di default: tutti e tre i divari negativi restano in lista");
  assert(
    kept.every((g) => g.edgePct < 0),
    "nessun pavimento silenzioso: il default non è «>= 0»",
  );
  assert(
    SHOW_ALL_EDGES === Number.NEGATIVE_INFINITY,
    "la sentinella «mostra tutto» è −∞, non 0 (con 0 i negativi sparivano)",
  );
}

// 2 — le soglie dichiarate filtrano, e solo loro
{
  const fromHalf = applyScannerFilters(ALL_NEGATIVE, {
    ...DEFAULT_SCANNER_FILTERS,
    minEdge: 0.5,
  });
  assert(fromHalf.length === 0, "da +0,5 pp: nessun negativo passa");

  const mixed = [
    ...ALL_NEGATIVE,
    gap({ edgePct: 0.4 }),
    gap({ edgePct: 1.2 }),
    gap({ edgePct: 2.7 }),
  ];
  assert(
    applyScannerFilters(mixed, { ...DEFAULT_SCANNER_FILTERS, minEdge: 1 }).length === 2,
    "da +1,0 pp: restano i due divari da 1,2 e 2,7",
  );
  assert(
    applyScannerFilters(mixed, { ...DEFAULT_SCANNER_FILTERS, positiveOnly: true }).length ===
      3,
    "«solo divari positivi»: i tre sopra zero, esclusi i negativi",
  );
  assert(
    applyScannerFilters(mixed, { ...DEFAULT_SCANNER_FILTERS, minEdge: 0 }).length === 3,
    "soglia 0 esclude i negativi: è una scelta, non il default",
  );
}

// 3 — fascia quota e ricerca
{
  const rows = [
    gap({ edgePct: -1, currentOdds: 1.5, homeTeam: "Preston U21" }),
    gap({ edgePct: -2, currentOdds: 2.4, homeTeam: "Kyoto" }),
    gap({ edgePct: -3, currentOdds: 8.8, homeTeam: "Saoura", awayTeam: "Horoya" }),
  ];
  assert(
    applyScannerFilters(rows, { ...DEFAULT_SCANNER_FILTERS, oddsRange: "low" }).length === 1,
    "«sotto 2,00» lascia una riga",
  );
  assert(
    applyScannerFilters(rows, { ...DEFAULT_SCANNER_FILTERS, oddsRange: "medium" }).length === 1,
    "«2,00 – 3,50» lascia una riga",
  );
  assert(
    applyScannerFilters(rows, { ...DEFAULT_SCANNER_FILTERS, oddsRange: "high" }).length === 1,
    "«sopra 3,50» lascia una riga",
  );
  assert(
    applyScannerFilters(rows, { ...DEFAULT_SCANNER_FILTERS, searchTerm: "  KYOTO  " }).length ===
      1,
    "la ricerca ignora spazi e maiuscole",
  );
  assert(
    applyScannerFilters(rows, { ...DEFAULT_SCANNER_FILTERS, searchTerm: "serie a" }).length === 0,
    "nessun risultato per una squadra assente (e la pagina lo dice)",
  );
}

// 4 — il messaggio quando l'elenco è vuoto deve distinguere le due cause
{
  const nothing = describeEmptyScanner([], [], DEFAULT_SCANNER_FILTERS);
  assert(
    nothing.title === "Nessun divario calcolabile, in questo momento.",
    "zero misure → «nessun divario calcolabile»",
  );
  assert(
    nothing.note.includes("terna completa"),
    "spiega la condizione che manca (partita al kickoff o terna incompleta)",
  );

  const filteredOut = describeEmptyScanner(ALL_NEGATIVE, [], {
    ...DEFAULT_SCANNER_FILTERS,
    minEdge: 0.5,
  });
  assert(filteredOut.title === "Nessuna riga passa i filtri scelti.", "misure + filtri → colpa dei filtri");
  assert(filteredOut.note.includes("3"), "dice quanti divari c'erano");
  assert(filteredOut.note.includes("-8.66") === false, "non esibisce numeri che l'utente non ha chiesto");
  assert(
    filteredOut.note.includes("Mostra tutto, anche i negativi"),
    "indica l'opzione da scegliere per rivederli",
  );
  assert(
    filteredOut.note.includes("Media"),
    "riporta il divario medio di ciò che è stato escluso",
  );

  const byCheckbox = describeEmptyScanner(ALL_NEGATIVE, [], {
    ...DEFAULT_SCANNER_FILTERS,
    positiveOnly: true,
  });
  assert(
    byCheckbox.note.includes("«solo divari positivi»"),
    "se la causa è la casella, lo dice: non invita ad abbassare una soglia già al minimo",
  );

  const byBand = describeEmptyScanner(ALL_NEGATIVE, [], {
    ...DEFAULT_SCANNER_FILTERS,
    oddsRange: "low",
  });
  assert(
    byBand.note.includes("Tutte le quote lette"),
    "se la causa è la fascia quota, propone l'opzione giusta",
  );
}

console.log(`\n${passed} test superati | ${failed} falliti\n`);
if (failed > 0) process.exit(1);
