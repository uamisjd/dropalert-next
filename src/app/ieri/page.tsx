/**
 * Pagina "Ieri — segnali ed esiti" — indirizzo pubblico /ieri.
 *
 * Server component: legge dal database a ogni richiesta, senza cache.
 * Mostra i segnali le cui partite si sono giocate ieri con l'esito
 * descrittivo centrata/mancata, calcolato DAI GOL FINALI registrati.
 * Mai dal CLV: l'esito dice che cosa è accaduto in campo, il CLV resta
 * l'unica misura di qualità del monitor, e la pagina lo dichiara.
 *
 * Regola della soglia: sotto dieci esiti risolti la pagina dice che non
 * è una tendenza. E l'avviso fisso: non è un rendimento né un consiglio.
 */
import Link from "next/link";
import { getYesterdayView, type YesterdayItem } from "@/lib/repo/yesterday";
import { fmtDay, fmtPrice, fmtTime } from "@/components/format";

/* ISR: la lettura di ieri si rigenera al massimo ogni 5 minuti.
   Il collector scrive su GitHub Actions e non dipende dal render, quindi una
   pagina servita dalla cache di bordo non blocca né ritarda la raccolta. La
   freschezza del dato resta dichiarata in pagina dal pannello «Stato dati». */
export const revalidate = 300;

export const metadata = {
  title: "Ieri — segnali ed esiti — DropAlert",
  description:
    "I movimenti rilevati sulle partite di ieri, con l'esito descrittivo centrata o mancata calcolato dai gol finali. Non è un rendimento né un consiglio.",
  alternates: { canonical: "/ieri" },
};

const VERDICT_STYLES: Record<string, string> = {
  centrata: "border-emerald-300 bg-emerald-50 text-emerald-900",
  mancata: "border-red-300 bg-red-50 text-red-900",
  in_attesa: "border-slate-300 bg-slate-100 text-slate-700",
  non_pubblicato: "border-amber-300 bg-amber-50 text-amber-900",
};

function VerdictBadge({ item }: { item: YesterdayItem }) {
  /* l'attesa scade: oltre le tre ore dal kickoff senza risultato non si
      aspetta più, si dichiara che la fonte non ha pubblicato */
  if (item.verdict === "in_attesa" && item.resultOverdue) {
    return (
      <span
        className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${VERDICT_STYLES.non_pubblicato}`}
        title={item.resultNote ?? "Risultato non pubblicato dalla fonte."}
      >
        Non pubblicato dalla fonte
      </span>
    );
  }
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${VERDICT_STYLES[item.verdict]}`}
      title={
        item.verdict === "in_attesa"
          ? "Partita da meno di tre ore: il risultato può non essere ancora registrato."
          : `Gol finali ${item.homeGoals}–${item.awayGoals}: esito calcolato dal risultato, non dal CLV.`
      }
    >
      {item.verdictLabel}
    </span>
  );
}

function SignalRow({ item }: { item: YesterdayItem }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Link
          href={`/matches/${item.matchId}`}
          className="text-sm font-semibold text-slate-900 underline-offset-2 hover:underline"
        >
          {item.homeTeam} <span className="text-slate-400">–</span>{" "}
          {item.awayTeam}
        </Link>
        <VerdictBadge item={item} />
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {item.league ?? "Competizione non attribuita"}
        {item.country ? <span className="text-slate-500"> ({item.country})</span> : null}
        <span className="mx-1.5 text-slate-300">|</span>
        kickoff {fmtTime(item.kickoffAt)}
        <span className="mx-1.5 text-slate-300">|</span>
        {item.marketLabel} · {item.selectionLabel}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        Quota al rilevamento {fmtPrice(item.detectedPrice)} · fiducia{" "}
        {item.confidenceLabel}
        {item.confidenceScore !== null
          ? ` (${item.confidenceScore.toFixed(0)}/100)`
          : ""}
        {item.resultSource !== null ? (
          <span
            className="ml-1.5 text-[11px] text-slate-500"
            title="La fonte primaria non ha pubblicato il punteggio: questo esito arriva da una fonte pubblica secondaria, dichiarata qui accanto."
          >
            (da fonte secondaria: {item.resultSource})
          </span>
        ) : null}
        {item.verdict === "in_attesa" && item.resultOverdue
          ? " — risultato non pubblicato dalla fonte: il collector verifica a ogni giro e lo dichiarerà appena arriva."
          : item.verdict === "in_attesa"
            ? " — partita recente: risultato in arrivo, nessun esito inventato."
            : ` — gol finali ${item.homeGoals}–${item.awayGoals}.`}
      </p>
    </li>
  );
}

export default async function YesterdayPage() {
  const now = new Date();

  let view = null;
  let failure: string | null = null;

  try {
    view = await getYesterdayView(now);
  } catch (error) {
    // Il dettaglio grezzo (driver SQL incluso) resta nel log del server: alla
    // pagina arriva solo un testo generico, mai `error.message`.
    console.error("[ieri] lettura dei segnali non riuscita:", error);
    failure = "lettura non riuscita (dettaglio nel log del server).";
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-5">
      <header className="mb-5">
        <nav className="mb-2 text-xs text-slate-500">
          <Link href="/" className="underline hover:text-slate-800">
            ← Torna ai movimenti
          </Link>
        </nav>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Ieri — segnali ed esiti
          {view !== null ? (
            <span className="ml-2 text-sm font-normal text-slate-500">
              {fmtDay(view.dayIso)}
            </span>
          ) : null}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          I movimenti rilevati dal monitor sulle partite giocate ieri
          (giornata italiana), ciascuno con il proprio esito descrittivo.{" "}
          <span className="font-medium text-slate-800">
            L&apos;esito è calcolato dai gol finali registrati, non dal CLV.
          </span>{" "}
          Senza risultato registrato resta «in attesa».
        </p>
      </header>

      {failure !== null ? (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 text-sm text-orange-900">
          <p className="font-medium">DATI PARZIALI</p>
          <p className="mt-1 text-xs leading-relaxed">
            I segnali di ieri non sono leggibili in questo momento ({failure})
            Nessun valore viene mostrato al suo posto.
          </p>
        </div>
      ) : view !== null ? (
        <>
          {/* riepilogo: i tre conteggi, la soglia, l'avviso fisso */}
          <section
            aria-labelledby="riepilogo-ieri"
            className="mb-5 rounded-lg border border-slate-200 bg-white p-4"
          >
            <h2
              id="riepilogo-ieri"
              className="mb-2 text-sm font-semibold tracking-wide text-slate-900 uppercase"
            >
              Come è andata
            </h2>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] text-emerald-800">Centrate</div>
                <div className="text-lg font-semibold tabular-nums text-emerald-900">
                  {view.tally.centrata}
                </div>
              </div>
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2">
                <div className="text-[11px] text-red-800">Mancate</div>
                <div className="text-lg font-semibold tabular-nums text-red-900">
                  {view.tally.mancata}
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-600">In attesa</div>
                <div className="text-lg font-semibold tabular-nums text-slate-800">
                  {view.tally.in_attesa}
                </div>
                {view.overduePending > 0 ? (
                  <div className="text-[10px] leading-tight text-amber-800">
                    di cui {view.overduePending} oltre {view.graceHours} h: fonte che non
                    pubblica
                  </div>
                ) : null}
              </div>
            </div>

            {view.underpowered ? (
              <p className="mt-2 text-xs font-medium leading-relaxed text-slate-800">
                {view.settled} esiti risolti su {view.minForTrend}:{" "}
                <span className="underline">non è una tendenza</span>.
              </p>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                {view.settled} esiti risolti. I numeri descrivono ciò che è
                accaduto, non quanto vale il metodo.
              </p>
            )}

            <p className="mt-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
              <span className="font-semibold">{view.disclaimer}</span> L&apos;esito
              dei gol finali dice che cosa è accaduto in campo, non quanto è
              solido il segnale: la sola misura di qualità del monitor resta il
              CLV, il confronto fra la quota al rilevamento e la quota di
              chiusura. Questa pagina non lo usa e non lo sostituisce.
            </p>
          </section>

          <section aria-labelledby="segnali-ieri">
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-900 uppercase">
              Segnali di ieri
            </h2>
            {view.items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm leading-relaxed text-slate-600">
                <p className="font-medium text-slate-900">
                  Nessun segnale su partite giocate ieri.
                </p>
                <p className="mt-1 text-xs">
                  Può voler dire due cose, entrambe legittime: nessun movimento
                  ha superato la soglia di rumore, oppure la raccolta non ha
                  coperto quelle partite. La{" "}
                  <Link href="/coverage" className="underline hover:text-slate-900">
                    copertura della raccolta
                  </Link>{" "}
                  dice quante righe della fonte sono diventate osservazioni.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {view.items.map((item) => (
                  <SignalRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <footer className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
        <p>
          Gli esiti sono letture fattuali dei gol finali registrati
          dall&apos;archivio. Le partite senza risultato restano «in attesa» e
          non vengono completate con stime.
        </p>
      </footer>
    </main>
  );
}
