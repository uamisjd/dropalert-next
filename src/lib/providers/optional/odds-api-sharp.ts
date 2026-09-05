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
 * Cosa NON facciamo: sostituire il collector. Le quote di consenso restano
 * quelle di BetExplorer; questa fonte serve solo a dire se una linea sharp
 * conferma, smentisce o non è osservabile.
 */
import type { SelectionCode } from "@/db/schema";
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
  readAt: string;
}

interface ApiOutcome {
  name?: unknown;
  price?: unknown;
}
interface ApiMarket {
  key?: unknown;
  outcomes?: unknown;
}
interface ApiBookmaker {
  key?: unknown;
  markets?: unknown;
}
interface ApiEvent {
  home_team?: unknown;
  away_team?: unknown;
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

/**
 * Trova nell'elenco eventi quello che corrisponde alla partita cercata.
 * Il confronto è sui nomi normalizzati: se non combacia, si restituisce
 * `null` invece di prendere «l'evento più simile».
 */
export function findEvent(
  events: unknown,
  homeTeam: string,
  awayTeam: string,
): ApiEvent | null {
  if (!Array.isArray(events)) return null;
  const h = norm(homeTeam);
  const a = norm(awayTeam);
  for (const e of events) {
    if (typeof e !== "object" || e === null) continue;
    const ev = e as ApiEvent;
    const eh = typeof ev.home_team === "string" ? norm(ev.home_team) : "";
    const ea = typeof ev.away_team === "string" ? norm(ev.away_team) : "";
    if (eh === "" || ea === "") continue;
    const diretto =
      (eh.includes(h) || h.includes(eh)) && (ea.includes(a) || a.includes(ea));
    if (diretto) return ev;
  }
  return null;
}

/** Selezione 1X2 → nome dell'esito nell'API. */
function outcomeNameFor(
  selection: string,
  homeTeam: string,
  awayTeam: string,
): string {
  if (selection === "home") return homeTeam;
  if (selection === "away") return awayTeam;
  return "Draw";
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
): { book: string | null; price: number | null } {
  if (event === null || !Array.isArray(event.bookmakers)) {
    return { book: null, price: null };
  }
  const wanted = norm(outcomeNameFor(selection, homeTeam, awayTeam));
  for (const key of SHARP_BOOKS) {
    for (const b of event.bookmakers as ApiBookmaker[]) {
      if (typeof b !== "object" || b === null || b.key !== key) continue;
      if (!Array.isArray(b.markets)) continue;
      for (const m of b.markets as ApiMarket[]) {
        if (m.key !== "h2h" || !Array.isArray(m.outcomes)) continue;
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
    const event = findEvent(payload, params.homeTeam, params.awayTeam);
    const { book, price } = extractSharpPrice(
      event,
      params.selection,
      params.homeTeam,
      params.awayTeam,
    );

    /* Stessa risposta, stessa chiamata già pagata: i prezzi per book si
       leggono qui senza spendere un credito in più. La dispersione è l'unica
       cosa che una fotografia consente di dire sui book — il movimento
       richiederebbe due fotografie e non lo inventiamo. */
    const parsed = extractBookLines(
      (event ?? { id: "" }) as TheOddsApiEvent,
      now,
    ).lines.filter(
      (l) =>
        l.market === "1x2" && l.selection === (params.selection as SelectionCode),
    );

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
    readAt: typeof r.readAt === "string" ? r.readAt : "",
  };
}
