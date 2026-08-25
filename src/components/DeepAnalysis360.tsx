/**
 * Sezione «Analisi 360° completa» del dettaglio partita.
 *
 * Collassabile, sotto il Contesto 360°. Gli schemi vengono stampati in
 * blocchi monospaziati con scorrimento orizzontale disattivato: sono già
 * larghi al massimo 32 colonne per costruzione, quindi stanno su un telefono
 * senza tagli. Ogni punto porta il proprio tag (fonte o ipotesi) e la
 * chiusura fissa non si può togliere.
 */
import type { AnalysisView } from "@/lib/repo/analysis";

function SchemaBlock({ title, body }: { title: string; body: string }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-[11px] tracking-wide text-slate-500 uppercase">
        {title}
      </figcaption>
      <pre className="overflow-x-auto rounded border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-[11px] leading-tight text-slate-800">
        {body}
      </pre>
    </figure>
  );
}

export function DeepAnalysis360({ view }: { view: AnalysisView }) {
  const a = view.analysis;

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold tracking-wide text-slate-700 uppercase">
        Analisi 360° completa
      </summary>

      {a === null ? (
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          {view.unavailableReason ?? "analisi non disponibile"}. Nessun
          contenuto viene inventato al suo posto.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          <p className="text-sm leading-relaxed text-slate-800">{a.headline}</p>

          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-700 uppercase">
              Matrice dei fattori chiave
            </h3>
            <p className="border-l-2 border-slate-400 pl-3 text-sm leading-relaxed font-medium text-slate-900">
              {a.matrice}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SchemaBlock title="Schema 1 — confronto ad albero" body={a.schemaAlbero} />
            <SchemaBlock title="Schema 2 — incrocio vettoriale" body={a.schemaVettore} />
          </div>

          <div className="space-y-3">
            {a.punti.map((p, i) => (
              <div key={i} className="rounded border border-slate-200 px-3 py-2">
                <h4 className="text-xs font-semibold text-slate-900">
                  {p.titolo}
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-700">
                  {p.testo}
                </p>
                <p className="mt-1 text-[10px] tracking-wide text-slate-400 uppercase">
                  {p.tag === "fonte"
                    ? "da fonte recuperata"
                    : "ipotesi, non verificata"}
                </p>
              </div>
            ))}
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-700 uppercase">
              Scenario logico di lettura
            </h3>
            <p className="text-xs leading-relaxed text-slate-700">{a.scenario}</p>
          </div>

          <p className="border-t border-slate-200 pt-2 text-[11px] leading-relaxed text-slate-500">
            {a.closing} Nessun esito consigliato e nessuna giocata suggerita:
            l&apos;analisi descrive il mercato, non il risultato. Generata una
            sola volta e conservata 24 ore ({view.usage.used}/{view.usage.limit}{" "}
            chiamate al modello oggi).
          </p>
        </div>
      )}
    </details>
  );
}
