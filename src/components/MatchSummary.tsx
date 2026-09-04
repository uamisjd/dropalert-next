/**
 * Sintesi leggibile del movimento principale di una partita.
 *
 * Questa è la risposta immediata alle tre domande con cui si apre il dettaglio:
 * che cosa si è mosso, di quanto e quanto siamo davvero riusciti a verificarlo.
 * Non introduce dati nuovi: riorganizza serie e punteggio già registrati.
 */
import type { DetailSignal, MarketSeries } from "@/lib/repo/match-detail";
import { normalizedReachabilityScore } from "@/lib/repo/score-view";
import { fmtMinutes, fmtPct, fmtPp, fmtPrice } from "./format";
import { MagnitudeBadge, SignalLevelBadge } from "./Badges";

function normalizedScore(signal: DetailSignal): number | null {
  return normalizedReachabilityScore(
    signal.reachability,
    signal.confidenceScore,
  );
}

function observationBase(signal: DetailSignal): number | null {
  const { measurableMax, totalMax } = signal.reachability;
  if (totalMax <= 0) return null;
  return Math.round((measurableMax / totalMax) * 100);
}

function scoreLabel(value: number | null): string {
  if (value === null) return "Non calcolabile";
  if (value >= 78) return "Alta";
  if (value >= 60) return "Media";
  return "Bassa";
}

function movementVerb(series: MarketSeries): string {
  if (series.opening === null || series.current === null) return "si è mossa";
  if (series.current < series.opening) return "è scesa";
  if (series.current > series.opening) return "è salita";
  return "è rimasta invariata";
}

function verificationNote(signal: DetailSignal): string {
  const missingCoordination = signal.booksTotal <= 1;
  const missingSharp = !signal.sharpAvailable || signal.sharpConfirms === null;

  if (missingCoordination && missingSharp) {
    return "La verifica resta limitata: non sono osservabili né il confronto tra singoli bookmaker né una linea indipendente sharp.";
  }
  if (missingCoordination) {
    return "La verifica tra singoli bookmaker non è disponibile: la fonte pubblica una sola linea di consenso.";
  }
  if (missingSharp) {
    return "Manca una linea indipendente sharp: il movimento è misurato, ma non ha questa seconda verifica.";
  }
  return signal.sharpConfirms
    ? "Il movimento è osservabile su più bookmaker e la linea indipendente si muove nella stessa direzione."
    : "Il movimento è osservabile su più bookmaker, ma la linea indipendente non si muove nella stessa direzione.";
}

export function MatchSummary({
  signal,
  series,
}: {
  signal: DetailSignal | null;
  series: MarketSeries | null;
}) {
  if (signal === null || series === null) {
    return (
      <section
        aria-labelledby="in-sintesi"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase">
          In sintesi
        </p>
        <h2
          id="in-sintesi"
          className="mt-1 text-lg font-semibold text-slate-950"
        >
          Nessun movimento ha superato la soglia del monitor
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          La partita è osservata, ma al momento non esiste un segnale da
          riassumere. Le rilevazioni disponibili restano consultabili sotto.
        </p>
      </section>
    );
  }

  const score = normalizedScore(signal);
  const base = observationBase(signal);
  const missing = base === null ? null : Math.max(0, 100 - base);

  return (
    <section
      aria-labelledby="in-sintesi"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(16rem,.75fr)]">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase">
              In sintesi
            </p>
            <SignalLevelBadge level={signal.level} label={signal.levelLabel} />
            <MagnitudeBadge label={signal.magnitudeLabel} />
          </div>

          <h2
            id="in-sintesi"
            className="mt-3 max-w-2xl text-xl leading-snug font-semibold tracking-tight text-slate-950 sm:text-2xl"
          >
            La quota di {signal.selectionLabel.toLowerCase()}{" "}
            {movementVerb(series)} da{" "}
            <span className="tabular-nums">{fmtPrice(series.opening)}</span> a{" "}
            <span className="tabular-nums">{fmtPrice(series.current)}</span>
          </h2>

          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Il movimento implicito è di {fmtPp(series.shiftPp)} ed è rimasto sul
            nuovo livello per {fmtMinutes(signal.sustainedMinutes)}.{" "}
            {verificationNote(signal)}
          </p>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div>
              <dt className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                Quota attuale
              </dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-950">
                {fmtPrice(series.current)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                Variazione quota
              </dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-950">
                {fmtPct(series.dropPct)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                Probabilità implicita
              </dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-950">
                {fmtPp(series.shiftPp)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                Tenuta
              </dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-950">
                {fmtMinutes(signal.sustainedMinutes)}
              </dd>
            </div>
          </dl>
        </div>

        <aside className="border-t border-slate-200 bg-slate-950 p-5 text-white lg:border-t-0 lg:border-l lg:p-6">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-cyan-300 uppercase">
            Qualità dell&apos;osservazione
          </p>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-4xl font-semibold tabular-nums">
              {score ?? "—"}
            </span>
            <span className="pb-1 text-sm text-slate-400">/100</span>
            <span className="mb-1 ml-auto rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-medium text-slate-200">
              {scoreLabel(score)}
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-cyan-400"
              style={{ width: `${score ?? 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            Indica la solidità del movimento sui criteri che possiamo misurare,
            non la probabilità che l&apos;esito si verifichi.
          </p>

          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-400">Base verificabile</span>
              <span className="font-semibold tabular-nums text-white">
                {base === null ? "—" : `${base}%`}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-slate-400"
                style={{ width: `${base ?? 0}%` }}
              />
            </div>
            {missing !== null && missing > 0 ? (
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Il {missing}% dei criteri non è verificabile con le fonti
                disponibili ed è escluso dal punteggio.
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
