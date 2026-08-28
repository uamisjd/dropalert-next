/**
 * Sezione «Analisi 360° completa» del dettaglio partita.
 *
 * Collassabile, sotto il Contesto 360°. Ogni punto porta il proprio tag
 * (fonte o ipotesi) e la chiusura fissa non si può togliere.
 *
 * Gli schemi ASCII che stavano qui sono stati rimossi: ridisegnavano in
 * caratteri quello che le righe accanto già dicevano in italiano, e un
 * disegno che ripete non informa — occupa spazio e basta.
 */
import type { AnalysisView } from "@/lib/repo/analysis";
import { COERENZA_LABELS, type CoerenzaValue } from "@/lib/context/analysis";

/* Il verdetto non è un voto: è una dichiarazione su quanto sappiamo. Grigi
   e basta — un semaforo verde/rosso suggerirebbe un giudizio di merito. */
const COERENZA_STYLES: Record<CoerenzaValue, string> = {
  spiegato: "border-slate-700 bg-slate-800 text-slate-100",
  parziale: "border-slate-400 bg-slate-100 text-slate-900",
  "non spiegato": "border-dashed border-slate-400 bg-white text-slate-700",
};

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

          {/* La risposta alla domanda per cui questa sezione esiste: il
              contesto regge il movimento? Sta in cima perché è il punto. */}
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                  COERENZA_STYLES[a.coerenza]
                }`}
              >
                {COERENZA_LABELS[a.coerenza]}
              </span>
              <span className="text-[11px] tracking-wide text-slate-500 uppercase">
                coerenza col movimento
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-700">
              {a.coerenzaMotivo}
            </p>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-700 uppercase">
              Matrice dei fattori chiave
            </h3>
            <p className="border-l-2 border-slate-400 pl-3 text-sm leading-relaxed font-medium text-slate-900">
              {a.matrice}
            </p>
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

          {/* il buco dichiarato vale più di un buco riempito a supposizioni */}
          <div className="rounded border border-dashed border-slate-300 px-3 py-2">
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-700 uppercase">
              Cosa manca per capirci di più
            </h3>
            <p className="text-xs leading-relaxed text-slate-600">
              {a.cosaManca}
            </p>
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
