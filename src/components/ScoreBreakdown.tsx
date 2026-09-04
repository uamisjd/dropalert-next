/**
 * Scomposizione dell'indice di fiducia.
 *
 * Regola di questa vista: uno zero e una lacuna non si disegnano allo stesso
 * modo. Se un componente vale zero punti perché il dato è stato osservato e
 * non conferma, si mostra la barra a zero. Se vale zero perché il dato non
 * esiste, si mostra "GAP" e si spiega perché — nasconderlo lascerebbe credere
 * che il monitor abbia guardato e non abbia trovato conferma, che è un'altra
 * cosa.
 */
import type { DetailSignal } from "@/lib/repo/match-detail";
import {
  normalizedReachabilityScore,
  type ScoreComponentView,
} from "@/lib/repo/score-view";
import { fmtRate } from "./format";
import { NORMALIZED_BAND_NOTE, normalizedBandOf } from "@/lib/repo/dashboard";
import { CONFIDENCE_LABELS_IT } from "@/lib/drop/constants";

function ComponentRow({ c }: { c: ScoreComponentView }) {
  return (
    <li className="border-t border-slate-100 py-2.5 first:border-t-0 first:pt-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm font-medium text-slate-900">{c.label}</span>
        {c.isGap ? (
          <span
            className="rounded border border-dashed border-slate-400 bg-white px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-slate-600 uppercase"
            title="Componente non misurabile con i dati disponibili."
          >
            GAP — non misurabile
          </span>
        ) : (
          <span className="text-xs tabular-nums text-slate-600">
            {c.points} / {c.maxPoints} punti
          </span>
        )}
      </div>

      {/* barra solo per i componenti realmente misurati */}
      {c.isGap ? (
        <div
          aria-hidden
          className="h-1.5 w-full rounded-full border border-dashed border-slate-300 bg-white"
        />
      ) : (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-slate-800"
            style={{ width: `${Math.round((c.ratio ?? 0) * 100)}%` }}
          />
        </div>
      )}

      <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
        {c.isGap ? c.gapReason : c.detail}
      </p>

      {c.isGap && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          I {c.maxPoints} punti di questo componente non sono assegnabili né
          sottraibili: restano fuori dal conteggio come lacuna dichiarata.
        </p>
      )}
    </li>
  );
}

export function ScoreBreakdown({ signal }: { signal: DetailSignal }) {
  const { components, reachability } = signal;
  const gaps = components.filter((c) => c.isGap);
  /* confidenceScore comprende gli eventuali moltiplicatori applicati dopo la
     somma delle componenti. È lo stesso numeratore usato nella dashboard. */
  const earned = signal.confidenceScore ?? reachability.earned;
  const percentuale = normalizedReachabilityScore(
    reachability,
    signal.confidenceScore,
  );
  const normalizedBand = normalizedBandOf(percentuale);
  const normalizedLabel =
    normalizedBand === null ? null : CONFIDENCE_LABELS_IT[normalizedBand];

  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-700 uppercase">
        Come è composto l&apos;indice
      </h4>

      {/* Numero principale: punteggio effettivo, inclusi gli eventuali
          moltiplicatori, sui punti realmente misurabili. */}
      <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className="text-2xl font-semibold tabular-nums text-slate-900"
            title="Punti ottenuti sui punti effettivamente misurabili: i componenti che i dati disponibili non permettono di valutare non entrano nel denominatore, invece di pesare come uno zero."
          >
            {earned}
            <span className="text-base font-normal text-slate-500">
              /{reachability.measurableMax}
            </span>
          </span>
          <span
            className="text-xs font-medium text-slate-700"
            title="La base è ciò che le fonti hanno reso osservabile per questa partita."
          >
            su base misurabile
          </span>
          <span className="text-xs text-slate-600" title={NORMALIZED_BAND_NOTE}>
            banda {(normalizedLabel ?? signal.confidenceLabel).toLowerCase()}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          Fascia calcolata su base misurabile ({percentuale ?? "n/d"}%).{" "}
          {NORMALIZED_BAND_NOTE} {reachability.gapMax} punti su{" "}
          {reachability.totalMax} non osservabili (GAP) · copertura dati{" "}
          {fmtRate(signal.dataCoverage)}.
          {signal.suspicion !== null &&
          Math.abs(reachability.earned - earned) > 0.005 ? (
            <>
              {" "}
              Le componenti totalizzano {reachability.earned} punti prima del
              moltiplicatore {signal.suspicion.multiplier}; il valore usato qui
              e nella home è {earned}.
            </>
          ) : null}
        </p>
      </div>

      {components.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-600">
          Il motore non ha salvato la scomposizione per questo segnale: il dato
          manca e non viene ricostruito a posteriori.
        </p>
      ) : (
        <ul className="rounded border border-slate-200 bg-white px-3 py-2">
          {components.map((c) => (
            <ComponentRow key={c.key} c={c} />
          ))}
        </ul>
      )}

      {gaps.length > 0 && (
        <p className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
          <span className="font-medium">
            Lettura corretta dell&apos;indice:
          </span>{" "}
          {earned} punti su {reachability.measurableMax} effettivamente
          misurabili. Gli altri {reachability.gapMax} punti su{" "}
          {reachability.totalMax} appartengono a{" "}
          {gaps.length === 1 ? "un componente" : `${gaps.length} componenti`}{" "}
          che i dati disponibili non permettono di valutare. Questi criteri non
          pesano come zero, ma riducono la base su cui il movimento può essere
          verificato.
        </p>
      )}

      {signal.missingData.length > 0 && (
        <div className="mt-2">
          <h5 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">
            Dati mancanti dichiarati dal motore
          </h5>
          <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-slate-600">
            {signal.missingData.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {signal.caveats.length > 0 && (
        <div className="mt-2">
          <h5 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">
            Avvertenze
          </h5>
          <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-slate-600">
            {signal.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
