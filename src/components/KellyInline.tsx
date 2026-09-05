"use client";

/**
 * Kelly Stake Calculator — componente inline per le card dei value bets.
 *
 * Mostra la puntata Kelly frazionaria basata sul bankroll personale dell'utente.
 * Il bankroll è salvato in localStorage, mai inviato al server.
 *
 * Questo componente NON è un consiglio di giocata: è una calcolatrice che
 * mostra quanto sarebbe la puntata ottimale SE l'edge fosse reale.
 */

import { useState } from "react";
import { calculateKellyStake } from "@/lib/quant/kelly";

const BANKROLL_KEY = "dropalert_personal_bankroll_amount";

interface Props {
  offeredOdds: number;
  trueProbPct: number; // probabilità fair in percentuale (es. 45.5 = 45.5%)
  edgePct: number;
  compact?: boolean; // versione compatta per le card
}

export function KellyInline({ offeredOdds, trueProbPct, edgePct, compact = false }: Props) {
  const [bankroll, setBankroll] = useState<number>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(BANKROLL_KEY);
        if (stored) return Number(stored);
      } catch {
        // ignore
      }
    }
    return 1000;
  });
  const [editing, setEditing] = useState(false);

  const saveBankroll = (value: number) => {
    setBankroll(value);
    try {
      localStorage.setItem(BANKROLL_KEY, String(value));
    } catch {
      // ignore
    }
  };

  if (edgePct <= 0) {
    return null; // niente Kelly per edge negativo
  }

  const kelly = calculateKellyStake({
    offeredOdds,
    trueProbability: trueProbPct / 100,
    bankroll,
    tier: "quarter",
    maxCapPct: 3.0,
  });

  if (!kelly.hasEdge) return null;

  if (compact) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg bg-cyan-50 border border-cyan-200 px-2.5 py-1">
        <span className="text-xs font-semibold text-cyan-800">
          Kelly: {kelly.recommendedStakePct.toFixed(1)}%
        </span>
        <span className="text-xs font-bold text-cyan-900 tabular-nums">
          €{kelly.recommendedStakeAmount.toFixed(0)}
        </span>
        {editing ? (
          <input
            type="number"
            value={bankroll}
            onChange={(e) => saveBankroll(Number(e.target.value))}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
            className="w-16 rounded border border-cyan-300 px-1 py-0.5 text-xs text-right"
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] text-cyan-500 hover:text-cyan-700"
            title={`Bankroll: €${bankroll}. Clicca per modificare.`}
          >
            su €{bankroll}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-cyan-800 uppercase">Kelly frazionaria</span>
        {editing ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-cyan-600">€</span>
            <input
              type="number"
              value={bankroll}
              onChange={(e) => saveBankroll(Number(e.target.value))}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
              className="w-20 rounded border border-cyan-300 px-2 py-0.5 text-xs text-right font-bold"
              autoFocus
            />
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-cyan-600 hover:text-cyan-800"
          >
            Bankroll: €{bankroll} ✎
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center">
        <div>
          <p className="text-[10px] text-cyan-600">Full</p>
          <p className="text-xs font-bold tabular-nums">{kelly.fullKellyPct.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-[10px] text-cyan-600">Half</p>
          <p className="text-xs font-bold tabular-nums">{kelly.halfKellyPct.toFixed(1)}%</p>
        </div>
        <div className="rounded bg-cyan-100">
          <p className="text-[10px] font-bold text-cyan-800">Quarter ✓</p>
          <p className="text-xs font-extrabold tabular-nums text-cyan-900">
            {kelly.quarterKellyPct.toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-[10px] text-cyan-600">Eighth</p>
          <p className="text-xs font-bold tabular-nums">{kelly.eighthKellyPct.toFixed(1)}%</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-cyan-700">
          Puntata consigliata (quarter, max 3%):
        </span>
        <span className="text-sm font-extrabold text-cyan-900 tabular-nums">
          €{kelly.recommendedStakeAmount.toFixed(2)}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-cyan-600">
        Growth rate atteso: {kelly.growthRatePct.toFixed(3)}% per scommessa.
        La probabilità fair è una stima: sovrastimarla accelera la perdita, non la crescita.
      </p>
    </div>
  );
}
