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

      {/* base di confronto: va letta PRIMA del numero, non dopo. Con basi
          miste la media sotto somma numeri non confrontabili, e chi legge ha
          diritto di saperlo prima di darle un significato. */}
      <p
        className={`mb-3 rounded border px-3 py-2 text-xs leading-relaxed ${
          clv.basis.mixed
            ? "border-amber-300 bg-amber-50 text-amber-900"
            : "border-slate-200 bg-white text-slate-600"
        }`}
      >
        <span className="font-semibold">Base di confronto del CLV. </span>
        {clv.basisNote}
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

          <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
            Le fasce di questa tabella sono sull&apos;indice grezzo su 100: è la
            scala con cui i CLV sono stati registrati nello storico e
            ricalcolarla a posteriori cambierebbe i dati già pubblicati. Sulle
            card la fascia è invece letta su base misurabile — alta da 78, media
            da 60 — e la differenza è dichiarata proprio per non confonderle.
          </p>

          {/* Tetto strutturale: una fascia vuota sopra il tetto non significa
              «nessun segnale abbastanza buono», significa che nessun segnale
              può arrivarci. Senza questa riga la tabella si legge come un
              risultato, ed è esattamente l'errore che R2 non poteva escludere. */}
          <p className="mb-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
            <span className="font-semibold">
              Tetto dell&apos;indice: {clv.ceiling.maxRaw} su 100
              {clv.ceiling.singleSource ? " (fonte singola)" : ""}. </span>
            {clv.ceilingNote}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th
                    className="py-1.5 pr-3 font-medium"
                    title="Fasce dell'indice grezzo su 100, la scala con cui i CLV sono stati registrati nello storico. La fascia mostrata sulle card è invece letta su base misurabile: sono due scale diverse e qui è dichiarato quale si sta usando."
                  >
                    Fascia di indice (grezzo /100)
                  </th>
                  <th className="py-1.5 pr-3 font-medium">n</th>
                  <th className="py-1.5 pr-3 font-medium">CLV medio</th>
                  <th className="py-1.5 font-medium">Batte la chiusura</th>
                </tr>
              </thead>
              <tbody>
                {clv.buckets.map((b) => (
                  <tr
                    key={b.key}
                    className={`border-b border-slate-100 ${
                      b.unreachable ? "text-slate-400" : ""
                    }`}
                  >
                    <td className="py-1.5 pr-3 text-slate-700">
                      {b.label}
                      {b.unreachable && (
                        <span
                          className="ml-1.5 rounded border border-slate-300 bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-500"
                          title={`Sopra il tetto strutturale di ${clv.ceiling.maxRaw}: con la fonte attuale nessuna osservazione può cadere in questa fascia.`}
                        >
                          irraggiungibile
                        </span>
                      )}
                    </td>
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
