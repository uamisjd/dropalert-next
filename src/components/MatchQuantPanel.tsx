"use client";

import { useState, useMemo } from "react";
import type { DetailSignal, MarketSeries } from "@/lib/repo/match-detail";
import { calculateEV } from "@/lib/quant/ev-engine";
import { calculateKellyStake } from "@/lib/quant/kelly";
import { calculateGreenUp } from "@/lib/quant/exchange-trading";
import { simulateDixonColes } from "@/lib/quant/dixon-coles";
import { buildSyntheticMarkets } from "@/lib/quant/synthetic-odds";
import { round } from "@/lib/drop/math";

interface Props {
  signal: DetailSignal | null;
  series: MarketSeries | null;
  allSeries: MarketSeries[];
  homeTeam: string;
  awayTeam: string;
}

export function MatchQuantPanel({
  signal,
  series,
  allSeries,
  homeTeam,
  awayTeam,
}: Props) {
  const [bankroll, setBankroll] = useState<number>(1000);
  const [kellyTier, setKellyTier] = useState<"eighth" | "quarter" | "half">("quarter");

  const currentPrice = series?.current ?? signal?.currentPrice ?? null;
  const openingPrice = series?.opening ?? signal?.openingPrice ?? null;

  // Calcolo +EV & Kelly
  const quantMetrics = useMemo(() => {
    if (!currentPrice || currentPrice <= 1.01) return null;

    const implied = 1 / currentPrice;
    const fairProb = Math.min(0.95, implied / 1.045);
    const fairOdds = round(1 / fairProb, 3);

    const priceToEvaluate = openingPrice && openingPrice > currentPrice
      ? openingPrice
      : currentPrice * 1.04;

    const ev = calculateEV(priceToEvaluate, { fairOdds, trueProb: fairProb });
    const kelly = calculateKellyStake({
      offeredOdds: priceToEvaluate,
      trueProbability: fairProb,
      bankroll,
      tier: kellyTier,
    });

    let greenUp = null;
    if (openingPrice && openingPrice > currentPrice) {
      greenUp = calculateGreenUp({
        backOdds: openingPrice,
        backStake: 100,
        layOdds: currentPrice,
        commissionPct: 4.5,
      });
    }

    return {
      fairOdds,
      fairProbPct: round(fairProb * 100, 1),
      edgePct: ev ? ev.edgePct : 0,
      hasEdge: ev ? ev.hasEdge : false,
      kelly,
      greenUp,
    };
  }, [currentPrice, openingPrice, bankroll, kellyTier]);

  // Simulazione Dixon-Coles
  const poissonSim = useMemo(() => {
    return simulateDixonColes({
      lambdaHome: 1.55,
      muAway: 1.15,
      rho: -0.12,
    });
  }, []);

  // Quote Sintetiche se 1X2 disponibile
  const syntheticMarkets = useMemo(() => {
    const s1 = allSeries.find((s) => s.selection === "home")?.current ?? 2.2;
    const sX = allSeries.find((s) => s.selection === "draw")?.current ?? 3.3;
    const s2 = allSeries.find((s) => s.selection === "away")?.current ?? 3.4;
    return buildSyntheticMarkets(s1, sX, s2);
  }, [allSeries]);

  return (
    <section
      id="quant-alpha"
      aria-labelledby="titolo-quant"
      className="scroll-mt-20 pt-10"
    >
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <p className="text-xs font-bold tracking-[0.16em] text-emerald-700 uppercase">
            Alpha & Intelligence Terminal
          </p>
        </div>
        <h2
          id="titolo-quant"
          className="mt-1 text-xl font-bold tracking-tight text-slate-950"
        >
          Valutazione Quantitativa & Trading della Partita
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Expected Value (+EV), dimensionamento dello stake tramite Criterio di Kelly,
          opportunità di Cash-out / Green-Up e modello statistico Dixon-Coles.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Box 1: Value Betting & Kelly Staking */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
              💎 Analisi Valore (+EV) & Kelly
            </h3>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
              {quantMetrics && quantMetrics.edgePct > 0
                ? `+${quantMetrics.edgePct.toFixed(1)}% Edge`
                : "0.0% Edge"}
            </span>
          </div>

          {quantMetrics ? (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3 text-center">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Quota Reale</div>
                  <div className="text-base font-bold text-slate-950">
                    {currentPrice?.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Quota Fair No-Vig</div>
                  <div className="text-base font-bold text-slate-700">
                    @{quantMetrics.fairOdds.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-emerald-700 font-bold uppercase">Prob. Stimata</div>
                  <div className="text-base font-extrabold text-emerald-600">
                    {quantMetrics.fairProbPct}%
                  </div>
                </div>
              </div>

              {/* Parametro Bankroll & Kelly */}
              <div className="rounded-2xl border border-slate-200 p-3.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">
                    Il tuo Bankroll:
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400">€</span>
                    <input
                      type="number"
                      value={bankroll}
                      onChange={(e) =>
                        setBankroll(Math.max(10, Number(e.target.value) || 0))
                      }
                      className="w-24 rounded-lg border border-slate-300 px-2 py-0.5 text-xs font-bold text-slate-900"
                    />
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Frazione Kelly:</span>
                  <div className="flex gap-1">
                    {(["eighth", "quarter", "half"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setKellyTier(t)}
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                          kellyTier === t
                            ? "bg-slate-950 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {t === "eighth" ? "⅛" : t === "quarter" ? "¼" : "½"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
                  <span className="text-xs font-bold text-cyan-900">
                    Stake Consigliato ({kellyTier === "quarter" ? "¼ Kelly" : kellyTier}):
                  </span>
                  <span className="text-sm font-extrabold text-cyan-700 tabular-nums">
                    € {quantMetrics.kelly.recommendedStakeAmount.toFixed(2)}{" "}
                    <span className="text-xs text-slate-500 font-normal">
                      ({quantMetrics.kelly.recommendedStakePct}%)
                    </span>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Dati di quota non sufficienti per calcolare l'Expected Value.
            </p>
          )}
        </div>

        {/* Box 2: Trading Exchange & Green-Up */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
              📈 Trading Exchange & Scalping
            </h3>
            {quantMetrics?.greenUp && (
              <span className="rounded-full bg-cyan-100 px-2.5 py-0.5 text-xs font-bold text-cyan-900">
                +{quantMetrics.greenUp.roiPct.toFixed(1)}% ROI Green-Up
              </span>
            )}
          </div>

          {quantMetrics?.greenUp ? (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-600">
                Se sei entrato in Back a quota <strong>{openingPrice?.toFixed(2)}</strong> (100 €) e la quota è scesa a <strong>{currentPrice?.toFixed(2)}</strong>:
              </p>

              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-950 p-4 text-white">
                <div>
                  <div className="text-[10px] text-cyan-300 uppercase font-bold">
                    Azione Operativa
                  </div>
                  <div className="text-base font-extrabold tabular-nums">
                    Banca (Lay) € {quantMetrics.greenUp.requiredLayStake.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-slate-400">@ {currentPrice?.toFixed(2)}</div>
                </div>

                <div className="border-l border-white/15 pl-3">
                  <div className="text-[10px] text-emerald-400 uppercase font-bold">
                    Profitto Netto
                  </div>
                  <div className="text-xl font-black text-emerald-400 tabular-nums">
                    +€ {quantMetrics.greenUp.hedgedProfitNet.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-emerald-200">Garantito su tutti gli esiti</div>
                </div>
              </div>

              <div className="text-[11px] text-slate-500">
                Escursione di prezzo: <strong>{quantMetrics.greenUp.tickDifference} tick</strong> (Betfair standard ladder).
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-xs text-slate-600">
              <p className="font-semibold text-slate-800">Nessuna posizione in calo favorevole.</p>
              <p className="mt-1">
                Il Green-Up pre-gara richiede un calo significativo della quota rispetto all'apertura per bloccare un profitto su entrambi i lati.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Box 3: Quote Sintetiche Correlate & Modello Goal */}
      <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
          🎯 Quote Sintetiche Derivate dal Mercato 1X2
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Quote teoriche perfette calcolate matematicamente dalla terna 1X2. Se il bookmaker offre quote più alte, si ha un disallineamento sfruttabile.
        </p>

        {syntheticMarkets && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 p-3 text-center">
              <div className="text-[10px] text-slate-500 uppercase">Doppia Chance 1X</div>
              <div className="text-base font-bold text-slate-900 tabular-nums">
                @{syntheticMarkets.doubleChance.oneX.toFixed(2)}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 text-center">
              <div className="text-[10px] text-slate-500 uppercase">Doppia Chance X2</div>
              <div className="text-base font-bold text-slate-900 tabular-nums">
                @{syntheticMarkets.doubleChance.xTwo.toFixed(2)}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 text-center">
              <div className="text-[10px] text-slate-500 uppercase">Draw No Bet (DNB 1)</div>
              <div className="text-base font-bold text-slate-900 tabular-nums">
                @{syntheticMarkets.drawNoBet.dnb1.toFixed(2)}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 text-center">
              <div className="text-[10px] text-slate-500 uppercase">Draw No Bet (DNB 2)</div>
              <div className="text-base font-bold text-slate-900 tabular-nums">
                @{syntheticMarkets.drawNoBet.dnb2.toFixed(2)}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
