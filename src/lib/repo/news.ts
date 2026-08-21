/**
 * Cache e lettura delle notizie per partita (Sprint notizie).
 *
 * Il flusso è lo stesso del Contesto 360°: si legge la cache, e solo se
 * scaduta si va alla fonte — con il limiter di cortesia davanti. Gli stati
 * dichiarati sono tre più uno: `ok` (N notizie), `vuoto` (fonte raggiunta,
 * nessuna notizia: stato VALIDO), `irraggiungibile` (fonte non
 * raggiungibile), `rinviato` (limite di cortesia: si mostra la cache
 * vecchia, e se non c'è lo si dichiara per ciò che è).
 *
 * Le notizie non entrano nel punteggio, non entrano nel contesto 360° e
 * non cambiano nulla del monitor: sono la pagina dei giornali accanto ai
 * numeri.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { newsFetch, newsItems } from "@/db/schema";
import {
  NEWS_CACHE_HOURS,
  fetchMatchNews,
} from "@/lib/news/source";
import { acquireNewsSlot } from "@/lib/news/limiter";

export type NewsState = "ok" | "vuoto" | "irraggiungibile" | "rinviato";

export interface NewsItemView {
  title: string;
  link: string;
  source: string | null;
  publishedAt: string | null;
  language: string;
}

export interface NewsView {
  state: NewsState;
  itemsCount: number;
  language: string | null;
  updatedAt: string | null;
  items: NewsItemView[];
}

function isFresh(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() > now.getTime();
}

async function readItems(matchId: number): Promise<NewsItemView[]> {
  const rows = await db
    .select()
    .from(newsItems)
    .where(eq(newsItems.matchId, matchId))
    .orderBy(desc(newsItems.publishedAt));
  return rows.map((r) => ({
    title: r.title,
    link: r.link,
    source: r.source,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    language: r.language,
  }));
}

async function writeFetchState(
  matchId: number,
  state: NewsState,
  itemsCount: number,
  language: string | null,
  now: Date,
): Promise<void> {
  /* un fallimento si riprova prima: un'ora, non sei. Un vuoto è un
     risultato e invecchia come tale */
  const hours =
    state === "irraggiungibile" ? 1 : NEWS_CACHE_HOURS;
  const expiresAt = new Date(now.getTime() + hours * 3_600_000);
  const values = {
    matchId,
    state,
    itemsCount,
    language,
    updatedAt: now,
    expiresAt,
  };
  await db
    .insert(newsFetch)
    .values(values)
    .onConflictDoUpdate({ target: newsFetch.matchId, set: values });
}

/**
 * Notizie di una partita: cache 6h, poi UNA lettura (o due: italiano poi
 * fallback) sotto limiter. Dedupe per link: la tabella ha il vincolo
 * unico (partita, link) e le ripetizioni si ignorano in silenzio.
 */
export async function getNewsForMatch(
  matchId: number,
  homeTeam: string,
  awayTeam: string,
  now: Date = new Date(),
): Promise<NewsView> {
  const [fetchRow] = await db
    .select()
    .from(newsFetch)
    .where(eq(newsFetch.matchId, matchId))
    .limit(1);

  if (fetchRow !== undefined && isFresh(fetchRow.expiresAt, now)) {
    return {
      state: fetchRow.state as NewsState,
      itemsCount: fetchRow.itemsCount,
      language: fetchRow.language,
      updatedAt: fetchRow.updatedAt.toISOString(),
      items: await readItems(matchId),
    };
  }

  /* la cortesia viene prima della freschezza: senza slot si dichiara */
  const slot = await acquireNewsSlot();
  if (!slot) {
    if (fetchRow !== undefined) {
      return {
        state: "rinviato",
        itemsCount: fetchRow.itemsCount,
        language: fetchRow.language,
        updatedAt: fetchRow.updatedAt.toISOString(),
        items: await readItems(matchId),
      };
    }
    return {
      state: "rinviato",
      itemsCount: 0,
      language: null,
      updatedAt: null,
      items: [],
    };
  }

  const outcome = await fetchMatchNews(homeTeam, awayTeam);

  if (!outcome.ok) {
    await writeFetchState(matchId, "irraggiungibile", 0, null, now);
    return {
      state: "irraggiungibile",
      itemsCount: 0,
      language: null,
      updatedAt: now.toISOString(),
      items: [],
    };
  }

  const { items, language, query } = outcome.result;

  for (const item of items) {
    await db
      .insert(newsItems)
      .values({
        matchId,
        title: item.title,
        source: item.source,
        publishedAt: item.publishedAt,
        link: item.link,
        language,
        query,
        fetchedAt: now,
      })
      .onConflictDoNothing({ target: [newsItems.matchId, newsItems.link] });
  }

  const stored = await readItems(matchId);
  const state: NewsState = stored.length > 0 ? "ok" : "vuoto";
  await writeFetchState(matchId, state, stored.length, language, now);

  return {
    state,
    itemsCount: stored.length,
    language,
    updatedAt: now.toISOString(),
    items: stored,
  };
}

/**
 * Conteggi per le card: solo lettura della cache, mai generazione. Una
 * partita mai letta vale `null`: la card non dice ciò che non sa.
 */
export async function getNewsCounts(
  matchIds: number[],
): Promise<Map<number, { count: number; state: NewsState }>> {
  if (matchIds.length === 0) return new Map();
  const rows = await db
    .select({
      matchId: newsFetch.matchId,
      state: newsFetch.state,
      itemsCount: newsFetch.itemsCount,
    })
    .from(newsFetch);
  const out = new Map<number, { count: number; state: NewsState }>();
  for (const r of rows) {
    if (!matchIds.includes(r.matchId)) continue;
    out.set(r.matchId, { count: r.itemsCount, state: r.state as NewsState });
  }
  return out;
}
