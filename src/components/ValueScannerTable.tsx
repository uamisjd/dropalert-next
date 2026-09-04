"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { ValueOpportunity } from "@/lib/quant/types";
import { fmtDay, fmtTime } from "@/components/format";

interface Props {
  initialOpportunities: ValueOpportunity[];
  initialBankroll?: number;
}

export function ValueScannerTable({
  initialOpportunities,
  initialBankroll = 1000,
}: Props) {
  const [bankroll, setBankroll] = useState<number>(initialBankroll);
  const [minEdge, setMinEdge] = useState<number>(0);
  const [oddsRange, setOddsRange] = useState<string>("all");
  const [selectedStrategy, setSelectedStrategy] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");

  const filtered = useMemo(() => {
    return initialOpportunities.filter((item) => {
      if (item.edgePct < minEdge) return false;

      if (oddsRange === "low" && item.currentOdds >= 2.0) return false;
      if (
        oddsRange === "medium" &&
        (item.currentOdds < 2.0 || item.currentOdds > 3.5)
      )
        return false;
      if (oddsRange === "high" && item.currentOdds <= 3.5) return false;

      if (selectedStrategy !== "all" && item.strategy !== selectedStrategy)
        return false;

      if (searchTerm.trim() !== "") {
        const q = searchTerm.toLowerCase();
        const matchStr = `${item.homeTeam} ${item.awayTeam} ${item.league} ${item.selectionLabel}`.toLowerCase();
        if (!matchStr.includes(q)) return false;
      }

      return true;
    });
  }, [initialOpportunities, minEdge, oddsRange, selectedStrategy, searchTerm]);

  return (
    <div className="space-y-4">
      {/* Barra di controllo parametri & Bankroll */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Bankroll */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              Il tuo Bankroll (€)
            </label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-500">
                €
              </span>
              <input
                type="number"
                min="10"
                step="50"
                value={bankroll}
                onChange={(e) =>
                  setBankroll(Math.max(10, Number(e.target.value) || 0))
                }
                className="w-full rounded-xl border border-slate-300 py-2 pr-3 pl-8 text-sm font-semibold text-slate-900 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Calcola lo stake Kelly in euro
            </p>
          </div>

          {/* Minimo Edge % */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              Minimo Edge (+EV)
            </label>
            <select
              value={minEdge}
              onChange={(e) => setMinEdge(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-cyan-500 focus:outline-none"
            >
              <option value={0}>Tutti i valori (+0.5%)</option>
              <option value={2}>Almeno +2.0% EV</option>
              <option value={4}>Almeno +4.0% EV</option>
              <option value={6}>Almeno +6.0% EV (Forte)</option>
              <option value={8}>Almeno +8.0% EV (Massimo)</option>
            </select>
          </div>

          {/* Range Quota */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              Fascia Quota
            </label>
            <select
              value={oddsRange}
              onChange={(e) => setOddsRange(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-cyan-500 focus:outline-none"
            >
              <option value="all">Tutte le quote (1.01 – 50.0)</option>
              <option value="low">Quote Basse (&lt; 2.00)</option>
              <option value="medium">Quote Medie (2.00 – 3.50)</option>
              <option value="high">Quote Alte (&gt; 3.50)</option>
            </select>
          </div>

          {/* Cerca Partita / Squadra */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              Cerca Partita
            </label>
            <input
              type="text"
              placeholder="es. Inter, Chelsea, Serie A..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Tab Strategie */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-xs font-medium text-slate-500">Strategia:</span>
          {[
            { id: "all", label: "Tutte" },
            { id: "steam_chase", label: "🔥 Steam Move (Sharp Confirm)" },
            { id: "market_lag", label: "⚡ Latenza / Market Lag" },
            { id: "value_bet", label: "💎 Pure Value (+EV)" },
          ].map((strat) => (
            <button
              key={strat.id}
              onClick={() => setSelectedStrategy(strat.id)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedStrategy === strat.id
                  ? "bg-slate-950 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {strat.label}
            </button>
          ))}
          <span className="ml-auto text-xs font-semibold text-slate-500">
            {filtered.length} opportunità trovate
          </span>
        </div>
      </div>

      {/* Lista / Tabella Operativa */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">
            Nessuna Value Bet rispetta i filtri selezionati.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Prova ad abbassare la soglia di Edge o ad allargare la fascia di quote.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((opp) => {
            const stakeEuro = ((bankroll * opp.recommendedKellyPct) / 100).toFixed(2);
            return (
              <div
                key={opp.id}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-cyan-500 hover:shadow-md sm:p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  {/* Intestazione e info match */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">
                        {opp.league}
                      </span>
                      <span>•</span>
                      <span>
                        {fmtDay(opp.kickoffAt)} ore {fmtTime(opp.kickoffAt)}
                      </span>
                      {opp.sharpConfirmed && (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          SHARP CONFIRMED
                        </span>
                      )}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {opp.strategy === "steam_chase"
                          ? "Steam Move"
                          : opp.strategy === "market_lag"
                            ? "Market Lag"
                            : "Value Bet"}
                      </span>
                    </div>

                    <h3 className="mt-1 text-base font-bold text-slate-950 sm:text-lg">
                      <Link
                        href={`/matches/${opp.matchId}`}
                        className="hover:text-cyan-700 hover:underline"
                      >
                        {opp.homeTeam}{" "}
                        <span className="font-normal text-slate-400">–</span>{" "}
                        {opp.awayTeam}
                      </Link>
                    </h3>

                    {/* Selezione e Mercato */}
                    <div className="mt-1 flex items-center gap-2 text-sm text-slate-700">
                      <span className="text-xs uppercase text-slate-500">
                        Selezione:
                      </span>
                      <span className="font-bold text-slate-950">
                        {opp.selectionLabel}
                      </span>
                      <span className="text-xs text-slate-400">
                        ({opp.market.toUpperCase()})
                      </span>
                    </div>
                  </div>

                  {/* Metriche Finanziarie & Prezzi */}
                  <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 sm:border-t-0 sm:pt-0">
                    {/* Prezzo Mercato vs Fair */}
                    <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                      <div className="text-[10px] font-semibold uppercase text-slate-500">
                        Quota Attuale
                      </div>
                      <div className="text-lg font-bold text-slate-950 tabular-nums">
                        {opp.currentOdds.toFixed(2)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Fair: <span className="font-semibold text-slate-700">{opp.fairOdds.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Edge (+EV) */}
                    <div className="rounded-xl bg-emerald-50 p-2.5 text-center ring-1 ring-emerald-200">
                      <div className="text-[10px] font-bold uppercase text-emerald-700">
                        Edge (+EV)
                      </div>
                      <div className="text-lg font-extrabold text-emerald-600 tabular-nums">
                        +{opp.edgePct.toFixed(1)}%
                      </div>
                      <div className="text-[11px] font-medium text-emerald-800">
                        Prob: {opp.trueProbPct}%
                      </div>
                    </div>

                    {/* Kelly Stake */}
                    <div className="rounded-xl bg-cyan-50 p-2.5 text-center ring-1 ring-cyan-200">
                      <div className="text-[10px] font-bold uppercase text-cyan-800">
                        Kelly Stake (¼)
                      </div>
                      <div className="text-lg font-extrabold text-cyan-900 tabular-nums">
                        € {stakeEuro}
                      </div>
                      <div className="text-[11px] font-semibold text-cyan-700">
                        {opp.recommendedKellyPct.toFixed(1)}% bankroll
                      </div>
                    </div>

                    {/* Bottone Dettaglio */}
                    <Link
                      href={`/matches/${opp.matchId}`}
                      className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-cyan-700"
                    >
                      Analisi Match →
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
