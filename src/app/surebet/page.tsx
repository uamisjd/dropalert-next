/**
 * Pagina /surebet — calcolatori di arbitraggio e Dutching.
 *
 * Com'era nata: "Risk-Free Suite" con "profitto matematico certo al 100%" e tre regole
 * operative su come piazzare le giocate. Due problemi: le regole sono istruzioni di
 * scommessa (fuori dal contratto di questo sito) e la certezza dipende da una condizione
 * che i dati non verificano — la simultaneità dei prezzi. Sulle 12 459 partite del
 * dataset congelato, un arbitraggio vero fra le otto fonti disponibili esiste nell'1,6%
 * dei casi con profitto medio 1,13% — e sono prezzi rilevati in momenti diversi, quindi
 * neppure quelli sono eseguibili (studio `docs/STUDIO-PARTITE-FINITE.md`, §S6).
 * Restano i calcolatori: l'aritmetica è esatta, i numeri li inserisce chi legge.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { SurebetCalculator } from "@/components/tools/SurebetCalculator";
import { DutchingCalculator } from "@/components/tools/DutchingCalculator";

export const metadata: Metadata = {
  title: "Calcolatore di Surebet e Dutching — DropAlert Pro",
  description:
    "Arbitraggio e distribuzione su più esiti: l'aritmetica delle quote che inserisci tu, con i vincoli che la rendono rara (simultaneità, limiti, commissione).",
  alternates: { canonical: "/surebet" },
};

export default async function SurebetPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-lg">
        <div
          aria-hidden
          className="absolute -top-24 -right-20 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl"
        />
        <div className="relative max-w-3xl">
          <p className="text-xs font-bold tracking-[0.2em] text-cyan-400 uppercase">
            Aritmetica delle quote · calcolatore
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Surebet e Dutching
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Una surebet esiste quando la somma delle probabilità implicite di tutte le
            selezioni di un mercato sta sotto il 100%. È un calcolo esatto — e una
            condizione rara: perché resti vera servono quote rilevate nello stesso
            istante, disponibili sullo stesso importo e con regole di regolamento
            identiche. Sotto, i due calcolatori e i vincoli che li rendono tali.
          </p>
        </div>
      </header>

      <div className="space-y-8">
        <SurebetCalculator />
        <DutchingCalculator />
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm sm:p-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Perché il calcolo è certo e l&apos;occasione no
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3.5">
            <h3 className="font-semibold text-slate-900">1. Simultaneità</h3>
            <p className="mt-1 leading-relaxed">
              Un margine del 101% fra due operatori misurati a dieci minuti di distanza
              non è un arbitraggio: è il movimento che li ha separati. Nel dataset
              congelato di questo sito, con otto fonti di prezzo, una somma sotto il 100%
              compare nell&apos;1,6% delle partite e vale in media 1,13 punti su 100 — e
              quelle letture non sono simultanee, quindi non sono nemmeno eseguibili.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5">
            <h3 className="font-semibold text-slate-900">2. Importi e regole</h3>
            <p className="mt-1 leading-relaxed">
              La distribuzione che esce dal calcolatore presuppone che ogni quota sia
              disponibile per l&apos;intero importo e che i regolamenti coincidano (tempi
              supplementari, partite sospese, rinvii). Sono condizioni da verificare sul
              singolo mercato: nessun foglio di calcolo può dedurle.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5">
            <h3 className="font-semibold text-slate-900">3. Che cosa fa questo sito</h3>
            <p className="mt-1 leading-relaxed">
              Nulla di tutto questo: nessun confronto fra operatori è pubblicato, nessuna
              coppia di quote viene proposta, nessun link a bookmaker. La somma delle
              probabilità implicite di una singola fonte è usata qui solo per togliere il
              margine dalle quote, e quella scelta è descritta in{" "}
              <Link href="/metodologia" className="underline">
                /metodologia
              </Link>
              .
            </p>
          </div>
        </div>
        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          I numeri dei due calcolatori non vengono dal database e non sono precaricati:
          sono prove di aritmetica su valori inseriti. Per i limiti personali,{" "}
          <Link href="/gioco-responsabile" className="underline">
            /gioco-responsabile
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
