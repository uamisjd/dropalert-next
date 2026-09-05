/**
 * La linea che il divario pretende esiste davvero nei dati del collettore?
 * Runner minimale, nessuna dipendenza esterna e nessun accesso al database.
 * Eseguire con: npm run test:line-shape
 *
 * Perché questo file esiste: `computeValueGap` rifiuta di calcolare senza la terna
 * completa rilevata ALLO STESSO ISTANTE, fino a ieri quella era una scelta di
 * principio verificata a mente. Qui diventa un fatto misurato sull'unica fonte che
 * usiamo — l'HTML reale della pagina drop congelato l'18.08.2026 — attraverso la
 * catena vera: parser → `toQuoteDTOs` (un solo `fetchedAt` per giro) → la stessa
 * raggruppazione che fa il repository → divario.
 *
 * Cosa deve dire, se passa: che ogni riga d'elenco produce tre colonne con lo stesso
 * istante, quindi il divario è calcolabile su TUTTE le partite monitorate (e la lista
 * vuota in produzione significherebbe «non c'è nulla da misurare», non «la regola è
 * troppo stretta»).
 *
 * Cosa deve dire, se rompe: che la forma della fonte è cambiata. È l'allarme giusto da
 * ricevere, ed è il motivo per cui sta in una suite e non in un commento.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDroppingOdds } from "../betexplorer/parse";
import { toQuoteDTOs } from "../betexplorer/index";
import { groupLatestLines, type LineRow } from "@/lib/repo/value-bets";
import { computeValueGap } from "@/lib/quant/value-gap";
import type { MarketType, SelectionCode } from "@/db/schema";

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

const FIXTURES = join(process.cwd(), "src/lib/providers/__tests__/fixtures");
const html = readFileSync(join(FIXTURES, "betexplorer-dropping-odds.html"), "utf8");
const listing = parseDroppingOdds(html);
/** l'istante del giro: uno solo, come in `fetchOdds` */
const fetchedAt = new Date("2026-08-18T10:00:00.000Z");

console.log("\nForma delle linee 1X2 sull'elenco drop reale (18.08.2026)\n");

const margins: number[] = [];
let withLine = 0;
let withGap = 0;

for (const row of listing.fixtures) {
  const quotes = toQuoteDTOs(row, fetchedAt);
  const line1x2 = quotes.filter((q) => q.market === "1x2");

  /* 1 — la fonte pubblica le tre colonne insieme, con lo stesso istante */
  assert(
    line1x2.length === 3,
    `${row.homeTeamRaw} – ${row.awayTeamRaw}: tre quote 1X2 nell'elenco (${line1x2.length})`,
  );
  assert(
    line1x2.every((q) => q.observedAt.getTime() === fetchedAt.getTime()),
    "  · stesso istante di osservazione per tutte e tre",
  );

  /* 2 — la scrittura del collettore produce UNA linea completa */
  const asRows: LineRow[] = quotes.map((q) => ({
    matchId: 1,
    bookmakerId: 1,
    market: q.market as MarketType,
    selection: q.selection as SelectionCode,
    price: String(q.price),
    collectedAt: q.observedAt,
    source: "betexplorer-listing",
  }));
  const reading = groupLatestLines(asRows).get("1|1x2")?.[0];
  if (reading) {
    withLine += 1;
    assert(
      Object.keys(reading.prices).length === 3,
      `  · grouping: linea completa (${Object.keys(reading.prices).length} selezioni)`,
    );

    /* 3 — il divario si calcola, e il margine MISURATO non è un numero di comodo */
    const first = line1x2[0]!;
    const gap = computeValueGap({
      market: "1x2",
      selection: first.selection as SelectionCode,
      currentPrice: first.price,
      line: reading.prices,
    });
    if (gap.ok) {
      withGap += 1;
      margins.push(gap.marginPct);
      assert(
        gap.marginPct > 5 && gap.marginPct < 15,
        `  · margine rimosso ${gap.marginPct}% in ordine con la fonte (atteso 5–15%)`,
      );
      assert(
        Math.abs(gap.marginPct - 4.5) > 1,
        `  · e lontano dal 4,5% ipotizzato un tempo (${gap.marginPct}%)`,
      );
      assert(gap.edgePct < 0, `  · divario negativo su linea del book: ${gap.edgePct} pp`);
    } else {
      assert(false, `  · divario calcolabile: ${gap.reason}`);
    }
  } else {
    assert(false, "  · grouping: nessuna linea 1X2 (inatteso)");
  }
}

assert(
  withLine === listing.fixtures.length && withGap === listing.fixtures.length,
  `terne simultanee e divari calcolati su tutte le ${listing.fixtures.length} righe (${withLine}/${withGap})`,
);

/* ------------------------------------------------------------------ */
/* Il caso che fa paura: un giro che scrive MEZZA riga                */
/* ------------------------------------------------------------------ */

/**
 * Il salto di stabilità del collettore è per partita, non per selezione: un giro che
 * porta una sola colonna non è una linea. Se il raggruppatore la mescolasse con la
 * lettura precedente, il margine — e quindi il divario — sarebbe un artefatto di tempi
 * diversi. Qui si verifica che non lo faccia.
 */
{
  const row = listing.fixtures[0]!;
  const full = toQuoteDTOs(row, fetchedAt).filter((q) => q.market === "1x2");
  const later = new Date(fetchedAt.getTime() + 5 * 60_000);
  const rows: LineRow[] = [
    ...full.map((q) => ({
      matchId: 2,
      bookmakerId: 1,
      market: "1x2" as MarketType,
      selection: q.selection as SelectionCode,
      price: String(q.price),
      collectedAt: fetchedAt,
      source: "betexplorer-listing",
    })),
    {
      matchId: 2,
      bookmakerId: 1,
      market: "1x2" as MarketType,
      selection: full[0]!.selection as SelectionCode,
      price: String(Number(full[0]!.price) * 0.9),
      collectedAt: later,
      source: "betexplorer-listing",
    },
  ];
  const reading = groupLatestLines(rows).get("2|1x2")?.[0];
  assert(reading !== undefined, "ciclo parziale: una lettura esiste comunque");
  assert(
    reading !== undefined && Object.keys(reading.prices).length === 1,
    "ciclo parziale: la terna precedente NON viene ereditata",
  );
  const gap = computeValueGap({
    market: "1x2",
    selection: full[0]!.selection as SelectionCode,
    currentPrice: Number(full[0]!.price) * 0.9,
    line: reading?.prices ?? {},
  });
  assert(gap.ok === false, "ciclo parziale: nessun divario, nessun numero inventato");
}

const ordered = [...margins].sort((a, b) => a - b);
const mediana =
  ordered.length === 0
    ? null
    : ordered[(ordered.length - 1) >> 1];
console.log(
  `\n  margine rimosso su queste linee reali: min ${ordered[0]?.toFixed(2)}% · mediana ${
    mediana === null ? "n/d" : `${mediana.toFixed(2)}%`
  } · max ${ordered[ordered.length - 1]?.toFixed(2)}% — il vecchio codice ne assumeva ` +
    `uno solo per tutte le quote, e non era in ordine di grandezza\n`,
);

console.log(`${passed} test superati | ${failed} falliti\n`);
if (failed > 0) process.exit(1);
