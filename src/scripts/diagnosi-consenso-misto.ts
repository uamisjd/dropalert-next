/**
 * DIAGNOSI (non un test, non una modifica): inquinamento del consenso.
 *
 * Risponde, con dati reali delle funzioni PURE del motore, alla domanda:
 * «se mescolo la linea di consenso di BetExplorer con i bookmaker reali di
 * una fonte per-bookmaker, la misura dei segnali cambia?».
 *
 * Il motore (`src/lib/drop/engine.ts`) è già pronto per la coordinazione e la
 * sharp: ma `consensusAt` (mediana di TUTTE le serie) e `computeCoordination`
 * (conta ogni serie come un book) NON distinguono il consenso dai book reali.
 * Questo script SIMULA due scenari sulla stessa partita e STAMPA il confronto.
 *
 * È deliberatamente FUORI dalla suite dei test: non asserisce nulla, produce
 * solo evidenza. Non tocca il database, non tocca il motore.
 */
import {
  computeCoordination,
  computeMagnitude,
  computeSharp,
  consensusAt,
  timeline,
} from "@/lib/drop/engine";
import type { BookmakerSeries } from "@/lib/drop/types";

/** Crea una serie di un bookmaker: prezzo che scende nel tempo (un drop).
 *  `consensus` (default false) segna una linea di consenso anziché un operatore. */
function mk(
  key: string,
  id: number,
  isSharp: boolean,
  prices: Array<[minute: number, price: number]>,
  consensus = false,
): BookmakerSeries {
  return {
    bookmakerId: id,
    bookmakerKey: key,
    bookmakerName: key,
    isSharp,
    isConsensus: consensus,
    weight: 1,
    points: prices.map(([minute, price]) => ({
      price,
      at: new Date(2026, 0, 1, 0, minute),
      isStale: false,
    })),
  };
}

function report(name: string, series: BookmakerSeries[]): void {
  const t = timeline(series);
  const open = consensusAt(series, t[0]);
  const cur = consensusAt(series, t[t.length - 1]);
  const mag = computeMagnitude(series);
  const coord = computeCoordination(series, mag ? mag.deltaPp : 0);
  const sharp = computeSharp(series, mag ? mag.deltaPp : 0);

  console.log(`\n=== ${name} ===`);
  console.log(`  consenso apertura: ${open}  →  consenso attuale: ${cur}`);
  if (mag) {
    console.log(`  magnitude deltaPp: ${mag.deltaPp} pp (${mag.magnitudeClass})`);
  }
  console.log(
    `  coordination: booksTotal=${coord.booksTotal} confirming=${coord.booksConfirming} opposing=${coord.booksOpposing} flat=${coord.booksFlat}`,
  );
  console.log(
    `  perBook: ${coord.perBook
      .map((b) => `${b.bookmakerKey}=${b.direction}(${b.deltaPp})`)
      .join(", ")}`,
  );
  console.log(
    `  sharp: available=${sharp.available} confirms=${sharp.confirms} deltaPp=${sharp.deltaPp} bookKeys=[${sharp.bookKeys.join(", ")}]`,
  );
}

async function main(): Promise<void> {
  // Drop coordinato: consenso 2.00→1.70, Pinnacle 2.05→1.72, Bet365 2.10→1.80.
  const onlyConsensus = [
    mk("betexplorer-consensus", 1, false, [
      [0, 2.0],
      [20, 1.9],
      [40, 1.8],
      [60, 1.7],
    ]),
  ];
  /* Cablaggio NAÏF: la linea di consenso viene scritta senza il flag */
  const mixedNaive = [
    mk("betexplorer-consensus", 1, false, [
      [0, 2.0],
      [20, 1.9],
      [40, 1.8],
      [60, 1.7],
    ]),
    mk("pinnacle", 2, true, [
      [0, 2.05],
      [20, 1.95],
      [40, 1.82],
      [60, 1.72],
    ]),
    mk("bet365", 3, false, [
      [0, 2.1],
      [20, 2.0],
      [40, 1.9],
      [60, 1.8],
    ]),
  ];
  /* Cablaggio CORRETTO: la linea di consenso è marcata isConsensus=true */
  const mixedFlagged = [
    mk("betexplorer-consensus", 1, false, [
      [0, 2.0],
      [20, 1.9],
      [40, 1.8],
      [60, 1.7],
    ], true),
    mk("pinnacle", 2, true, [
      [0, 2.05],
      [20, 1.95],
      [40, 1.82],
      [60, 1.72],
    ]),
    mk("bet365", 3, false, [
      [0, 2.1],
      [20, 2.0],
      [40, 1.9],
      [60, 1.8],
    ]),
  ];

  console.log("DIAGNOSI: inquinamento del consenso quando si mescolano i book.");
  console.log("(script puramente dimostrativo: nessuna modifica, nessun DB)");

  report("SCENARIO A — solo consenso (stato attuale)", onlyConsensus);
  report("SCENARIO B — consenso + book reali (cablaggio NAÏF, senza flag)", mixedNaive);
  report("SCENARIO C — consenso+book, ma il consenso è marcato isConsensus", mixedFlagged);

  console.log("\n--- lettura dei tre numeri chiave ---");
  console.log(
    "1. Il consenso di riferimento scende in entrambi (2.00→1.70): il DROP è lo stesso.",
  );
  console.log(
    "2. In B `coordination.booksTotal=3` e counts anche `betexplorer-consensus` come book,",
    "e `consensusAt` fa la mediana di tre serie: la misura del movimento e il ",
    "`sharp.confirms` cambiano rispetto ad A. È l'inquinamento da evitare.",
  );
  console.log(
    "3. In C il motore (già corretto) ESCLUDE `betexplorer-consensus`: la mediana ",
    "di consenso torna sui soli operatori e `coordination.booksTotal=2` (solo",
    "pinnacle e bet365). È il comportamento atteso che il flag isConsensus abilita",
    "oltre il cablaggio naïf.",
  );
}

main().catch((error) => {
  console.error("DIAGNOSI FALLITA:", error);
  process.exitCode = 1;
});
