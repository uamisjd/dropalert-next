"use client";

/**
 * Bankroll Tracker Personale — uso proprietario, dati in localStorage.
 *
 * Questa pagina è per il solo proprietario del sito. Traccia le scommesse
 * piazzate, calcola il CLV personale (quota piazzata vs chiusura), e mostra
 * ROI, drawdown e profitto totale.
 *
 * I dati restano nel browser (localStorage), mai inviati al server.
 * La pagina è accessibile senza autenticazione nel codice, ma è nascosta
 * dalla navigazione pubblica: solo chi conosce l'URL la raggiunge.
 */

import { useState, useEffect, useCallback } from "react";

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
  placedAt: string; // ISO
  kickoffAt: string; // ISO
  closingOdds?: number;
  result?: "won" | "lost" | "void" | "pending";
  profit?: number;
  clvPct?: number;
  notes?: string;
}

interface BankrollStats {
  totalBets: number;
  settledBets: number;
  pendingBets: number;
  totalStaked: number;
  totalProfit: number;
  roiPct: number;
  avgClvPct: number;
  winRate: number;
  maxDrawdown: number;
  currentStreak: number;
  avgOdds: number;
  avgEdge: number;
  bankrollHistory: Array<{ date: string; bankroll: number }>;
}

const STORAGE_KEY = "dropalert_personal_bankroll";
const BANKROLL_KEY = "dropalert_personal_bankroll_amount";

function loadBets(): PersonalBet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveBets(bets: PersonalBet[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
}

function loadBankroll(): number {
  if (typeof window === "undefined") return 1000;
  try {
    const raw = localStorage.getItem(BANKROLL_KEY);
    return raw ? Number(raw) : 1000;
  } catch {
    return 1000;
  }
}

function saveBankroll(amount: number) {
  localStorage.setItem(BANKROLL_KEY, String(amount));
}

function calculateStats(bets: PersonalBet[], initialBankroll: number): BankrollStats {
  const settled = bets.filter((b) => b.result && b.result !== "pending");
  const pending = bets.filter((b) => !b.result || b.result === "pending");

  const totalStaked = bets.reduce((sum, b) => sum + b.stake, 0);
  const totalProfit = settled.reduce((sum, b) => sum + (b.profit || 0), 0);

  const won = settled.filter((b) => b.result === "won").length;
  const lost = settled.filter((b) => b.result === "lost").length;

  const clvBets = settled.filter((b) => b.clvPct !== undefined);
  const avgClv =
    clvBets.length > 0
      ? clvBets.reduce((sum, b) => sum + (b.clvPct || 0), 0) / clvBets.length
      : 0;

  // Drawdown: massima perdita dal picco
  let peak = initialBankroll;
  let maxDrawdown = 0;
  let current = initialBankroll;
  const history: Array<{ date: string; bankroll: number }> = [
    { date: "Inizio", bankroll: initialBankroll },
  ];

  const sorted = [...settled].sort(
    (a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime(),
  );
  for (const bet of sorted) {
    current += bet.profit || 0;
    if (current > peak) peak = current;
    const dd = ((peak - current) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
    history.push({
      date: new Date(bet.placedAt).toLocaleDateString("it-IT"),
      bankroll: Math.round(current * 100) / 100,
    });
  }

  // Streak corrente
  let streak = 0;
  const reversed = [...settled].reverse();
  for (const bet of reversed) {
    if (streak === 0) {
      streak = bet.result === "won" ? 1 : -1;
    } else if (streak > 0 && bet.result === "won") {
      streak++;
    } else if (streak < 0 && bet.result === "lost") {
      streak--;
    } else {
      break;
    }
  }

  return {
    totalBets: bets.length,
    settledBets: settled.length,
    pendingBets: pending.length,
    totalStaked: Math.round(totalStaked * 100) / 100,
    totalProfit: Math.round(totalProfit * 100) / 100,
    roiPct: totalStaked > 0 ? Math.round((totalProfit / totalStaked) * 10000) / 100 : 0,
    avgClvPct: Math.round(avgClv * 100) / 100,
    winRate:
      settled.length > 0 ? Math.round((won / (won + lost)) * 10000) / 100 : 0,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    currentStreak: streak,
    avgOdds:
      bets.length > 0
        ? Math.round((bets.reduce((sum, b) => sum + b.odds, 0) / bets.length) * 100) / 100
        : 0,
    avgEdge:
      bets.length > 0
        ? Math.round((bets.reduce((sum, b) => sum + b.edgePct, 0) / bets.length) * 100) / 100
        : 0,
    bankrollHistory: history,
  };
}

export default function MioBankrollPage() {
  const [bets, setBets] = useState<PersonalBet[]>([]);
  const [bankroll, setBankroll] = useState(1000);
  const [showForm, setShowForm] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Form state
  const [formHome, setFormHome] = useState("");
  const [formAway, setFormAway] = useState("");
  const [formLeague, setFormLeague] = useState("");
  const [formMarket, setFormMarket] = useState("1x2");
  const [formSelection, setFormSelection] = useState("home");
  const [formOdds, setFormOdds] = useState("");
  const [formStake, setFormStake] = useState("");
  const [formEdge, setFormEdge] = useState("");
  const [formKelly, setFormKelly] = useState("");
  const [formKickoff, setFormKickoff] = useState("");
  const [formNotes, setFormNotes] = useState("");

  useEffect(() => {
    setBets(loadBets());
    setBankroll(loadBankroll());
  }, []);

  const persistBets = useCallback((newBets: PersonalBet[]) => {
    setBets(newBets);
    saveBets(newBets);
  }, []);

  const addBet = useCallback(() => {
    const odds = Number(formOdds);
    const stake = Number(formStake);
    if (!formHome || !formAway || !odds || !stake) return;

    const bet: PersonalBet = {
      id: crypto.randomUUID(),
      homeTeam: formHome,
      awayTeam: formAway,
      league: formLeague,
      market: formMarket,
      selection: formSelection,
      odds,
      stake,
      edgePct: Number(formEdge) || 0,
      kellyPct: Number(formKelly) || 0,
      placedAt: new Date().toISOString(),
      kickoffAt: formKickoff ? new Date(formKickoff).toISOString() : new Date().toISOString(),
      result: "pending",
      notes: formNotes,
    };

    persistBets([bet, ...bets]);
    setShowForm(false);
    setFormHome("");
    setFormAway("");
    setFormLeague("");
    setFormOdds("");
    setFormStake("");
    setFormEdge("");
    setFormKelly("");
    setFormKickoff("");
    setFormNotes("");
  }, [bets, formHome, formAway, formLeague, formMarket, formSelection, formOdds, formStake, formEdge, formKelly, formKickoff, formNotes, persistBets]);

  const settleBet = useCallback(
    (id: string, result: "won" | "lost" | "void", closingOdds?: number) => {
      const updated = bets.map((b) => {
        if (b.id !== id) return b;
        let profit = 0;
        if (result === "won") profit = b.stake * (b.odds - 1);
        else if (result === "lost") profit = -b.stake;
        // void: profit = 0

        let clvPct: number | undefined;
        if (closingOdds && closingOdds > 1) {
          clvPct = Math.round(((b.odds / closingOdds) - 1) * 10000) / 100;
        }

        return { ...b, result, profit, closingOdds, clvPct };
      });
      persistBets(updated);
    },
    [bets, persistBets],
  );

  const deleteBet = useCallback(
    (id: string) => {
      persistBets(bets.filter((b) => b.id !== id));
    },
    [bets, persistBets],
  );

  const stats = calculateStats(bets, bankroll);

  const exportData = useCallback(() => {
    const json = JSON.stringify({ bankroll, bets }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dropalert-bankroll-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [bankroll, bets]);

  const importData = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (data.bets && Array.isArray(data.bets)) {
            persistBets(data.bets);
            if (data.bankroll) {
              setBankroll(data.bankroll);
              saveBankroll(data.bankroll);
            }
          }
        } catch {
          alert("File non valido");
        }
      };
      reader.readAsText(file);
    },
    [persistBets],
  );

  const currentBankroll = bankroll + stats.totalProfit;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">
      <header className="mb-6 rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-8 text-white shadow-lg">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <p className="text-xs font-bold tracking-[0.2em] text-amber-400 uppercase">
            Personale · dati locali
          </p>
        </div>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          Il Mio Bankroll
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          Tracking personale delle scommesse. Dati salvati solo nel tuo browser (localStorage).
        </p>
      </header>

      {/* Bankroll Settings */}
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase">Bankroll iniziale</label>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-slate-400">€</span>
            <input
              type="number"
              value={bankroll}
              onChange={(e) => {
                const v = Number(e.target.value);
                setBankroll(v);
                saveBankroll(v);
              }}
              className="w-28 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-900"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase">Bankroll attuale</label>
          <p className={`mt-1 text-2xl font-extrabold tabular-nums ${currentBankroll >= bankroll ? "text-emerald-600" : "text-rose-600"}`}>
            €{currentBankroll.toFixed(2)}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-700"
          >
            + Nuova scommessa
          </button>
          <button
            onClick={() => setShowExport(!showExport)}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Import/Export
          </button>
        </div>
      </div>

      {showExport && (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex gap-4">
            <button onClick={exportData} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white">
              Esporta JSON
            </button>
            <label className="cursor-pointer rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white">
              Importa JSON
              <input type="file" accept=".json" onChange={importData} className="hidden" />
            </label>
          </div>
        </div>
      )}

      {/* Stats Dashboard */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {[
          { label: "Scommesse", value: stats.totalBets, color: "text-slate-900" },
          { label: "ROI", value: `${stats.roiPct > 0 ? "+" : ""}${stats.roiPct}%`, color: stats.roiPct >= 0 ? "text-emerald-600" : "text-rose-600" },
          { label: "Profitto", value: `€${stats.totalProfit >= 0 ? "+" : ""}${stats.totalProfit.toFixed(0)}`, color: stats.totalProfit >= 0 ? "text-emerald-600" : "text-rose-600" },
          { label: "CLV medio", value: `${stats.avgClvPct > 0 ? "+" : ""}${stats.avgClvPct}%`, color: stats.avgClvPct >= 2 ? "text-emerald-600" : stats.avgClvPct >= 0 ? "text-amber-600" : "text-rose-600" },
          { label: "Win rate", value: `${stats.winRate}%`, color: stats.winRate >= 50 ? "text-emerald-600" : "text-slate-600" },
          { label: "Drawdown max", value: `${stats.maxDrawdown}%`, color: stats.maxDrawdown < 10 ? "text-emerald-600" : stats.maxDrawdown < 20 ? "text-amber-600" : "text-rose-600" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase">{stat.label}</p>
            <p className={`mt-1 text-xl font-extrabold tabular-nums ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* CLV Assessment */}
      {stats.settledBets >= 10 && (
        <div className={`mb-6 rounded-2xl border p-4 ${stats.avgClvPct >= 2 ? "border-emerald-200 bg-emerald-50" : stats.avgClvPct >= 0 ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50"}`}>
          <p className="text-sm font-bold">
            {stats.avgClvPct >= 2
              ? `✅ CLV medio +${stats.avgClvPct}%: stai battendo la chiusura. Il metodo funziona.`
              : stats.avgClvPct >= 0
                ? `⚠️ CLV medio +${stats.avgClvPct}%: sei vicino alla chiusura. Alza la soglia di edge.`
                : `❌ CLV medio ${stats.avgClvPct}%: non stai battendo la chiusura. Rivedi i filtri.`}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Basato su {stats.settledBets} scommesse chiuse. Obiettivo: CLV &gt; +2% su 30+ scommesse.
          </p>
        </div>
      )}

      {/* Add Bet Form */}
      {showForm && (
        <div className="mb-6 rounded-2xl border border-cyan-200 bg-cyan-50 p-5">
          <h2 className="mb-3 text-sm font-bold text-slate-900">Nuova scommessa</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input placeholder="Casa" value={formHome} onChange={(e) => setFormHome(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input placeholder="Trasferta" value={formAway} onChange={(e) => setFormAway(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input placeholder="Campionato" value={formLeague} onChange={(e) => setFormLeague(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <select value={formMarket} onChange={(e) => setFormMarket(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="1x2">1X2</option>
              <option value="ou_2_5">Over/Under 2.5</option>
              <option value="btts">Gol/No Gol</option>
              <option value="other">Altro</option>
            </select>
            <select value={formSelection} onChange={(e) => setFormSelection(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="home">Casa (1)</option>
              <option value="draw">Pareggio (X)</option>
              <option value="away">Trasferta (2)</option>
              <option value="over">Over</option>
              <option value="under">Under</option>
              <option value="yes">Gol</option>
              <option value="no">No Gol</option>
            </select>
            <input type="number" step="0.01" placeholder="Quota" value={formOdds} onChange={(e) => setFormOdds(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input type="number" step="1" placeholder="Puntata €" value={formStake} onChange={(e) => setFormStake(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input type="number" step="0.1" placeholder="Edge %" value={formEdge} onChange={(e) => setFormEdge(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input type="number" step="0.1" placeholder="Kelly %" value={formKelly} onChange={(e) => setFormKelly(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input type="datetime-local" value={formKickoff} onChange={(e) => setFormKickoff(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input placeholder="Note" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm col-span-2" />
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={addBet} className="rounded-xl bg-cyan-600 px-5 py-2 text-sm font-bold text-white hover:bg-cyan-700">
              Salva scommessa
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-xl border border-slate-300 px-5 py-2 text-sm font-medium text-slate-600 hover:bg-white">
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* Bets List */}
      <div className="space-y-2">
        {bets.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <p className="text-sm text-slate-500">
              Nessuna scommessa registrata. Clicca «+ Nuova scommessa» per iniziare.
            </p>
          </div>
        )}
        {bets.map((bet) => (
          <div
            key={bet.id}
            className={`rounded-xl border p-4 shadow-sm ${
              bet.result === "won"
                ? "border-emerald-200 bg-emerald-50"
                : bet.result === "lost"
                  ? "border-rose-200 bg-rose-50"
                  : bet.result === "void"
                    ? "border-slate-200 bg-slate-50"
                    : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {bet.homeTeam} vs {bet.awayTeam}
                </p>
                <p className="text-xs text-slate-500">
                  {bet.league} · {bet.market} · {bet.selection} ·{" "}
                  {new Date(bet.placedAt).toLocaleDateString("it-IT")}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold tabular-nums">
                  @{bet.odds.toFixed(2)} · €{bet.stake}
                </p>
                {bet.result === "pending" && (
                  <span className="text-xs font-medium text-amber-600">In attesa</span>
                )}
                {bet.result === "won" && (
                  <span className="text-xs font-bold text-emerald-600">
                    +€{bet.profit?.toFixed(2)}
                  </span>
                )}
                {bet.result === "lost" && (
                  <span className="text-xs font-bold text-rose-600">
                    −€{Math.abs(bet.profit || 0).toFixed(2)}
                  </span>
                )}
                {bet.result === "void" && (
                  <span className="text-xs font-medium text-slate-500">Annullata</span>
                )}
              </div>
            </div>

            {bet.edgePct > 0 && (
              <div className="mt-1 flex gap-3 text-xs text-slate-500">
                <span>Edge: +{bet.edgePct}%</span>
                {bet.kellyPct > 0 && <span>Kelly: {bet.kellyPct}%</span>}
                {bet.clvPct !== undefined && (
                  <span className={bet.clvPct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                    CLV: {bet.clvPct > 0 ? "+" : ""}{bet.clvPct}%
                  </span>
                )}
              </div>
            )}

            {bet.result === "pending" && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    const closing = prompt("Quota di chiusura (es. 1.85):");
                    settleBet(bet.id, "won", closing ? Number(closing) : undefined);
                  }}
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  ✓ Vinta
                </button>
                <button
                  onClick={() => {
                    const closing = prompt("Quota di chiusura (es. 1.85):");
                    settleBet(bet.id, "lost", closing ? Number(closing) : undefined);
                  }}
                  className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700"
                >
                  ✗ Persa
                </button>
                <button
                  onClick={() => settleBet(bet.id, "void")}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Annullata
                </button>
                <button
                  onClick={() => deleteBet(bet.id)}
                  className="ml-auto text-xs text-slate-400 hover:text-rose-600"
                >
                  Elimina
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600">
        <h2 className="text-sm font-bold text-slate-900">Come leggere i numeri</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div>
            <h3 className="font-semibold">CLV (Closing Line Value)</h3>
            <p className="mt-1">
              La differenza fra la quota a cui hai puntato e la quota di chiusura.
              CLV +5% significa che hai puntato a 2.10 e il mercato ha chiuso a 2.00.
              Se il CLV medio è &gt; +2% su 30+ scommesse, stai battendo il mercato.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">ROI</h3>
            <p className="mt-1">
              Profitto / Totale puntato × 100. Un ROI positivo su 100+ scommesse
              è il segno che il metodo funziona. Sotto le 30 scommesse la varianza
              domina: non trarre conclusioni.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">Drawdown</h3>
            <p className="mt-1">
              La massima perdita dal picco del bankroll. Un drawdown sotto il 15%
              con Kelly frazionaria è normale. Sopra il 25% indica size troppo
              aggressive o edge sovrastimato.
            </p>
          </div>
        </div>
        <p className="mt-3 text-slate-400">
          I dati restano nel tuo browser. Esporta regolarmente il JSON come backup.
        </p>
      </footer>
    </main>
  );
}
