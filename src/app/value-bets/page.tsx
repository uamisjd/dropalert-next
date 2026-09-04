/**
 * Scanner Value Bet (+EV) in Tempo Reale.
 *
 * Visualizza e ordina tutte le opportunità di scommessa e trading ad alto rendimento atteso,
 * calcolando l'Edge rispetto alla linea Fair No-Vig e lo Stake ottimale tramite Kelly Frazionale.
 */
import type { Metadata } from "next";
import { getValueOpportunities } from "@/lib/repo/value-bets";
import { ValueScannerTable } from "@/components/ValueScannerTable";
import { fmtDateTime } from "@/components/format";

export const metadata: Metadata = {
  title: "Value Bet Scanner (+EV Terminal) — DropAlert Pro",
  description:
    "Radar quantitativo delle quote di valore: calcolo Expected Value, Edge %, discrepanze sharp/soft e sizing scientifico con Criterio di Kelly.",
  alternates: { canonical: "/value-bets" },
};

export const revalidate = 60; // rigenera ogni minuto

export default async function ValueBetsPage() {
  const now = new Date();
  const data = await getValueOpportunities({}, now);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
      {/* Header Pro Terminal */}
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-lg">
        <div
          aria-hidden
          className="absolute -top-24 -right-20 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl"
        />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-xs font-bold tracking-[0.2em] text-emerald-400 uppercase">
              Quantitative Alpha Terminal
            </p>
          </div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Value Bet Scanner (+EV)
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Identifica in tempo reale le discrepanze matematiche tra la quota offerta
            e la reale probabilità stimata (Fair No-Vig / Sharp). Sfrutta la lentezza dei bookmaker
            e ottieni un vantaggio matematico di lungo periodo.
          </p>

          <div className="mt-6 flex flex-wrap gap-3 text-xs">
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Opportunità attive: </span>
              <span className="font-bold text-white tabular-nums">
                {data.opportunities.length}
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Edge medio rilevato: </span>
              <span className="font-bold text-emerald-400 tabular-nums">
                +{data.averageEdgePct.toFixed(1)}%
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Metodo di stima: </span>
              <span className="font-bold text-cyan-300">Shin / Power No-Vig</span>
            </div>
          </div>
        </div>
      </header>

      {/* Tabella interattiva con filtri e calcolo Kelly */}
      <ValueScannerTable initialOpportunities={data.opportunities} />

      {/* Box educativo metodologico avanzato */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm sm:p-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Come funziona l'Expected Value (+EV) e il Kelly Staking
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <h3 className="font-semibold text-slate-800">1. Quota Fair vs Quota Offerta</h3>
            <p className="mt-1 leading-relaxed">
              La probabilità reale viene isolata rimuovendo il margine del banco tramite modelli avanzati.
              Se la quota del bookmaker è superiore alla quota fair, si ha un <strong>Expected Value positivo (+EV)</strong>.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">2. Quarter Kelly Staking</h3>
            <p className="mt-1 leading-relaxed">
              Puntare una frazione del Criterio di Kelly (25%) massimizza la crescita geometrica
              del capitale azzerando il rischio di rovina durante le inevitabili serie negative.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">3. Varianza e Lungo Termine</h3>
            <p className="mt-1 leading-relaxed">
              Nel breve periodo domina il caso. Nel lungo periodo (500+ scommesse), il ROI
              reale convergerà matematicamente verso l'Edge percentuale medio giocato.
            </p>
          </div>
        </div>
        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          Scansionato alle ore {fmtDateTime(data.generatedAt)} · Dati sincronizzati con il motore quantitativo.
        </p>
      </section>
    </main>
  );
}
