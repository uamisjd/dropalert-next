/**
 * Grafico della serie storica di una quota.
 *
 * SVG inline, nessuna libreria: i punti disegnati sono esattamente quelli
 * registrati nel database, uno per rilevazione. Non c'è smoothing, non c'è
 * interpolazione fra i punti oltre al segmento che li unisce, e la densità
 * visiva della linea non deve suggerire più osservazioni di quante ce ne
 * siano davvero — per questo ogni rilevazione è marcata con un pallino.
 */
import type { MarketSeries } from "@/lib/repo/match-detail";
import { buildChart, CHART_HEIGHT, CHART_WIDTH } from "./chart";
import { ND, fmtPrice, fmtTime } from "./format";

export function OddsChart({ series }: { series: MarketSeries }) {
  const geo = buildChart(
    series.points.map((p) => ({ t: new Date(p.at).getTime(), v: p.price })),
  );

  if (!geo) {
    return (
      <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
        Nessuna rilevazione utilizzabile: non c&apos;è serie da disegnare.
      </div>
    );
  }

  const last = geo.dots[geo.dots.length - 1];
  const first = geo.dots[0];

  return (
    <figure className="m-0">
      <div className="relative rounded border border-slate-200 bg-white">
        {/* etichette dell'asse verticale: solo estremi realmente osservati */}
        <div className="pointer-events-none absolute top-1 left-2 text-[10px] tabular-nums text-slate-400">
          {fmtPrice(geo.max)}
        </div>
        <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] tabular-nums text-slate-400">
          {geo.flat ? "" : fmtPrice(geo.min)}
        </div>

        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-40 w-full"
          role="img"
          preserveAspectRatio="none"
          aria-label={`Serie storica della quota ${series.selectionLabel}: ${series.pointCount} rilevazioni, da ${fmtPrice(series.opening)} a ${fmtPrice(series.current)}.`}
        >
          {/* riferimento orizzontale sulla quota di apertura */}
          {!geo.flat && (
            <line
              x1={0}
              x2={CHART_WIDTH}
              y1={first.y}
              y2={first.y}
              stroke="#cbd5e1"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}

          {geo.path && (
            <path
              d={geo.path}
              fill="none"
              stroke="#0f172a"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* una rilevazione = un punto: la densità dice quanto abbiamo visto */}
          {geo.dots.map((d, i) => {
            const stale = series.points[i]?.isStale === true;
            return (
              <circle
                key={`${d.t}-${i}`}
                cx={d.x}
                cy={d.y}
                r={i === geo.dots.length - 1 ? 4 : 2.5}
                fill={stale ? "#fff" : "#0f172a"}
                stroke={stale ? "#f59e0b" : "#0f172a"}
                strokeWidth={stale ? 2 : 1}
              />
            );
          })}
        </svg>

        {/* etichette temporali degli estremi */}
        <div className="flex justify-between border-t border-slate-100 px-2 py-1 text-[10px] tabular-nums text-slate-500">
          <span>{series.firstAt ? fmtTime(series.firstAt) : ND}</span>
          <span>
            {series.pointCount} {series.pointCount === 1 ? "rilevazione" : "rilevazioni"}
          </span>
          <span>{series.lastAt ? fmtTime(series.lastAt) : ND}</span>
        </div>
      </div>

      <figcaption className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
        {geo.flat
          ? "Quota invariata per tutta la finestra osservata: la linea è piatta perché il mercato non si è mosso, non per mancanza di dati."
          : "La linea unisce le rilevazioni realmente registrate. Fra un punto e l'altro il monitor non ha osservato nulla: quel tratto è un collegamento, non un dato."}{" "}
        {series.points.some((p) => p.isStale) &&
          "I punti cerchiati in arancione provengono da una rilevazione dichiarata vecchia dalla fonte."}
      </figcaption>

      {/* estremi in forma numerica, per chi legge i valori e non il disegno */}
      <div className="sr-only">
        Apertura {fmtPrice(series.opening)} alle{" "}
        {series.firstAt ? fmtTime(series.firstAt) : ND}, ultima rilevazione{" "}
        {fmtPrice(last ? last.v : null)} alle{" "}
        {series.lastAt ? fmtTime(series.lastAt) : ND}.
      </div>
    </figure>
  );
}
