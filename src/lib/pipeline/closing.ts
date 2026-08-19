/**
 * Pipeline di chiusura: cattura della closing line e calcolo del CLV.
 *
 * La closing line è l'ultimo prezzo osservato prima del calcio d'inizio.
 * È il riferimento con cui l'osservatorio misura sé stesso: un segnale è
 * utile se la quota rilevata era migliore della chiusura.
 *
 * Regole:
 *  - si registra l'ultima osservazione per ogni bookmaker prima del kickoff;
 *  - quando il mercato è COMPLETO per un bookmaker si calcola anche la
 *    chiusura fair senza margine (no-vig, metodo proporzionale): è la base
 *    di confronto preferita per il CLV, perché confronta stima con stima e
 *    non stima con margine;
 *  - se il mercato è incompleto la chiusura fair resta NULL e il CLV usa la
 *    chiusura grezza DICHIARANDOLO nel campo `closingBasis`;
 *  - la cattura NON dipende dall'esistenza di un segnale: ogni partita
 *    monitorata che supera il kickoff lascia la sua chiusura a registro;
 *  - se non ci sono prezzi prima del kickoff si registra un data gap e NON
 *    si calcola alcun CLV: nessun valore inventato.
 */
import { and, eq, gte, lt, isNotNull, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bookmakers,
  closingLines,
  clvRecords,
  dropSignals,
  matches,
  oddsSnapshots,
  signalEvents,
  type MarketType,
  type SelectionCode,
} from "@/db/schema";
import { computeClv } from "@/lib/drop/clv";
import { median, num, round } from "@/lib/drop/math";
import {
  MARKET_SELECTIONS,
  NOVIG_METHOD,
  SCORE_BUCKETS,
  fairMarket,
  scoreBucketOf,
  type ClosingBasis,
  type ScoreBucketKey,
} from "@/lib/drop/novig";
import { recordGap } from "./detect";

/** Finestra all'indietro entro cui una partita passata è ancora chiudibile. */
export const CLOSING_LOOKBACK_HOURS = 72;

export interface ClosingOutcome {
  matchId: number;
  market: MarketType;
  selection: SelectionCode;
  action: "captured" | "already_present" | "no_data";
  closingPrice: number | null;
  /** chiusura depurata dal margine, null se il mercato era incompleto */
  fairClosingPrice: number | null;
  booksUsed: number;
}

export interface ClvOutcome {
  signalId: number;
  matchId: number;
  action: "computed" | "already_present" | "missing_closing" | "missing_detected";
  clvPp: number | null;
  clvPct: number | null;
  beatClose: boolean | null;
  basis: ClosingBasis | null;
}

export interface ClosingSummary {
  matchesProcessed: number;
  linesCaptured: number;
  fairLinesCaptured: number;
  clvComputed: number;
  skipped: number;
  gapsRecorded: number;
  closings: ClosingOutcome[];
  clvs: ClvOutcome[];
  errors: Array<{ matchId: number; message: string }>;
}

/* ------------------------------------------------------------------ */
/* Lettura degli ultimi prezzi prima del kickoff                       */
/* ------------------------------------------------------------------ */

/** Ultimo prezzo osservato per (mercato, bookmaker, selezione) prima del kickoff. */
interface LastPrice {
  price: number;
  at: Date;
}

type PerBook = Map<number, Map<SelectionCode, LastPrice>>;
type PerMarket = Map<MarketType, PerBook>;

/**
 * Ricostruisce l'ultima fotografia del mercato prima del fischio d'inizio.
 * Legge l'intero mercato — non solo la selezione di interesse — perché la
 * rimozione del margine richiede l'insieme completo delle selezioni dello
 * stesso bookmaker.
 */
export async function readPreKickoffPrices(
  matchId: number,
  kickoffAt: Date,
  market?: MarketType,
): Promise<PerMarket> {
  const conditions = [
    eq(oddsSnapshots.matchId, matchId),
    lt(oddsSnapshots.collectedAt, kickoffAt),
  ];
  if (market) conditions.push(eq(oddsSnapshots.market, market));

  const rows = await db
    .select({
      bookmakerId: oddsSnapshots.bookmakerId,
      market: oddsSnapshots.market,
      selection: oddsSnapshots.selection,
      price: oddsSnapshots.price,
      collectedAt: oddsSnapshots.collectedAt,
    })
    .from(oddsSnapshots)
    .where(and(...conditions))
    .orderBy(oddsSnapshots.collectedAt);

  const out: PerMarket = new Map();

  for (const r of rows) {
    const price = num(r.price);
    if (price === null) continue;

    let byBook = out.get(r.market);
    if (!byBook) {
      byBook = new Map();
      out.set(r.market, byBook);
    }
    let bySel = byBook.get(r.bookmakerId);
    if (!bySel) {
      bySel = new Map();
      byBook.set(r.bookmakerId, bySel);
    }
    // le righe sono ordinate per tempo: l'ultima scrittura vince
    bySel.set(r.selection, { price, at: r.collectedAt });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Cattura della closing line                                          */
/* ------------------------------------------------------------------ */

/**
 * Registra la closing line di TUTTE le selezioni osservate di un mercato,
 * per ogni bookmaker, aggiungendo la chiusura fair quando il mercato è
 * completo per quel bookmaker.
 *
 * @returns un esito per ogni selezione toccata
 */
export async function captureClosingForMarket(
  matchId: number,
  kickoffAt: Date,
  market: MarketType,
): Promise<ClosingOutcome[]> {
  const perMarket = await readPreKickoffPrices(matchId, kickoffAt, market);
  const byBook = perMarket.get(market);

  if (!byBook || byBook.size === 0) {
    await recordGap({
      matchId,
      market,
      reason: "provider_unavailable",
      detail: `Nessun prezzo osservato prima del kickoff per il mercato ${market}: closing line non acquisibile.`,
    });
    return MARKET_SELECTIONS[market].map((selection) => ({
      matchId,
      market,
      selection,
      action: "no_data" as const,
      closingPrice: null,
      fairClosingPrice: null,
      booksUsed: 0,
    }));
  }

  /* selezioni già presenti a registro: la chiusura non si riscrive */
  const already = await db
    .select({ selection: closingLines.selection })
    .from(closingLines)
    .where(
      and(eq(closingLines.matchId, matchId), eq(closingLines.market, market)),
    );
  const alreadySet = new Set(already.map((r) => r.selection));

  const touched = new Set<SelectionCode>();
  const rawBySelection = new Map<SelectionCode, number[]>();
  const fairBySelection = new Map<SelectionCode, number[]>();
  let incompleteBooks = 0;

  for (const [bookmakerId, bySel] of byBook) {
    const prices: Partial<Record<SelectionCode, number>> = {};
    for (const [sel, v] of bySel) prices[sel] = v.price;

    const fair = fairMarket({ market, prices });
    if (!fair.ok) incompleteBooks += 1;

    for (const [selection, v] of bySel) {
      touched.add(selection);
      const prob = 1 / v.price;

      const fairPrice = fair.ok ? (fair.data.fairPrices[selection] ?? null) : null;
      const fairProb = fair.ok ? (fair.data.fairProbs[selection] ?? null) : null;

      rawBySelection.set(selection, [
        ...(rawBySelection.get(selection) ?? []),
        v.price,
      ]);
      if (fairPrice !== null) {
        fairBySelection.set(selection, [
          ...(fairBySelection.get(selection) ?? []),
          fairPrice,
        ]);
      }

      if (alreadySet.has(selection)) continue;

      await db
        .insert(closingLines)
        .values({
          matchId,
          bookmakerId,
          market,
          selection,
          closingPrice: v.price.toFixed(3),
          closingProb: prob.toFixed(6),
          fairClosingPrice: fairPrice === null ? null : fairPrice.toFixed(3),
          fairClosingProb: fairProb === null ? null : fairProb.toFixed(6),
          marketMargin: fair.ok ? fair.data.margin.toFixed(4) : null,
          capturedAt: v.at,
          minutesBeforeKickoff: Math.round(
            (kickoffAt.getTime() - v.at.getTime()) / 60000,
          ),
        })
        .onConflictDoNothing();
    }
  }

  /* il margine non rimovibile è un dato mancante, e come tale va dichiarato */
  if (incompleteBooks > 0) {
    await recordGap({
      matchId,
      market,
      reason: "market_not_offered",
      detail: `${incompleteBooks} bookmaker con mercato ${market} incompleto alla chiusura: quota fair senza margine non calcolabile, il CLV userà la chiusura grezza.`,
    });
  }

  return [...touched].map((selection) => ({
    matchId,
    market,
    selection,
    action: alreadySet.has(selection)
      ? ("already_present" as const)
      : ("captured" as const),
    closingPrice: median(rawBySelection.get(selection) ?? []),
    fairClosingPrice: median(fairBySelection.get(selection) ?? []),
    booksUsed: byBook.size,
  }));
}

/**
 * Cattura la closing line di una singola selezione.
 * Conserva la firma storica; internamente lavora sull'intero mercato perché
 * la rimozione del margine non è possibile su una selezione isolata.
 */
export async function captureClosingLine(
  matchId: number,
  kickoffAt: Date,
  market: MarketType,
  selection: SelectionCode,
): Promise<ClosingOutcome> {
  const outcomes = await captureClosingForMarket(matchId, kickoffAt, market);
  const found = outcomes.find((o) => o.selection === selection);
  return (
    found ?? {
      matchId,
      market,
      selection,
      action: "no_data",
      closingPrice: null,
      fairClosingPrice: null,
      booksUsed: 0,
    }
  );
}

/** Prezzo di chiusura di consenso (mediana grezza fra i bookmaker). */
export async function getClosingConsensus(
  matchId: number,
  market: MarketType,
  selection: SelectionCode,
): Promise<number | null> {
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
  return median(rows.map((r) => num(r.closingPrice)));
}

export interface ClosingReference {
  price: number;
  basis: ClosingBasis;
  /** margine mediano rimosso, presente solo con base fair */
  margin: number | null;
  booksUsed: number;
}

/**
 * Riferimento di chiusura da usare per il CLV.
 *
 * Preferisce la chiusura fair senza margine. Se nessun bookmaker aveva il
 * mercato completo ripiega sulla chiusura grezza e lo dichiara, invece di
 * restituire un numero di provenienza ambigua.
 */
export async function getClosingReference(
  matchId: number,
  market: MarketType,
  selection: SelectionCode,
): Promise<ClosingReference | null> {
  const rows = await db
    .select({
      closingPrice: closingLines.closingPrice,
      fairClosingPrice: closingLines.fairClosingPrice,
      marketMargin: closingLines.marketMargin,
    })
    .from(closingLines)
    .where(
      and(
        eq(closingLines.matchId, matchId),
        eq(closingLines.market, market),
        eq(closingLines.selection, selection),
      ),
    );

  if (rows.length === 0) return null;

  const fair = rows
    .map((r) => num(r.fairClosingPrice))
    .filter((v): v is number => v !== null);

  if (fair.length > 0) {
    const margins = rows
      .map((r) => num(r.marketMargin))
      .filter((v): v is number => v !== null);
    const price = median(fair);
    if (price !== null) {
      return {
        price,
        basis: "fair_novig",
        margin: median(margins),
        booksUsed: fair.length,
      };
    }
  }

  const rawPrice = median(rows.map((r) => num(r.closingPrice)));
  if (rawPrice === null) return null;
  return {
    price: rawPrice,
    basis: "raw_consensus",
    margin: null,
    booksUsed: rows.length,
  };
}

/** Prezzo di chiusura della sola linea sharp, se disponibile. */
export async function getSharpClosing(
  matchId: number,
  market: MarketType,
  selection: SelectionCode,
): Promise<number | null> {
  const rows = await db
    .select({ closingPrice: closingLines.closingPrice })
    .from(closingLines)
    .innerJoin(bookmakers, eq(bookmakers.id, closingLines.bookmakerId))
    .where(
      and(
        eq(closingLines.matchId, matchId),
        eq(closingLines.market, market),
        eq(closingLines.selection, selection),
        eq(bookmakers.isSharp, true),
      ),
    );
  return median(rows.map((r) => num(r.closingPrice)));
}

/* ------------------------------------------------------------------ */
/* Calcolo del CLV                                                     */
/* ------------------------------------------------------------------ */

/**
 * Calcola il CLV di un segnale confrontando il prezzo congelato al
 * rilevamento con la chiusura di riferimento (fair se disponibile).
 * È idempotente: l'indice unico su signalId impedisce doppioni.
 */
export async function computeClvForSignal(signalId: number): Promise<ClvOutcome> {
  const [signal] = await db
    .select()
    .from(dropSignals)
    .where(eq(dropSignals.id, signalId))
    .limit(1);

  if (!signal) {
    return {
      signalId,
      matchId: 0,
      action: "missing_detected",
      clvPp: null,
      clvPct: null,
      beatClose: null,
      basis: null,
    };
  }

  const existing = await db
    .select({ id: clvRecords.id })
    .from(clvRecords)
    .where(eq(clvRecords.signalId, signalId))
    .limit(1);

  if (existing.length > 0) {
    return {
      signalId,
      matchId: signal.matchId,
      action: "already_present",
      clvPp: null,
      clvPct: null,
      beatClose: null,
      basis: null,
    };
  }

  const detectedPrice = num(signal.detectedPrice);
  if (detectedPrice === null) {
    return {
      signalId,
      matchId: signal.matchId,
      action: "missing_detected",
      clvPp: null,
      clvPct: null,
      beatClose: null,
      basis: null,
    };
  }

  const reference = await getClosingReference(
    signal.matchId,
    signal.market,
    signal.selection,
  );

  if (reference === null) {
    return {
      signalId,
      matchId: signal.matchId,
      action: "missing_closing",
      clvPp: null,
      clvPct: null,
      beatClose: null,
      basis: null,
    };
  }

  const clv = computeClv({
    signalPrice: detectedPrice,
    closingPrice: reference.price,
  });
  if (!clv) {
    return {
      signalId,
      matchId: signal.matchId,
      action: "missing_closing",
      clvPp: null,
      clvPct: null,
      beatClose: null,
      basis: null,
    };
  }

  await db.insert(clvRecords).values({
    signalId,
    matchId: signal.matchId,
    signalPrice: clv.signalPrice.toFixed(3),
    closingPrice: clv.closingPrice.toFixed(3),
    clvPp: clv.clvPp.toFixed(2),
    clvPct: clv.clvPct.toFixed(3),
    beatClose: clv.beatClose,
    closingBasis: reference.basis,
    marketMargin: reference.margin === null ? null : reference.margin.toFixed(4),
    signalScore: signal.confidenceScore,
  });

  const basisLabel =
    reference.basis === "fair_novig"
      ? `chiusura fair senza margine (${NOVIG_METHOD})`
      : "chiusura grezza di consenso (margine non rimovibile)";

  await db.insert(signalEvents).values({
    signalId,
    kind: "clv_computed",
    note: `CLV ${clv.clvPp > 0 ? "+" : ""}${clv.clvPp} pp: quota rilevata ${clv.signalPrice} contro ${basisLabel} ${clv.closingPrice}.`,
    payload: {
      clvPp: clv.clvPp,
      clvPct: clv.clvPct,
      beatClose: clv.beatClose,
      closingBasis: reference.basis,
      marketMargin: reference.margin,
      booksUsed: reference.booksUsed,
    },
  });

  return {
    signalId,
    matchId: signal.matchId,
    action: "computed",
    clvPp: clv.clvPp,
    clvPct: clv.clvPct,
    beatClose: clv.beatClose,
    basis: reference.basis,
  };
}

/* ------------------------------------------------------------------ */
/* Job completo                                                        */
/* ------------------------------------------------------------------ */

export interface ClosingJobOptions {
  /** quanto indietro guardare per le partite già iniziate */
  lookbackHours?: number;
  /** limita a partite specifiche */
  matchIds?: number[];
}

/**
 * Per ogni partita monitorata il cui kickoff è passato:
 *  1. cattura le closing line di tutti i mercati osservati (anche senza segnali);
 *  2. porta gli eventuali segnali a stato `closed`;
 *  3. calcola il CLV dei segnali con prezzo di rilevamento congelato.
 *
 * La cattura precede il calcolo: senza chiusura non esiste CLV, e senza CLV
 * non si dichiara nulla.
 */
export async function runClosingJob(
  now: Date = new Date(),
  options: ClosingJobOptions = {},
): Promise<ClosingSummary> {
  const lookbackHours = options.lookbackHours ?? CLOSING_LOOKBACK_HOURS;
  const since = new Date(now.getTime() - lookbackHours * 3600_000);

  const summary: ClosingSummary = {
    matchesProcessed: 0,
    linesCaptured: 0,
    fairLinesCaptured: 0,
    clvComputed: 0,
    skipped: 0,
    gapsRecorded: 0,
    closings: [],
    clvs: [],
    errors: [],
  };

  /* --- 1. partite da chiudere: kickoff passato e almeno un'osservazione --- */
  const conditions = [
    lt(matches.kickoffAt, now),
    gte(matches.kickoffAt, since),
  ];

  const candidates = await db
    .selectDistinct({
      matchId: matches.id,
      kickoffAt: matches.kickoffAt,
      market: oddsSnapshots.market,
    })
    .from(matches)
    .innerJoin(oddsSnapshots, eq(oddsSnapshots.matchId, matches.id))
    .where(and(...conditions));

  const filtered = options.matchIds
    ? candidates.filter((c) => options.matchIds!.includes(c.matchId))
    : candidates;

  const seenMatches = new Set<number>();

  for (const c of filtered) {
    try {
      const outcomes = await captureClosingForMarket(
        c.matchId,
        c.kickoffAt,
        c.market,
      );
      for (const o of outcomes) {
        summary.closings.push(o);
        if (o.action === "captured") {
          summary.linesCaptured += 1;
          if (o.fairClosingPrice !== null) summary.fairLinesCaptured += 1;
        }
        if (o.action === "no_data") {
          summary.gapsRecorded += 1;
          summary.skipped += 1;
        }
      }
      seenMatches.add(c.matchId);
    } catch (err) {
      summary.errors.push({
        matchId: c.matchId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /* --- 2. segnali delle partite iniziate: chiusura di stato e CLV --- */
  const signals = await db
    .select({
      signalId: dropSignals.id,
      matchId: dropSignals.matchId,
      status: dropSignals.status,
      kickoffAt: matches.kickoffAt,
    })
    .from(dropSignals)
    .innerJoin(matches, eq(matches.id, dropSignals.matchId))
    .where(and(lt(matches.kickoffAt, now), isNotNull(dropSignals.detectedPrice)));

  for (const s of signals) {
    if (options.matchIds && !options.matchIds.includes(s.matchId)) continue;
    try {
      if (s.status !== "closed") {
        await db
          .update(dropSignals)
          .set({ status: "closed", updatedAt: now })
          .where(eq(dropSignals.id, s.signalId));
        await db.insert(signalEvents).values({
          signalId: s.signalId,
          at: now,
          kind: "closed",
          note: "Partita iniziata: segnale chiuso, si passa alla misura del CLV.",
        });
      }

      const clv = await computeClvForSignal(s.signalId);
      summary.clvs.push(clv);
      if (clv.action === "computed") summary.clvComputed += 1;
      seenMatches.add(s.matchId);
    } catch (err) {
      summary.errors.push({
        matchId: s.matchId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  summary.matchesProcessed = seenMatches.size;
  return summary;
}

/* ------------------------------------------------------------------ */
/* Aggregati                                                           */
/* ------------------------------------------------------------------ */

/** Statistiche CLV aggregate, pronte per la pagina di trasparenza. */
export async function getClvRecordsForAggregate(): Promise<
  Array<{
    signalPrice: number;
    closingPrice: number;
    clvPp: number;
    clvPct: number;
    beatClose: boolean;
    signalProb: number;
    closingProb: number;
    basis: ClosingBasis;
    signalScore: number | null;
  }>
> {
  const rows = await db
    .select({
      signalPrice: clvRecords.signalPrice,
      closingPrice: clvRecords.closingPrice,
      clvPp: clvRecords.clvPp,
      clvPct: clvRecords.clvPct,
      beatClose: clvRecords.beatClose,
      closingBasis: clvRecords.closingBasis,
      signalScore: clvRecords.signalScore,
    })
    .from(clvRecords);

  const out = [];
  for (const r of rows) {
    const sp = num(r.signalPrice);
    const cp = num(r.closingPrice);
    const pp = num(r.clvPp);
    const pct = num(r.clvPct);
    if (sp === null || cp === null || pp === null || pct === null) continue;
    out.push({
      signalPrice: sp,
      closingPrice: cp,
      clvPp: pp,
      clvPct: pct,
      beatClose: r.beatClose,
      signalProb: round(1 / sp, 6),
      closingProb: round(1 / cp, 6),
      basis: (r.closingBasis === "fair_novig"
        ? "fair_novig"
        : "raw_consensus") as ClosingBasis,
      signalScore: num(r.signalScore),
    });
  }
  return out;
}

export interface ClvBucketRow {
  bucket: ScoreBucketKey;
  label: string;
  sampleSize: number;
  beatCloseCount: number;
  beatCloseRate: number | null;
  avgClvPp: number | null;
  /** quanti record del gruppo usano la chiusura fair */
  fairBasisCount: number;
  /** true se il gruppo è troppo piccolo per qualsiasi lettura */
  underpowered: boolean;
  note: string;
}

/** Soglia sotto la quale una fascia non viene commentata. */
export const MIN_SAMPLE_PER_BUCKET = 10;

/**
 * Riepilogo del CLV per fascia dell'indice di fiducia.
 *
 * Serve a verificare l'ipotesi implicita del monitor: se l'indice misura
 * qualcosa, le fasce alte devono mostrare un CLV migliore delle basse.
 * Le fasce vuote sono riportate come vuote: nessuna interpolazione.
 */
export async function summarizeClvByScoreBucket(): Promise<{
  buckets: ClvBucketRow[];
  unclassified: number;
  total: number;
}> {
  const records = await getClvRecordsForAggregate();

  const groups = new Map<ScoreBucketKey, typeof records>();
  let unclassified = 0;

  for (const r of records) {
    if (r.signalScore === null) {
      unclassified += 1;
      continue;
    }
    const key = scoreBucketOf(r.signalScore);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const buckets: ClvBucketRow[] = SCORE_BUCKETS.map((b) => {
    const rows = groups.get(b.key) ?? [];
    const n = rows.length;
    if (n === 0) {
      return {
        bucket: b.key,
        label: b.label,
        sampleSize: 0,
        beatCloseCount: 0,
        beatCloseRate: null,
        avgClvPp: null,
        fairBasisCount: 0,
        underpowered: true,
        note: "Nessun segnale chiuso in questa fascia: niente da riportare.",
      };
    }
    const beat = rows.filter((r) => r.beatClose).length;
    const avg = rows.reduce((a, r) => a + r.clvPp, 0) / n;
    const fair = rows.filter((r) => r.basis === "fair_novig").length;
    const underpowered = n < MIN_SAMPLE_PER_BUCKET;
    return {
      bucket: b.key,
      label: b.label,
      sampleSize: n,
      beatCloseCount: beat,
      beatCloseRate: round(beat / n, 4),
      avgClvPp: round(avg, 2),
      fairBasisCount: fair,
      underpowered,
      note: underpowered
        ? `Solo ${n} osservazioni: valore descrittivo, non una conclusione.`
        : `${beat} segnali su ${n} hanno battuto la chiusura. CLV medio ${avg > 0 ? "+" : ""}${round(avg, 2)} pp.`,
    };
  });

  return { buckets, unclassified, total: records.length };
}

/** Conteggio delle partite monitorate che devono ancora chiudere. */
export async function pendingClosings(
  now: Date = new Date(),
): Promise<Array<{ matchId: number; key: string; kickoffAt: Date }>> {
  const rows = await db
    .selectDistinct({
      matchId: matches.id,
      key: matches.key,
      kickoffAt: matches.kickoffAt,
    })
    .from(matches)
    .innerJoin(oddsSnapshots, eq(oddsSnapshots.matchId, matches.id))
    .where(
      and(
        gte(matches.kickoffAt, now),
        raw`${matches.key} not like 'demo-%'`,
      ),
    )
    .orderBy(matches.kickoffAt);

  return rows;
}
