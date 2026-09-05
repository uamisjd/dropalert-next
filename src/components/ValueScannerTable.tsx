"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { ValueScannerResult } from "@/lib/repo/value-bets";
import {
  DEFAULT_SCANNER_FILTERS,
  SHOW_ALL_EDGES,
  applyScannerFilters,
  describeEmptyScanner,
  type OddsBand,
} from "@/lib/view/scanner-filters";
import { fmtDay, fmtTime } from "@/components/format";
import { KellyInline } from "@/components/KellyInline";

interface Props {
  scanner: ValueScannerResult;
}

const signed = (v: number, d = 2): string =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;

/**
 * Elenco dei divari di prezzo, dal più favorevole al meno favorevole.
 *
 * Nessun campo «puntata»: le righe sono una misura (quota eseguibile contro linea
 * senza margine), non un ordine di esecuzione. Le soglie di filtro sono letture, non
 * soglie operative: il divario si mostra anche quando è negativo, perché è il caso in
 * cui il monitor serve di più.
 */
export function ValueScannerTable({ scanner }: Props) {
  const [minEdge, setMinEdge] = useState<number>(DEFAULT_SCANNER_FILTERS.minEdge);
  const [positiveOnly, setPositiveOnly] = useState<boolean>(
    DEFAULT_SCANNER_FILTERS.positiveOnly,
  );
  const [oddsRange, setOddsRange] = useState<OddsBand>(
    DEFAULT_SCANNER_FILTERS.oddsRange,
  );
  const [searchTerm, setSearchTerm] = useState<string>("");

  const items = scanner.opportunities;

  // I filtri sono una funzione pura (`src/lib/view/scanner-filters.ts`) e sono testati
  // lì: «Mostra tutto, anche i negativi» deve voler dire proprio quello.
  const filters = useMemo(
    () => ({ minEdge, positiveOnly, oddsRange, searchTerm }),
    [minEdge, positiveOnly, oddsRange, searchTerm],
  );
  const filtered = useMemo(() => applyScannerFilters(items, filters), [items, filters]);

  const negative = filtered.filter((o) => o.edgePct < 0).length;
  const empty = describeEmptyScanner(items, filtered, filters);

  return (
    <div className="space-y-4">
      {/* Filtri di lettura */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold tracking-wider text-slate-600 uppercase">
              Soglia di divario
            </label>
            <select
              value={minEdge}
              onChange={(e) => setMinEdge(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-cyan-500 focus:outline-none"
            >
              <option value={SHOW_ALL_EDGES}>Mostra tutto, anche i negativi</option>
              <option value={0.5}>Da +0,5%</option>
              <option value={1}>Da +1,0%</option>
              <option value={2}>Da +2,0%</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold tracking-wider text-slate-600 uppercase">
              Fascia quota
            </label>
            <select
              value={oddsRange}
              onChange={(e) => setOddsRange(e.target.value as OddsBand)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-cyan-500 focus:outline-none"
            >
              <option value="all">Tutte le quote lette</option>
              <option value="low">Sotto 2,00</option>
              <option value="medium">2,00 – 3,50</option>
              <option value="high">Sopra 3,50</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold tracking-wider text-slate-600 uppercase">
              Cerca partita
            </label>
            <input
              type="text"
              placeholder="squadra o campionato"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={positiveOnly}
              onChange={(e) => setPositiveOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            solo divari positivi
          </label>
          <span className="ml-auto text-xs font-semibold text-slate-500 tabular-nums">
            {filtered.length} righe · {negative} con divario negativo
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">{empty.title}</p>
          <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
            Segnali letti: {scanner.signalsRead}. {empty.note}
            {items.length === 0 ? ` ${scanner.dataNote}.` : ""}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((opp) => (
            <div
              key={opp.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-cyan-500 sm:p-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{opp.league}</span>
                    <span>•</span>
                    <span>
                      {fmtDay(opp.kickoffAt)} ore {fmtTime(opp.kickoffAt)}
                    </span>
                    {opp.lineAgeMinutes !== null && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        lettura di {opp.lineAgeMinutes} min fa
                      </span>
                    )}
                    {opp.sharpConfirmed && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                        CONFERMA DALLA FONTE
                      </span>
                    )}
                  </div>

                  <h3 className="mt-1 text-base font-bold text-slate-950 sm:text-lg">
                    <Link
                      href={`/matches/${opp.matchId}`}
                      className="hover:text-cyan-700 hover:underline"
                    >
                      {opp.homeTeam}
                      {" "}
                      <span className="font-normal text-slate-400">–</span>
                      {" "}
                      {opp.awayTeam}
                    </Link>
                  </h3>

                  <p className="mt-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500 uppercase">
                      {opp.market.toUpperCase()}
                    </span>{" "}
                    · {opp.selectionLabel}
                    {opp.dropPct !== null && (
                      <span className="ml-1 text-xs text-slate-500">
                        (quota {signed(opp.dropPct, 1)}% dall&#39;apertura)
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 sm:border-t-0 sm:pt-0">
                  <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      Quota eseguibile
                    </div>
                    <div className="text-lg font-bold text-slate-950 tabular-nums">
                      {opp.currentOdds.toFixed(2)}
                    </div>
                    {opp.openingOdds !== undefined && (
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        apertura {opp.openingOdds.toFixed(2)}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      Fair no-vig
                    </div>
                    <div className="text-lg font-bold text-slate-700 tabular-nums">
                      {opp.fairOdds.toFixed(2)}
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      margine rimosso {opp.lineMarginPct.toFixed(2)}%
                    </div>
                  </div>

                  <div
                    className={`rounded-xl p-2.5 text-center ring-1 ${
                      opp.edgePct > 0
                        ? "bg-emerald-50 ring-emerald-200"
                        : "bg-slate-50 ring-slate-200"
                    }`}
                  >
                    <div
                      className={`text-[10px] font-bold uppercase ${
                        opp.edgePct > 0 ? "text-emerald-700" : "text-slate-500"
                      }`}
                    >
                      Divario
                    </div>
                    <div
                      className={`text-lg font-extrabold tabular-nums ${
                        opp.edgePct > 0 ? "text-emerald-600" : "text-slate-500"
                      }`}
                    >
                      {signed(opp.edgePct, 1)}%
                    </div>
                    <div
                      className="text-[11px] text-slate-500 tabular-nums"
                      title="Il divario sopra è relativo (edge × 100); qui la differenza assoluta fra le due probabilità, in punti percentuali."
                    >
                      fair {opp.trueProbPct.toFixed(1)}% · implicita{" "}
                      {opp.impliedProbPct.toFixed(1)}% (
                      {signed(opp.trueProbPct - opp.impliedProbPct, 1)} pp)
                    </div>
                  </div>

                  {opp.edgePct > 0 && (
                    <KellyInline
                      offeredOdds={opp.currentOdds}
                      trueProbPct={opp.trueProbPct}
                      edgePct={opp.edgePct}
                      compact
                    />
                  )}

                  <Link
                    href={`/matches/${opp.matchId}`}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-3 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-950 hover:bg-slate-950 hover:text-white"
                  >
                    Scheda partita →
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
