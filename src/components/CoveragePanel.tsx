/**
 * Pannello "Copertura della raccolta".
 *
 * Dichiarativo per costruzione: mostra quante righe la fonte esponeva,
 * quante ne abbiamo prese, quante ne mancano **in numero assoluto**, e
 * dove sono finite quelle non importate. La percentuale è presente ma
 * subordinata: su undici righe non è la cosa più informativa.
 *
 * Nessun allarme, nessun colore che suggerisca un giudizio sulla qualità
 * del monitor. Il rosso è usato solo per le perdite effettive, che sono
 * un fatto contato, non un'opinione.
 */
import {
  KIND_LABELS,
  SERIES_INSUFFICIENT_TEXT,
  coverageLabel,
  type CoverageView,
  type ReasonKind,
} from "@/lib/cov/view";
import { fmtDateTime } from "./format";

const KIND_STYLES: Record<ReasonKind, string> = {
  fuori_perimetro: "text-slate-500",
  limite_fonte: "text-amber-700",
  perdita: "text-red-700",
  non_classificato: "text-slate-500",
};

function Stat({
  label,
  value,
  hint,
  strong = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] leading-tight text-slate-500" title={hint}>
        {label}
      </div>
      <div
        className={`text-lg font-semibold tabular-nums ${
          strong ? "text-slate-900" : "text-slate-700"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export function CoveragePanel({
  view,
  children,
}: {
  view: CoverageView;
  /** slot per il pulsante di raccolta, che è un componente client */
  children?: React.ReactNode;
}) {
  /* righe che il giro non ha saputo attribuire: si dichiarano, non si
     assegnano d'ufficio a una categoria */
  const unclassified = view.reasons
    .filter((r) => r.kind === "non_classificato")
    .reduce((sum, r) => sum + r.count, 0);

  return (
    <section
      aria-labelledby="copertura"
      className="rounded-lg border border-slate-200 bg-slate-50 p-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="copertura"
          className="text-sm font-semibold tracking-wide text-slate-900 uppercase"
        >
          Copertura della raccolta
        </h2>
        {children}
      </div>

      <p className="mb-3 text-xs leading-relaxed text-slate-600">
        Quante righe di calcio dell&apos;elenco della fonte sono diventate una
        partita con almeno una quota in archivio. Descrive la completezza del
        dato raccolto, non la qualità dei movimenti osservati.
      </p>

      {!view.measured ? (
        /* assenza di misura: dichiarata, mai convertita in uno zero */
        <div className="rounded border border-slate-400 bg-slate-100 px-3 py-3 text-sm text-slate-800">
          <p className="font-medium">NON MISURATO</p>
          <p className="mt-1 text-xs leading-relaxed">
            {view.notMeasuredLabel}
          </p>
        </div>
      ) : (
        <>
          {/* --- ultimo giro --------------------------------------- */}
          <div className="mb-1 text-[11px] text-slate-500">
            Ultimo giro strumentato
            {view.runId !== null ? ` · run ${view.runId}` : ""}
            {view.measuredAt !== null
              ? ` · ${fmtDateTime(view.measuredAt)}`
              : ""}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label="Righe viste"
              value={view.seen}
              hint="Righe partita presenti nell'elenco della fonte, tutti gli sport compresi."
            />
            <Stat
              label="Di calcio"
              value={view.football}
              strong
              hint="Il denominatore: le righe di cui questo monitor risponde."
            />
            <Stat
              label="Importate"
              value={view.imported}
              strong
              hint="Partite scritte in archivio con almeno una quota registrata."
            />
            <Stat
              label="Perse"
              value={view.lost}
              strong
              hint="Numero assoluto di righe di calcio non diventate dato utile."
            />
          </div>

          <p className="mb-3 text-xs text-slate-600">
            Copertura sul calcio:{" "}
            <span className="font-semibold tabular-nums text-slate-900">
              {coverageLabel(view.coverage)}
            </span>
            {view.football > 0 && view.football < 20 ? (
              <>
                {" "}
                — calcolata su {view.football} righe. Con un campione così
                piccolo una sola partita sposta la percentuale di diversi
                punti: il numero assoluto delle perse è più informativo.
              </>
            ) : null}
          </p>

          {/* --- dove sono finite le non importate ------------------ */}
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Dove sono finite le righe non importate
          </h3>

          <div className="mb-2 overflow-hidden rounded border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                  <th className="px-3 py-1.5 font-medium">Motivo</th>
                  <th className="px-3 py-1.5 text-right font-medium">Righe</th>
                  <th className="hidden px-3 py-1.5 font-medium sm:table-cell">
                    Natura
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.reasons.map((r) => (
                  <tr
                    key={r.reason}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-3 py-1.5 text-slate-700" title={r.description}>
                      {r.label}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-semibold tabular-nums ${
                        r.count === 0 ? "text-slate-400" : KIND_STYLES[r.kind]
                      }`}
                    >
                      {r.count}
                    </td>
                    <td
                      className={`hidden px-3 py-1.5 sm:table-cell ${KIND_STYLES[r.kind]}`}
                    >
                      {KIND_LABELS[r.kind]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
            Solo <span className="font-medium text-red-700">Senza quote</span> e{" "}
            <span className="font-medium text-red-700">Non raggiunte</span> sono
            perdite attribuibili al monitor: in questo giro sono{" "}
            <span className="font-semibold tabular-nums">
              {view.lossesDeclared}
            </span>
            . Le righe di altri sport e le fixture dimostrative sono fuori
            perimetro; la quota per singolo bookmaker non è pubblicata entro il
            robots.txt della fonte ed è un limite dichiarato, non una perdita.
            {unclassified > 0 ? (
              <>
                {" "}
                Restano{" "}
                <span className="font-semibold tabular-nums">
                  {unclassified}
                </span>{" "}
                righe con motivo non attribuito: non sono conteggiate né fra le
                perdite né fuori perimetro, perché il giro non ha saputo dire
                dove sono finite.
              </>
            ) : null}
          </p>

          {/* --- competizioni --------------------------------------- */}
          {view.competitions.length > 0 ? (
            <details className="mb-3 rounded border border-slate-200 bg-white px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                Dettaglio per competizione ({view.competitions.length})
              </summary>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1 font-medium">Competizione</th>
                    <th className="py-1 text-right font-medium">Viste</th>
                    <th className="py-1 text-right font-medium">Importate</th>
                    <th className="py-1 text-right font-medium">Perse</th>
                  </tr>
                </thead>
                <tbody>
                  {view.competitions.map((c) => (
                    <tr key={c.competition} className="border-t border-slate-100">
                      <td className="py-1 text-slate-700">{c.competition}</td>
                      <td className="py-1 text-right tabular-nums text-slate-600">
                        {c.seen}
                      </td>
                      <td className="py-1 text-right tabular-nums text-slate-600">
                        {c.imported}
                      </td>
                      <td
                        className={`py-1 text-right font-medium tabular-nums ${
                          c.lost === 0 ? "text-slate-400" : "text-red-700"
                        }`}
                      >
                        {c.lost}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
        </>
      )}

      {/* --- profondità della serie: sempre visibile ---------------- */}
      <div className="rounded border border-slate-300 bg-white px-3 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-slate-700">
            Profondità dell&apos;osservazione
          </span>
          <span className="text-xs font-semibold tabular-nums text-slate-900">
            {view.seriesLabel}
          </span>
        </div>
        {view.seriesInsufficient ? (
          <p className="mt-1 text-xs font-medium text-slate-800">
            {SERIES_INSUFFICIENT_TEXT}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          {view.depth}
        </p>
        {view.manualRuns > 0 ? (
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {`I ${view.manualRuns} giri chiesti a mano restano nei totali ma non contano per la soglia: giri ravvicinati su richiesta sono la stessa fotografia ripetuta, non una serie.`}
          </p>
        ) : null}
        {view.schedulerLabel !== null ? (
          <p
            className={
              view.schedulerUncertain
                ? "mt-1 text-[11px] leading-relaxed text-amber-700"
                : "mt-1 text-[11px] leading-relaxed text-slate-600"
            }
          >
            {view.schedulerUncertain ? "⚠ " : ""}
            {view.schedulerLabel}
          </p>
        ) : null}
        {view.runsWithoutMeasure > 0 ? (
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {view.runsWithoutMeasure} giri letti sono precedenti alla
            strumentazione e non hanno la misura: contano come non misurati,
            non come copertura zero.
          </p>
        ) : null}
      </div>

      {view.notes.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-slate-500">
          {view.notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
