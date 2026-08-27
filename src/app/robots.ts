/**
 * robots.txt (Sprint lancio, punto D).
 *
 * Il sito è pubblico e vuole essere indicizzato, tranne le rotte di
 * servizio: le API non hanno contenuto per un lettore e il pannello
 * operativo non è materiale da motore di ricerca.
 */
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";
export const revalidate = 86400;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        /* i feed restano leggibili: sono contenuto pubblico, non servizio */
        disallow: ["/api/", "/cov"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
