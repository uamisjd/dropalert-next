import type { DecisionAssessment } from "@/lib/decision/contract";
import { primaryDecisionReason } from "@/lib/decision/contract";

const STATE_STYLES: Record<DecisionAssessment["state"], string> = {
  NON_AZIONABILE: "border-rose-200 bg-rose-50 text-rose-950",
  OSSERVAZIONE: "border-slate-200 bg-slate-50 text-slate-950",
  CANDIDATA: "border-amber-200 bg-amber-50 text-amber-950",
  VALORE_VERIFICATO: "border-emerald-200 bg-emerald-50 text-emerald-950",
};

/**
 * Proiezione UI del contratto decisionale.
 *
 * Non contiene calcoli e non offre azioni: mostra lo stato prodotto dal gate,
 * separando motivi bloccanti e incertezze residue. In particolare, una riga
 * `NON AZIONABILE` mantiene sempre il testo `NO BET`.
 */
export function DecisionStatusBlock({
  assessment,
}: {
  assessment: DecisionAssessment;
}) {
  const blocking = assessment.reasons.length > 0;
  const title =
    assessment.state === "NON_AZIONABILE"
      ? "NO BET"
      : assessment.state === "CANDIDATA"
        ? "Da validare, non da eseguire automaticamente"
        : assessment.state === "VALORE_VERIFICATO"
          ? "Evidenza storica positiva"
          : "Movimento da osservare";

  return (
    <section
      aria-labelledby="decision-status"
      className={`rounded-2xl border p-5 shadow-sm ${STATE_STYLES[assessment.state]}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] uppercase">
            Stato decisionale
          </p>
          <h2 id="decision-status" className="mt-1 text-xl font-bold tracking-tight">
            {title}
          </h2>
        </div>
        <span className="rounded-full border border-current/20 bg-white/60 px-2.5 py-1 text-xs font-bold tracking-wide">
          {assessment.label}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed">
        {blocking
          ? primaryDecisionReason(assessment)
          : "I gate operativi sono soddisfatti; la validazione storica resta separata dalla decisione."}
      </p>

      {assessment.reasons.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-xs leading-relaxed">
          {assessment.reasons.map((item) => (
            <li key={item.code} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{item.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {assessment.warnings.length > 0 ? (
        <div className="mt-3 border-t border-current/15 pt-3">
          <p className="text-[11px] font-semibold uppercase">Incertezze residue</p>
          <ul className="mt-1 space-y-1 text-xs leading-relaxed">
            {assessment.warnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-4 border-t border-current/15 pt-3 text-[11px] leading-relaxed opacity-80">
        Questo pannello classifica l&apos;evidenza disponibile. Non è una previsione,
        non è una garanzia e non calcola stake o Kelly.
      </p>
    </section>
  );
}
