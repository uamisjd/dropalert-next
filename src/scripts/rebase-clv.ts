/**
 * Ribasatura del CLV — riporta ogni riga sulla base allineata.
 *
 *   npm run clv:rebase            # SOLO LETTURA: stampa cosa cambierebbe
 *   npm run clv:rebase -- --apply # scrive davvero
 *
 * Perché esiste: il CLV confronta la probabilità di chiusura con quella del
 * segnale, e il prezzo del segnale è sempre grezzo (margine incluso). Le righe
 * registrate con `closing_basis = 'fair_novig'` confrontano quel prezzo grezzo
 * con una chiusura depurata dal margine: basi diverse, e lo studio §1.1 misura
 * −1,86 pp di CLV bruciati dal solo errore di base, con il 20,6% dei casi che
 * cambierebbe verso.
 *
 * Che cosa fa: rilegge la chiusura GREZZA mediana che `closing_lines` conserva
 * comunque e ricalcola il CLV su quella. Non inventa un margine, non stima una
 * chiusura, non tocca `signalPrice`. Se la chiusura grezza non c'è la riga
 * resta com'è e il motivo è contato nel riepilogo.
 *
 * Perché di default non scrive: un ricalcolo che riscrive la misura di validità
 * dell'intero osservatorio va prima letto. Il passaggio a secco stampa gli
 * stessi numeri che scriverebbe, riga per riga nei primi casi.
 */
import { and, eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import {
  closingLines,
  clvRecords,
  dropSignals,
  type MarketType,
  type SelectionCode,
} from "@/db/schema";
import { median, num } from "@/lib/drop/math";
import {
  accumulate,
  decideRebase,
  describeRebase,
  emptySummary,
  type AlignedReference,
  type ClvRow,
} from "@/lib/clv/rebasis";

const APPLY = process.argv.includes("--apply");
const SHOW = 10;

interface JoinedRow {
  id: number;
  signalPrice: string;
  closingPrice: string;
  clvPp: string;
  closingBasis: string;
  market: MarketType;
  selection: SelectionCode;
  matchId: number;
}

/**
 * Chiusura grezza mediana per una (partita, mercato, selezione): la metà che
 * sta sulla stessa base del prezzo del segnale.
 */
async function alignedReference(
  matchId: number,
  market: MarketType,
  selection: SelectionCode,
): Promise<AlignedReference | null> {
  const rows = await db
    .select({ closingPrice: closingLines.closingPrice })
    .from(closingLines)
    .where(
      and(
        eq(closingLines.matchId, matchId),
        eq(closingLines.market, market),
        eq(closingLines.selection, selection),
      ),
    );
  const prices = rows
    .map((r) => num(r.closingPrice))
    .filter((v): v is number => v !== null);
  const price = median(prices);
  if (price === null) return null;
  return { price, booksUsed: prices.length };
}

async function main(): Promise<void> {
  const rows = (await db
    .select({
      id: clvRecords.id,
      signalPrice: clvRecords.signalPrice,
      closingPrice: clvRecords.closingPrice,
      clvPp: clvRecords.clvPp,
      closingBasis: clvRecords.closingBasis,
      market: dropSignals.market,
      selection: dropSignals.selection,
      matchId: clvRecords.matchId,
    })
    .from(clvRecords)
    .innerJoin(dropSignals, eq(clvRecords.signalId, dropSignals.id))
    .orderBy(clvRecords.id)) as JoinedRow[];

  console.log(
    `# Ribasatura del CLV — ${APPLY ? "APPLICAZIONE" : "passaggio a secco (nessuna scrittura)"}`,
  );
  console.log(`righe di CLV a registro: ${rows.length}\n`);

  let summary = emptySummary();
  const shown: string[] = [];

  for (const r of rows) {
    const row: ClvRow = {
      id: r.id,
      signalPrice: num(r.signalPrice) ?? 0,
      closingPrice: num(r.closingPrice) ?? 0,
      clvPp: num(r.clvPp) ?? 0,
      closingBasis: r.closingBasis,
    };
    const reference = await alignedReference(r.matchId, r.market, r.selection);
    const decision = decideRebase(row, reference);
    summary = accumulate(summary, row, decision);

    if (
      (decision.action === "repair" || decision.action === "refresh") &&
      shown.length < SHOW
    ) {
      shown.push(
        `- riga ${r.id}: CLV ${row.clvPp} → ${decision.update.clvPp} pp ` +
          `(${decision.deltaPp > 0 ? "+" : ""}${decision.deltaPp}), ` +
          `chiusura ${row.closingPrice} → ${decision.update.closingPrice} ` +
          `[${r.closingBasis} → ${decision.update.closingBasis}]`,
      );

      if (APPLY) {
        await db
          .update(clvRecords)
          .set({
            closingPrice: decision.update.closingPrice.toFixed(3),
            clvPp: decision.update.clvPp.toFixed(2),
            clvPct: decision.update.clvPct.toFixed(3),
            beatClose: decision.update.beatClose,
            closingBasis: decision.update.closingBasis,
            marketMargin: null,
            computedAt: new Date(),
          })
          .where(eq(clvRecords.id, r.id));
      }
    }
  }

  if (shown.length > 0) {
    console.log(
      `## Prime ${shown.length} righe ${APPLY ? "riscritte" : "che cambierebbero"}\n`,
    );
    for (const line of shown) console.log(line);
    console.log("");
  }

  console.log("## Riepilogo\n");
  console.log(describeRebase(summary));
  console.log(
    `\nrighe viste ${summary.rowsSeen} · riparate ${summary.repaired} · ` +
      `ricalcolate ${summary.refreshed} · già allineate ${summary.unchanged} · ` +
      `non ricalcolabili ${summary.impossible}`,
  );
  if (!APPLY && summary.repaired + summary.refreshed > 0) {
    console.log(
      "\nNessuna scrittura effettuata. Per applicare: npm run clv:rebase -- --apply",
    );
  }
}

main()
  .then(async () => {
    await sql`select 1`.catch(() => undefined);
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(
      "ribasatura non riuscita:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
