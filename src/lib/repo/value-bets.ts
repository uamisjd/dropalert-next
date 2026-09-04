/**
 * Divario di prezzo: ultima lettura del consenso contro linea senza margine (no-vig).
 *
 * Che cosa misura. Per ogni segnale ANCORA giocabile — kickoff nel futuro, partita non
 * ancora chiusa a registro — confronta l'ultima lettura del consenso con la linea
 * senza margine dello STESSO bookmaker sullo STESSO mercato, calcolata da
 * `fairMarket` (`src/lib/drop/novig.ts`): è lo stesso identico metodo (no-vig
 * proporzionale) con cui nasce la `fairClosingPrice` del CLV, così le due misure sono
 * comparabili invece che due scale diverse.
 *
 * Che cosa NON fa, e perché.
 *  - Non costruisce quote sharp: con `perBookmakerOdds` spento la linea di un secondo
 *    operatore non esiste, quindi non esiste un "fair di mercato" — esiste il margine
 *    rimosso dalla linea che abbiamo (audit: `docs/STUDIO-VALUE-BETS.md` §2.4).
 *  - Non valuta il prezzo di APERTURA come fosse un'offerta: l'apertura non è più
 *    acquistabile, quindi l'edge si calcola SOLO sul prezzo eseguibile, quello
 *    corrente. Il calo dall'apertura resta in `dropPct`, con il suo nome.
 *  - Nessun pavimento a +0,5% e nessun valore di ripiego: un divario negativo è un
 *    divario negativo, e un mercato senza terna completa non viene elencato — viene
 *    contato in `skipped`, che la pagina mostra.
 *  - Nessun sizing: niente Kelly in euro e niente "puntata consigliata" (regola del
 *    progetto: nessuna selezione da eseguire). La Kelly come calcolatrice con numeri
 *    inseriti a mano vive in `/strumenti`.
 */
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, oddsSnapshots, type MarketType, type SelectionCode } from "@/db/schema";
import { NOVIG_METHOD } from "../drop/novig";
import { isValidPrice, round } from "../drop/math";
import { computeValueGap } from "../quant/value-gap";
import type { ValueOpportunity } from "../quant/types";
import { getDashboardData, type DashboardFilters } from "./dashboard";

export interface ValueBetFilters extends DashboardFilters {
  /** tiene solo i segnali con divario sopra questa soglia, in punti percentuali */
  minEdge?: number;
  minOdds?: number;
  maxOdds?: number;
  onlySharpConfirmed?: boolean;
}

/** Una lettura di linea: tutte le selezioni rilevate insieme da un bookmaker. */
interface LineReading {
  bookmakerId: number;
  collectedAt: Date;
  source: string;
  prices: Partial<Record<SelectionCode, number>>;
}

export interface ValueScannerResult {
  opportunities: ValueOpportunity[];
  /**
   * Quanti segnali l'elenco del dashboard ne ha prodotti, PRIMA di ogni filtro:
   * è il denominale onesto di `opportunities.length`, non un conteggio di occasioni.
   */
  signalsRead: number;
  withPositiveEdge: number;
  skipped: {
    kickoffPassed: number;
    notPlayable: number;
    noCurrentPrice: number;
    noLine: number;
    incompleteLine: number;
  };
  /** metodo di rimozione del margine effettivamente usato */
  method: typeof NOVIG_METHOD;
  /** media dei divari elencati, in punti percentuali (può essere negativa) */
  averageEdgePct: number;
  /** riga di stato per la pagina: nessun numero qui dentro è una stima */
  dataNote: string;
  /**
   * Motivo di una lettura fallita, mostrato dalla pagina invece di sparire dietro una
   * lista vuota: `opportunities.length === 0` con `error === null` significa "niente da
   * misurare", con `error` valorizzata significa "non abbiamo potuto leggere".
   */
  error: string | null;
  generatedAt: Date;
}

/** Finestra di lettura delle linee: più vecchia di così è un'altra fotografia. */
const LINE_WINDOW_HOURS = 12;
/** tetto di righe lette da `odds_snapshots` per passata di scansione */
const LINE_ROW_CAP = 4000;

const EMPTY: ValueScannerResult["skipped"] = {
  kickoffPassed: 0,
  notPlayable: 0,
  noCurrentPrice: 0,
  noLine: 0,
  incompleteLine: 0,
};

/**
 * Linee più recenti per (partita, mercato, bookmaker).
 *
 * La linea è il gruppo di selezioni rilevate ALLO STESSO ISTANTE dallo STESSO
 * bookmaker: mescolare letture di momenti diversi darebbe un margine inventato.
 */
async function loadLines(
  matchIds: number[],
  since: Date,
): Promise<Map<string, LineReading[]>> {
  const byMarket = new Map<string, LineReading[]>();
  if (matchIds.length === 0) return byMarket;

  const rows = await db
    .select({
      matchId: oddsSnapshots.matchId,
      bookmakerId: oddsSnapshots.bookmakerId,
      market: oddsSnapshots.market,
      selection: oddsSnapshots.selection,
      price: oddsSnapshots.price,
      collectedAt: oddsSnapshots.collectedAt,
      source: oddsSnapshots.source,
    })
    .from(oddsSnapshots)
    .where(
      and(inArray(oddsSnapshots.matchId, matchIds), gte(oddsSnapshots.collectedAt, since)),
    )
    .orderBy(desc(oddsSnapshots.collectedAt))
    .limit(LINE_ROW_CAP);

  /** chiave (partita, mercato, bookmaker) → lettura più recente vista */
  const newest = new Map<string, LineReading>();
  for (const r of rows) {
    const key = `${r.matchId}|${r.market}|${r.bookmakerId}`;
    const at = new Date(r.collectedAt);
    const cur = newest.get(key);
    if (!cur) {
      newest.set(key, {
        bookmakerId: r.bookmakerId,
        collectedAt: at,
        source: r.source,
        prices: { [r.selection]: Number(r.price) },
      });
      continue;
    }
    if (at.getTime() > cur.collectedAt.getTime()) {
      // lettura più recente: la precedente non rappresenta più "il presente"
      cur.collectedAt = at;
      cur.source = r.source;
      cur.prices = { [r.selection]: Number(r.price) };
    } else if (at.getTime() === cur.collectedAt.getTime()) {
      // stesso istante: completa la terna
      cur.prices[r.selection] = Number(r.price);
    }
  }

  for (const [key, reading] of newest) {
    const marketKey = key.slice(0, key.lastIndexOf("|"));
    const list = byMarket.get(marketKey) ?? [];
    list.push(reading);
    byMarket.set(marketKey, list);
  }
  return byMarket;
}

/**
 * Le sole partite su cui ha senso una lettura pre-gara: `scheduled` e senza verdetto a
 * registro. Tutto il resto (già giocate, rinviate, concluse) non è materia di questo
 * monitor: le partite finite stanno in `/ieri`, con il loro CLV.
 */
async function loadPlayableMatchIds(matchIds: number[]): Promise<Set<number>> {
  if (matchIds.length === 0) return new Set();
  const rows = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        inArray(matches.id, matchIds),
        eq(matches.status, "scheduled"),
        isNull(matches.settledAt),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

export async function getValueOpportunities(
  filters: ValueBetFilters = {},
  now: Date = new Date(),
): Promise<ValueScannerResult> {
  const skipped = { ...EMPTY };
  try {
    return await scanValueGaps(filters, now, skipped);
  } catch (err) {
    // una lettura mancante si dichiara, non si camuffa da «nessuna occasione»
    return {
      opportunities: [],
      signalsRead: 0,
      withPositiveEdge: 0,
      skipped,
      method: NOVIG_METHOD,
      averageEdgePct: 0,
      dataNote: "lettura dei dati non riuscita: questa pagina non ha numeri da mostrare",
      error: err instanceof Error ? err.message : String(err),
      generatedAt: now,
    };
  }
}

async function scanValueGaps(
  filters: ValueBetFilters,
  now: Date,
  skipped: ValueScannerResult["skipped"],
): Promise<ValueScannerResult> {
  const empty: ValueScannerResult = {
    opportunities: [],
    signalsRead: 0,
    withPositiveEdge: 0,
    skipped,
    method: NOVIG_METHOD,
    averageEdgePct: 0,
    dataNote: "nessun segnale letto dall'elenco",
    error: null,
    generatedAt: now,
  };

  const dashboard = await getDashboardData(filters, now);
  const signals = dashboard.signals;
  if (signals.length === 0) return empty;

  const candidates = signals.filter((s) => {
    const kickoff = new Date(s.kickoffAt).getTime();
    if (Number.isNaN(kickoff) || kickoff <= now.getTime()) {
      skipped.kickoffPassed += 1;
      return false;
    }
    if (!s.currentPrice || !isValidPrice(s.currentPrice) || s.currentPrice <= 1.01) {
      skipped.noCurrentPrice += 1;
      return false;
    }
    return true;
  });
  if (candidates.length === 0) {
    return {
      ...empty,
      signalsRead: signals.length,
      dataNote: `tutti i ${signals.length} segnali letti hanno il kickoff già passato o nessuna lettura di prezzo`,
    };
  }

  const matchIds = [...new Set(candidates.map((s) => s.matchId))];
  const since = new Date(now.getTime() - LINE_WINDOW_HOURS * 3600_000);
  const [lines, playableIds] = await Promise.all([
    loadLines(matchIds, since),
    loadPlayableMatchIds(matchIds),
  ]);

  const opportunities: ValueOpportunity[] = [];
  let booksWithCompleteLine = 0;

  for (const s of candidates) {
    if (!playableIds.has(s.matchId)) {
      skipped.notPlayable += 1;
      continue;
    }
    const market = s.market as MarketType;
    const readings = lines.get(`${s.matchId}|${market}`) ?? [];
    if (readings.length === 0) {
      skipped.noLine += 1;
      continue;
    }

    /* la linea completa più recente fra i bookmaker letti su questo mercato */
    const scored = readings
      .map((reading) => ({
        reading,
        gap: computeValueGap({
          market,
          selection: s.selection as SelectionCode,
          currentPrice: s.currentPrice!,
          line: reading.prices,
        }),
      }))
      .sort((a, b) => b.reading.collectedAt.getTime() - a.reading.collectedAt.getTime());
    const usable = scored.filter((x) => x.gap.ok);
    if (usable.length === 0) {
      skipped.incompleteLine += 1;
      continue;
    }

    const { reading, gap } = usable[0];
    if (!gap.ok) continue; // ridondante per il compilatore, non per chi legge
    booksWithCompleteLine = Math.max(booksWithCompleteLine, usable.length);

    const ageMinutes =
      s.ageMinutes ?? Math.round((now.getTime() - reading.collectedAt.getTime()) / 60_000);

    opportunities.push({
      id: s.id,
      matchId: s.matchId,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      league: s.league ?? "Competizione non specificata",
      kickoffAt: new Date(s.kickoffAt),
      market,
      selection: s.selection,
      selectionLabel: s.selectionLabel,
      currentOdds: round(s.currentPrice!, 3),
      openingOdds: s.openingPrice ? round(s.openingPrice, 3) : undefined,
      fairOdds: gap.fairOdds,
      lineMarginPct: gap.marginPct,
      booksWithLine: usable.length,
      trueProbPct: round(gap.fairProb * 100, 2),
      impliedProbPct: round((1 / s.currentPrice!) * 100, 2),
      /* nessun pavimento: il divario si mostra com'è, anche sotto zero */
      edgePct: gap.edgePct,
      expectedValue: gap.expectedValue,
      dropPct: s.dropPct,
      lineAgeMinutes: Number.isFinite(ageMinutes) ? ageMinutes : null,
      lineSource: reading.source,
      sharpConfirmed: s.sharpConfirms === true,
      status: "upcoming",
    });
  }

  let filtered = opportunities;
  if (filters.minEdge !== undefined) {
    filtered = filtered.filter((o) => o.edgePct >= filters.minEdge!);
  }
  if (filters.minOdds !== undefined) {
    filtered = filtered.filter((o) => o.currentOdds >= filters.minOdds!);
  }
  if (filters.maxOdds !== undefined) {
    filtered = filtered.filter((o) => o.currentOdds <= filters.maxOdds!);
  }
  if (filters.onlySharpConfirmed) {
    filtered = filtered.filter((o) => o.sharpConfirmed);
  }

  filtered.sort((a, b) => b.edgePct - a.edgePct);
  const withPositiveEdge = filtered.filter((o) => o.edgePct > 0).length;
  const avgEdge =
    filtered.length > 0
      ? round(
          filtered.reduce((acc, o) => acc + o.edgePct, 0) / filtered.length,
          2,
        )
      : 0;

  const reasons = [
    skipped.kickoffPassed > 0 ? `${skipped.kickoffPassed} già al kickoff` : null,
    skipped.notPlayable > 0 ? `${skipped.notPlayable} non più giocabili (esito a registro, rinviate o chiuse)` : null,
    skipped.incompleteLine > 0
      ? `${skipped.incompleteLine} senza terna completa (no-vig non calcolabile)`
      : null,
    skipped.noLine > 0 ? `${skipped.noLine} senza lettura della linea` : null,
    skipped.noCurrentPrice > 0 ? `${skipped.noCurrentPrice} senza prezzo corrente` : null,
  ].filter((x): x is string => x !== null);

  return {
    opportunities: filtered,
    signalsRead: signals.length,
    withPositiveEdge,
    skipped,
    method: NOVIG_METHOD,
    averageEdgePct: avgEdge,
    error: null,
    dataNote:
      `divario calcolato sul prezzo eseguibile con no-vig proporzionale; ` +
      `linea completa da ${booksWithCompleteLine} ` +
      `bookmaker${booksWithCompleteLine === 1 ? "" : "i"}` +
      (reasons.length > 0 ? ` · scartati: ${reasons.join(", ")}` : ""),
    generatedAt: now,
  };
}
