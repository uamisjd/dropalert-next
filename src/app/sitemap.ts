/**
 * sitemap.xml (Sprint lancio, punto D).
 *
 * Contiene le pagine pubbliche fisse più il dettaglio delle partite ancora
 * DA GIOCARE: quelle archiviate cambiano di rado e non meritano una visita
 * del crawler ogni giorno.
 *
 * Se il database non risponde la sitemap non fallisce: restituisce le sole
 * pagine fisse. Un elenco parziale è utile, un 500 no.
 */
import type { MetadataRoute } from "next";
import { and, asc, desc, eq, gte, inArray, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import { dropSignals, matches } from "@/db/schema";
import { PUBLIC_PAGES, SITE_URL } from "@/lib/site";
import { PLAYED_GRACE_MINUTES } from "@/lib/view/timeline";

export const revalidate = 3600;

/** Priorità dichiarata: la home prima, le pagine legali in fondo. */
const PRIORITY: Record<string, number> = {
  "/": 1,
  "/ieri": 0.7,
  "/domani": 0.7,
  "/coverage": 0.5,
  "/metodologia": 0.6,
  "/guida": 0.8,
  "/privacy": 0.3,
  "/gioco-responsabile": 0.4,
  "/performance": 0.5,
  "/strumenti": 0.6,
  "/value-bets": 0.7,
  "/trading": 0.6,
  "/surebet": 0.5,
  "/simulator": 0.5,
};

async function upcomingMatchIds(
  now: Date,
): Promise<Array<{ id: number; updatedAt: Date }>> {
  /* «da giocare» con la stessa regola della lista: kickoff futuro oppure
     iniziata da meno di tre ore */
  const since = new Date(now.getTime() - PLAYED_GRACE_MINUTES * 60_000);
  const rows = await db
    .select({
      id: matches.id,
      kickoffAt: matches.kickoffAt,
      updatedAt: raw<Date>`max(${dropSignals.updatedAt})`,
    })
    .from(matches)
    .innerJoin(dropSignals, eq(dropSignals.matchId, matches.id))
    .where(
      and(
        gte(matches.kickoffAt, since),
        raw`${matches.key} not like 'demo-%'`,
        inArray(dropSignals.status, ["active", "forming"]),
      ),
    )
    .groupBy(matches.id, matches.kickoffAt)
    .orderBy(asc(matches.kickoffAt))
    .limit(500);

  return rows.map((r) => ({
    id: r.id,
    updatedAt: r.updatedAt ?? r.kickoffAt,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const fixed: MetadataRoute.Sitemap = PUBLIC_PAGES.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === "/" ? "hourly" : "weekly",
    priority: PRIORITY[path] ?? 0.5,
  }));

  let live: MetadataRoute.Sitemap = [];
  try {
    const rows = await upcomingMatchIds(now);
    live = rows.map((r) => ({
      url: `${SITE_URL}/matches/${r.id}`,
      lastModified: r.updatedAt,
      changeFrequency: "hourly" as const,
      priority: 0.8,
    }));
  } catch {
    /* database non raggiungibile: restano le pagine fisse, dichiarate */
    live = [];
  }

  void desc;
  return [...fixed, ...live];
}
