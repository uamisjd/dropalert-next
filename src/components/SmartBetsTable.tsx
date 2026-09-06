"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ValueOpportunity } from "@/lib/quant/types";
import { fmtDay, fmtTime } from "@/components/format";
import { KellyInline } from "@/components/KellyInline";

interface Props {
  opportunities: ValueOpportunity[];
}

/**
 * Calcola il punteggio Smart (0-100) combinando:
 * - Edge (40 punti): edge% normalizzato (max 10% = 40 punti)
 * - Kelly (20 punti): kelly% normalizzato (max 5% = 20 punti)
 * - Quota (20 punti): quote tra 1.80 e 3.00 ottengono max punteggio
 * - Freshness (20 punti): lettura recente (< 30 min = 20 punti)
 */
function calculateSmartScore(opp: ValueOpportunity): number {
  // Edge: 40 punti, max a 10%
  const edgeScore = Math.min(opp.edgePct / 10, 1) * 40;

  // Kelly: 20 punti, max a 5%
  const kellyPct =
    opp.trueProbPct > 0
      ? Math.max(0, (opp.trueProbPct - opp.impliedProbPct) * 0.25)
      : 0;
  const kellyScore = Math.min(kellyPct / 5, 1) * 20;

  // Quota: 20 punti, ottimale tra 1.80 e 3.00
  let oddsScore = 0;
  if (opp.currentOdds >= 1.8 && opp.currentOdds <= 3.0) {
    oddsScore = 20;
  } else if (opp.currentOdds >= 1.5 && opp.currentOdds < 1.8) {
    oddsScore = 15;
  } else if (opp.currentOdds > 3.0 && opp.currentOdds <= 4.0) {
    oddsScore = 15;
  } else if (opp.currentOdds >= 1.3 && opp.currentOdds < 1.5) {
    oddsScore = 10;
  } else if (opp.currentOdds > 4.0 && opp.currentOdds <= 5.0) {
    oddsScore = 10;
  } else {
    oddsScore = 5;
  }

  // Freshness: 20 punti, max se < 30 min
  let freshnessScore = 0;
  if (opp.lineAgeMinutes !== null) {
    if (opp.lineAgeMinutes <= 30) {
      freshnessScore = 20;
    } else if (opp.lineAgeMinutes <= 60) {
      freshnessScore = 15;
    } else if (opp.lineAgeMinutes <= 120) {
      freshnessScore = 10;
    } else {
      freshnessScore = 5;
    }
  } else {
    freshnessScore = 10; // dato mancante, punteggio medio
  }

  return Math.round(edgeScore + kellyScore + oddsScore + freshnessScore);
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600 bg-emerald-50 ring-emerald-200";
  if (score >= 60) return "text-cyan-600 bg-cyan-50 ring-cyan-200";
  if (score >= 40) return "text-amber-600 bg-amber-50 ring-amber-200";
  return "text-slate-600 bg-slate-50 ring-slate-200";
}

function getScoreLabel(score: number): string {
  if (score >= 80) return "ECCELLENTE";
  if (score >= 60) return "BUONO";
  if (score >= 40) return "DISCRETO";
  return "BASSO";
}

export function SmartBetsTable({ opportunities }: Props) {
  // Ordina per punteggio Smart decrescente
  const sorted = useMemo(() => {
    return [...opportunities]
      .map((opp) => ({
        ...opp,
        smartScore: calculateSmartScore(opp),
      }))
      .sort((a, b) => b.smartScore - a.smartScore);
  }, [opportunities]);

  const signed = (v: number, d = 2): string =>
    `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-xs text-cyan-900">
        <p className="font-semibold">
          {sorted.length} smart bets trovati (edge ≥ 2%)
        </p>
        <p className="mt-1 text-[11px] leading-relaxed">
          Ordinati per punteggio combinato (0-100). Il punteggio combina edge,
          Kelly, quota e freshness. Un punteggio ≥ 80 significa che tutti i
          fattori sono favorevoli.
        </p>
      </div>

      {sorted.map((opp) => (
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
                    CONFERMA SHARP
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
              {/* Smart Score */}
              <div
                className={`rounded-xl p-3 text-center ring-2 ${getScoreColor(
                  opp.smartScore
                )}`}
              >
                <div className="text-[10px] font-bold uppercase">
                  Smart Score
                </div>
                <div className="text-2xl font-extrabold tabular-nums">
                  {opp.smartScore}
                </div>
                <div className="text-[10px] font-bold">
                  {getScoreLabel(opp.smartScore)}
                </div>
              </div>

              {/* Quota */}
              <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                <div className="text-[10px] font-semibold text-slate-500 uppercase">
                  Quota
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

              {/* Edge */}
              <div className="rounded-xl bg-emerald-50 p-2.5 text-center ring-1 ring-emerald-200">
                <div className="text-[10px] font-bold text-emerald-700 uppercase">
                  Edge
                </div>
                <div className="text-lg font-extrabold text-emerald-600 tabular-nums">
                  {signed(opp.edgePct, 1)}%
                </div>
                <div className="text-[11px] text-slate-500 tabular-nums">
                  fair {opp.trueProbPct.toFixed(1)}% · impl{" "}
                  {opp.impliedProbPct.toFixed(1)}%
                </div>
              </div>

              {/* Kelly */}
              <KellyInline
                offeredOdds={opp.currentOdds}
                trueProbPct={opp.trueProbPct}
                edgePct={opp.edgePct}
                compact
              />

              <Link
                href={`/matches/${opp.matchId}`}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-3 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-950 hover:bg-slate-950 hover:text-white"
              >
                Scheda →
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
