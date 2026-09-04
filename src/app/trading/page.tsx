/**
 * Pagina /trading — Terminale Operativo di Trading Exchange & Scalping.
 */
import type { Metadata } from "next";
import { getTradingOpportunities } from "@/lib/repo/trading-opportunities";
import { TradingTerminalView } from "@/components/trading/TradingTerminalView";
import { fmtDateTime } from "@/components/format";

export const metadata: Metadata = {
  title: "Exchange Trading & Scalping Terminal — DropAlert Pro",
  description:
    "Terminale di trading per Betting Exchange (Betfair, Betdaq). Calcolo Green-Up, cash-out automatico, freebet a rischio zero e radar steam moves.",
  alternates: { canonical: "/trading" },
};

export const revalidate = 60;

export default async function TradingPage() {
  const now = new Date();
  const data = await getTradingOpportunities(now, 100);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
      {/* Header Trading */}
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-lg">
        <div
          aria-hidden
          className="absolute -top-24 -right-20 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl"
        />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-400 uppercase">
              Betting Exchange Trading Engine
            </p>
          </div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Trading su Quote & Green-Up
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Sfrutta la volatilità pre-gara per fare scalping sui cali di quota (Steam Moves).
            Entra in puntata (Back) sui movimenti iniziali e chiudi la posizione in bancata (Lay)
            per un profitto garantito senza dipendere dal risultato finale.
          </p>

          <div className="mt-6 flex flex-wrap gap-3 text-xs">
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Trade attivi: </span>
              <span className="font-bold text-white tabular-nums">
                {data.totalActive}
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Struttura Tick: </span>
              <span className="font-bold text-cyan-300">Standard Betfair Ladder</span>
            </div>
          </div>
        </div>
      </header>

      {/* Terminale Interattivo */}
      <TradingTerminalView initialTrades={data.trades} />

      {/* Guida Metodologica al Trading Sportivo */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm sm:p-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Metodologia e Strategie di Trading Exchange Pre-Match
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <h3 className="font-semibold text-slate-800">1. Scalping su Steam Move</h3>
            <p className="mt-1 leading-relaxed">
              Quando una notizia o un flusso di cassa pesante muove la linea sharp, il prezzo scenderà costantemente. Entrare in Back all'inizio del drop permette di accumulare tick di profitto.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">2. Hedging & Green-Up</h3>
            <p className="mt-1 leading-relaxed">
              Il calcolatore determina la quota di Lay necessaria affinché il bilancio finale risulti identico (in verde) su qualsiasi esito (Vittoria Casa, Pareggio, Vittoria Trasferta).
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">3. Strategia Freebet</h3>
            <p className="mt-1 leading-relaxed">
              In alternativa al Green-Up uniforme, puoi bancare solo lo stake iniziale, creando una scommessa gratuita a rischio zero che paga un profitto enorme se la squadra vince.
            </p>
          </div>
        </div>
        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          Dati aggiornati alle ore {fmtDateTime(data.generatedAt)}.
        </p>
      </section>
    </main>
  );
}
