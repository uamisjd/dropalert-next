"use client";

/**
 * Quick Bet Button — registrazione rapida scommessa da /value-bets a /mio-bankroll.
 *
 * Quando l'utente clicca "Registra scommessa", salva direttamente in localStorage
 * (stessa chiave di /mio-bankroll) con i dati precompilati dal value bet.
 */

import { useState } from "react";

interface QuickBetButtonProps {
  homeTeam: string;
  awayTeam: string;
  league: string;
  market: string;
  selection: string;
  selectionLabel: string;
  odds: number;
  edgePct: number;
  kellyPct: number;
  kickoffAt: string;
  matchId: number;
}

const STORAGE_KEY = "dropalert_personal_bankroll";

interface PersonalBet {
  id: string;
  matchId?: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  market: string;
  selection: string;
  odds: number;
  stake: number;
  edgePct: number;
  kellyPct: number;
  placedAt: string;
  kickoffAt: string;
  closingOdds?: number;
  result?: "won" | "lost" | "void" | "pending";
  profit?: number;
  clvPct?: number;
  notes?: string;
}

export function QuickBetButton(props: QuickBetButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [stake, setStake] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const stakeAmount = Number(stake);
    if (!stakeAmount || stakeAmount <= 0) {
      alert("Inserisci una puntata valida");
      return;
    }

    // Carica scommesse esistenti
    let bets: PersonalBet[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      bets = raw ? JSON.parse(raw) : [];
    } catch {
      bets = [];
    }

    // Crea nuova scommessa
    const newBet: PersonalBet = {
      id: crypto.randomUUID(),
      matchId: props.matchId,
      homeTeam: props.homeTeam,
      awayTeam: props.awayTeam,
      league: props.league,
      market: props.market,
      selection: props.selection,
      odds: props.odds,
      stake: stakeAmount,
      edgePct: props.edgePct,
      kellyPct: props.kellyPct,
      placedAt: new Date().toISOString(),
      kickoffAt: props.kickoffAt,
      result: "pending",
      notes: notes || `Value bet da DropAlert: ${props.selectionLabel}`,
    };

    // Salva
    bets.unshift(newBet);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));

    // Feedback
    setSaved(true);
    setTimeout(() => {
      setShowModal(false);
      setSaved(false);
      setStake("");
      setNotes("");
    }, 1500);
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-600"
        title="Registra questa scommessa nel tuo bankroll personale"
      >
        <span>💰</span>
        <span>Registra</span>
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !saved && setShowModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {saved ? (
              <div className="text-center py-8">
                <div className="text-5xl mb-3">✅</div>
                <p className="text-lg font-bold text-emerald-600">Scommessa registrata!</p>
                <p className="text-sm text-slate-600 mt-2">
                  Vai su{" "}
                  <a href="/mio-bankroll" className="text-cyan-600 font-semibold hover:underline">
                    /mio-bankroll
                  </a>{" "}
                  per vederla.
                </p>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-bold text-slate-900 mb-4">
                  Registra scommessa
                </h3>

                <div className="space-y-3 mb-4">
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-slate-900">
                      {props.homeTeam} vs {props.awayTeam}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      {props.league} · {props.market.toUpperCase()} · {props.selectionLabel}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 p-2">
                      <p className="text-[10px] text-slate-500 uppercase">Quota</p>
                      <p className="text-sm font-bold text-slate-900">{props.odds.toFixed(2)}</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50 p-2">
                      <p className="text-[10px] text-emerald-700 uppercase">Edge</p>
                      <p className="text-sm font-bold text-emerald-600">+{props.edgePct.toFixed(1)}%</p>
                    </div>
                    <div className="rounded-lg bg-cyan-50 p-2">
                      <p className="text-[10px] text-cyan-700 uppercase">Kelly</p>
                      <p className="text-sm font-bold text-cyan-600">{props.kellyPct.toFixed(1)}%</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Puntata (€) *
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={stake}
                      onChange={(e) => setStake(e.target.value)}
                      placeholder="Es. 50"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none"
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Note (opzionale)
                    </label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Es. Value bet da DropAlert"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex gap-2 mt-5">
                  <button
                    onClick={handleSave}
                    className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-600"
                  >
                    Salva scommessa
                  </button>
                  <button
                    onClick={() => setShowModal(false)}
                    className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Annulla
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
