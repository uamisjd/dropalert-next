/**
 * Pagina pubblica /performance (Sprint ENH-1, punto 3).
 *
 * Mostra come si è mosso nel tempo il CLV — l'unica metrica di qualità che
 * pubblichiamo — con il campione sempre accanto al numero. Non è un
 * rendimento e non è un consiglio: il disclaimer è fisso e non si toglie.
 *
 * Il grafico è SVG inline calcolato in `lib/view/clv-chart`: nessuna
 * dipendenza esterna, nessuno script da caricare.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { getPerformanceView } from "@/lib/repo/performance";
import { getClvMaturity, CLV_MATURITY_NOTE } from "@/lib/repo/dashboard";
import {
  CLV_CHART_HEIGHT,
  CLV_CHART_WIDTH,
  buildClvChart,
  shortDay,
} from "@/lib/view/clv-chart";
import { fmtDateTime, fmtPp, fmtRate } from "@/components/format";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Performance — DropAlert",
  description:
    "Evoluzione nel tempo del CLV, l'unica metrica di qualità pubblicata da DropAlert, con il campione dichiarato. Non è un rendimento né un consiglio.",
  alternates: { canonical: "/performance" },
};

const DISCLAIMER =
  "Non è un rendimento né un consiglio: il CLV confronta il segnale con la quota di chiusura, non con l'esito della partita.";

export default async function PerformancePage() {
  const now = new Date();
  const [view, clv] = await Promise.all([
    getPerformanceView(now).catch(() => null),
    getClvMaturity(now).catch(() => null),
  ]);

  const geo = view === null ? null : buildClvChart(view.points);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">
        Performance
      </h1>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Come si muove nel tempo il CLV, con quante osservazioni lo sostengono.
        Sotto le {view?.threshold ?? 30} osservazioni un valore resta{" "}
        <span className="font-medium text-slate-800">non concludente</span>,
        anche quando è positivo.
      </p>

      <p className="mt-3 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800">
        {DISCLAIMER}
      </p>

      {view === null ? (
        <p className="mt-5 rounded border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
          Registro delle osservazioni non leggibile in questo momento: la
          pagina non mostra numeri al posto di quelli mancanti.
        </p>
      ) : (
        <>
          <section aria-labelledby="clv-tempo" className="mt-5">
            <h2
              id="clv-tempo"
              className="mb-2 text-sm font-semibold tracking-wide text-slate-900 uppercase"
            >
              CLV medio progressivo
            </h2>

            {geo === null ? (
              <p className="rounded border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
                Nessuna osservazione a registro: la serie comincerà quando le
                prime partite monitorate avranno una quota di chiusura.
              </p>
            ) : (
              <figure className="rounded-lg border border-slate-200 bg-white p-3">
                <svg
                  viewBox={`0 0 ${CLV_CHART_WIDTH} ${CLV_CHART_HEIGHT}`}
                  width="100%"
                  height={CLV_CHART_HEIGHT}
                  role="img"
                  aria-label={`CLV medio progressivo su ${view.totalN} osservazioni, da ${geo.firstDay} a ${geo.lastDay}.`}
                  className="block w-full"
                >
                  {/* lo zero è il riferimento: sopra il segnale ha battuto la
                      chiusura, sotto no */}
                  <line
                    x1={0}
                    x2={CLV_CHART_WIDTH}
                    y1={geo.zeroY}
                    y2={geo.zeroY}
                    stroke="#94a3b8"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                  />
                  <path
                    d={geo.path}
                    fill="none"
                    stroke="#0f172a"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {geo.dots.map((d) => (
                    <circle
                      key={d.day}
                      cx={d.x}
                      cy={d.y}
                      r={d.inconclusive ? 2 : 3}
                      fill={d.inconclusive ? "#ffffff" : "#0f172a"}
                      stroke="#0f172a"
                      strokeWidth={1.2}
                    >
                      <title>
                        {`${d.day}: ${d.value.toFixed(2)} pp su ${d.n} osservazioni${
                          d.inconclusive ? " (non concludente)" : ""
                        }`}
                      </title>
                    </circle>
                  ))}
                </svg>
                <figcaption className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                  <span>{shortDay(geo.firstDay)}</span>
                  <span className="ml-auto">{shortDay(geo.lastDay)}</span>
                  <span className="w-full">
                    Linea tratteggiata = zero. I punti vuoti indicano un
                    campione ancora sotto le {view.threshold} osservazioni:
                    sono disegnati, ma non provano nulla.
                  </span>
                </figcaption>
              </figure>
            )}

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded border border-slate-200 bg-white px-3 py-2">
                <div className="text-[11px] text-slate-500">Osservazioni</div>
                <div className="text-lg font-semibold tabular-nums text-slate-900">
                  {view.totalN}
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-white px-3 py-2">
                <div className="text-[11px] text-slate-500">CLV medio</div>
                <div className="text-lg font-semibold tabular-nums text-slate-900">
                  {fmtPp(view.overallAvgPp)}
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-white px-3 py-2">
                <div className="text-[11px] text-slate-500">
                  Batte la chiusura
                </div>
                <div className="text-lg font-semibold tabular-nums text-slate-900">
                  {fmtRate(view.beatCloseRate)}
                </div>
              </div>
            </div>

            {view.inconclusive ? (
              <p className="mt-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
                Campione sotto le {view.threshold} osservazioni:{" "}
                <span className="font-medium">non concludente</span>.{" "}
                {CLV_MATURITY_NOTE}
              </p>
            ) : null}
          </section>

          {clv !== null && clv.buckets.length > 0 ? (
            <section aria-labelledby="clv-fasce" className="mt-6">
              <h2
                id="clv-fasce"
                className="mb-2 text-sm font-semibold tracking-wide text-slate-900 uppercase"
              >
                CLV per fascia di indice
              </h2>
              <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
                Fasce sull&apos;indice grezzo su 100: è la scala con cui le
                osservazioni sono state registrate. Sulle card la fascia è
                invece letta su base misurabile.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-1.5 pr-3 font-medium">Fascia</th>
                      <th className="py-1.5 pr-3 font-medium">n</th>
                      <th className="py-1.5 pr-3 font-medium">CLV medio</th>
                      <th className="py-1.5 font-medium">Batte la chiusura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clv.buckets.map((b) => (
                      <tr key={b.key} className="border-b border-slate-100">
                        <td className="py-1.5 pr-3 text-slate-700">{b.label}</td>
                        <td className="py-1.5 pr-3 tabular-nums text-slate-700">
                          {b.sampleSize}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums text-slate-700">
                          {fmtPp(b.avgClvPp)}
                        </td>
                        <td className="py-1.5 tabular-nums text-slate-700">
                          {fmtRate(b.beatCloseRate)}
                          {b.inconclusive ? (
                            <span className="ml-1.5 text-slate-500">
                              non concludente
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <p className="mt-5 border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-500">
            {DISCLAIMER} Pagina generata il {fmtDateTime(view.generatedAt)} (ora
            italiana).{" "}
            <Link
              href="/metodologia"
              className="underline underline-offset-2 hover:text-slate-800"
            >
              Come si misura
            </Link>
            .
          </p>
        </>
      )}
    </main>
  );
}
