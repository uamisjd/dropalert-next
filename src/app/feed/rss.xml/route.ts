/**
 * Feed RSS dei segnali attivi (Sprint ENH-1, punto 4).
 *
 * Generato su richiesta con cache breve: un feed è utile se è fresco, ma
 * non deve interrogare il database a ogni lettore. Il disclaimer compare
 * nel canale E in ogni elemento, perché negli aggregatori l'intestazione
 * non si vede.
 */
import {
  FEED_DISCLAIMER,
  getFeedItems,
  xmlEscape,
} from "@/lib/repo/feed";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

export const revalidate = 300;

export async function GET(): Promise<Response> {
  const now = new Date();
  const items = await getFeedItems(now).catch(() => []);

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${xmlEscape(`${SITE_NAME} — movimenti rilevati`)}</title>`,
    `<link>${SITE_URL}</link>`,
    `<description>${xmlEscape(`${SITE_DESCRIPTION} ${FEED_DISCLAIMER}`)}</description>`,
    "<language>it-IT</language>",
    `<lastBuildDate>${now.toUTCString()}</lastBuildDate>`,
    `<atom:link href="${SITE_URL}/feed/rss.xml" rel="self" type="application/rss+xml" />`,
    ...items.map((i) =>
      [
        "<item>",
        `<title>${xmlEscape(i.title)}</title>`,
        `<link>${xmlEscape(i.url)}</link>`,
        `<guid isPermaLink="false">${xmlEscape(i.id)}</guid>`,
        `<pubDate>${new Date(i.publishedAt).toUTCString()}</pubDate>`,
        `<description>${xmlEscape(i.summary)}</description>`,
        "</item>",
      ].join(""),
    ),
    "</channel>",
    "</rss>",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
