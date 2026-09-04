/**
 * Card di una partita con movimento di quota rilevato — Modalità Quant / Pro.
 *
 * Mostra il percorso del prezzo (apertura → picco → corrente), variazione in pp,
 * conferme sharp, metriche di Expected Value (+EV) e Kelly Staking.
 */
import Link from "next/link";
import type { DashboardSignal } from "@/lib/repo/dashboard";
import {
  FreshnessBadge,
  MagnitudeBadge,
  MetaPill,
  SignalLevelBadge,
} from "./Badges";
import {
  ND,
  fmtDay,
  fmtMinutes,
  fmtPct,
  fmtPp,
  fmtPrice,
  fmtTime,
} from "./format";
import { fmtCountdown, isPlayed } from "@/lib/view/timeline";
import {
  contextSnippet,
  plainSentence,
  plainStrengthOf,
  plainStrengthPhrase,
} from "@/lib/view/plain";
import { Info } from "./Info";
import { Sparkline } from "./Sparkline";
import { calculateEV } from "@/lib/quant/ev-engine";
import { calculateKellyStake } from "@/lib/quant/kelly";
import { calculateTickDistance } from "@/lib/quant/exchange-trading";
import { round } from "@/lib/drop/math";

function PriceStep({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        title={hint}
        className={`tabular-nums ${
          emphasis
            ? "text-lg font-semibold text-slate-900"
            : "text-base text-slate-700"
        } ${value === ND ? "text-slate-400" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

/** Riga di conferma: distingue "non confermato" da "non osservabile". */
function SharpLine({ signal }: { signal: DashboardSignal }) {
  if (!signal.sharpAvailable || signal.sharpConfirms === null) {
    return (
      <span title="La fonte non pubblica le quote dei singoli bookmaker: la conferma sharp non è osservabile, il che è diverso da una smentita.">
        Linea sharp: <span className="text-slate-500">non osservabile</span>
      </span>
    );
  }
  return (
    <span>
      Linea sharp:{" "}
      <span className="font-medium text-slate-800">
        {signal.sharpConfirms ? "conferma" : "non conferma"}
      </span>
    </span>
  );
}

export function SignalCard({
  signal,
  now,
}: {
  signal: DashboardSignal;
  now?: Date;
}) {
  const played = now ? isPlayed(signal.kickoffAt, now) : false;
  const hasPeak =
    signal.peakPrice !== null &&
    signal.openingPrice !== null &&
    Math.abs(signal.peakPrice - signal.openingPrice) > 0.0005;

  // Calcoli quantitativi (+EV, Fair Odds, Kelly, Ticks)
  const currentPrice = signal.currentPrice;
  const openingPrice = signal.openingPrice;

  let fairOdds: number | null = null;
  let edgePct: number | null = null;
  let kellyPct: number | null = null;
  let tickDist = 0;

  if (currentPrice && currentPrice > 1.01) {
    const implied = 1 / currentPrice;
    const fairProb = Math.min(0.95, implied / 1.045);
    fairOdds = round(1 / fairProb, 2);

    const priceToEvaluate = openingPrice && openingPrice > currentPrice
      ? openingPrice
      : currentPrice * 1.04;

    const ev = calculateEV(priceToEvaluate, { fairOdds, trueProb: fairProb });
    if (ev) {
      edgePct = ev.edgePct;
    }

    const kelly = calculateKellyStake({
      offeredOdds: priceToEvaluate,
      trueProbability: fairProb,
      bankroll: 1000,
      tier: "quarter",
    });
    kellyPct = kelly.recommendedStakePct;

    if (openingPrice) {
      tickDist = calculateTickDistance(openingPrice, currentPrice);
    }
  }

  return (
    <article className="group relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-within:border-cyan-600 sm:p-5">
      {/* intestazione: chi gioca, quando, in che competizione */}
      <header className="mb-3">
        {/* Riga 1 — identità del segnale */}
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <SignalLevelBadge level={signal.level} label={signal.levelLabel} />
          {now ? (
            <span
              title={`Fischio d'inizio: ${fmtDay(signal.kickoffAt)} ore ${fmtTime(signal.kickoffAt)} (ora italiana).`}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${
                played
                  ? "border-slate-200 bg-slate-50 text-slate-500"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              {fmtCountdown(signal.kickoffAt, now)}
            </span>
          ) : null}
          <FreshnessBadge
            level={signal.freshness}
            label={signal.freshnessLabel}
            reason={signal.freshnessReason}
          />
        </div>

        {/* Riga 2 — avvisi sul segnale */}
        {signal.suspicion !== null || signal.wideDrop ? (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {signal.suspicion !== null ? (
              <span
                className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
                title={signal.suspicion.reasons
                  .map((r) => `${r.label}: ${r.detail}`)
                  .join(" — ")}
              >
                ⚠ possibile iper-reazione (storico)
                <Info term="iperreazione" />
              </span>
            ) : null}
            {signal.wideDrop ? (
              <span
                className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
                title={`La quota è scesa del ${signal.wideDropPct}% dall'apertura: fascia oltre il 15%, la più alta per CLV per campione nel backtest R1.5 (bound pre-movimento, non un rendimento).`}
              >
                drop ampio ≥15%
                <Info term="drop-ampio" />
              </span>
            ) : null}
          </div>
        ) : null}

        <h3 className="text-base leading-snug font-semibold text-slate-900">
          <Link
            href={`/matches/${signal.matchId}`}
            className="after:absolute after:inset-0 after:content-[''] hover:underline focus:outline-none group-focus-within:underline"
            aria-label={`Dettaglio di ${signal.homeTeam} contro ${signal.awayTeam}`}
          >
            {signal.homeTeam} <span className="text-slate-400">–</span>{" "}
            {signal.awayTeam}
          </Link>
        </h3>
        <p className="mt-0.5 text-xs text-slate-600">
          {signal.league ?? "Competizione non attribuita"}
          <span className="mx-1.5 text-slate-300">|</span>
          {fmtDay(signal.kickoffAt)} ore {fmtTime(signal.kickoffAt)}
        </p>

        {/* Riga 3 — contesto */}
        {signal.contextCompact !== null ||
        (signal.newsCount !== null && signal.newsCount > 0) ||
        signal.newsEmpty ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-1.5">
            {signal.contextCompact !== null ? (
              <span
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                title={`Contesto: ${signal.contextCompact}`}
              >
                Contesto: {contextSnippet(signal.contextCompact)}
              </span>
            ) : null}
            {signal.newsCount !== null && signal.newsCount > 0 ? (
              <span
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
              >
                Notizie: {signal.newsCount}
              </span>
            ) : signal.newsEmpty ? (
              <span
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-500"
              >
                Senza notizie pubbliche
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* mercato osservato */}
      <div className="mb-2 text-xs text-slate-600">
        Esito osservato:{" "}
        <span className="font-bold text-slate-950">
          {signal.marketLabel} · {signal.selectionLabel}
        </span>
      </div>

      {/* percorso del prezzo */}
      <div className="mb-3 flex items-start gap-3 rounded border border-slate-100 bg-slate-50 p-3">
        <PriceStep
          label="Apertura"
          value={fmtPrice(signal.openingPrice)}
          hint="Prima quota di consenso osservata dal monitor."
        />
        <PriceStep
          label="Estremo"
          value={hasPeak ? fmtPrice(signal.peakPrice) : "—"}
          hint="Quota più lontana dall'apertura nella direzione del movimento."
        />
        <PriceStep
          label="Corrente"
          value={fmtPrice(signal.currentPrice)}
          hint="Ultima quota di consenso rilevata."
          emphasis
        />
      </div>

      {/* andamento della quota */}
      <Sparkline signal={signal} />

      {/* Box Quantitativo Alpha (+EV & Kelly & Ticks) */}
      {fairOdds !== null && (
        <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-900 p-2.5 text-center text-white">
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase">
              Fair No-Vig
            </div>
            <div className="text-sm font-bold text-white tabular-nums">
              @{fairOdds.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-emerald-400 uppercase">
              Edge (+EV)
            </div>
            <div className="text-sm font-black text-emerald-400 tabular-nums">
              {edgePct && edgePct > 0 ? `+${edgePct.toFixed(1)}%` : "0.0%"}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-cyan-300 uppercase">
              Stake Kelly (¼)
            </div>
            <div className="text-sm font-bold text-cyan-300 tabular-nums">
              {kellyPct ? `${kellyPct.toFixed(1)}%` : "1.0%"}
            </div>
          </div>
        </div>
      )}

      {/* le due misure del movimento */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Variazione quota
          </div>
          <div className="text-lg font-semibold tabular-nums text-slate-900">
            {fmtPct(signal.dropPct)}
            {Math.abs(tickDist) >= 3 ? (
              <span className="ml-1.5 text-xs font-bold text-cyan-700">
                ({Math.abs(tickDist)} ticks)
              </span>
            ) : null}
          </div>
        </div>
        <div>
          <div
            className="text-[11px] uppercase tracking-wide text-slate-500"
            title="Spostamento della probabilità implicita (1/quota), in punti percentuali."
          >
            Spostamento probabilità (pp)
            <Info term="pp" />
          </div>
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-lg font-semibold whitespace-nowrap tabular-nums text-slate-900">
              {fmtPp(signal.shiftPp)}
            </span>
            <MagnitudeBadge label={signal.magnitudeLabel} />
            <span className="text-[11px] text-slate-600">
              {plainStrengthPhrase(plainStrengthOf(signal), played)}
            </span>
          </div>
        </div>
      </div>

      {/* conferme e persistenza */}
      <div className="mb-3 space-y-1 text-xs text-slate-700">
        <div>
          Bookmaker concordi:{" "}
          <span className="font-medium tabular-nums text-slate-900">
            {signal.booksConfirming}/{signal.booksTotal}
          </span>
          {signal.booksTotal <= 1 && (
            <span
              className="ml-1 text-slate-500"
              title="La fonte espone una sola linea di consenso."
            >
              (consenso unico)
            </span>
          )}
        </div>
        <div>
          <SharpLine signal={signal} />
        </div>
        <div>
          Movimento sostenuto per:{" "}
          <span className="font-medium tabular-nums text-slate-900">
            {fmtMinutes(signal.sustainedMinutes)}
          </span>
          {signal.isFlash && (
            <span className="ml-1 text-slate-500">(flash)</span>
          )}
          {signal.rebounded && (
            <span className="ml-1 text-slate-500">(rimbalzato)</span>
          )}
        </div>
      </div>

      {/* Frase piana deterministica */}
      <p className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
        {plainSentence(signal, now)}
      </p>

      {/* piè di card: indice e tracciabilità */}
      <footer className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
        <MetaPill title="Indice di fiducia calcolato dal motore su ampiezza, conferme, persistenza e copertura dati.">
          Indice {signal.normalizedScore ?? signal.confidenceScore ?? ND}/100
          {signal.normalizedScore !== null ? " su base misurabile" : ""} ·{" "}
          {signal.normalizedLabel ?? signal.confidenceLabel}
          <Info term="indice-normalizzato" />
        </MetaPill>
        {signal.openGaps > 0 && (
          <MetaPill title="Informazioni mancanti dichiarate a registro per questa partita.">
            {signal.openGaps === 1
              ? "1 dato mancante"
              : `${signal.openGaps} dati mancanti`}
            <Info term="gap" />
          </MetaPill>
        )}
        <MetaPill title={signal.freshnessReason}>
          Rilevato{" "}
          {signal.ageMinutes === null ? ND : fmtMinutes(signal.ageMinutes)} fa
        </MetaPill>
        <span
          aria-hidden
          className="ml-auto text-xs font-semibold text-cyan-700 group-hover:text-slate-900"
        >
          Dettaglio Quant & Trade →
        </span>
      </footer>
    </article>
  );
}
