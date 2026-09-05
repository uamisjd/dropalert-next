/** Verifica del movimento contro una linea sharp indipendente. */
import type { SharpView } from "@/lib/repo/sharp";
import { SHARP_VERDICT_LABELS } from "@/lib/providers/optional/odds-api-budget";
import { COVERED_LABEL } from "@/lib/providers/optional/sport-keys";
import { fmtPrice } from "./format";

const VERDICT_STYLES: Record<string, string> = {
  conferma: "border-slate-700 bg-slate-800 text-white",
  smentisce: "border-slate-400 bg-white text-slate-900",
  "non osservabile": "border-dashed border-slate-300 bg-white text-slate-500",
};

export function SharpLineBlock({ view }: { view: SharpView }) {
  const snapshot = view.snapshot;
  const budget = view.budget;

  return (
    <section
      aria-labelledby="linea-sharp"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase">
        Seconda verifica
      </p>
      <h2
        id="linea-sharp"
        className="mt-1 text-base font-semibold text-slate-950"
      >
        Linea indipendente
      </h2>

      {snapshot === null ? (
        <div className="mt-3">
          <span className="inline-flex rounded-full border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
            Non osservabile
          </span>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            {view.unavailableReason ?? "Linea sharp non disponibile"}. Questo
            non equivale a una smentita: la verifica semplicemente non può
            essere eseguita.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                VERDICT_STYLES[snapshot.verdict]
              }`}
            >
              {SHARP_VERDICT_LABELS[snapshot.verdict]}
            </span>
            {snapshot.book !== null ? (
              <span className="text-xs text-slate-600">
                {snapshot.book} · quota {fmtPrice(snapshot.price)}
              </span>
            ) : null}
          </p>
          {snapshot.marketSpread !== null ? (
            <p className="text-xs leading-relaxed text-slate-600">
              <strong className="font-semibold text-slate-950">Mercato:</strong>{" "}
              {snapshot.marketSpread.count} book europei quotano questa
              selezione fra {fmtPrice(snapshot.marketSpread.min)} e{" "}
              {fmtPrice(snapshot.marketSpread.max)} (differenza{" "}
              {fmtPrice(snapshot.marketSpread.spread)}). Più la differenza è
              piccola, più il mercato è allineato sul prezzo.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-slate-500">
              Una sola quotazione disponibile: la dispersione del mercato non è
              misurabile e non la stimiamo.
            </p>
          )}
          <p className="text-xs leading-relaxed text-slate-600">
            <strong className="font-semibold text-slate-950">Book sharp:</strong>{" "}
            {snapshot.spread !== null
              ? `${snapshot.spread.count} book sharp fra ${fmtPrice(snapshot.spread.min)} e ${fmtPrice(snapshot.spread.max)} (differenza ${fmtPrice(snapshot.spread.spread)}).`
              : "meno di due book sharp quotano questa selezione, quindi la loro dispersione non è misurabile."}
          </p>
          {snapshot.books.length > 0 ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-950">
                Tutti i {snapshot.books.length} prezzi letti
              </summary>
              <ul className="mt-1 space-y-0.5">
                {snapshot.books.map((b) => (
                  <li
                    key={b.key}
                    className="flex justify-between text-xs text-slate-600"
                  >
                    <span>
                      {b.key}
                      {b.isSharp ? (
                        <span className="ml-1 text-cyan-700">sharp</span>
                      ) : null}
                    </span>
                    <span className="tabular-nums">{fmtPrice(b.price)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="text-xs leading-relaxed text-slate-500">
            Confrontiamo la direzione del consenso con quella di un bookmaker
            sharp. Non è una previsione del risultato.
          </p>
        </div>
      )}

      <details className="mt-4 border-t border-slate-100 pt-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-950">
          Copertura e budget della fonte
        </summary>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          {budget.usedThisMonth}/{budget.monthlyCap} crediti questo mese ·{" "}
          {budget.usedToday}/{budget.allowanceToday} oggi (massimo{" "}
          {budget.dailyHardCap}). Una lettura al giorno per partita, solo per
          segnali attivi e per {COVERED_LABEL}.
        </p>
      </details>
    </section>
  );
}
