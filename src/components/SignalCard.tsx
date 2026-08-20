/**
 * Card di una partita con movimento di quota rilevato.
 *
 * Mostra il percorso del prezzo (apertura → picco → corrente), quanto vale
 * in probabilità, quanto è confermato e quanto è affidabile il dato che c'è
 * dietro. Ogni campo assente è dichiarato: nessun trattino ambiguo, nessun
 * valore riempito per simmetria.
 */
import Link from "next/link";
import type { DashboardSignal } from "@/lib/repo/dashboard";
import {
  FreshnessBadge,
  MagnitudeBadge,
  MetaPill,
  SignalLevelBadge,
} from "./Badges";
import { ND, fmtDay, fmtMinutes, fmtPct, fmtPp, fmtPrice, fmtTime } from "./format";

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

export function SignalCard({ signal }: { signal: DashboardSignal }) {
  const hasPeak =
    signal.peakPrice !== null &&
    signal.openingPrice !== null &&
    Math.abs(signal.peakPrice - signal.openingPrice) > 0.0005;

  return (
    <article className="group relative rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400 focus-within:border-slate-500">
      {/* intestazione: chi gioca, quando, in che competizione */}
      <header className="mb-3">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <SignalLevelBadge level={signal.level} label={signal.levelLabel} />
          <FreshnessBadge
            level={signal.freshness}
            label={signal.freshnessLabel}
            reason={signal.freshnessReason}
          />
          {/* iper-reazione storica: il segnale resta in lista, la fiducia
              è ridotta dal moltiplicatore e il motivo viaggia con il badge */}
          {signal.suspicion !== null ? (
            <span
              className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
              title={signal.suspicion.reasons
                .map((r) => `${r.label}: ${r.detail}`)
                .join(" — ")}
            >
              ⚠ possibile iper-reazione (storico)
            </span>
          ) : null}
          {/* drop ampio: fascia ≥15%, quella con il CLV per campione più
              alto nel backtest R1.5 (bound pre-movimento, dichiarato) */}
          {signal.wideDrop ? (
            <span
              className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
              title={`La quota è scesa del ${signal.wideDropPct}% dall'apertura: fascia oltre il 15%, la più alta per CLV per campione nel backtest R1.5 (bound pre-movimento, non un rendimento).`}
            >
              drop ampio ≥15%
            </span>
          ) : null}
        </div>
        <h3 className="text-base leading-snug font-semibold text-slate-900">
          {/*
            Il link copre l'intera card (::after esteso) così che tutta l'area
            sia cliccabile, ma resta un solo elemento focalizzabile: chi naviga
            da tastiera non deve attraversare dieci link per una partita.
          */}
          <Link
            href={`/matches/${signal.matchId}`}
            className="after:absolute after:inset-0 after:content-[''] hover:underline focus:outline-none group-focus-within:underline"
            aria-label={`Dettaglio di ${signal.homeTeam} contro ${signal.awayTeam}: serie storica delle quote, storia del segnale e dati mancanti.`}
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
      </header>

      {/* mercato osservato */}
      <div className="mb-2 text-xs text-slate-600">
        Esito osservato:{" "}
        <span className="font-medium text-slate-900">
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
          label="Picco"
          value={hasPeak ? fmtPrice(signal.peakPrice) : "—"}
          hint={
            hasPeak
              ? "Quota estrema realmente registrata nella direzione del movimento."
              : "Nessun estremo distinto dall'apertura fra le rilevazioni disponibili."
          }
        />
        <PriceStep
          label="Corrente"
          value={fmtPrice(signal.currentPrice)}
          hint="Ultima quota di consenso rilevata."
          emphasis
        />
      </div>

      {/* le due misure del movimento */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Variazione quota
          </div>
          <div className="text-lg font-semibold tabular-nums text-slate-900">
            {fmtPct(signal.dropPct)}
          </div>
        </div>
        <div>
          <div
            className="text-[11px] uppercase tracking-wide text-slate-500"
            title="Spostamento della probabilità implicita (1/quota), in punti percentuali."
          >
            Spostamento probabilità
          </div>
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-lg font-semibold whitespace-nowrap tabular-nums text-slate-900">
              {fmtPp(signal.shiftPp)}
            </span>
            <MagnitudeBadge label={signal.magnitudeLabel} />
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
              title="La fonte espone una sola linea di consenso: la coordinazione fra bookmaker non è misurabile e non entra nel punteggio."
            >
              (consenso unico, coordinazione non misurabile)
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
            <span
              className="ml-1 text-slate-500"
              title="Movimento concentrato in meno di 30 minuti: fiducia ridotta."
            >
              (flash)
            </span>
          )}
          {signal.rebounded && (
            <span
              className="ml-1 text-slate-500"
              title="La quota è rientrata verso il livello di apertura: segnale falso in tutto o in parte."
            >
              (rimbalzato)
            </span>
          )}
        </div>
      </div>

      {/* spiegazione prodotta dal motore */}
      {signal.summary && (
        <p className="mb-3 border-l-2 border-slate-200 pl-3 text-xs leading-relaxed text-slate-600">
          {signal.summary}
        </p>
      )}

      {/* piè di card: indice e tracciabilità */}
      <footer className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
        <MetaPill title="Indice di fiducia 0–100 calcolato dal motore su ampiezza, conferme, persistenza e copertura dati.">
          Indice {signal.confidenceScore ?? ND}/100 · {signal.confidenceLabel}
        </MetaPill>
        {signal.openGaps > 0 && (
          <MetaPill title="Informazioni mancanti dichiarate a registro per questa partita.">
            {signal.openGaps} {signal.openGaps === 1 ? "dato" : "dati"} mancanti
          </MetaPill>
        )}
        <MetaPill title={signal.freshnessReason}>
          Rilevato {signal.ageMinutes === null ? ND : fmtMinutes(signal.ageMinutes)} fa
        </MetaPill>
        <span
          aria-hidden
          className="ml-auto text-xs text-slate-500 group-hover:text-slate-900"
        >
          Serie storica e dettaglio →
        </span>
      </footer>
    </article>
  );
}
