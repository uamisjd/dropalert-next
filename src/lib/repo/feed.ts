/**
 * Elementi dei feed pubblici (Sprint ENH-1, punto 4).
 *
 * Un feed è una vista, non una nuova fonte: legge i segnali già a registro
 * e li impagina. Nessun calcolo nuovo, nessuna metrica inventata.
 *
 * Regole:
 *  - solo segnali su partite ancora DA GIOCARE (con la stessa tolleranza
 *    della lista): un feed che annuncia partite finite è rumore;
 *  - una voce per partita, la più forte, con la stessa deduplica della home;
 *  - il disclaimer viaggia in ogni singolo elemento, non solo nel canale:
 *    chi legge un item in un aggregatore non vede l'intestazione.
 */
import { getDashboardData } from "@/lib/repo/dashboard";
import { groupByMatch } from "@/lib/view/plain";
import { matchesTimeChip } from "@/lib/view/timeline";
import { SITE_URL } from "@/lib/site";

/** Frase fissa in coda a ogni elemento del feed. */
export const FEED_DISCLAIMER = "Nessuna vincita garantita: gioca responsabilmente.";

/** Quante voci al massimo: un feed lungo non è un feed più utile. */
export const FEED_MAX_ITEMS = 30;

export interface FeedItem {
  id: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
}

/** Titolo dichiarato: chi gioca, dove, e quanto si è mossa la quota. */
export function feedTitle(signal: {
  homeTeam: string;
  awayTeam: string;
  league: string | null;
  currentPrice: number | null;
  dropPct: number | null;
  sustainedMinutes: number;
}): string {
  const competizione =
    signal.league !== null && signal.league.trim() !== ""
      ? ` (${signal.league.trim()})`
      : "";
  const partita = `${signal.homeTeam} – ${signal.awayTeam}${competizione}`;

  if (signal.currentPrice === null || signal.dropPct === null) {
    return partita;
  }
  const segno = signal.dropPct < 0 ? "−" : "+";
  const ore =
    signal.sustainedMinutes > 0
      ? ` in ${Math.max(1, Math.round(signal.sustainedMinutes / 60))}h`
      : "";
  return `${partita}: quota ${signal.currentPrice.toFixed(2)} ${segno}${Math.abs(
    signal.dropPct,
  ).toFixed(0)}%${ore}`;
}

/** Riepilogo di un elemento: fatti a registro più il disclaimer. */
export function feedSummary(signal: {
  selectionLabel: string;
  marketLabel: string;
  openingPrice: number | null;
  currentPrice: number | null;
  levelLabel: string;
  booksConfirming: number;
  booksTotal: number;
}): string {
  const pezzi: string[] = [];
  if (signal.openingPrice !== null && signal.currentPrice !== null) {
    pezzi.push(
      `${signal.marketLabel} · ${signal.selectionLabel}: da ${signal.openingPrice.toFixed(2)} a ${signal.currentPrice.toFixed(2)}.`,
    );
  } else {
    pezzi.push(`${signal.marketLabel} · ${signal.selectionLabel}.`);
  }
  pezzi.push(`${signal.levelLabel}.`);
  pezzi.push(
    signal.booksTotal > 1
      ? `Movimento su ${signal.booksConfirming} bookmaker su ${signal.booksTotal}.`
      : "Movimento su un solo bookmaker.",
  );
  pezzi.push(FEED_DISCLAIMER);
  return pezzi.join(" ");
}

/** Le voci del feed, già ordinate e deduplicate. */
export async function getFeedItems(
  now: Date = new Date(),
): Promise<FeedItem[]> {
  const data = await getDashboardData({}, now);
  const daGiocare = data.signals.filter((s) =>
    matchesTimeChip(s.kickoffAt, "da-giocare", now),
  );
  return groupByMatch(daGiocare)
    .slice(0, FEED_MAX_ITEMS)
    .map((g) => {
      const s = g.primary;
      return {
        id: `${SITE_URL}/matches/${g.matchId}#${s.id}`,
        title: feedTitle(s),
        url: `${SITE_URL}/matches/${g.matchId}`,
        summary: feedSummary(s),
        publishedAt: s.updatedAt,
      };
    });
}

/** Escape XML: un nome squadra con & non deve rompere il feed. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
