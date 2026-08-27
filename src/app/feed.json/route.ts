/**
 * Feed JSON dei segnali attivi (Sprint ENH-1, punto 4).
 * Stesso contenuto dell'RSS, nel formato JSON Feed 1.1.
 */
import { FEED_DISCLAIMER, getFeedItems } from "@/lib/repo/feed";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

export const revalidate = 300;

export async function GET(): Promise<Response> {
  const items = await getFeedItems(new Date()).catch(() => []);

  const body = {
    version: "https://jsonfeed.org/version/1.1",
    title: `${SITE_NAME} — movimenti rilevati`,
    home_page_url: SITE_URL,
    feed_url: `${SITE_URL}/feed.json`,
    description: `${SITE_DESCRIPTION} ${FEED_DISCLAIMER}`,
    language: "it-IT",
    items: items.map((i) => ({
      id: i.id,
      url: i.url,
      title: i.title,
      content_text: i.summary,
      date_published: i.publishedAt,
    })),
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/feed+json; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
