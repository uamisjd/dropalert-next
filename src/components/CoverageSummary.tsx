/**
 * Riquadro compatto della copertura per la dashboard.
 *
 * Versione ridotta del pannello: i tre numeri che contano, la riga sulla
 * profondità della serie e un rimando alla pagina completa. Sta sulla
 * dashboard perché la completezza del dato è una premessa alla lettura dei
 * movimenti, non un approfondimento facoltativo.
 */
import Link from "next/link";
import {
  SERIES_INSUFFICIENT_TEXT,
  coverageLabel,
  type CoverageView,
} from "@/lib/cov/view";
import { fmtAgo, fmtDateTime } from "./format";

export function CoverageSummary({ view }: { view: CoverageView }) {
  return (
    <section
      aria-labelledby="copertura-sintesi"
      className="rounded-lg border border-slate-200 bg-white p-3"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="copertura-sintesi"
          className="text-xs font-semibold tracking-wide text-slate-900 uppercase"
        >
          Copertura della raccolta
        </h2>
        <Link
          href="/coverage"
          className="text-xs text-slate-500 underline hover:text-slate-800"
        >
          Dettaglio →
        </Link>
      </div>

      {!view.measured ? (
        <p className="rounded border border-slate-300 bg-slate-100 px-2 py-1.5 text-xs text-slate-700">
          <span className="font-medium">NON MISURATO</span> — nessun giro ha
          ancora registrato la copertura. Non è una copertura zero.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-600">
            Ultimo giro:{" "}
            <span className="font-semibold tabular-nums text-slate-900">
              {view.football}
            </span>{" "}
            righe di calcio ·{" "}
            <span className="font-semibold tabular-nums text-slate-900">
              {view.imported}
            </span>{" "}
            importate ·{" "}
            <span
              className={`font-semibold tabular-nums ${
                view.lost === 0 ? "text-slate-500" : "text-red-700"
              }`}
            >
              {view.lost}
            </span>{" "}
            perse ({coverageLabel(view.coverage)}).
          </p>
          {view.lossesDeclared > 0 ? (
            <p className="mt-1 text-[11px] text-slate-500">
              Di cui attribuibili al monitor: {view.lossesDeclared}.
            </p>
          ) : null}
        </>
      )}

      <p className="mt-2 text-[11px] text-slate-500">
        <span className="font-medium tabular-nums text-slate-700">
          {view.seriesLabel}
        </span>
        {view.seriesInsufficient ? (
          <>
            {" "}
            — <span className="text-slate-700">{SERIES_INSUFFICIENT_TEXT}</span>
          </>
        ) : null}
      </p>

      {view.schedulerLabel !== null ? (
        <p
          className={
            view.schedulerUncertain
              ? "mt-1 text-[11px] text-amber-700"
              : "mt-1 text-[11px] text-slate-500"
          }
        >
          {view.schedulerUncertain ? "⚠ " : ""}
          {view.schedulerLabel}
        </p>
      ) : null}

      {/* la raccolta automatica raccontata dall'archivio: GitHub Actions,
          ultimo giro schedulato, avviso se tace da oltre 90 minuti */}
      {view.actions !== null ? (
        <>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {view.actions.label}{" "}
            {view.actions.lastRun !== null ? (
              <>
                Ultimo giro schedulato:{" "}
                {fmtDateTime(view.actions.lastRun.startedAt)} (
                {fmtAgo(view.actions.lastRun.startedAt)}), esito{" "}
                {view.actions.lastRunStatusLabel}.
              </>
            ) : (
              <>{view.actions.lastRunLine}</>
            )}
          </p>
          {view.actions.warning !== null ? (
            <p className="mt-1 text-[11px] font-medium leading-relaxed text-amber-700">
              ⚠ {view.actions.warning}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
