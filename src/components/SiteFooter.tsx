/**
 * Footer legale persistente (Sprint lancio, punto B).
 *
 * Sta nel layout radice, quindi compare su OGNI pagina: gli avvisi di gioco
 * responsabile non possono dipendere da quale schermata si apre. Il numero
 * verde è quello nazionale per il gioco d'azzardo patologico.
 *
 * Nessuna logica: solo testo e link interni.
 */
import Link from "next/link";

/** Numero verde nazionale, dichiarato una volta sola. */
export const HELPLINE = "800 558 822";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-slate-300 bg-white">
      <div className="mx-auto w-full max-w-3xl px-4 py-4">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-800">
          <span className="rounded border border-slate-800 px-1.5 py-0.5 text-[11px] font-bold">
            +18
          </span>
          <span>Il gioco può causare dipendenza</span>
          <span aria-hidden className="text-slate-300">
            ·
          </span>
          <span>Gioca responsabilmente</span>
          <span aria-hidden className="text-slate-300">
            ·
          </span>
          <span>
            Numero Verde{" "}
            <a
              href={`tel:+39${HELPLINE.replace(/\s/g, "")}`}
              className="underline underline-offset-2"
            >
              {HELPLINE}
            </a>
          </span>
        </p>

        <nav
          aria-label="Informazioni legali"
          className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"
        >
          <Link
            href="/gioco-responsabile"
            className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            Gioco responsabile
          </Link>
          <Link
            href="/privacy"
            className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            Privacy
          </Link>
          <Link
            href="/performance"
            className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            Performance
          </Link>
          <Link
            href="/feed/rss.xml"
            className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            Feed RSS
          </Link>
          <Link
            href="/metodologia"
            className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            Metodologia
          </Link>
        </nav>

        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          DropAlert è un osservatorio statistico sui movimenti delle quote. Non
          fornisce pronostici, non raccoglie scommesse e non è affiliato ad
          alcun operatore di gioco.
        </p>
      </div>
    </footer>
  );
}
