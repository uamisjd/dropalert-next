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
import { isConsensusBookmakerKey } from "@/lib/decision/price-evidence";
import { PRODUCTION_SNAPSHOT_SOURCES } from "@/lib/providers/snapshot-sources";

/**
 * Interruttore: quando `true`, la riga di consenso (es. `betexplorer-consensus`)
 * viene marcata `isConsensus` e il motore la ESCLUDE da mediana di consenso e
 * coordinazione (correzione §4.7). Default `false` per non cambiare i segnali
 * esistenti finché non c'è una fonte per-bookmaker reale a fianco del consenso.
 * Va attivato SOLO dopo uno smoke test live riuscito del cablaggio.
 */
const EXCLUDE_CONSENSUS_BOOKS = process.env.DROP_EXCLUDE_CONSENSUS_BOOKS === "true";

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
        /* il flag decide se la riga di consenso va distinta dai book reali */
        isConsensus: EXCLUDE_CONSENSUS_BOOKS
          ? isConsensusBookmakerKey(r.bookmakerKey)
          : undefined,
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
 * Numero di bookmaker che quotano abitualmente un mercato.
 * Serve come denominatore onesto per la copertura dati.
 *
 * Conta SOLO le righe di produzione (`PRODUCTION_SNAPSHOT_SOURCES`): le righe
 * scritte dagli smoke test restano in archivio come prova della verifica, ma
 * non devono spostare questo denominatore — altrimenti ogni smoke deprimerebbe
 * copertura e punteggi di tutti i segnali (trovato 11/09/2026: denominatore
 * 1x2 salito a 25 per le righe degli smoke, copertura a 0,418 invece di 0,85).
 */
export async function getExpectedBookmakerCount(
  market: MarketType,
): Promise<number> {
  const [row] = await db
    .select({ n: raw<number>`count(distinct ${oddsSnapshots.bookmakerId})::int` })
    .from(oddsSnapshots)
    .where(
      and(
        eq(oddsSnapshots.market, market),
        inArray(oddsSnapshots.source, PRODUCTION_SNAPSHOT_SOURCES),
      ),
    );
  const observed = row?.n ?? 0;

  /* Book attivi che hanno almeno una riga di produzione sul mercato: un libro
     creato da uno smoke (attivo ma senza righe di produzione) non conta. */
  const [active] = await db
    .select({ n: raw<number>`count(distinct ${bookmakers.id})::int` })
    .from(bookmakers)
    .innerJoin(
      oddsSnapshots,
      and(
        eq(oddsSnapshots.bookmakerId, bookmakers.id),
        eq(oddsSnapshots.market, market),
        inArray(oddsSnapshots.source, PRODUCTION_SNAPSHOT_SOURCES),
      ),
    )
    .where(eq(bookmakers.active, true));

  return Math.max(observed, Math.min(active?.n ?? 0, 8), 1);
}

/**
 * true se esiste almeno un libro sharp con righe di produzione sul mercato.
 * Serve al tetto dell'indice: la conferma sharp è misurabile solo se una
 * linea sharp di produzione esiste davvero (le righe degli smoke non contano).
 */
export async function hasSharpProductionBook(
  market: MarketType,
): Promise<boolean> {
  const rows = await db
    .select({ id: bookmakers.id })
    .from(bookmakers)
    .innerJoin(
      oddsSnapshots,
      and(
        eq(oddsSnapshots.bookmakerId, bookmakers.id),
        eq(oddsSnapshots.market, market),
        inArray(oddsSnapshots.source, PRODUCTION_SNAPSHOT_SOURCES),
      ),
    )
    .where(and(eq(bookmakers.active, true), eq(bookmakers.isSharp, true)))
    .limit(1);
  return rows.length > 0;
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
