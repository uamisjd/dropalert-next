/**
 * Pagina /arbitrage — scanner di opportunità di surebet cross-bookmaker.
 *
 * Rileva opportunità di arbitraggio confrontando le quote migliori
 * disponibili per ogni selezione di un mercato su bookmaker diversi.
 *
 * Un'opportunità esiste quando la somma delle probabilità implicite
 * (1/quota) è < 1, ovvero quando si può scommettere su tutti gli esiti
 * e garantire un profitto indipendentemente dal risultato.
 *
 * Raggiungibile dalla navigazione principale (voce «Arbitrage» in SiteNav,
 * accanto a «Surebet (calcolo)», di cui è la versione automatica).
 * L'arbitraggio richiede account attivi su più bookmaker, liquidità
 * sufficiente, velocità di esecuzione e verifica dei limiti di puntata.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { scanArbitrage } from "@/lib/quant/arbitrage";
import {
  ArbitrageTable,
  type ArbitrageRow,
} from "@/components/ArbitrageTable";
import { fmtDateTime } from "@/components/format";

export const metadata: Metadata = {
  title: "Arbitrage Scanner — Surebet cross-bookmaker — DropAlert",
  description:
    "Scanner di opportunità di arbitraggio cross-bookmaker. Uso personale.",
  alternates: { canonical: "/arbitrage" },
};

export const revalidate = 60; // rigenera ogni minuto

export default async function ArbitragePage() {
  const now = new Date();
  const result = await scanArbitrage(0.5, now); // soglia minima 0.5%

  const totalProfit = result.opportunities.reduce(
    (sum, opp) => sum + opp.profitPct,
    0,
  );
  const avgProfit =
    result.opportunities.length > 0
      ? totalProfit / result.opportunities.length
      : 0;
  const maxProfit =
    result.opportunities.length > 0
      ? Math.max(...result.opportunities.map((o) => o.profitPct))
      : 0;

  /* Età della lettura calcolata qui (server), alla generazione: la tabella è
     un client component e non deve chiamare Date.now() nel render. */
  const opportunities: ArbitrageRow[] = result.opportunities.map((opp) => ({
    ...opp,
    lineAgeMinutes: Math.max(
      0,
      Math.round((now.getTime() - opp.collectedAt.getTime()) / 60_000),
    ),
  }));

  return (
    <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-purple-700 to-indigo-800 px-6 py-8 text-white shadow-lg">
        <div
          aria-hidden
          className="absolute -top-24 -right-20 h-64 w-64 rounded-full bg-yellow-400/20 blur-3xl"
        />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
            <p className="text-xs font-bold tracking-[0.2em] text-yellow-300 uppercase">
              Uso personale · arbitraggio matematico
            </p>
          </div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Arbitrage Scanner
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-purple-100 sm:text-base">
            Opportunità di surebet cross-bookmaker con profitto garantito ≥ 0.5%.
            Lo scanner confronta le quote migliori disponibili per ogni selezione
            e calcola il profitto matematico se tutte le quote sono eseguibili
            simultaneamente. Nessuna garanzia: le quote cambiano in secondi e i
            bookmaker limitano.
          </p>

          <div className="mt-6 flex flex-wrap gap-3 text-xs">
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-purple-200">Opportunità: </span>
              <span className="font-bold text-yellow-300 tabular-nums">
                {result.opportunities.length}
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-purple-200">Partite scansionate: </span>
              <span className="font-bold text-white tabular-nums">
                {result.matchesScanned}
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-purple-200">Mercati scansionati: </span>
              <span className="font-bold text-white tabular-nums">
                {result.marketsScanned}
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-purple-200">Profitto medio: </span>
              <span className="font-bold text-emerald-300 tabular-nums">
                +{avgProfit.toFixed(2)}%
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-purple-200">Profitto massimo: </span>
              <span className="font-bold text-yellow-300 tabular-nums">
                +{maxProfit.toFixed(2)}%
              </span>
            </div>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-purple-200">
            Soglia: profitto ≥ 0.5% · Finestra: {result.windowHours}h · Riga
            generata alle {fmtDateTime(result.scannedAt)}.
          </p>
        </div>
      </header>

      {result.error !== null && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs leading-relaxed text-rose-900">
          <p className="font-semibold">Scansione non riuscita.</p>
          <p className="mt-1">
            {result.error} Il dettaglio tecnico resta nel log del server.
          </p>
        </div>
      )}

      {result.opportunities.length === 0 && result.error === null && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="text-sm font-semibold text-amber-900">
            Nessuna opportunità di arbitraggio disponibile
          </p>
          <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-amber-800">
            Al momento non ci sono surebet con profitto ≥ 0.5%. Questo è normale:
            le opportunità di arbitraggio sono rare e durano pochi secondi.
            Controlla più tardi o abbassa la soglia (modifica il codice in{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-[10px]">
              src/lib/quant/arbitrage.ts
            </code>
            ).
          </p>
          <p className="mt-3 text-xs text-amber-700">
            Partite scansionate: {result.matchesScanned} · Mercati scansionati:{" "}
            {result.marketsScanned}
          </p>
        </div>
      )}

      {result.opportunities.length > 0 && (
        <ArbitrageTable opportunities={opportunities} />
      )}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm sm:p-6">
        <h2 className="text-sm font-bold tracking-wide text-slate-900 uppercase">
          Come funziona l&apos;arbitraggio
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="font-semibold text-slate-800">1. Surebet matematica</h3>
            <p className="mt-1 leading-relaxed">
              Un&apos;opportunità di arbitraggio esiste quando la somma delle
              probabilità implicite (1/quota) delle migliori quote disponibili
              per ogni selezione è &lt; 1. In quel caso, scommettendo
              proporzionalmente su tutti gli esiti si garantisce un profitto.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">2. Requisiti pratici</h3>
            <p className="mt-1 leading-relaxed">
              L&apos;arbitraggio richiede: account attivi su più bookmaker,
              liquidità sufficiente su tutti i bookmaker, velocità di
              esecuzione (le quote cambiano in secondi), verifica dei limiti di
              puntata. Senza questi requisiti, l&apos;opportunità resta teorica.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">3. Rischi</h3>
            <p className="mt-1 leading-relaxed">
              Le quote cambiano in secondi: un&apos;opportunità rilevata ora
              potrebbe non essere più eseguibile quando piazzi la scommessa. I
              bookmaker limitano gli account che fanno arbitraggio. Le
              scommesse possono essere annullate se il bookmaker rileva un
              errore nelle quote.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">4. Validazione</h3>
            <p className="mt-1 leading-relaxed">
              Questa pagina mostra opportunità teoriche basate sui dati
              disponibili. Non verifica che le quote siano ancora eseguibili né
              che i bookmaker accettino le puntate. Usa{" "}
              <Link href="/strumenti" className="underline">
                /strumenti
              </Link>{" "}
              per calcolare gli stake esatti prima di piazzare le scommesse.
            </p>
          </div>
        </div>
        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          Questa pagina è per uso personale. Le opportunità mostrate sono
          calcoli matematici, non garanzie di profitto. L&apos;arbitraggio
          comporta rischi pratici significativi.
        </p>
      </section>
    </main>
  );
}
