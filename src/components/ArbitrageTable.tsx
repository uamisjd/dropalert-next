"use client";

import Link from "next/link";
import type { ArbitrageOpportunity } from "@/lib/quant/arbitrage";
import { fmtDay, fmtTime } from "@/components/format";

interface Props {
  opportunities: ArbitrageOpportunity[];
}

function getProfitColor(profitPct: number): string {
  if (profitPct >= 3) return "text-emerald-700 bg-emerald-50 ring-emerald-300";
  if (profitPct >= 2) return "text-cyan-700 bg-cyan-50 ring-cyan-300";
  if (profitPct >= 1) return "text-blue-700 bg-blue-50 ring-blue-300";
  return "text-amber-700 bg-amber-50 ring-amber-300";
}

function getProfitLabel(profitPct: number): string {
  if (profitPct >= 3) return "ECCELLENTE";
  if (profitPct >= 2) return "OTTIMO";
  if (profitPct >= 1) return "BUONO";
  return "MINIMO";
}

const MARKET_LABELS: Record<string, string> = {
  "1x2": "1X2",
  ou_2_5: "Over/Under 2.5",
  btts: "Gol/No Gol",
};

export function ArbitrageTable({ opportunities }: Props) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 text-xs text-purple-900">
        <p className="font-semibold">
          {opportunities.length} opportunità di arbitraggio trovate (profitto ≥ 0.5%)
        </p>
        <p className="mt-1 text-[11px] leading-relaxed">
          Ordinate per profitto decrescente. Ogni opportunità mostra le quote
          migliori disponibili per ogni selezione, il bookmaker che le offre, e
          la ripartizione degli stake per garantire il profitto.
        </p>
      </div>

      {opportunities.map((opp) => (
        <div
          key={`${opp.matchId}-${opp.market}`}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-purple-500 sm:p-5"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            {/* Info partita */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{opp.league}</span>
                <span>•</span>
                <span>
                  {fmtDay(opp.kickoffAt)} ore {fmtTime(opp.kickoffAt)}
                </span>
                <span>•</span>
                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-800">
                  {MARKET_LABELS[opp.market] || opp.market}
                </span>
              </div>

              <h3 className="mt-1 text-base font-bold text-slate-950 sm:text-lg">
                <Link
                  href={`/matches/${opp.matchId}`}
                  className="hover:text-purple-700 hover:underline"
                >
                  {opp.homeTeam}
                  {" "}
                  <span className="font-normal text-slate-400">–</span>
                  {" "}
                  {opp.awayTeam}
                </Link>
              </h3>

              <p className="mt-2 text-[11px] text-slate-500">
                Lettura più vecchia: {Math.round((Date.now() - opp.collectedAt.getTime()) / 60_000)} min fa
              </p>
            </div>

            {/* Profitto */}
            <div
              className={`rounded-xl p-3 text-center ring-2 ${getProfitColor(
                opp.profitPct
              )}`}
            >
              <div className="text-[10px] font-bold uppercase">
                Profitto Garantito
              </div>
              <div className="text-2xl font-extrabold tabular-nums">
                +{opp.profitPct.toFixed(2)}%
              </div>
              <div className="text-[10px] font-bold">
                {getProfitLabel(opp.profitPct)}
              </div>
            </div>
          </div>

          {/* Gambe dell'arbitraggio */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-semibold text-slate-700 uppercase">
              Ripartizione Scommesse
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {opp.legs.map((leg) => (
                <div
                  key={leg.selection}
                  className="rounded-xl bg-slate-50 p-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">
                      {leg.selectionLabel}
                    </span>
                    <span className="rounded bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-xs">
                      {leg.stakePct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-slate-600">Quota:</span>
                    <span className="text-base font-bold text-slate-950 tabular-nums">
                      {leg.bestOdds.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-slate-600">Bookmaker:</span>
                    <span className="text-[11px] font-semibold text-slate-800">
                      {leg.bookmakerName}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    Prob. implicita: {(leg.impliedProb * 100).toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Riepilogo */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs">
            <div className="flex gap-4">
              <div>
                <span className="text-slate-500">Somma prob. implicite: </span>
                <span className="font-bold text-slate-900 tabular-nums">
                  {(opp.totalImpliedProb * 100).toFixed(2)}%
                </span>
              </div>
              <div>
                <span className="text-slate-500">Margine: </span>
                <span className="font-bold text-emerald-600 tabular-nums">
                  -{((1 - opp.totalImpliedProb) * 100).toFixed(2)}%
                </span>
              </div>
            </div>
            <Link
              href="/strumenti"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-purple-600 hover:bg-purple-600 hover:text-white"
            >
              Calcola Stake →
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
