"use client";

import { useState, useMemo } from "react";
import { calculateGreenUp } from "@/lib/quant/exchange-trading";

export function GreenUpCalculator() {
  const [backOdds, setBackOdds] = useState<string>("2.60");
  const [backStake, setBackStake] = useState<string>("100");
  const [layOdds, setLayOdds] = useState<string>("2.10");
  const [commissionPct, setCommissionPct] = useState<string>("4.5");
  const [mode, setMode] = useState<"equal_profit" | "freebet_back">("equal_profit");

  const result = useMemo(() => {
    const bO = Number.parseFloat(backOdds.replace(",", ".")) || 0;
    const bS = Number.parseFloat(backStake.replace(",", ".")) || 0;
    const lO = Number.parseFloat(layOdds.replace(",", ".")) || 0;
    const cP = Number.parseFloat(commissionPct.replace(",", ".")) || 0;

    return calculateGreenUp({
      backOdds: bO,
      backStake: bS,
      layOdds: lO,
      commissionPct: cP,
      mode,
    });
  }, [backOdds, backStake, layOdds, commissionPct, mode]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-950 sm:text-xl">
            Calcolatore Green-Up & Cashout (Betting Exchange)
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Hai puntato (Back) prima del calo e ora vuoi bancare (Lay) per bloccare il profitto o creare una scommessa a rischio zero (Freebet).
          </p>
        </div>

        <div className="flex rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setMode("equal_profit")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === "equal_profit"
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            Green-Up (Profitto Uniforme)
          </button>
          <button
            onClick={() => setMode("freebet_back")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === "freebet_back"
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            Freebet (Rischio Zero)
          </button>
        </div>
      </div>

      {/* Input Form */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Quota di Entrata (Back @)
          </label>
          <input
            type="text"
            value={backOdds}
            onChange={(e) => setBackOdds(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Puntata Iniziale (€)
          </label>
          <input
            type="text"
            value={backStake}
            onChange={(e) => setBackStake(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Quota Attuale di Uscita (Lay @)
          </label>
          <input
            type="text"
            value={layOdds}
            onChange={(e) => setLayOdds(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Commissione Exchange (%)
          </label>
          <input
            type="text"
            value={commissionPct}
            onChange={(e) => setCommissionPct(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 focus:border-cyan-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Risultato Trade */}
      {result && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-md">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Importo da Bancare */}
            <div className="rounded-xl bg-white/10 p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                Azione Operativa Richiesta
              </div>
              <div className="mt-1 text-xl font-extrabold tabular-nums text-white">
                Banca (Lay) € {result.requiredLayStake.toFixed(2)}
              </div>
              <div className="mt-0.5 text-xs text-slate-300">
                alla quota {result.layOdds.toFixed(2)}
              </div>
            </div>

            {/* Profitto Netto */}
            <div className="rounded-xl bg-emerald-500/20 p-3.5 ring-1 ring-emerald-400/40">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                {mode === "equal_profit" ? "Profitto Netto Garantito" : "Vincita Netta Freebet"}
              </div>
              <div className="mt-1 text-2xl font-black tabular-nums text-emerald-400">
                {mode === "equal_profit"
                  ? `${result.hedgedProfitNet >= 0 ? "+" : ""}€ ${result.hedgedProfitNet.toFixed(2)}`
                  : `+€ ${result.freebetProfitIfWin.toFixed(2)}`}
              </div>
              <div className="mt-0.5 text-xs text-emerald-200">
                {mode === "equal_profit"
                  ? `ROI netto: +${result.roiPct.toFixed(1)}%`
                  : `Se perde la selezione: 0.00 € (nessuna perdita)`}
              </div>
            </div>

            {/* Escursione in Tick */}
            <div className="rounded-xl bg-white/10 p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Movimento di Prezzo
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-white">
                {result.tickDifference} Tick
              </div>
              <div className="mt-0.5 text-xs text-slate-300">
                {result.tickDifference < 0 ? "📉 Calo favorevole" : "📈 Rialzo sfavorevole"}
              </div>
            </div>

            {/* Responsabilità / Liability */}
            <div className="rounded-xl bg-white/10 p-3.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Responsabilità Banca
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-white">
                € {(result.requiredLayStake * (result.layOdds - 1)).toFixed(2)}
              </div>
              <div className="mt-0.5 text-xs text-slate-300">
                Coperta dal profitto della puntata
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
