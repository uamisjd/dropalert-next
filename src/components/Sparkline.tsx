/**
 * Mini-grafico della quota sulla card (Sprint UX-3).
 *
 * Legge i punti già in archivio (odds_snapshots, gli stessi della "Serie
 * storica" del dettaglio): nessuna raccolta nuova, nessuna fonte nuova.
 * Senza assi e con al massimo tre etichette — inizio, picco, corrente.
 *
 * Regola dichiarata anche a schermo: i pallini sono rilevazioni vere, i
 * tratti che li uniscono sono collegamenti visivi, non dati osservati.
 */
import type { DashboardSignal } from "@/lib/repo/dashboard";
import {
  SPARK_HEIGHT,
  SPARK_WIDTH,
  buildSparkline,
} from "@/lib/view/sparkline";
import { fmtPrice } from "./format";

const TRATTI_NOTE =
  "Ogni pallino è una rilevazione realmente registrata. I tratti che li uniscono sono collegamenti visivi, non quote osservate: fra due rilevazioni il monitor non sa cosa è successo.";

export function Sparkline({ signal }: { signal: DashboardSignal }) {
  const geo = buildSparkline(signal.sparkline);

  /* meno di due punti: niente grafico, i valori restano in testo */
  if (geo === null) {
    return (
      <p className="mb-3 rounded border border-dashed border-slate-200 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        Rilevazioni insufficienti per un andamento ({signal.sparkline.length}{" "}
        {signal.sparkline.length === 1 ? "punto registrato" : "punti registrati"}
        ): apertura {fmtPrice(signal.openingPrice)}, corrente{" "}
        {fmtPrice(signal.currentPrice)}.
      </p>
    );
  }

  /* segnale nullo o linea ferma: si dice, non si finge un movimento */
  const noMovement = geo.flat || signal.level === "nessuno";
  const showPeak =
    !geo.flat &&
    geo.peak !== geo.first &&
    geo.peak !== geo.last &&
    Math.abs(geo.peak.v - geo.last.v) > 0.0005;

  return (
    <figure className="mb-3">
      <svg
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        width="100%"
        height={SPARK_HEIGHT}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Andamento della quota su ${geo.dots.length} rilevazioni: da ${fmtPrice(geo.first.v)} a ${fmtPrice(geo.last.v)}.`}
        className="block w-full"
      >
        <path
          d={geo.path}
          fill="none"
          stroke={noMovement ? "#cbd5e1" : "#334155"}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* i punti realmente registrati */}
        {geo.dots.map((d, i) => (
          <circle
            key={`${d.t}-${i}`}
            cx={d.x}
            cy={d.y}
            r={1.6}
            fill="#94a3b8"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {showPeak ? (
          <circle
            cx={geo.peak.x}
            cy={geo.peak.y}
            r={3}
            fill="#ffffff"
            stroke="#334155"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <circle
          cx={geo.last.x}
          cy={geo.last.y}
          r={3.2}
          fill="#0f172a"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <figcaption className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        {noMovement ? (
          <span>Nessun movimento significativo nelle rilevazioni.</span>
        ) : (
          <>
            <span className="tabular-nums">
              inizio {fmtPrice(geo.first.v)}
            </span>
            {showPeak ? (
              <span className="tabular-nums" title="Estremo osservato nella direzione del movimento: è la quota da cui si misura il drop.">
                ap. {fmtPrice(geo.peak.v)}
              </span>
            ) : null}
            <span className="font-medium tabular-nums text-slate-700">
              corrente {fmtPrice(geo.last.v)}
            </span>
          </>
        )}
        <span className="ml-auto inline-flex items-center">
          {geo.dots.length} rilevazioni
          <span
            role="note"
            tabIndex={0}
            aria-label={TRATTI_NOTE}
            title={TRATTI_NOTE}
            className="ml-1 inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-slate-300 align-middle text-[9px] leading-none font-semibold text-slate-500"
          >
            i
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
