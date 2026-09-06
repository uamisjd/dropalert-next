/**
 * Pagina /smart-bets — segnali ad alto valore per uso personale.
 *
 * Questa pagina è per il proprietario del sito. Combina i value bets con
 * edge positivo significativo (> 2%) e li ordina per punteggio combinato.
 *
 * Punteggio Smart (max 100):
 * - Edge (40 punti): edge% normalizzato (max 10% = 40 punti)
 * - Kelly (20 punti): kelly% normalizzato (max 5% = 20 punti)
 * - Quota (20 punti): quote tra 1.80 e 3.00 ottengono max punteggio
 * - Freshness (20 punti): lettura recente (< 30 min = 20 punti)
 *
 * Uso personale: questa pagina non è nella navigazione pubblica.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { getValueOpportunities } from "@/lib/repo/value-bets";
import { SmartBetsTable } from "@/components/SmartBetsTable";
import { fmtDateTime } from "@/components/format";

export const metadata: Metadata = {
  title: "Smart Bets — Segnali ad alto valore — DropAlert",
  description:
    "Value bets con edge > 2% ordinati per punteggio combinato. Uso personale.",
  alternates: { canonical: "/smart-bets" },
};

export const revalidate = 60; // rigenera ogni minuto

export default async function SmartBetsPage() {
  const now = new Date();
  const data = await getValueOpportunities({}, now);

  // Filtra solo edge > 2% (soglia alta per uso personale)
  const smartBets = data.opportunities.filter((opp) => opp.edgePct >= 2);
  const totalPositive = data.withPositiveEdge;

  // Calcola statistiche
  const avgEdge =
    smartBets.length > 0
      ? smartBets.reduce((sum, opp) => sum + opp.edgePct, 0) / smartBets.length
      : 0;
  const maxEdge =
    smartBets.length > 0
      ? Math.max(...smartBets.map((opp) => opp.edgePct))
      : 0;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-600 to-blue-700 px-6 py-8 text-white shadow-lg">
        <div
          aria-hidden
          className="absolute -top-24 -right-20 h-64 w-64 rounded-full bg-yellow-400/20 blur-3xl"
        />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
            <p className="text-xs font-bold tracking-[0.2em] text-yellow-300 uppercase">
              Uso personale · segnali premium
            </p>
          </div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Smart Bets
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-cyan-100 sm:text-base">
            Value bets con edge superiore al 2%, ordinati per punteggio combinato.
            Questa pagina filtra solo i segnali con margine significativo e li
            presenta in ordine di priorità. Nessuna garanzia di vincita: è una
            lettura dei dati, non un consiglio.
          </p>

          <div className="mt-6 flex flex-wrap gap-3 text-xs">
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-cyan-200">Smart bets: </span>
              <span className="font-bold text-yellow-300 tabular-nums">
                {smartBets.length}
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-cyan-200">Edge positivi totali: </span>
              <span className="font-bold text-white tabular-nums">
                {totalPositive}
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-cyan-200">Edge medio (smart): </span>
              <span className="font-bold text-emerald-300 tabular-nums">
                +{avgEdge.toFixed(2)}%
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-cyan-200">Edge massimo: </span>
              <span className="font-bold text-yellow-300 tabular-nums">
                +{maxEdge.toFixed(2)}%
              </span>
            </div>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-cyan-200">
            Soglia: edge ≥ 2% · riga generata alle {fmtDateTime(data.generatedAt)}.
          </p>
        </div>
      </header>

      {data.error !== null && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs leading-relaxed text-rose-900">
          <p className="font-semibold">Lettura dei dati non riuscita.</p>
          <p className="mt-1">
            {data.error} Il dettaglio tecnico resta nel log del server.
          </p>
        </div>
      )}

      {smartBets.length === 0 && data.error === null && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="text-sm font-semibold text-amber-900">
            Nessun smart bet disponibile
          </p>
          <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-amber-800">
            Al momento non ci sono value bets con edge ≥ 2%. Questo è normale: i
            segnali ad alto valore sono rari. Controlla più tardi o abbassa la
            soglia in{" "}
            <Link href="/value-bets" className="underline font-medium">
              /value-bets
            </Link>{" "}
            per vedere tutti i divari positivi.
          </p>
          <p className="mt-3 text-xs text-amber-700">
            Segnali letti: {data.signalsRead} · Edge positivi: {totalPositive} ·
            Max edge: +{maxEdge.toFixed(2)}%
          </p>
        </div>
      )}

      {smartBets.length > 0 && <SmartBetsTable opportunities={smartBets} />}

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm sm:p-6">
        <h2 className="text-sm font-bold tracking-wide text-slate-900 uppercase">
          Come leggere il punteggio Smart
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="font-semibold text-slate-800">1. Punteggio combinato</h3>
            <p className="mt-1 leading-relaxed">
              Il punteggio Smart (0-100) combina quattro fattori: edge (40%),
              Kelly (20%), quota (20%), freshness (20%). Un punteggio alto
              significa che tutti i fattori sono favorevoli.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">2. Edge ≥ 2%</h3>
            <p className="mt-1 leading-relaxed">
              La soglia del 2% è arbitraria ma ragionevole: sotto questa soglia
              il margine è piccolo e la varianza domina. Sopra il 2% il segnale
              è statisticamente più interessante, ma non garantisce vincita.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">3. Kelly frazionaria</h3>
            <p className="mt-1 leading-relaxed">
              Il Kelly mostrato è frazionario (25% del Kelly pieno): riduce la
              varianza e il drawdown. Con bankroll €1000 e Kelly 2%, la puntata
              è €20. Mai puntare più del 5% del bankroll su una singola scommessa.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">4. Validazione</h3>
            <p className="mt-1 leading-relaxed">
              Un segnale si valida alla chiusura, non all&apos;apertura. Usa{" "}
              <Link href="/mio-bankroll" className="underline">
                /mio-bankroll
              </Link>{" "}
              per tracciare le scommesse e misurare il CLV medio. Obiettivo: CLV
              &gt; +2% su 30+ scommesse.
            </p>
          </div>
        </div>
        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          Questa pagina è per uso personale. I dati sono una lettura del mercato,
          non un consiglio di gioco. Nessuna vincita è garantita.
        </p>
      </section>
    </main>
  );
}
