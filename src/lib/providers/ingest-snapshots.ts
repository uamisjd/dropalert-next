import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { bookmakers, oddsSnapshots } from "@/db/schema";
import type { OddsQuoteDTO, QuoteTimestampOrigin } from "./types";

export interface ProviderSnapshotWriteReport {
  written: number;
  skipped: number;
  bookmakersEnsured: number;
}

export interface ProviderSnapshotRecord {
  matchId: number;
  bookmakerKey: string;
  isConsensus: boolean;
  isSharp: boolean;
  market: OddsQuoteDTO["market"];
  selection: OddsQuoteDTO["selection"];
  price: number;
  impliedProb: number;
  collectedAt: Date;
  timestampOrigin: QuoteTimestampOrigin;
  source: string;
  runId: number | null;
}

function impliedProbabilityOf(price: number): number {
  return 1 / price;
}

function validQuote(quote: OddsQuoteDTO): boolean {
  return (
    quote.bookmakerKey.trim() !== "" &&
    Number.isFinite(quote.price) &&
    quote.price > 1 &&
    quote.observedAt instanceof Date &&
    Number.isFinite(quote.observedAt.getTime())
  );
}

/**
 * Crea o trova le anagrafiche necessarie per una fonte per-bookmaker.
 * `isSharp` arriva dal parser della fonte, non viene dedotto dal prezzo.
 */
async function ensureBookmaker(
  bookmakerKey: string,
  isConsensus: boolean,
  isSharp: boolean,
): Promise<number> {
  const [existing] = await db
    .select({ id: bookmakers.id })
    .from(bookmakers)
    .where(eq(bookmakers.key, bookmakerKey))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(bookmakers)
    .values({
      key: bookmakerKey,
      name: isConsensus ? `${bookmakerKey} — consenso` : bookmakerKey,
      isSharp: !isConsensus && isSharp,
      weight: "1.000",
      active: true,
    })
    .onConflictDoNothing()
    .returning({ id: bookmakers.id });
  if (created) return created.id;

  const [after] = await db
    .select({ id: bookmakers.id })
    .from(bookmakers)
    .where(eq(bookmakers.key, bookmakerKey))
    .limit(1);
  if (!after) throw new Error(`Anagrafica bookmaker non creata: ${bookmakerKey}`);
  return after.id;
}

/**
 * Normalizzazione pura prima della scrittura. I test possono verificare il
 * contenuto da persistire senza fingere una connessione al database.
 */
export function toProviderSnapshotRecords(
  matchId: number,
  quotes: OddsQuoteDTO[],
  runId: number | null,
  source: string,
): ProviderSnapshotRecord[] {
  if (source.trim() === "") return [];
  return quotes.filter(validQuote).map((quote) => ({
    matchId,
    bookmakerKey: quote.bookmakerKey,
    isConsensus: quote.isConsensus,
    isSharp: quote.isSharp === true,
    market: quote.market,
    selection: quote.selection,
    price: quote.price,
    impliedProb: impliedProbabilityOf(quote.price),
    collectedAt: quote.observedAt,
    timestampOrigin: quote.timestampOrigin === "provider_market" || quote.timestampOrigin === "provider_bookmaker" || quote.timestampOrigin === "collection_fallback" ? quote.timestampOrigin : "unknown",
    source,
    runId,
  }));
}

/**
 * Persistenza comune delle quote per bookmaker.
 *
 * Non calcola consensus, fair o edge: salva esclusivamente ciò che l'adapter
 * ha osservato. Il timestamp conserva la provenienza dichiarata dal parser: fonte,
 * ripiego di raccolta o origine sconosciuta. Non lo si deduce dalla data.
 */
export async function writeProviderSnapshots(
  matchId: number,
  quotes: OddsQuoteDTO[],
  runId: number | null,
  source: string,
): Promise<ProviderSnapshotWriteReport> {
  if (source.trim() === "") throw new Error("La sorgente dello snapshot non può essere vuota.");

  const records = toProviderSnapshotRecords(matchId, quotes, runId, source);
  if (records.length === 0) {
    return { written: 0, skipped: quotes.length, bookmakersEnsured: 0 };
  }

  const metadata = new Map<string, { isConsensus: boolean; isSharp: boolean }>();
  for (const record of records) {
    const previous = metadata.get(record.bookmakerKey);
    metadata.set(record.bookmakerKey, {
      isConsensus: previous?.isConsensus === true || record.isConsensus,
      isSharp: previous?.isSharp === true || record.isSharp,
    });
  }

  const bookmakerIds = new Map<string, number>();
  for (const [key, value] of metadata) {
    bookmakerIds.set(key, await ensureBookmaker(key, value.isConsensus, value.isSharp));
  }

  const rows = records.map((record) => ({
    matchId: record.matchId,
    bookmakerId: bookmakerIds.get(record.bookmakerKey)!,
    market: record.market,
    selection: record.selection,
    price: record.price.toFixed(3),
    impliedProb: record.impliedProb.toFixed(6),
    collectedAt: record.collectedAt,
    timestampOrigin: record.timestampOrigin,
    source: record.source,
    isStale: false,
    runId: record.runId,
  }));

  const inserted = await db
    .insert(oddsSnapshots)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: oddsSnapshots.id });

  return {
    written: inserted.length,
    skipped: quotes.length - inserted.length,
    bookmakersEnsured: bookmakerIds.size,
  };
}
