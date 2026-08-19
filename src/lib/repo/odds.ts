/**
 * Accesso ai dati delle quote.
 * Trasforma le righe di odds_snapshots nelle serie che il motore consuma.
 * Nessuna logica di analisi qui dentro: solo lettura e mappatura.
 */
import { and, asc, eq, gte, inArray, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bookmakers,
  oddsSnapshots,
  type MarketType,
  type SelectionCode,
} from "@/db/schema";
import { STALE_SNAPSHOT_MINUTES } from "@/lib/drop/constants";
import { num } from "@/lib/drop/math";
import type { BookmakerSeries } from "@/lib/drop/types";

/** Coppia mercato/selezione osservata per una partita. */
export interface MarketKey {
  market: MarketType;
  selection: SelectionCode;
}

/**
 * Serie storiche di una partita, raggruppate per (mercato, selezione, book).
 * @param matchId partita
 * @param since finestra temporale opzionale
 */
export async function getSeriesForMatch(
  matchId: number,
  since?: Date,
): Promise<Map<string, BookmakerSeries[]>> {
  const rows = await db
    .select({
      bookmakerId: oddsSnapshots.bookmakerId,
      bookmakerKey: bookmakers.key,
      bookmakerName: bookmakers.name,
      isSharp: bookmakers.isSharp,
      weight: bookmakers.weight,
      market: oddsSnapshots.market,
      selection: oddsSnapshots.selection,
      price: oddsSnapshots.price,
      collectedAt: oddsSnapshots.collectedAt,
      isStale: oddsSnapshots.isStale,
    })
    .from(oddsSnapshots)
    .innerJoin(bookmakers, eq(bookmakers.id, oddsSnapshots.bookmakerId))
    .where(
      since
        ? and(
            eq(oddsSnapshots.matchId, matchId),
            gte(oddsSnapshots.collectedAt, since),
          )
        : eq(oddsSnapshots.matchId, matchId),
    )
    .orderBy(asc(oddsSnapshots.collectedAt));

  const grouped = new Map<string, Map<number, BookmakerSeries>>();

  for (const r of rows) {
    const price = num(r.price);
    if (price === null) continue;

    const mk = `${r.market}::${r.selection}`;
    let byBook = grouped.get(mk);
    if (!byBook) {
      byBook = new Map();
      grouped.set(mk, byBook);
    }

    let series = byBook.get(r.bookmakerId);
    if (!series) {
      series = {
        bookmakerId: r.bookmakerId,
        bookmakerKey: r.bookmakerKey,
        bookmakerName: r.bookmakerName,
        isSharp: r.isSharp,
        weight: num(r.weight) ?? 1,
        points: [],
      };
      byBook.set(r.bookmakerId, series);
    }

    series.points.push({
      price,
      at: r.collectedAt,
      isStale: r.isStale,
    });
  }

  const out = new Map<string, BookmakerSeries[]>();
  for (const [mk, byBook] of grouped) out.set(mk, [...byBook.values()]);
  return out;
}

/** Scompone la chiave "market::selection". */
export function parseMarketKey(key: string): MarketKey {
  const [market, selection] = key.split("::");
  return { market: market as MarketType, selection: selection as SelectionCode };
}

/** Costruisce la chiave da mercato e selezione. */
export function marketKey(market: MarketType, selection: SelectionCode): string {
  return `${market}::${selection}`;
}

/**
 * Numero di bookmaker attivi che quotano abitualmente un mercato.
 * Serve come denominatore onesto per la copertura dati.
 */
export async function getExpectedBookmakerCount(
  market: MarketType,
): Promise<number> {
  const [row] = await db
    .select({ n: raw<number>`count(distinct ${oddsSnapshots.bookmakerId})::int` })
    .from(oddsSnapshots)
    .where(eq(oddsSnapshots.market, market));
  const observed = row?.n ?? 0;

  const [active] = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(bookmakers)
    .where(eq(bookmakers.active, true));

  return Math.max(observed, Math.min(active?.n ?? 0, 8), 1);
}

/** Ultimo prezzo noto per book su una selezione (per la linea di chiusura). */
export async function getLatestPrices(
  matchId: number,
  market: MarketType,
  selection: SelectionCode,
  before?: Date,
): Promise<
  Array<{ bookmakerId: number; price: number; collectedAt: Date; isSharp: boolean }>
> {
  const rows = await db
    .select({
      bookmakerId: oddsSnapshots.bookmakerId,
      price: oddsSnapshots.price,
      collectedAt: oddsSnapshots.collectedAt,
      isSharp: bookmakers.isSharp,
    })
    .from(oddsSnapshots)
    .innerJoin(bookmakers, eq(bookmakers.id, oddsSnapshots.bookmakerId))
    .where(
      and(
        eq(oddsSnapshots.matchId, matchId),
        eq(oddsSnapshots.market, market),
        eq(oddsSnapshots.selection, selection),
      ),
    )
    .orderBy(asc(oddsSnapshots.collectedAt));

  const latest = new Map<
    number,
    { bookmakerId: number; price: number; collectedAt: Date; isSharp: boolean }
  >();
  for (const r of rows) {
    if (before && r.collectedAt.getTime() > before.getTime()) continue;
    const price = num(r.price);
    if (price === null) continue;
    latest.set(r.bookmakerId, {
      bookmakerId: r.bookmakerId,
      price,
      collectedAt: r.collectedAt,
      isSharp: r.isSharp,
    });
  }
  return [...latest.values()];
}

/** Marca come stale gli snapshot più vecchi della soglia rispetto a `now`. */
export function isStaleSnapshot(collectedAt: Date, now: Date): boolean {
  return (now.getTime() - collectedAt.getTime()) / 60000 > STALE_SNAPSHOT_MINUTES;
}

/** Elenco delle coppie (mercato, selezione) osservate per un insieme di partite. */
export async function getObservedMarkets(
  matchIds: number[],
): Promise<Map<number, MarketKey[]>> {
  if (matchIds.length === 0) return new Map();
  const rows = await db
    .selectDistinct({
      matchId: oddsSnapshots.matchId,
      market: oddsSnapshots.market,
      selection: oddsSnapshots.selection,
    })
    .from(oddsSnapshots)
    .where(inArray(oddsSnapshots.matchId, matchIds));

  const out = new Map<number, MarketKey[]>();
  for (const r of rows) {
    const list = out.get(r.matchId) ?? [];
    list.push({ market: r.market, selection: r.selection });
    out.set(r.matchId, list);
  }
  return out;
}
