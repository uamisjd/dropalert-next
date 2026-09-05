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
 *  - Nessun sizing: niente Kelly in euro e niente "puntata consigliata" — il divario
 *    è una misura, non un ordine di esecuzione. La Kelly come calcolatrice con numeri
 *    inseriti a mano vive in `/strumenti`.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
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
   * È un testo generico fisso: il dettaglio grezzo (driver SQL incluso) resta nel log
   * del server e non raggiunge mai l'HTML.
   */
  error: string | null;
  generatedAt: Date;
}

/** Finestra di lettura delle linee: più vecchia di così è un'altra fotografia. */
const LINE_WINDOW_HOURS = 12;

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
export interface LineRow {
  matchId: number;
  bookmakerId: number;
  market: MarketType;
  selection: SelectionCode;
  price: string | number;
  collectedAt: Date | string;
  source: string;
}

/**
 * Raggruppa le letture in linee candidate: una riga per
 * (partita, mercato, bookmaker), con le sole selezioni rilevate ALLO STESSO ISTANTE.
 *
 * La regola è verificata sui dati, non assunta: il collettore scrive le tre colonne
 * della stessa riga d'elenco con lo stesso `observedAt` (`toQuoteDTOs`, un solo
 * `fetchedAt` per giro) e il salto di stabilità è per partita, non per selezione —
 * quindi o si scrive la terna intera o non si scrive niente. `npm run
 * test:line-shape` lo blocca sull'HTML reale congelato dell'18/08.
 *
 * In generale:
 * mescolare selezioni lette a minuti diversi darebbe un margine che nessuno ha mai
 * offerto. La lettura più recente vince e non eredita nulla dalla precedente: se è
 * arrivata a metà, la linea resta a metà e il divario non viene calcolato.
 *
 * Input ordinato come viene dalla banca dati (non è richiesto: l'ordine è ricostruito).
 */
export function groupLatestLines(rows: LineRow[]): Map<string, LineReading[]> {
  const newest = new Map<string, LineReading>();
  for (const r of rows) {
    const key = `${r.matchId}|${r.market}|${r.bookmakerId}`;
    const at = new Date(r.collectedAt);
    const price = Number(r.price);
    const cur = newest.get(key);
    if (!cur) {
      newest.set(key, {
        bookmakerId: r.bookmakerId,
        collectedAt: at,
        source: r.source,
        prices: { [r.selection]: price },
      });
      continue;
    }
    if (at.getTime() > cur.collectedAt.getTime()) {
      cur.collectedAt = at;
      cur.source = r.source;
      cur.prices = { [r.selection]: price };
    } else if (at.getTime() === cur.collectedAt.getTime()) {
      cur.prices[r.selection] = price;
    }
  }

  const byMarket = new Map<string, LineReading[]>();
  for (const [key, reading] of newest) {
    const marketKey = key.slice(0, key.lastIndexOf("|"));
    const list = byMarket.get(marketKey) ?? [];
    list.push(reading);
    byMarket.set(marketKey, list);
  }
  return byMarket;
}

/**
 * Letture delle linee, in due passi — e il secondo è il motivo per cui non si può
 * fare in uno solo.
 *
 * Passo 1: per ogni (partita, mercato, bookmaker) l'istante più recente entro la
 * finestra. Passo 2: le sole righe di quegli istanti. Una query unica con `limit`
 * globale, ordinata per tempo, avrebbe affamato le partite con molte letture (una
 * partita monitorata ogni cinque minuti produce ~430 righe in 12 ore per mercato:
 * il tetto se le sarebbe mangiate tutte, e le altre partite avrebbero risultato
 * "nessuna linea" per un motivo che non sta nei dati).
 *
 * Le letture marcate `isStale` dalla fonte restano fuori: sono quote arrivate
 * più vecchie della soglia, e una linea mezza vecchia non è una linea.
 */
/**
 * Un istante letto da un aggregato (`max(collected_at)`) arriva dal driver come **testo**,
 * non come `Date`: passedalo a `inArray` così com'è e il serializzatore di Postgres chiama
 * `.toISOString()` su una stringa e la pagina esplode. Normalizzare qui, con un solo punto
 * di verità: `null` se il testo non è interpretabile, così la riga viene scartata invece di
 * produrre un'età falsa.
 */
export function toInstant(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const text = typeof v === "string" ? v.trim() : v;
  if (typeof text === "string" && text === "") return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function loadLines(
  matchIds: number[],
  since: Date,
): Promise<Map<string, LineReading[]>> {
  const groups = await db
    .select({
      matchId: oddsSnapshots.matchId,
      market: oddsSnapshots.market,
      bookmakerId: oddsSnapshots.bookmakerId,
      newestAt: sql<Date>`max(${oddsSnapshots.collectedAt})`,
    })
    .from(oddsSnapshots)
    .where(
      and(
        inArray(oddsSnapshots.matchId, matchIds),
        gte(oddsSnapshots.collectedAt, since),
        eq(oddsSnapshots.isStale, false),
      ),
    )
    .groupBy(
      oddsSnapshots.matchId,
      oddsSnapshots.market,
      oddsSnapshots.bookmakerId,
    );

  if (groups.length === 0) return new Map();

  // Gli istanti escono dagli aggregati come testo: vanno riportati a `Date` prima di
  // usarli come parametri (vedi `toInstant`).
  const instants = [
    ...new Set(
      groups
        .map((g) => toInstant(g.newestAt))
        .filter((d): d is Date => d !== null)
        .map((d) => d.getTime()),
    ),
  ].map((t) => new Date(t));
  if (instants.length === 0) return new Map();
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
      and(
        inArray(oddsSnapshots.matchId, matchIds),
        inArray(oddsSnapshots.collectedAt, instants),
      ),
    )
    .orderBy(desc(oddsSnapshots.collectedAt));

  return groupLatestLines(rows as LineRow[]);
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
    // una lettura mancante si dichiara, non si camuffa da «nessuna occasione».
    // Il dettaglio grezzo resta nel log del server: alla pagina arriva solo un
    // testo generico, mai il messaggio del driver SQL.
    console.error("[value-bets] lettura dei divari non riuscita:", err);
    return {
      opportunities: [],
      signalsRead: 0,
      withPositiveEdge: 0,
      skipped,
      method: NOVIG_METHOD,
      averageEdgePct: 0,
      dataNote: "lettura dei dati non riuscita: questa pagina non ha numeri da mostrare",
      error: "lettura non riuscita (dettaglio nel log del server)",
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
      league: s.league ?? "Competizione non attribuita",
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
