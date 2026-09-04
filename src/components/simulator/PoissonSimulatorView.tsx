"use client";

import { useState, useMemo } from "react";
import { simulateDixonColes } from "@/lib/quant/dixon-coles";
import { calculateEV } from "@/lib/quant/ev-engine";

export function PoissonSimulatorView() {
  const [lambdaHome, setLambdaHome] = useState<number>(1.65);
  const [muAway, setMuAway] = useState<number>(1.15);
  const [rho, setRho] = useState<number>(-0.12);

  // Quote di mercato per il confronto
  const [marketOddsHome, setMarketOddsHome] = useState<string>("2.10");
  const [marketOddsDraw, setMarketOddsDraw] = useState<string>("3.40");
  const [marketOddsAway, setMarketOddsAway] = useState<string>("3.75");
  const [marketOddsOver25, setMarketOddsOver25] = useState<string>("1.95");
  const [marketOddsBttsYes, setMarketOddsBttsYes] = useState<string>("1.85");

  const simulation = useMemo(() => {
    return simulateDixonColes({
      lambdaHome,
      muAway,
      rho,
      maxGoals: 5,
    });
  }, [lambdaHome, muAway, rho]);

  // Calcolo Edge rispetto alle quote di mercato inserite
  const evHome = useMemo(() => {
    const o = Number.parseFloat(marketOddsHome.replace(",", ".")) || 0;
    return calculateEV(o, { fairOdds: simulation.fairOdds.homeWin });
  }, [marketOddsHome, simulation.fairOdds.homeWin]);

  const evOver25 = useMemo(() => {
    const o = Number.parseFloat(marketOddsOver25.replace(",", ".")) || 0;
    return calculateEV(o, { fairOdds: simulation.fairOdds.over25 });
  }, [marketOddsOver25, simulation.fairOdds.over25]);

  const evBtts = useMemo(() => {
    const o = Number.parseFloat(marketOddsBttsYes.replace(",", ".")) || 0;
    return calculateEV(o, { fairOdds: simulation.fairOdds.bttsYes });
  }, [marketOddsBttsYes, simulation.fairOdds.bttsYes]);

  return (
    <div className="space-y-6">
      {/* Box Controlli xG / Goal Expectancy */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-lg font-bold text-slate-950 sm:text-xl">
          Parametri xG / Goal Expectancy (Dixon-Coles)
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Imposta i gol attesi per squadra (xG) e il fattore di correlazione dei punteggi bassi per calcolare la distribuzione statistica esatta.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {/* Lambda Casa */}
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase text-slate-700">
                xG Squadra Casa (λ)
              </label>
              <span className="text-sm font-extrabold text-cyan-700 tabular-nums">
                {lambdaHome.toFixed(2)} gol
              </span>
            </div>
            <input
              type="range"
              min="0.3"
              max="3.5"
              step="0.05"
              value={lambdaHome}
              onChange={(e) => setLambdaHome(Number.parseFloat(e.target.value))}
              className="mt-3 w-full accent-cyan-600"
            />
          </div>

          {/* Mu Trasferta */}
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase text-slate-700">
                xG Squadra Trasferta (μ)
              </label>
              <span className="text-sm font-extrabold text-cyan-700 tabular-nums">
                {muAway.toFixed(2)} gol
              </span>
            </div>
            <input
              type="range"
              min="0.3"
              max="3.5"
              step="0.05"
              value={muAway}
              onChange={(e) => setMuAway(Number.parseFloat(e.target.value))}
              className="mt-3 w-full accent-cyan-600"
            />
          </div>

          {/* Rho Correlazione */}
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase text-slate-700">
                Correlazione Dixon-Coles (ρ)
              </label>
              <span className="text-sm font-extrabold text-slate-800 tabular-nums">
                {rho.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="-0.25"
              max="0.0"
              step="0.01"
              value={rho}
              onChange={(e) => setRho(Number.parseFloat(e.target.value))}
              className="mt-3 w-full accent-slate-600"
            />
            <p className="mt-1 text-[10px] text-slate-400">
              Standard Dixon-Coles calcio: -0.12
            </p>
          </div>
        </div>
      </div>

      {/* Quote Fair Calcolate vs Mercato */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* 1X2 */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Mercato 1X2 Fair Model
          </h3>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5">
              <span>1 (Casa): <strong>{simulation.probabilities.homeWinPct}%</strong></span>
              <span className="font-bold text-slate-900">Fair @ {simulation.fairOdds.homeWin.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5">
              <span>X (Pareggio): <strong>{simulation.probabilities.drawPct}%</strong></span>
              <span className="font-bold text-slate-900">Fair @ {simulation.fairOdds.draw.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5">
              <span>2 (Trasferta): <strong>{simulation.probabilities.awayWinPct}%</strong></span>
              <span className="font-bold text-slate-900">Fair @ {simulation.fairOdds.awayWin.toFixed(2)}</span>
            </div>
          </div>

          {/* Confronto Quota 1 */}
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="text-[11px] text-slate-500">Quota Bookmaker su Esito 1:</div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={marketOddsHome}
                onChange={(e) => setMarketOddsHome(e.target.value)}
                className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold text-slate-900"
              />
              <span
                className={`text-xs font-extrabold ${
                  evHome && evHome.hasEdge ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {evHome && evHome.hasEdge ? `+${evHome.edgePct}% EV 💎` : `${evHome?.edgePct}% EV`}
              </span>
            </div>
          </div>
        </div>

        {/* Over / Under 2.5 */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Over / Under 2.5 Fair Model
          </h3>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5">
              <span>Over 2.5: <strong>{simulation.probabilities.over25Pct}%</strong></span>
              <span className="font-bold text-slate-900">Fair @ {simulation.fairOdds.over25.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5">
              <span>Under 2.5: <strong>{simulation.probabilities.under25Pct}%</strong></span>
              <span className="font-bold text-slate-900">Fair @ {simulation.fairOdds.under25.toFixed(2)}</span>
            </div>
          </div>

          {/* Confronto Over 2.5 */}
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="text-[11px] text-slate-500">Quota Bookmaker su Over 2.5:</div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={marketOddsOver25}
                onChange={(e) => setMarketOddsOver25(e.target.value)}
                className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold text-slate-900"
              />
              <span
                className={`text-xs font-extrabold ${
                  evOver25 && evOver25.hasEdge ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {evOver25 && evOver25.hasEdge ? `+${evOver25.edgePct}% EV 💎` : `${evOver25?.edgePct}% EV`}
              </span>
            </div>
          </div>
        </div>

        {/* Goal / No Goal */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Goal / No Goal (BTTS) Fair Model
          </h3>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5">
              <span>Goal (Sì): <strong>{simulation.probabilities.bttsYesPct}%</strong></span>
              <span className="font-bold text-slate-900">Fair @ {simulation.fairOdds.bttsYes.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5">
              <span>No Goal: <strong>{simulation.probabilities.bttsNoPct}%</strong></span>
              <span className="font-bold text-slate-900">Fair @ {simulation.fairOdds.bttsNo.toFixed(2)}</span>
            </div>
          </div>

          {/* Confronto BTTS */}
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="text-[11px] text-slate-500">Quota Bookmaker su Goal Sì:</div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={marketOddsBttsYes}
                onChange={(e) => setMarketOddsBttsYes(e.target.value)}
                className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold text-slate-900"
              />
              <span
                className={`text-xs font-extrabold ${
                  evBtts && evBtts.hasEdge ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {evBtts && evBtts.hasEdge ? `+${evBtts.edgePct}% EV 💎` : `${evBtts?.edgePct}% EV`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Matrice dei Risultati Esatti (Heatmap) */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h3 className="text-base font-bold text-slate-950">
          Matrice delle Probabilità dei Risultati Esatti (0-0 a 5-5)
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Probabilità percentuale e quota fair no-vig teorica per ciascun punteggio finale.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-center text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="p-2 font-bold">Casa \ Ospite</th>
                {[0, 1, 2, 3, 4, 5].map((y) => (
                  <th key={y} className="p-2 font-bold">{y} gol</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {simulation.scoreMatrix.map((row, x) => (
                <tr key={x} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-2 font-bold text-slate-800">{x} gol</td>
                  {row.map((cell, y) => {
                    // Colora in base all'intensità della probabilità
                    const intensity = Math.min(1, cell.probPct / 12);
                    const isHigh = cell.probPct >= 8.0;
                    return (
                      <td
                        key={y}
                        className={`p-2 transition-colors ${
                          isHigh ? "bg-cyan-100 font-bold text-cyan-950" : ""
                        }`}
                        style={{
                          backgroundColor:
                            cell.probPct > 1
                              ? `rgba(6, 182, 212, ${intensity * 0.25})`
                              : undefined,
                        }}
                      >
                        <div className="font-semibold text-slate-900">{cell.probPct.toFixed(1)}%</div>
                        <div className="text-[10px] text-slate-500">@{cell.fairOdds.toFixed(1)}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Risultati più probabili */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <span className="text-xs font-semibold text-slate-600">Top Risultati Probabili:</span>
          {simulation.mostLikelyScores.map((s, idx) => (
            <span
              key={idx}
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-800"
            >
              {s.home}–{s.away} ({s.probPct.toFixed(1)}% @ {s.odds.toFixed(2)})
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
