"use client";

import { useState, useMemo } from "react";
import { calculateDutching } from "@/lib/quant/arbitrage";
import { isValidPrice } from "@/lib/drop/math";

interface DutchOutcome {
  id: string;
  label: string;
  odds: string;
}

export function DutchingCalculator() {
  const [totalStake, setTotalStake] = useState<number>(100);
  const [commissionPct, setCommissionPct] = useState<number>(0);
  const [outcomes, setOutcomes] = useState<DutchOutcome[]>([
    { id: "1", label: "Risultato Esatto 1-0", odds: "6.50" },
    { id: "2", label: "Risultato Esatto 2-0", odds: "8.00" },
    { id: "3", label: "Risultato Esatto 2-1", odds: "9.50" },
  ]);

  const addOutcome = () => {
    if (outcomes.length >= 6) return;
    setOutcomes([
      ...outcomes,
      {
        id: String(Date.now()),
        label: `Selezione ${outcomes.length + 1}`,
        odds: "4.00",
      },
    ]);
  };

  const removeOutcome = (id: string) => {
    if (outcomes.length <= 2) return;
    setOutcomes(outcomes.filter((o) => o.id !== id));
  };

  const updateOutcome = (id: string, field: "label" | "odds", value: string) => {
    setOutcomes(
      outcomes.map((o) => (o.id === id ? { ...o, [field]: value } : o)),
    );
  };

  /* Quote digitate valide? Senza questo controllo la sintesi sparirebbe e basta,
     senza dire perché: uno spazio vuoto senza causa. */
  const inputsValid = outcomes.every((o) =>
    isValidPrice(Number.parseFloat(o.odds.replace(",", ".")) || 0),
  );

  const result = useMemo(() => {
    const parsed = outcomes.map((o) => ({
      label: o.label,
      odds: Number.parseFloat(o.odds.replace(",", ".")) || 0,
    }));
    return calculateDutching(parsed, totalStake, commissionPct);
  }, [outcomes, totalStake, commissionPct]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-950 sm:text-xl">
            Calcolatore Dutching Multi-Esito
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Copri più risultati contemporaneamente (es. 2-3 risultati esatti o marcatori) distribuendo lo stake per ottenere lo stesso profitto se uno di essi si verifica.
          </p>
        </div>
        <button
          type="button"
          onClick={addOutcome}
          disabled={outcomes.length >= 6}
          className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-cyan-700 disabled:opacity-40"
        >
          + Aggiungi Esito
        </button>
      </div>

      {/* Parametri di Stake e Commissione */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Budget Totale Scommessa (€)
          </label>
          <input
            type="number"
            min="5"
            step="10"
            value={totalStake}
            onChange={(e) =>
              setTotalStake(Math.max(5, Number(e.target.value) || 0))
            }
            className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Commissione Bookmaker / Exchange (%)
          </label>
          <input
            type="number"
            min="0"
            max="15"
            step="0.5"
            value={commissionPct}
            onChange={(e) =>
              setCommissionPct(Math.max(0, Number(e.target.value) || 0))
            }
            className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-900 focus:border-cyan-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Righe Selezioni */}
      <div className="mt-5 space-y-2.5">
        {outcomes.map((o, idx) => (
          <div
            key={o.id}
            className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 p-3 sm:gap-3"
          >
            <div className="w-6 text-center text-xs font-bold text-slate-400">
              #{idx + 1}
            </div>
            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={o.label}
                onChange={(e) => updateOutcome(o.id, "label", e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div className="w-28">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 text-xs text-slate-400">
                  @
                </span>
                <input
                  type="text"
                  value={o.odds}
                  onChange={(e) => updateOutcome(o.id, "odds", e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-2 pl-6 text-xs font-bold text-slate-900 tabular-nums focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="w-28 text-right">
              <div className="text-[10px] text-slate-400 uppercase">Puntata</div>
              <div className="text-xs font-bold text-slate-900 tabular-nums">
                {result?.outcomes[idx] ? `€ ${result.outcomes[idx].stake}` : "—"}
              </div>
            </div>
            {outcomes.length > 2 && (
              <button
                type="button"
                onClick={() => removeOutcome(o.id)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-rose-600"
                title="Rimuovi esito"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Box Risultato Combinato: con quote incomplete non si dichiara nulla */}
      {!inputsValid ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-xs leading-relaxed text-slate-500 sm:p-5">
          Inserisci una quota valida (maggiore di 1,00) per ogni esito: finché
          manca un numero, qui non compare nessuna sintesi — né quota combinata
          né profitto.
        </div>
      ) : (
        result && (
        <div className="mt-6 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-cyan-900">
                Sintesi Strategia Dutching
              </div>
              <p className="mt-0.5 text-xs text-cyan-800">
                Quota sintetica combinata:{" "}
                <strong className="text-slate-950">
                  {result.combinedOdds.toFixed(2)}
                </strong>{" "}
                (se vince una delle selezioni, incassi lo stesso importo).
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white p-2.5 text-center shadow-xs">
                <div className="text-[10px] font-bold uppercase text-slate-500">
                  Profitto Netto
                </div>
                <div
                  className={`text-lg font-extrabold tabular-nums ${
                    result.profitAmount >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {result.profitAmount >= 0 ? "+" : ""}€ {result.profitAmount.toFixed(2)}
                </div>
              </div>
              <div className="rounded-xl bg-cyan-950 px-3.5 py-2.5 text-center text-white">
                <div className="text-[10px] font-bold uppercase opacity-80">
                  ROI Netto
                </div>
                <div className="text-lg font-extrabold tabular-nums">
                  {result.roiPct >= 0 ? "+" : ""}{result.roiPct.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </div>
        )
      )}
    </div>
  );
}
