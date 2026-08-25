/**
 * Blocco "Notizie" per il dettaglio partita (Sprint notizie).
 *
 * Fonte dichiarata: GDELT DOC API, feed RSS pubblico (Google News RSS è
 * vietato dal suo robots.txt — vedi `src/lib/news/source.ts`). Gli stati
 * sono tre più uno e si dicono per ciò che sono: N notizie trovate,
 * nessuna notizia pubblica trovata (stato valido), fonte non raggiungibile,
 * lettura rimandata per cortesia verso la fonte.
 *
 * Le notizie non entrano nel punteggio e non entrano nel Contesto 360°:
 * sono fonti citate accanto ai numeri del monitor.
 */
import type { NewsView } from "@/lib/repo/news";
import {
  NEWS_MAX_AGE_HOURS,
  TAVILY_NEWS_SOURCE_LABEL,
} from "@/lib/news/tavily-news";
import { tavilyBudgetLine } from "@/lib/context/tavily";
import { italianTranslationLink } from "@/lib/news/source";
import { fmtDay, fmtTime } from "./format";

export function NewsBlock({ news }: { news: NewsView }) {
  const stateLine =
    news.state === "ok"
      ? `${news.itemsCount === 1 ? "1 notizia trovata" : `${news.itemsCount} notizie trovate`}`
      : news.state === "vuoto"
        ? "nessuna notizia pubblica trovata"
        : news.state === "irraggiungibile"
          ? "fonte non raggiungibile"
          : "lettura rinviata: cortesia verso la fonte, cache in scadenza";

  return (
    <section
      aria-labelledby="notizie-partita"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2
        id="notizie-partita"
        className="mb-1 text-sm font-semibold tracking-wide text-slate-700 uppercase"
      >
        Notizie
      </h2>

      <p className="mb-3 text-xs font-medium text-slate-700">{stateLine}</p>

      {/* budget della ricerca, dichiarato: senza budget non si inventa nulla */}
      {news.tavilyBudget !== undefined ? (
        <p className="mb-2 text-[11px] tabular-nums text-slate-500">
          {tavilyBudgetLine(news.tavilyBudget.used)}
        </p>
      ) : null}
      {news.searchUnavailableReason ? (
        <p className="mb-2 rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">
          {news.searchUnavailableReason}: nessuna notizia viene inventata al suo
          posto.
        </p>
      ) : null}

      {news.items.length > 0 ? (
        <ul className="space-y-2">
          {news.items.map((n) => (
            <li
              key={n.link}
              className="rounded border border-slate-200 px-3 py-2 text-xs leading-relaxed"
            >
              <a
                href={n.link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-medium text-slate-800 underline underline-offset-2 hover:text-slate-950"
              >
                {n.title}
              </a>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {n.source ?? "testata non dichiarata"}
                {n.publishedAt !== null ? ` · ${fmtDay(n.publishedAt)} ${fmtTime(n.publishedAt)}` : ""}
                {` · lingua query: ${n.language === "it" ? "italiano" : "internazionale"}`}
              </p>
              {n.language !== "it" ? (
                <a
                  href={italianTranslationLink(n.link)}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-0.5 inline-block text-[11px] text-slate-600 underline underline-offset-2 hover:text-slate-900"
                >
                  Leggi in italiano (traduzione)
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : news.state === "vuoto" ? (
        <p className="text-xs leading-relaxed text-slate-600">
          La fonte è stata interrogata e non ha notizie pubbliche delle ultime
          {" "}{NEWS_MAX_AGE_HOURS} ore che citino entrambe le squadre: è un
          risultato, non un guasto. Nessun contenuto viene sostituito o
          inventato.
        </p>
      ) : null}

      <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-500">
        Fonte: {TAVILY_NEWS_SOURCE_LABEL}. Sono mostrate solo notizie delle
        ultime {NEWS_MAX_AGE_HOURS} ore che citano entrambe le squadre: ciò che
        non passa questi due filtri non viene mostrato. Cache di 24 ore per
        partita, dedupe per URL, massimo 1 richiesta ogni 5 secondi e 20 per quarto d&apos;ora
        verso i feed. Le notizie non influenzano punteggio e segnali.
      </p>
    </section>
  );
}
