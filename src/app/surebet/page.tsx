/**
 * Pagina /surebet — Suite di Arbitraggio Matematico & Dutching.
 */
import type { Metadata } from "next";
import { SurebetCalculator } from "@/components/tools/SurebetCalculator";
import { DutchingCalculator } from "@/components/tools/DutchingCalculator";

export const metadata: Metadata = {
  title: "Surebet & Dutching Suite — Arbitraggio Matematico | DropAlert Pro",
  description:
    "Calcola arbitraggi a profitto matematico garantito (Surebet) e strategie di Dutching multi-esito. Ottimizzazione delle puntate e calcolo ROI netto.",
  alternates: { canonical: "/surebet" },
};

export default function SurebetPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
      {/* Header */}
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-lg">
        <div
          aria-hidden
          className="absolute -top-24 -right-20 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl"
        />
        <div className="relative max-w-3xl">
          <p className="text-xs font-bold tracking-[0.2em] text-cyan-400 uppercase">
            Risk-Free Quantitative Suite
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Surebet & Dutching Matematico
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Sfrutta le differenze di quota tra bookmaker concorrenti per bloccare un profitto
            matematico certo al 100% indipendentemente dal risultato finale, oppure distribuisci
            il tuo budget su più selezioni con il Dutching professionale.
          </p>
        </div>
      </header>

      {/* Calcolatori */}
      <div className="space-y-8">
        <SurebetCalculator />
        <DutchingCalculator />
      </div>

      {/* Regole operative Pro per l'Arbitraggio */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm sm:p-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Linee guida operative per scommettitori & trader su Surebet
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3.5">
            <h3 className="font-semibold text-slate-900">1. Arrotondamento degli Stake</h3>
            <p className="mt-1 leading-relaxed">
              I bookmaker ricreativi monitorano e limitano gli utenti che scommettono importi con decimali anomali (es. 47.38 €). Usa sempre l'arrotondamento all'euro intero (es. 47 € o 50 €).
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5">
            <h3 className="font-semibold text-slate-900">2. Velocità di Esecuzione</h3>
            <p className="mt-1 leading-relaxed">
              Le finestre di Surebet durano tipicamente tra i 2 e i 15 minuti. Piazza sempre prima la scommessa sul bookmaker soft (più lento a cambiare) e subito dopo la copertura sullo sharp/exchange.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5">
            <h3 className="font-semibold text-slate-900">3. Regole sui Ritiri e Rinvii</h3>
            <p className="mt-1 leading-relaxed">
              Verifica che i due bookmaker abbiano gli stessi termini di regolamento (es. tempi supplementari inclusi/esclusi o regole sui match rinviati).
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
