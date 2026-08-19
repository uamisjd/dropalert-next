/**
 * Sezione "Performance in maturazione".
 *
 * Vincoli non negoziabili applicati qui:
 *  1. sotto le 30 osservazioni il dato è marcato NON CONCLUDENTE, in colore
 *     neutro, con `n` sempre accanto al numero;
 *  2. questa sezione non è mai in evidenza: sta in fondo, dopo i segnali;
 *  3. la riga esplicativa sul valore dei campioni piccoli è fissa;
 *  4. nessun badge, classifica o testo celebrativo è costruito su questo dato.
 */
import type { ClvMaturity } from "@/lib/repo/dashboard";
import { CLV_INCONCLUSIVE_BELOW } from "@/lib/repo/dashboard";
import { InconclusiveBadge } from "./Badges";
import { ND, fmtDateTime, fmtPp, fmtRate } from "./format";

export function ClvSection({ clv }: { clv: ClvMaturity }) {
  const hasAny = clv.sampleSize > 0;

  return (
    <section
      aria-labelledby="performance"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2
          id="performance"
          className="text-sm font-semibold tracking-wide text-slate-700 uppercase"
        >
          Performance in maturazione
        </h2>
        <InconclusiveBadge n={clv.sampleSize} />
      </div>

      <p className="mb-3 text-xs leading-relaxed text-slate-600">
        Il CLV misura se la quota al momento del segnale era migliore della
        quota di chiusura. È l&apos;unico criterio di qualità che il monitor
        applica a sé stesso: non riguarda l&apos;esito della partita.
      </p>

      {/* riga esplicativa fissa, richiesta dai vincoli */}
      <p className="mb-3 rounded border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-800">
        {clv.note}
      </p>

      {hasAny ? (
        <>
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded border border-slate-200 px-3 py-2">
              <div className="text-[11px] text-slate-500">
                {`CLV medio (n=${clv.sampleSize})`}
              </div>
              <div className="text-lg font-semibold tabular-nums text-slate-700">
                {fmtPp(clv.avgClvPp)}
              </div>
            </div>
            <div className="rounded border border-slate-200 px-3 py-2">
              <div className="text-[11px] text-slate-500">
                {`Segnali che battono la chiusura (n=${clv.sampleSize})`}
              </div>
              <div className="text-lg font-semibold tabular-nums text-slate-700">
                {fmtRate(clv.beatCloseRate)}
              </div>
            </div>
            <div className="rounded border border-slate-200 px-3 py-2">
              <div className="text-[11px] text-slate-500">Osservazioni</div>
              <div className="text-lg font-semibold tabular-nums text-slate-700">
                {clv.sampleSize} / {CLV_INCONCLUSIVE_BELOW}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Fascia di indice</th>
                  <th className="py-1.5 pr-3 font-medium">n</th>
                  <th className="py-1.5 pr-3 font-medium">CLV medio</th>
                  <th className="py-1.5 font-medium">Batte la chiusura</th>
                </tr>
              </thead>
              <tbody>
                {clv.buckets.map((b) => (
                  <tr key={b.key} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3 text-slate-700">{b.label}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-slate-700">
                      {b.sampleSize}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums text-slate-700">
                      {fmtPp(b.avgClvPp)}
                    </td>
                    <td className="py-1.5 tabular-nums text-slate-700">
                      {fmtRate(b.beatCloseRate)}
                      {b.inconclusive && (
                        <span className="ml-1.5 text-slate-500">
                          non concludente
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-700">
          <p className="mb-1 font-medium text-slate-900">
            Nessuna osservazione di CLV disponibile.
          </p>
          <p>
            Il CLV si calcola solo quando un segnale rilevato raggiunge il
            calcio d&apos;inizio e la sua quota di chiusura viene registrata.
            {clv.pendingClosings > 0 ? (
              <>
                {" "}
                Al momento ci sono{" "}
                <span className="font-medium tabular-nums">
                  {clv.pendingClosings}
                </span>{" "}
                partite monitorate in attesa di chiusura
                {clv.nextClosingAt
                  ? `, la prima il ${fmtDateTime(clv.nextClosingAt)}`
                  : ""}
                . Le partite senza segnale non producono CLV: la metrica misura
                i segnali, non il calendario.
              </>
            ) : (
              <> Nessuna partita monitorata è al momento in attesa di chiusura.</>
            )}
          </p>
          <p className="mt-1 text-slate-600">
            Storico attuale: {ND}. Il dato comparirà da solo, quando esisterà.
          </p>
        </div>
      )}
    </section>
  );
}
