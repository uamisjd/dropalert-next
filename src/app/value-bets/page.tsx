/**
 * Pagina /value-bets — divario fra prezzo eseguibile e linea senza margine.
 *
 * Com'era nata: scanner «+EV» con quota fair No-Vig, edge medio, Kelly frazionaria e
 * puntata in euro. Quell'edge si calcolava sul prezzo di APERTURA (non più acquistabile)
 * contro una «fair» pari a `corrente × 1,045`, con un pavimento a +0,5% che rendeva ogni
 * segnale un'«opportunità attiva» — anche su partite già giocate. L'audit completo è in
 * `docs/STUDIO-VALUE-BETS.md`; qui resta la sola cosa che i dati permettono: misurare
 * quanto margine c'è dentro la quota che si potrebbe eseguire, confronto dopo confronto.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { getValueOpportunities } from "@/lib/repo/value-bets";
import { ValueScannerTable } from "@/components/ValueScannerTable";
import { fmtDateTime } from "@/components/format";

export const metadata: Metadata = {
  title: "Divario di prezzo contro linea no-vig — DropAlert",
  description:
    "Quanto margine resta dentro l'ultima quota letta, confronto per confronto, sulle partite non ancora al kickoff. Nessuna puntata consigliata: è una misura.",
  alternates: { canonical: "/value-bets" },
};

export const revalidate = 60; // rigenera ogni minuto

const signed = (v: number): string =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)} pp`;

export default async function ValueBetsPage() {
  const now = new Date();
  const data = await getValueOpportunities({}, now);
  const listed = data.opportunities.length;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-lg">
        <div
          aria-hidden
          className="absolute -top-24 -right-20 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl"
        />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <p className="text-xs font-bold tracking-[0.2em] text-emerald-400 uppercase">
              Misura del margine · nessun consiglio
            </p>
          </div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Divario di prezzo contro la linea no-vig
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Per ogni segnale non ancora al kickoff confrontiamo l&apos;ultima lettura del
            consenso con la linea senza margine (no-vig) dello stesso bookmaker sullo
            stesso mercato. È la stessa formula con cui nasce la quota fair di chiusura usata
            per il CLV, quindi le due misure sono comparabili. Il divario può essere
            negativo e viene mostrato tale: significa che il margine è tutto dentro la quota.
          </p>

          <div className="mt-6 flex flex-wrap gap-3 text-xs">
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Segnali letti: </span>
              <span className="font-bold text-white tabular-nums">{data.signalsRead}</span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Divario calcolabile: </span>
              <span className="font-bold text-white tabular-nums">{listed}</span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">di cui sopra zero: </span>
              <span className="font-bold text-emerald-400 tabular-nums">
                {data.withPositiveEdge}
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Divario medio: </span>
              <span className="font-bold tabular-nums text-white">
                {signed(data.averageEdgePct)}
              </span>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2">
              <span className="text-slate-400">Metodo: </span>
              <span className="font-bold text-cyan-300">
                no-vig proporzionale ({data.method})
              </span>
            </div>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            {data.dataNote} · riga generata alle {fmtDateTime(data.generatedAt)}.
          </p>
        </div>
      </header>

      {data.error !== null && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs leading-relaxed text-rose-900">
          <p className="font-semibold">Lettura dei dati non riuscita.</p>
          <p className="mt-1">
            Questa pagina non mostra numeri quando non può leggerli: niente zeri di
            ripiego, niente lista vuota scambiata per «nessuna occasione». Dettaglio:{' '}
            <code className="rounded bg-white/70 px-1">{data.error}</code>
          </p>
        </div>
      )}

      {listed === 0 && data.error === null && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
          <p className="font-semibold">
            Perché la lista è vuota: un divario si calcola solo su una partita non ancora al
            kickoff, con tutte le selezioni del mercato lette dallo stesso bookmaker alla
            stessa ora.
          </p>
          <p className="mt-1">
            Non viene riempita con stime. Se il dato manca, la riga non c&apos;è: è il modo in
            cui questo sito scrive qualsiasi numero ({data.skipped.incompleteLine} segnali
            scartati per linea incompleta, {data.skipped.kickoffPassed} già al kickoff,{" "}
            {data.skipped.notPlayable} non più giocabili).
          </p>
        </div>
      )}

      <ValueScannerTable scanner={data} />

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 shadow-sm sm:p-6">
        <h2 className="text-sm font-bold tracking-wide text-slate-900 uppercase">
          Che cosa legge questa pagina, e che cosa no
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <h3 className="font-semibold text-slate-800">1. Il divario</h3>
            <p className="mt-1 leading-relaxed">
              Togliamo il margine dalla linea letta (somma delle probabilità implicata,
              divisa per se stessa) e confrontiamo il risultato con la quota che si
              potrebbe eseguire. Se la quota è sotto la linea senza margine, il divario è
              negativo: è la condizione normale, non un guasto.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">2. Che cosa non è misurabile qui</h3>
            <p className="mt-1 leading-relaxed">
              La fonte espone un solo operatore, quindi non esiste una linea di mercato
              indipendente da cui far discendere un valore atteso: no-vig dello stesso
              bookmaker significa auto-confronto, e i valori restano piccoli e quasi
              sempre negativi. L&apos;apertura non è un&apos;offerta: il calo è descritto in
              &laquo;quota x% dall&apos;apertura&raquo;, non trasformato in edge.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800">3. Come si valida</h3>
            <p className="mt-1 leading-relaxed">
              Un&apos;ipotesi di valore si verifica alla chiusura, non all&apos;apertura: le
              partite concluse stanno in{" "}
              <Link href="/ieri" className="underline">
                /ieri
              </Link>
              , la misura del confronto con la chiusura è in{" "}
              <Link href="/performance" className="underline">
                /performance
              </Link>{" "}
              (CLV medio, che oggi è negativo), la regola di lettura in{" "}
              <Link href="/metodologia" className="underline">
                /metodologia
              </Link>
              .
            </p>
          </div>
        </div>
        <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
          Nessun campo di questa pagina è una puntata da eseguire. Per giocare con i
          numeri — Kelly, varianza, surebet — ci sono gli&nbsp;
          <Link href="/strumenti" className="underline">
            strumenti
          </Link>
          , dove i valori li inserisci tu; per i limiti personali,&nbsp;
          <Link href="/gioco-responsabile" className="underline">
            gioco responsabile
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
