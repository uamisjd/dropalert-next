/**
 * Ricerca attiva "in casa" per il Contesto 360° (Sprint grounding).
 *
 * Perché esiste: il grounding Google Search dell'API Gemini è riservato
 * alle chiave con billing attivo — con la chiave gratuita la richiesta
 * con strumenti risponde 429 (verificato il 21/08/2026). La ricerca però
 * serve. Perciò il contesto viene generato su DOCUMENTI RECUPERATI da
 * noi, da fonti pubbliche e robots-consentite:
 *
 *  - Wikipedia (REST summary, it prima e en come fallback): la pagina di
 *    ciascuna squadra dice categoria, città e competizione — il terreno
 *    naturale dei campi «livello_categorie» e «posta_in_palo»;
 *  - i feed RSS delle testate già usati dal blocco Notizie (Gazzetta,
 *    BBC): titoli recenti che citano le squadre.
 *
 * Il tool Google Search resta chiesto per primo nella chiamata al modello
 * (si accende da solo con una chiave a billing). I documenti recuperati
 * qui sono la base che funziona da subito, e ogni fonte citata dal modello
 * DEVE essere uno di questi URL: il parsing lo verifica, così un link può
 * essere solo vero, mai di facciata.
 */
import { teamFeedItems } from "@/lib/news/source";

export interface RetrievedDoc {
  titolo: string;
  /** stralcio, al massimo 400 caratteri: quel tanto che serve al modello */
  stralcio: string;
  url: string;
}

const WIKI_TIMEOUT_MS = 4_000;

interface WikiSummary {
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  type?: string;
}

async function fetchWiki(
  lang: "it" | "en",
  team: string,
  fetchImpl: typeof fetch,
): Promise<RetrievedDoc | null> {
  /* il nome nudo spesso è la città: prima la voce calcistica
     («X Calcio» / «X FC»), poi il nome nudo, poi l'altra lingua */
  const candidates =
    lang === "it"
      ? [`${team} Calcio`, team]
      : [`${team} FC`, team];

  for (const candidate of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WIKI_TIMEOUT_MS);
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidate)}`;
      const response = await fetchImpl(url, {
        headers: { "user-agent": "DropAlert/1.0 (osservatorio statistico)" },
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const data = (await response.json()) as WikiSummary;
      if (data.type === "disambiguation") continue;
      const page = data.content_urls?.desktop?.page;
      if (page === undefined || (data.extract ?? "").trim() === "") continue;
      return {
        titolo: data.title ?? team,
        stralcio: (data.extract ?? "").slice(0, 400),
        url: page,
      };
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * I documenti per una partita: le due pagine Wikipedia (it, poi en se la
 * prima non c'è) e i titoli di feed che citano le squadre. Al massimo sei,
 * i più pertinenti per primi. Chi non c'è non c'è: nessuna fonte inventata.
 */
export async function retrieveSources(
  homeTeam: string,
  awayTeam: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<RetrievedDoc[]> {
  const doFetch = options.fetchImpl ?? fetch;

  const [homeIt, awayIt, feed] = await Promise.all([
    fetchWiki("it", homeTeam, doFetch).catch(() => null),
    fetchWiki("it", awayTeam, doFetch).catch(() => null),
    teamFeedItems(homeTeam, awayTeam).catch(() => []),
  ]);
  const fallbackLang = async (team: string): Promise<RetrievedDoc | null> =>
    homeIt === null || awayIt === null
      ? await fetchWiki("en", team, doFetch).catch(() => null)
      : null;
  const home = homeIt ?? (await fallbackLang(homeTeam));
  const away = awayIt ?? (await fallbackLang(awayTeam));

  const docs: RetrievedDoc[] = [];
  for (const d of [home, away]) {
    if (d !== null) docs.push(d);
  }
  for (const item of feed.slice(0, 4)) {
    docs.push({
      titolo: item.title.slice(0, 120),
      stralcio: (item.source ?? "testata").slice(0, 80),
      url: item.link,
    });
  }

  /* dedup per URL, tetto sei */
  const seen = new Set<string>();
  return docs.filter((d) => {
    if (seen.has(d.url)) return false;
    seen.add(d.url);
    return true;
  }).slice(0, 6);
}
