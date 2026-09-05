/**
 * Identità pubblica del sito (Sprint lancio, punto D).
 *
 * Un solo posto decide l'indirizzo canonico: robots, sitemap e meta OG
 * devono dire lo stesso nome, altrimenti i motori vedono due siti diversi.
 * In produzione l'host arriva dall'ambiente; in locale resta l'indirizzo
 * pubblico noto, così i file generati non contengono mai «localhost».
 */

function normalizeBase(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  const t = raw.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

/** Indirizzo canonico del sito, senza slash finale. */
export const SITE_URL =
  normalizeBase(process.env.NEXT_PUBLIC_SITE_URL) ??
  normalizeBase(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
  "https://dropalert-next.vercel.app";

export const SITE_NAME = "DropAlert";

export const SITE_TITLE =
  "DropAlert — Osservatorio sui movimenti delle quote";

export const SITE_DESCRIPTION =
  "Monitoraggio statistico dei movimenti di quota nel calcio: ampiezza, conferme, persistenza e qualità del dato. Non è un servizio di pronostici.";

/** Pagine pubbliche sempre presenti in sitemap.
 *
 * `/preferite` è esclusa di proposito: la lista vive nel localStorage del
 * visitatore, quindi per un crawler è sempre lo stesso guscio vuoto
 * (vedi anche il `noindex` nel suo layout). Segnalarla in sitemap
 * significherebbe chiedere l'indicizzazione di una pagina sottile. */
export const PUBLIC_PAGES = [
  "/",
  "/ieri",
  "/domani",
  "/coverage",
  "/metodologia",
  "/privacy",
  "/gioco-responsabile",
  "/performance",
  "/strumenti",
  "/value-bets",
  "/trading",
  "/surebet",
  "/simulator",
] as const;
