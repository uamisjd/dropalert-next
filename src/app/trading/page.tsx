/**
 * Pagina /trading — escursione dei prezzi e green-up calcolato a ritroso.
 *
 * Com'era nata: "Terminale di trading per Betting Exchange" con "profitto garantito
 * senza dipendere dal risultato finale". Un exchange non viene letto da nessuna parte:
 * i due prezzi della riga sono entrambi quote di consenso dello stesso operatore, e la
 * commissione è un'assunzione. La pagina misura il movimento e dice quanto varrebbe
 * chiuderlo fra quei due numeri; il resto è nel calcolatore, dove i valori li inserisce
 * chi legge. Audit: `docs/STUDIO-VALUE-BETS.md` §2.6.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { getTradingOpportunities } from "@/lib/repo/trading-opportunities";
import { TradingTerminalView } from "@/components/trading/TradingTerminalView";
import { fmtDateTime } from "@/components/format";

export const metadata: Metadata = {
  title: "Escursione dei prezzi e green-up a ritroso — DropAlert Pro",
  description:
    "Quanto si è mossa una quota fra apertura e ultima lettura, in tick, e quanto varrebbe chiudere la posizione fra quei due prezzi. Nessun exchange è collegato.",
  alternates: { canonical: "/trading" },
};

export const revalidate = 60;

export default async function TradingPage() {
  const now = new Date();
  const data = await getTradingOpportunities(now, 100);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-lg">
        <div
          aria-hidden
          className="absolute -top-24 -right-20 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl"
        />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-cyan-400" />
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-400 uppercase">
              Movimento del prezzo · lettura a ritroso
            </p>
          </div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Quanto si è mosso il prezzo, e quanto valeva chiuderlo
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Ogni riga è un calo di quota osservato dal collettore su una selezione già
            segnalata: distanza in tick fra le due letture e risultato aritmetico del
            chiuderle. Non è una posizione apribile — i prezzi di bancata di un exchange
            non sono fra i dati letti qui, e la commissione è un&apos;ipotesi di
            calcolatore, non una tariffa rilevata.
          </p>

          <div className="mt-6 flex flex-wrap gap-3 text-xs">
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Escursioni rilevate: </span>
              <span className="font-bold text-white tabular-nums">{data.trades.length}</span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Segnali letti: </span>
              <span className="font-bold text-white tabular-nums">{data.signalsRead}</span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Struttura tick: </span>
              <span className="font-bold text-amber-300">Betfair ladder, assunta</span>
            </div>
          </div>
        </div>
      </header>

      <TradingTerminalView trades={data.trades} signalsRead={data.signalsRead} />

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm sm:p-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Che cosa si può dire di un movimento, con questi dati
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <h3 className="font-semibold text-slate-800">1. Che cosa è misurato</h3>
            <p className="mt-1 leading-relaxed">
              Due letture dello stesso mercato: prezzo d&apos;apertura e ultima lettura. Da
              quelle derivano la variazione percentuale, la distanza in tick e il movimento
              confermato nel tempo. Sono numeri del collettore, con la loro età e i loro
              buchi.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">2. Che cosa manca per chiamarlo trade</h3>
            <p className="mt-1 leading-relaxed">
              Un&apos;operazione di exchange ha due gambe: il prezzo a cui stai dentro e
              quello a cui esci, con profondità e commissione reali. Qui la seconda gamba
              è la stessa fonte di quote d&apos;offerta della prima: il green-up della riga
              è quindi un &laquo;quanto valeva&raquo;, non un &laquo;quanto incassi&raquo;.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">3. Il calcolatore, invece</h3>
            <p className="mt-1 leading-relaxed">
              Sopra questa nota c&apos;è il calcolatore di green-up: lì i tre valori li
              scrivi tu (quota di entrata, quota di uscita, commissione del tuo conto) e
              ottieni l&apos;aritmetica esatta. È lo stesso criterio di{" "}
              <Link href="/strumenti" className="underline">
                /strumenti
              </Link>
              : la pagina non precarica nulla dai segnali.
            </p>
          </div>
        </div>
        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          Letture aggiornate alle {fmtDateTime(data.generatedAt)} · la misura di qualità
          del resto del sito è il CLV, in{" "}
          <Link href="/performance" className="underline">
            /performance
          </Link>
          . Per i limiti personali:{" "}
          <Link href="/gioco-responsabile" className="underline">
            /gioco-responsabile
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
