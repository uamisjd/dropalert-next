/**
 * Lettura della linea sharp da The Odds API (Sprint G).
 *
 * Una sola chiamata per partita, e solo quando il budget la concede: le
 * regole stanno tutte in `odds-api-budget.ts` e qui non si aggirano.
 *
 * Cosa chiediamo: le quote 1X2 (`h2h`) dei soli bookmaker sharp, in formato
 * decimale. Non chiediamo mercati che non usiamo e non chiediamo interi
 * campionati: ogni credito speso deve corrispondere a un segnale attivo.
 *
 * Cosa NON facciamo: sostituire il collector o spacciare una quota sharp per
 * un ordine eseguibile. Le quote di consenso restano quelle di BetExplorer;
 * questa fonte aggiunge una fotografia indipendente, la dispersione e — solo
 * quando la linea è completa — una fair di riferimento sharp.
 */
import { fairMarket } from "@/lib/drop/novig";
import type { MarketType, SelectionCode } from "@/db/schema";
import {
  bookSpread,
  extractBookLines,
  isSharpBookmaker,
  type BookLine,
  type TheOddsApiEvent,
} from "./the-odds-api-odds";
import {
  SHARP_BOOKS,
  readOddsApiKey,
  sharpVerdict,
  type SharpVerdict,
} from "./odds-api-budget";

const ENDPOINT = "https://api.the-odds-api.com/v4/sports";
/* La risposta contiene tutti i book della regione, non più tre: il timeout è
   un po' più largo per non trasformare un payload più ricco in un errore. */
const TIMEOUT_MS = 12_000;

/** Dispersione misurata fra i prezzi di più book. `null` se non misurabile. */
export type SpreadView = {
  count: number;
  min: number;
  max: number;
  spread: number;
};

/** Prezzo di un singolo bookmaker nella stessa lettura (nessun credito in più). */
export interface SharpBookLine {
  key: string;
  price: number;
  isSharp: boolean;
}

/** Linea completa di un bookmaker, conservata senza mescolare istanti diversi. */
export interface SharpCompleteLine {
  bookmakerKey: string;
  isSharp: boolean;
  market: MarketType;
  prices: Partial<Record<SelectionCode, number>>;
  observedAt: string;
}

/** Fair no-vig derivata da una linea sharp completa, non dal consenso. */
export interface IndependentSharpFair {
  sourceBook: string;
  market: MarketType;
  fairProbabilities: Partial<Record<SelectionCode, number>>;
  fairOdds: Partial<Record<SelectionCode, number>>;
  marginPct: number;
  observedAt: string;
}

/** Fotografia della linea sharp per una partita. */
export interface SharpSnapshot {
  /** bookmaker che ha fornito il prezzo, null se nessuno */
  book: string | null;
  /** prezzo decimale della selezione osservata */
  price: number | null;
  verdict: SharpVerdict;
  /**
   * Tutti i bookmaker che hanno quotato la selezione osservata, dalla stessa
   * risposta. Serve a mostrare la dispersione fra i book sharp invece di un
   * solo prezzo preso come se fosse «la» linea: con un unico numero non si
   * distingue una linea condivisa da un'opinione isolata.
   */
  books: SharpBookLine[];
  /** dispersione fra i soli book sharp; `null` se c'è meno di un confronto */
  spread: SpreadView | null;
  /** dispersione fra tutti i book della regione che quotano la selezione */
  marketSpread: SpreadView | null;
  /** crediti residui dichiarati dal provider, quando li espone */
  remainingFromProvider: number | null;
  /** mercato della selezione richiesta, se riconosciuto */
  market: MarketType | null;
  /** linee complete per bookmaker presenti nella stessa risposta */
  completeLines: SharpCompleteLine[];
  /** fair indipendente dalla prima linea sharp completa disponibile */
  independentFair: IndependentSharpFair | null;
  readAt: string;
}

interface ApiOutcome {
  name?: unknown;
  price?: unknown;
}
interface ApiMarket {
  key?: unknown;
  point?: unknown;
  outcomes?: unknown;
}
interface ApiBookmaker {
  key?: unknown;
  markets?: unknown;
}
interface ApiEvent {
  id?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  commence_time?: unknown;
  bookmakers?: unknown;
}

/** Nome normalizzato per il confronto fra squadre di fonti diverse. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Token normalizzati di un nome squadra: minuscolo, senza accenti, a parole. */
function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((token) => token !== ""),
  );
}

/**
 * Due nomi di squadra combaciano per la lettura?
 *
 * Regola DOPPIA, per costruzione conservativa:
 *  1. sottostringa sulla forma unita (regola storica): «Inter» sta in
 *     «Internazionale», «Milan» sta in «AC Milan»;
 *  2. token contenuti in un senso o nell'altro: {academico, viseu} sta in
 *     {academico, de, viseu}.
 *
 * La seconda manca alla prima nel caso delle particelle e dei suffissi
 * societari: il 06/09/2026 la lettura di controllo ha pagato un credito su
 * Gil Vicente — «Academico Viseu» (archivio) senza trovare l'evento perché
 * la fonte chiama la squadra «Academico de Viseu» — la forma unita
 * «academicodeviseu» non contiene «academicoviseu», ma i token significativi
 * sono gli stessi. Un token davvero diverso (guimaraes vs sc) non combacia:
 * quello è un caso per l'override esplicito, non per l'automatismo.
 */
export function teamNameMatches(internal: string, source: string): boolean {
  const ni = norm(internal);
  const ns = norm(source);
  if (ni === "" || ns === "") return false;
  if (ns.includes(ni) || ni.includes(ns)) return true;
  const ti = nameTokens(internal);
  const ts = nameTokens(source);
  if (ti.size === 0 || ts.size === 0) return false;
  const iInS = [...ti].every((token) => ts.has(token));
  const sInI = [...ts].every((token) => ti.has(token));
  return iInS || sInI;
}

/** Differenza massima accettata fra kickoff interno e timestamp del provider. */
export const EVENT_TIME_TOLERANCE_MINUTES = 30;

/**
 * Trova l'evento solo quando l'identità è sufficientemente determinata.
 *
 * I nomi normalizzati sono un primo filtro, non una licenza a prendere il primo
 * risultato. Quando il kickoff interno è disponibile deve esistere anche il
 * kickoff del provider entro la tolleranza; più corrispondenze o un timestamp
 * mancante producono `null`.
 */
export function findEvent(
  events: unknown,
  homeTeam: string,
  awayTeam: string,
  kickoffAt: Date | null = null,
): ApiEvent | null {
  if (!Array.isArray(events)) return null;
  if (norm(homeTeam) === "" || norm(awayTeam) === "") return null;

  const candidates: ApiEvent[] = [];
  for (const e of events) {
    if (typeof e !== "object" || e === null) continue;
    const ev = e as ApiEvent;
    const eh = typeof ev.home_team === "string" ? ev.home_team : "";
    const ea = typeof ev.away_team === "string" ? ev.away_team : "";
    const namesMatch = teamNameMatches(homeTeam, eh) && teamNameMatches(awayTeam, ea);
    if (!namesMatch) continue;

    if (kickoffAt !== null) {
      const providerKickoff =
        typeof ev.commence_time === "string" ? new Date(ev.commence_time) : null;
      if (
        providerKickoff === null ||
        Number.isNaN(providerKickoff.getTime()) ||
        Math.abs(providerKickoff.getTime() - kickoffAt.getTime()) >
          EVENT_TIME_TOLERANCE_MINUTES * 60_000
      ) {
        continue;
      }
    }
    candidates.push(ev);
  }

  return candidates.length === 1 ? candidates[0] : null;
}

/** Selezione interna → nome dell'esito nell'API. */
function outcomeNameFor(
  market: MarketType,
  selection: string,
  homeTeam: string,
  awayTeam: string,
): string {
  if (market === "ou_2_5") return selection === "over" ? "Over" : "Under";
  if (selection === "home") return homeTeam;
  if (selection === "away") return awayTeam;
  return "Draw";
}

function marketForSelection(selection: string): MarketType | null {
  if (selection === "home" || selection === "draw" || selection === "away") return "1x2";
  if (selection === "over" || selection === "under") return "ou_2_5";
  return null;
}

function expectedSelections(market: MarketType): SelectionCode[] {
  return market === "1x2" ? ["home", "draw", "away"] : ["over", "under"];
}

/**
 * Estrae il prezzo sharp dall'evento: il primo bookmaker della lista di
 * preferenza che espone davvero la selezione. Puro e testabile.
 */
export function extractSharpPrice(
  event: ApiEvent | null,
  selection: string,
  homeTeam: string,
  awayTeam: string,
  market: MarketType = "1x2",
): { book: string | null; price: number | null } {
  if (event === null || !Array.isArray(event.bookmakers)) {
    return { book: null, price: null };
  }
  const wanted = norm(outcomeNameFor(market, selection, homeTeam, awayTeam));
  const marketKey = market === "1x2" ? "h2h" : "totals";
  for (const key of SHARP_BOOKS) {
    for (const b of event.bookmakers as ApiBookmaker[]) {
      if (typeof b !== "object" || b === null || b.key !== key) continue;
      if (!Array.isArray(b.markets)) continue;
      for (const m of b.markets as ApiMarket[]) {
        if (m.key !== marketKey || !Array.isArray(m.outcomes)) continue;
        if (market === "ou_2_5" && m.point !== 2.5) continue;
        for (const o of m.outcomes as ApiOutcome[]) {
          if (typeof o.name !== "string" || typeof o.price !== "number") continue;
          const n = norm(o.name);
          if (n === wanted || n.includes(wanted) || wanted.includes(n)) {
            return { book: key, price: o.price };
          }
        }
      }
    }
  }
  return { book: null, price: null };
}

/**
 * Raggruppa le righe della risposta per bookmaker e conserva solo mercati
 * completi, senza ereditare selezioni da un altro istante. Una fair derivata
 * da due timestamp diversi sarebbe una fair costruita, quindi viene scartata.
 */
export function completeSharpLines(
  lines: BookLine[],
  market: MarketType,
): SharpCompleteLine[] {
  const expected = expectedSelections(market);
  const byBook = new Map<string, BookLine[]>();
  for (const line of lines) {
    if (line.market !== market) continue;
    const list = byBook.get(line.bookmakerKey) ?? [];
    list.push(line);
    byBook.set(line.bookmakerKey, list);
  }

  const complete: SharpCompleteLine[] = [];
  for (const [bookmakerKey, bookLines] of byBook) {
    const prices: Partial<Record<SelectionCode, number>> = {};
    const timestamps = new Set<number>();
    let duplicate = false;
    for (const line of bookLines) {
      if (prices[line.selection] !== undefined) duplicate = true;
      prices[line.selection] = line.price;
      timestamps.add(line.observedAt.getTime());
    }
    if (
      duplicate ||
      expected.some((selection) => prices[selection] === undefined) ||
      timestamps.size !== 1
    ) {
      continue;
    }
    complete.push({
      bookmakerKey,
      isSharp: bookLines[0]?.isSharp === true,
      market,
      prices,
      observedAt: new Date([...timestamps][0]).toISOString(),
    });
  }
  return complete;
}

/** Seleziona la prima linea sharp completa secondo l'ordine dichiarato. */
export function independentFairFromSharpLines(
  lines: SharpCompleteLine[],
  market: MarketType,
): IndependentSharpFair | null {
  const candidates = lines.filter((line) => line.isSharp && line.market === market);
  const ordered = SHARP_BOOKS.flatMap((key) => candidates.filter((line) => line.bookmakerKey === key));
  const line = ordered[0];
  if (line === undefined) return null;

  const fair = fairMarket({ market, prices: line.prices });
  if (!fair.ok) return null;
  return {
    sourceBook: line.bookmakerKey,
    market,
    fairProbabilities: fair.data.fairProbs as Partial<Record<SelectionCode, number>>,
    fairOdds: fair.data.fairPrices as Partial<Record<SelectionCode, number>>,
    marginPct: fair.data.margin * 100,
    observedAt: line.observedAt,
  };
}

export type SharpFetch =
  | { ok: true; snapshot: SharpSnapshot; creditsUsed: number }
  | { ok: false; reason: string; creditsUsed: number };

/**
 * Una lettura, un credito. Il chiamante ha già verificato il budget: qui si
 * esegue e si riporta quanto è stato speso, così il contatore resta veritiero
 * anche quando la risposta è inutilizzabile.
 */
export async function fetchSharpLine(
  params: {
    sportKey: string;
    homeTeam: string;
    awayTeam: string;
    kickoffAt: Date;
    market: MarketType;
    selection: string;
    consensusOpening: number | null;
    consensusCurrent: number | null;
  },
  options: { fetchImpl?: typeof fetch; apiKey?: string; now?: Date } = {},
): Promise<SharpFetch> {
  const apiKey = options.apiKey ?? readOddsApiKey() ?? undefined;
  const now = options.now ?? new Date();
  if (apiKey === undefined || apiKey.trim() === "") {
    return { ok: false, reason: "chiave non configurata", creditsUsed: 0 };
  }
  const doFetch = options.fetchImpl ?? fetch;

  const url =
    `${ENDPOINT}/${encodeURIComponent(params.sportKey)}/odds` +
    `?apiKey=${encodeURIComponent(apiKey)}` +
    /* Nessun filtro `bookmakers=`: la documentazione della fonte stabilisce
       che il costo è `mercati × regioni`, non per bookmaker. Con un mercato
       (`h2h`) e una regione (`eu`) la chiamata costa 1 credito sia che si
       chiedano tre book sia che si chiedano tutti. Chiedere tutti i book è
       quindi gratis rispetto a chiederne tre, ed è ciò che rende misurabile
       la dispersione dell'intero mercato europeo invece che dei soli sharp. */
    `&regions=eu&markets=h2h&oddsFormat=decimal`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(url, { signal: controller.signal });
    /* il credito è speso comunque: l'API lo conta anche se poi non ci serve */
    const remainingHeader = res.headers?.get?.("x-requests-remaining") ?? null;
    const remaining =
      remainingHeader !== null && remainingHeader.trim() !== ""
        ? Number(remainingHeader)
        : null;

    if (!res.ok) {
      return {
        ok: false,
        reason: `fonte non disponibile (HTTP ${res.status})`,
        creditsUsed: 1,
      };
    }
    const payload: unknown = await res.json();
    const event = findEvent(
      payload,
      params.homeTeam,
      params.awayTeam,
      params.kickoffAt,
    );
    const eventForParsing = event as TheOddsApiEvent | null;
    const { book, price } = extractSharpPrice(
      event,
      params.selection,
      typeof event?.home_team === "string" ? event.home_team : params.homeTeam,
      typeof event?.away_team === "string" ? event.away_team : params.awayTeam,
      params.market,
    );

    /* Stessa risposta, stessa chiamata già pagata: i prezzi per book si
       leggono qui senza spendere un credito in più. La dispersione è l'unica
       cosa che una fotografia consente di dire sui book — il movimento
       richiederebbe due fotografie e non lo inventiamo. */
    const parsedAll = extractBookLines(
      eventForParsing ?? { id: "" },
      now,
    ).lines;
    const parsed = parsedAll.filter(
      (l) => l.market === params.market && l.selection === (params.selection as SelectionCode),
    );
    const completeLines = completeSharpLines(parsedAll, params.market);
    const independentFair = independentFairFromSharpLines(completeLines, params.market);

    const byKey = new Map<string, SharpBookLine>();
    /* il prezzo che ha prodotto il verdetto va per primo, se c'è */
    if (book !== null && price !== null) {
      byKey.set(book, { key: book, price, isSharp: isSharpBookmaker(book) });
    }
    for (const l of parsed) {
      if (!byKey.has(l.bookmakerKey)) {
        byKey.set(l.bookmakerKey, {
          key: l.bookmakerKey,
          price: l.price,
          isSharp: l.isSharp,
        });
      }
    }
    const allBooks = [...byKey.values()];
    const asLines = (bs: SharpBookLine[]): BookLine[] =>
      bs.map((b) => ({
        bookmakerKey: b.key,
        isSharp: b.isSharp,
        market: "1x2" as const,
        selection: params.selection as SelectionCode,
        price: b.price,
        observedAt: now,
      }));
    /* Due dispersioni distinte, perché dicono due cose diverse: quella fra i
       book sharp misura se la linea "intelligente" è condivisa, quella fra
       tutti i book misura quanto il mercato è d'accordo. Confonderle
       significherebbe spacciare l'una per l'altra. */
    const spread = bookSpread(
      asLines(allBooks.filter((b) => b.isSharp)),
      params.selection as SelectionCode,
    );
    const marketSpread = bookSpread(allBooks.length > 0 ? asLines(allBooks) : parsed,
      params.selection as SelectionCode,
    );

    return {
      ok: true,
      creditsUsed: 1,
      snapshot: {
        book,
        price,
        verdict: sharpVerdict(
          params.consensusOpening,
          params.consensusCurrent,
          price,
        ),
        books: allBooks,
        spread,
        marketSpread,
        remainingFromProvider:
          remaining !== null && Number.isFinite(remaining) ? remaining : null,
        market: marketForSelection(params.selection),
        completeLines,
        independentFair,
        readAt: now.toISOString(),
      },
    };
  } catch (err) {
    const timeout = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      reason: timeout ? "timeout della fonte" : "errore della fonte",
      creditsUsed: 1,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rende leggibile una fotografia scritta da una versione precedente.
 *
 * Le fotografie sono conservate in `system_state` per un giorno: quando si
 * aggiunge un campo, quelle già scritte non lo hanno. Senza normalizzazione la
 * pagina leggerebbe `snapshot.marketSpread.count` su `undefined` e si
 * schianterebbe sulle partite lette ieri — un difetto che comparirebbe solo in
 * produzione e solo per un giorno, il tipo peggiore. Un campo assente diventa
 * "non misurabile", che è ciò che è davvero.
 */
export function normalizeSharpSnapshot(raw: unknown): SharpSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<SharpSnapshot> & Record<string, unknown>;
  const spreadOf = (v: unknown): SpreadView | null => {
    if (typeof v !== "object" || v === null) return null;
    const s = v as Partial<SpreadView>;
    if (
      typeof s.count !== "number" ||
      typeof s.min !== "number" ||
      typeof s.max !== "number" ||
      typeof s.spread !== "number"
    ) {
      return null;
    }
    return { count: s.count, min: s.min, max: s.max, spread: s.spread };
  };
  const books = Array.isArray(r.books)
    ? r.books
        .filter((b): b is SharpBookLine => {
          if (typeof b !== "object" || b === null) return false;
          const x = b as Partial<SharpBookLine>;
          return typeof x.key === "string" && typeof x.price === "number";
        })
        .map((b) => ({ key: b.key, price: b.price, isSharp: b.isSharp === true }))
    : [];
  const marketOf = (value: unknown): MarketType | null =>
    value === "1x2" || value === "ou_2_5" ? value : null;
  const pricesOf = (
    value: unknown,
    market: MarketType,
  ): Partial<Record<SelectionCode, number>> | null => {
    if (typeof value !== "object" || value === null) return null;
    const source = value as Record<string, unknown>;
    const prices: Partial<Record<SelectionCode, number>> = {};
    for (const selection of expectedSelections(market)) {
      const price = source[selection];
      if (typeof price !== "number" || !Number.isFinite(price) || price <= 1) return null;
      prices[selection] = price;
    }
    return prices;
  };
  const probabilitiesOf = (
    value: unknown,
    market: MarketType,
  ): Partial<Record<SelectionCode, number>> | null => {
    if (typeof value !== "object" || value === null) return null;
    const source = value as Record<string, unknown>;
    const probabilities: Partial<Record<SelectionCode, number>> = {};
    for (const selection of expectedSelections(market)) {
      const probability = source[selection];
      if (
        typeof probability !== "number" ||
        !Number.isFinite(probability) ||
        probability <= 0 ||
        probability >= 1
      ) {
        return null;
      }
      probabilities[selection] = probability;
    }
    return probabilities;
  };
  const market = marketOf(r.market);
  const completeLines =
    market !== null && Array.isArray(r.completeLines)
      ? r.completeLines.flatMap((value): SharpCompleteLine[] => {
          if (typeof value !== "object" || value === null) return [];
          const line = value as unknown as Record<string, unknown>;
          const lineMarket = marketOf(line.market);
          const prices = lineMarket === null ? null : pricesOf(line.prices, lineMarket);
          if (
            typeof line.bookmakerKey !== "string" ||
            lineMarket === null ||
            prices === null ||
            typeof line.observedAt !== "string"
          ) {
            return [];
          }
          return [{
            bookmakerKey: line.bookmakerKey,
            isSharp: line.isSharp === true,
            market: lineMarket,
            prices,
            observedAt: line.observedAt,
          }];
        })
      : [];
  const fairRaw = r.independentFair;
  let independentFair: IndependentSharpFair | null = null;
  if (typeof fairRaw === "object" && fairRaw !== null) {
    const fair = fairRaw as unknown as Record<string, unknown>;
    const fairMarket = marketOf(fair.market);
    const fairProbabilities =
      fairMarket === null ? null : probabilitiesOf(fair.fairProbabilities, fairMarket);
    const fairOdds = fairMarket === null ? null : pricesOf(fair.fairOdds, fairMarket);
    if (
      typeof fair.sourceBook === "string" &&
      fairMarket !== null &&
      fairProbabilities !== null &&
      fairOdds !== null &&
      typeof fair.marginPct === "number" &&
      typeof fair.observedAt === "string"
    ) {
      independentFair = {
        sourceBook: fair.sourceBook,
        market: fairMarket,
        fairProbabilities,
        fairOdds,
        marginPct: fair.marginPct,
        observedAt: fair.observedAt,
      };
    }
  }
  const verdict: SharpVerdict =
    r.verdict === "conferma" || r.verdict === "smentisce"
      ? r.verdict
      : "non osservabile";
  return {
    book: typeof r.book === "string" ? r.book : null,
    price: typeof r.price === "number" ? r.price : null,
    verdict,
    books,
    spread: spreadOf(r.spread),
    marketSpread: spreadOf(r.marketSpread),
    remainingFromProvider:
      typeof r.remainingFromProvider === "number" ? r.remainingFromProvider : null,
    market,
    completeLines,
    independentFair,
    readAt: typeof r.readAt === "string" ? r.readAt : "",
  };
}
