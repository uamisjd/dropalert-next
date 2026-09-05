"use client";

import { useState, useMemo } from "react";
import { calculateArbitrage } from "@/lib/quant/arbitrage";

interface OutcomeInput {
  label: string;
  bookmaker: string;
  odds: string;
}

export function SurebetCalculator() {
  const [marketType, setMarketType] = useState<"2way" | "3way">("2way");
  const [totalStake, setTotalStake] = useState<number>(500);
  const [roundStakes, setRoundStakes] = useState<boolean>(true);

  const [outcomes2Way, setOutcomes2Way] = useState<OutcomeInput[]>([
    { label: "Over 2.5", bookmaker: "Bookmaker A", odds: "2.10" },
    { label: "Under 2.5", bookmaker: "Bookmaker B", odds: "2.05" },
  ]);

  const [outcomes3Way, setOutcomes3Way] = useState<OutcomeInput[]>([
    { label: "1 (Casa)", bookmaker: "Bookmaker 1", odds: "2.90" },
    { label: "X (Pareggio)", bookmaker: "Bookmaker 2", odds: "3.45" },
    { label: "2 (Trasferta)", bookmaker: "Bookmaker 3", odds: "2.80" },
  ]);

  const currentOutcomes = marketType === "2way" ? outcomes2Way : outcomes3Way;
  const setOutcomes = marketType === "2way" ? setOutcomes2Way : setOutcomes3Way;

  const result = useMemo(() => {
    const parsed = currentOutcomes.map((o) => ({
      label: o.label,
      bookmaker: o.bookmaker,
      odds: Number.parseFloat(o.odds.replace(",", ".")) || 0,
    }));

    const raw = calculateArbitrage(parsed, totalStake);
    if (!raw || !roundStakes) return raw;

    // Arrotonda gli stake all'euro intero (standard per non farsi limitare)
    let totalRounded = 0;
    const roundedOutcomes = raw.outcomes.map((o) => {
      const rStake = Math.round(o.stake);
      totalRounded += rStake;
      return {
        ...o,
        stake: rStake,
        payout: Number((rStake * o.odds).toFixed(2)),
      };
    });

    const minPayout = Math.min(...roundedOutcomes.map((o) => o.payout));
    const profit = Number((minPayout - totalRounded).toFixed(2));
    const profitPct = Number(((profit / totalRounded) * 100).toFixed(2));

    return {
      ...raw,
      totalStake: totalRounded,
      totalPayout: minPayout,
      guaranteedProfit: profit,
      profitPct,
      outcomes: roundedOutcomes,
    };
  }, [currentOutcomes, totalStake, roundStakes]);

  const handleOddsChange = (index: number, val: string) => {
    const updated = [...currentOutcomes];
    updated[index] = { ...updated[index], odds: val };
    setOutcomes(updated);
  };

  const handleBookChange = (index: number, val: string) => {
    const updated = [...currentOutcomes];
    updated[index] = { ...updated[index], bookmaker: val };
    setOutcomes(updated);
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-950 sm:text-xl">
            Calcolatore Surebet & Arbitraggio Matematico
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Distribuisce l&apos;importo sulle quote che inserisci, così che il risultato sia lo
stesso a ogni esito. La distribuzione è matematica; l&apos;esistenza di quelle quote,
nello stesso momento e allo stesso importo, non lo è.
          </p>
        </div>

        {/* Scelta 2-Vie o 3-Vie */}
        <div className="flex rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setMarketType("2way")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              marketType === "2way"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            2 Esiti (O/U, GG/NG, Testa a Testa)
          </button>
          <button
            onClick={() => setMarketType("3way")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              marketType === "3way"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            3 Esiti (1X2)
          </button>
        </div>
      </div>

      {/* Input Parametri Generali */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Importo Totale da Investire (€)
          </label>
          <input
            type="number"
            min="10"
            step="50"
            value={totalStake}
            onChange={(e) =>
              setTotalStake(Math.max(10, Number(e.target.value) || 0))
            }
            className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-3 pt-6">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={roundStakes}
              onChange={(e) => setRoundStakes(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
            />
            <span>Arrotonda gli importi all&apos;euro intero</span>
          </label>
        </div>
      </div>

      {/* Griglia Input Quote e Bookmaker */}
      <div className="mt-5 space-y-3">
        {currentOutcomes.map((outcome, idx) => (
          <div
            key={idx}
            className="grid grid-cols-1 items-center gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-12 sm:gap-3"
          >
            <div className="sm:col-span-3">
              <span className="text-xs font-bold text-slate-800">
                {outcome.label}
              </span>
            </div>
            <div className="sm:col-span-4">
              <input
                type="text"
                placeholder="Nome Bookmaker"
                value={outcome.bookmaker}
                onChange={(e) => handleBookChange(idx, e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-3">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 text-xs text-slate-400">
                  @
                </span>
                <input
                  type="text"
                  placeholder="Quota (es. 2.10)"
                  value={outcome.odds}
                  onChange={(e) => handleOddsChange(idx, e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-2.5 pl-6 text-xs font-bold text-slate-900 tabular-nums focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="text-right sm:col-span-2">
              <span className="text-xs font-semibold text-slate-500">
                {result?.outcomes[idx] ? `€ ${result.outcomes[idx].stake}` : "—"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Verdetto Arbitraggio */}
      {result && (
        <div
          className={`mt-6 rounded-2xl p-4 sm:p-5 ${
            result.isArbitrage
              ? "border border-emerald-300 bg-emerald-50 text-emerald-950"
              : "border border-slate-200 bg-slate-50 text-slate-800"
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    result.isArbitrage ? "bg-emerald-500 animate-ping" : "bg-slate-400"
                  }`}
                />
                <span className="text-xs font-bold uppercase tracking-wider">
                  {result.isArbitrage
                    ? "✨ SUREBET TROVATA — PROFITTO GARANTITO"
                    : "Nessuna Surebet (Mercato con Margine)"}
                </span>
              </div>
              <p className="mt-1 text-xs opacity-80">
                {result.isArbitrage
                  ? `Puntando le quote indicate otterrai un ritorno sicuro a prescindere dall'esito finale.`
                  : `Overround attuale: ${(100 + result.arbitrageMarginPct).toFixed(2)}%. Serve un overround < 100% per l'arbitraggio.`}
              </p>
            </div>

            {/* Rendimento e Guadagno */}
            {result.isArbitrage && (
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-emerald-100/80 px-3 py-2 text-center">
                  <div className="text-[10px] font-bold uppercase text-emerald-800">
                    Profitto Netto
                  </div>
                  <div className="text-lg font-extrabold text-emerald-700 tabular-nums">
                    +€ {result.guaranteedProfit.toFixed(2)}
                  </div>
                </div>
                <div className="rounded-xl bg-emerald-600 px-3.5 py-2 text-center text-white">
                  <div className="text-[10px] font-bold uppercase opacity-90">
                    ROI su queste quote
                  </div>
                  <div className="text-lg font-extrabold tabular-nums">
                    +{result.profitPct.toFixed(2)}%
                  </div>
                </div>
              </div>
            )}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Il vantaggio esiste solo se tutte le quote indicate sono disponibili{" "}
            <strong>nello stesso istante e per l&#39;intero importo</strong>. Qui non entrano
            commissioni dell&#39;exchange né limiti di puntata: è aritmetica su numeri che
            inserisci tu, non un&#39;operazione che il sito abbia osservato da qualche parte.
          </p>

          {/* Ripartizione Dettagliata Puntate */}
          {result.isArbitrage && (
            <div className="mt-4 grid grid-cols-1 gap-2 border-t border-emerald-200/60 pt-3 sm:grid-cols-3">
              {result.outcomes.map((o, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-white/70 p-2.5 text-xs text-slate-800"
                >
                  <div className="font-bold">{o.label} ({o.bookmaker})</div>
                  <div className="mt-1 text-slate-600">
                    Punta: <strong className="text-slate-900">€ {o.stake}</strong> @ {o.odds}
                  </div>
                  <div className="text-slate-600">
                    Incasso se vince: <strong>€ {o.payout}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
