/** Notizie pubbliche recenti collegate alla partita. */
import type { NewsView } from "@/lib/repo/news";
import {
  NEWS_MAX_AGE_HOURS,
  TAVILY_NEWS_SOURCE_LABEL,
} from "@/lib/news/tavily-news";
import { tavilyBudgetLine } from "@/lib/context/tavily";
import { italianTranslationLink } from "@/lib/news/source";
import { fmtDay, fmtTime } from "./format";

function stateLabel(news: NewsView): string {
  if (news.state === "ok") {
    return news.itemsCount === 1
      ? "1 notizia trovata"
      : `${news.itemsCount} notizie trovate`;
  }
  if (news.state === "vuoto") return "Nessuna notizia recente trovata";
  if (news.state === "irraggiungibile")
    return "Fonte temporaneamente non raggiungibile";
  return "Lettura rinviata per rispettare i limiti della fonte";
}

export function NewsBlock({ news }: { news: NewsView }) {
  return (
    <section
      aria-labelledby="notizie-partita"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase">
        Ultime 72 ore
      </p>
      <h2
        id="notizie-partita"
        className="mt-1 text-base font-semibold text-slate-950"
      >
        Notizie pubbliche
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        {stateLabel(news)}
      </p>

      {news.searchUnavailableReason ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {news.searchUnavailableReason}. Nessun contenuto viene inventato al
          suo posto.
        </p>
      ) : null}

      {news.items.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {news.items.map((item) => (
            <li
              key={item.link}
              className="rounded-lg border border-slate-200 px-3 py-2.5"
            >
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-sm leading-snug font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:text-cyan-800"
              >
                {item.title}
              </a>
              <p className="mt-1 text-[11px] text-slate-500">
                {item.source ?? "testata non dichiarata"}
                {item.publishedAt !== null
                  ? ` · ${fmtDay(item.publishedAt)} ${fmtTime(item.publishedAt)}`
                  : ""}
              </p>
              {item.language !== "it" ? (
                <a
                  href={italianTranslationLink(item.link)}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-1 inline-block text-[11px] text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-950"
                >
                  Leggi la traduzione italiana
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Non abbiamo trovato articoli recenti che citino entrambe le squadre. È
          assenza di riscontri pubblici, non una prova che non esistano cause
          per il movimento.
        </p>
      )}

      <details className="mt-4 border-t border-slate-100 pt-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-950">
          Metodo e limiti della ricerca
        </summary>
        <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-slate-500">
          {news.tavilyBudget !== undefined ? (
            <p className="tabular-nums">
              {tavilyBudgetLine(news.tavilyBudget.used)}
            </p>
          ) : null}
          <p>
            Fonte: {TAVILY_NEWS_SOURCE_LABEL}. Sono inclusi solo contenuti delle
            ultime {NEWS_MAX_AGE_HOURS} ore che citano entrambe le squadre.
            Cache 24 ore e deduplica per URL. Le notizie non modificano il
            punteggio.
          </p>
        </div>
      </details>
    </section>
  );
}
