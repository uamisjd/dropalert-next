/**
 * Blocco «Linea sharp» del dettaglio partita (Sprint G).
 *
 * Tre stati, detti per quello che sono: la linea sharp CONFERMA il movimento
 * del consenso, lo SMENTISCE, oppure NON È OSSERVABILE. Il terzo non è una
 * smentita: è assenza di dato, e va scritto diversamente.
 *
 * Il budget della fonte è dichiarato qui sotto, con una formulazione sola:
 * chi legge deve poter vedere quanto è stato speso e quanto resta.
 */
import type { SharpView } from "@/lib/repo/sharp";
import { SHARP_VERDICT_LABELS } from "@/lib/providers/optional/odds-api-budget";
import { COVERED_LABEL } from "@/lib/providers/optional/sport-keys";
import { fmtPrice } from "./format";

const VERDICT_STYLES: Record<string, string> = {
  conferma: "border-slate-700 bg-slate-800 text-slate-100",
  smentisce: "border-slate-400 bg-white text-slate-900",
  "non osservabile": "border-dashed border-slate-300 bg-white text-slate-500",
};

export function SharpLineBlock({ view }: { view: SharpView }) {
  const s = view.snapshot;
  const b = view.budget;

  return (
    <section
      aria-labelledby="linea-sharp"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2
        id="linea-sharp"
        className="mb-2 text-sm font-semibold tracking-wide text-slate-700 uppercase"
      >
        Linea sharp
      </h2>

      {s === null ? (
        <p className="text-xs leading-relaxed text-slate-600">
          {view.unavailableReason ?? "linea sharp non disponibile"}. Nessun
          valore viene stimato al suo posto: «non osservabile» non significa
          «non conferma».
        </p>
      ) : (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                VERDICT_STYLES[s.verdict]
              }`}
            >
              {SHARP_VERDICT_LABELS[s.verdict]}
            </span>
            {s.book !== null ? (
              <span className="text-xs text-slate-600">
                fonte: {s.book} · quota {fmtPrice(s.price)}
              </span>
            ) : (
              <span className="text-xs text-slate-500">
                nessun bookmaker sharp espone questa selezione
              </span>
            )}
          </p>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Il confronto è fra la direzione del consenso e il prezzo del
            bookmaker sharp. Conferma significa stessa direzione, non
            probabilità di vittoria.
          </p>
        </div>
      )}

      <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-500">
        Budget della fonte: {b.usedThisMonth}/{b.monthlyCap} crediti questo
        mese · {b.usedToday}/{b.allowanceToday} oggi (tetto massimo{" "}
        {b.dailyHardCap} al giorno). Una sola lettura al giorno per partita,
        solo per segnali attivi e solo su {COVERED_LABEL}. Raggiunto un tetto,
        la lettura si ferma e lo si dichiara.
      </p>
    </section>
  );
}
