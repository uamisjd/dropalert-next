"use client";

import { useState } from "react";
import Link from "next/link";
import type { TradingOpportunity } from "@/lib/repo/trading-opportunities";
import { fmtDay, fmtTime } from "@/components/format";
import { GreenUpCalculator } from "./GreenUpCalculator";

interface Props {
  initialTrades: TradingOpportunity[];
}

export function TradingTerminalView({ initialTrades }: Props) {
  const [selectedPhase, setSelectedPhase] = useState<string>("all");

  const filtered = initialTrades.filter((t) => {
    if (selectedPhase === "ready" && t.strategyPhase !== "green_up_ready") return false;
    if (selectedPhase === "active" && t.strategyPhase !== "momentum_active") return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Calcolatore Operativo Green-Up */}
      <GreenUpCalculator />

      {/* Sezione Opportunità di Scalping Live */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-950 sm:text-xl">
              Steam Moves & Momentum Radar (Pre-Match Trading)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Partite con forti pressioni di mercato in cui la quota sta crollando: ideali per entrare in Back e uscire in Green-Up prima del fischio d'inizio.
            </p>
          </div>

          <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
            <button
              onClick={() => setSelectedPhase("all")}
              className={`rounded-lg px-2.5 py-1 transition-colors ${
                selectedPhase === "all" ? "bg-slate-950 text-white" : "text-slate-600 hover:text-slate-950"
              }`}
            >
              Tutti ({initialTrades.length})
            </button>
            <button
              onClick={() => setSelectedPhase("ready")}
              className={`rounded-lg px-2.5 py-1 transition-colors ${
                selectedPhase === "ready" ? "bg-slate-950 text-white" : "text-slate-600 hover:text-slate-950"
              }`}
            >
              🚀 Green-Up Pronto
            </button>
            <button
              onClick={() => setSelectedPhase("active")}
              className={`rounded-lg px-2.5 py-1 transition-colors ${
                selectedPhase === "active" ? "bg-slate-950 text-white" : "text-slate-600 hover:text-slate-950"
              }`}
            >
              ⚡ Momentum Attivo
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
            Nessun trade attivo al momento con questi parametri.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filtered.map((trade) => (
              <div
                key={trade.signalId}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{trade.league}</span>
                  <span>
                    {fmtDay(trade.kickoffAt)} ore {fmtTime(trade.kickoffAt)}
                  </span>
                </div>

                <h3 className="mt-1 text-base font-bold text-slate-950">
                  <Link
                    href={`/matches/${trade.matchId}`}
                    className="hover:text-cyan-700 hover:underline"
                  >
                    {trade.homeTeam} – {trade.awayTeam}
                  </Link>
                </h3>

                <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-800">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
                    {trade.marketLabel}
                  </span>
                  <span>Target: <strong>{trade.selectionLabel}</strong></span>
                </div>

                {/* Prezzi e Ticks */}
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-center">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Back Entrata</div>
                    <div className="text-sm font-bold text-slate-900 tabular-nums">
                      {trade.entryBackOdds.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Lay Uscita</div>
                    <div className="text-sm font-bold text-slate-900 tabular-nums">
                      {trade.currentLayOdds.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Escursione</div>
                    <div className="text-sm font-extrabold text-cyan-700 tabular-nums">
                      +{trade.tickMovement} Ticks
                    </div>
                  </div>
                </div>

                {/* Potenziale Green-up e Bottone */}
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
                  <div>
                    <div className="text-[10px] text-slate-500">Potenziale Green-Up (su 100€)</div>
                    <div className="text-sm font-black text-emerald-600 tabular-nums">
                      +€ {trade.exampleNetProfitEuros.toFixed(2)}{" "}
                      <span className="text-xs font-bold text-emerald-700">
                        (+{trade.greenUpRoiPct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/matches/${trade.matchId}`}
                    className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-700"
                  >
                    Grafico & Trade →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
