"use client";

/**
 * Simulatore di varianza (lato betting, uso analitico).
 *
 * Serve a mostrare il numero che manca quasi sempre quando si parla di
 * «vantaggio»: l'ampiezza della distribuzione. Stessa quota, stessa
 * probabilità, ripetute molte volte — e la forbice fra il 5° e il 95°
 * percentile, la quota di sequenze in perdita e quella rovinate.
 *
 * È deterministico: a parità di seme il risultato è identico, quindi è
 * riproducibile e verificabile. Non suggerisce alcuna giocata.
 */
import { useMemo, useState } from "react";
import {
  KELLY_NOTE,
  RUIN_THRESHOLD_PCT,
  SIMULATION_NOTE,
  SIM_LIMITS,
  STAKE_DISCLAIMER,
  breakEvenWinRate,
  expectedValue,
  kellyFraction,
  simulate,
} from "@/lib/tools/stake";
import { marginOf } from "@/lib/tools/margin";

/** Seme predefinito: dichiarato, così chiunque ottiene gli stessi numeri. */
const SEME_DEFAULT = 20260904;
/** Quante sequenze simulare a ogni calcolo. */
const SEQUENZE = 2000;

const SCENARI: Array<{ key: string; label: string; note: string; winPct: number }> = [
  {
    key: "banco",
    label: "Alla quota del banco",
    note: "La probabilità reale è quella che la quota stessa dichiara: il rendimento atteso è negativo di quanto vale il margine.",
    winPct: 50,
  },
  {
    key: "piccolo",
    label: "Vantaggio piccolo (+2%)",
    note: "Un vantaggio reale ma modesto, già superiore a quello che quasi chiunque sostiene di avere.",
    winPct: 52,
  },
  {
    key: "grande",
    label: "Vantaggio teorico (+8%)",
    note: "Un vantaggio irrealistico, usato solo per mostrare quanto resta comunque in mano al caso.",
    winPct: 58,
  },
];

function money(v: number): string {
  return v.toLocaleString("it-IT", { maximumFractionDigits: 0 });
}

function pct(v: number, decimals = 1): string {
  return `${v.toFixed(decimals).replace(".", ",")}%`;
}

function toNumber(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

export function VarianceSimulator() {
  const [bankroll, setBankroll] = useState("1000");
  const [price, setPrice] = useState("1.90");
  const [winPct, setWinPct] = useState("50");
  const [bets, setBets] = useState("200");
  const [stakePct, setStakePct] = useState("5");

  const b = toNumber(bankroll);
  const p = toNumber(price);
  const w = toNumber(winPct);
  const n = toNumber(bets);
  const s = toNumber(stakePct);

  const risultato = useMemo(() => {
    if (b === null || p === null || w === null || n === null || s === null) {
      return null;
    }
    return simulate({
      bankroll: b,
      price: p,
      winPct: w,
      bets: Math.round(n),
      stakePct: s,
      trials: SEQUENZE,
      seed: SEME_DEFAULT,
    });
    /* la simulazione è deterministica: ricalcolare è inutile, e il join
       delle dipendenze tiene la memo stabile sui valori, non sulle stringhe */
  }, [b, p, w, n, s]);

  const pareggio = breakEvenWinRate(p);
  const ev = expectedValue(w, p);
  const kelly = kellyFraction(w, p);
  const mercato = p === null ? null : marginOf([p, p]);
  const scenario = SCENARI.find((sc) => sc.winPct === w);

  return (
    <section
      aria-labelledby="varianza"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2
        id="varianza"
        className="text-sm font-semibold tracking-wide text-slate-900 uppercase"
      >
        Quanto pesa la varianza
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        Stessa quota e stessa probabilità ripetute molte volte: la simulazione
        mostra la distribuzione dei risultati, non una previsione. È
        deterministica — seme <span className="tabular-nums">{SEME_DEFAULT}</span>,{" "}
        {SEQUENZE} sequenze — quindi chiunque ottiene gli stessi numeri.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          { label: "Capitale iniziale", value: bankroll, set: setBankroll },
          { label: "Quota decimale", value: price, set: setPrice },
          { label: "Probabilità reale (%)", value: winPct, set: setWinPct },
          { label: "Numero di giocate", value: bets, set: setBets },
          { label: "Puntata (% capitale)", value: stakePct, set: setStakePct },
        ].map((f) => (
          <label key={f.label} className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">
              {f.label}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm tabular-nums text-slate-900 focus:border-slate-500 focus:outline-none"
              aria-label={f.label}
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SCENARI.map((sc) => (
          <button
            key={sc.key}
            type="button"
            onClick={() => setWinPct(String(sc.winPct))}
            title={sc.note}
            className={`rounded border px-2 py-1 text-[11px] ${
              w === sc.winPct
                ? "border-slate-800 bg-slate-100 text-slate-900"
                : "border-slate-300 text-slate-600 hover:border-slate-500"
            }`}
          >
            {sc.label}
          </button>
        ))}
      </div>
      {scenario !== undefined ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          {scenario.note}
        </p>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          {
            k: "Pareggio a questa quota",
            v: pareggio === null ? "n/d" : pct(pareggio, 2),
          },
          { k: "La tua probabilità", v: w === null ? "n/d" : pct(w, 2) },
          {
            k: "Rendimento per giocata",
            v: ev === null ? "n/d" : pct(ev * 100, 2),
          },
          {
            k: "Kelly (tetto teorico)",
            v: kelly === null ? "n/d" : pct(kelly.fractionPct, 2),
          },
        ].map((c) => (
          <div
            key={c.k}
            className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2"
          >
            <dt className="text-[11px] leading-tight text-slate-500">{c.k}</dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-900">
              {c.v}
            </dd>
          </div>
        ))}
      </dl>

      {kelly !== null && !kelly.hasEdge ? (
        <p className="mt-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-700">
          Con questa probabilità e questa quota non c&apos;è vantaggio: il
          rendimento atteso è negativo e non esiste una dimensione di puntata
          che lo renda positivo.
        </p>
      ) : null}

      {risultato === null ? (
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          Parametri non utilizzabili: servono un capitale positivo, una quota
          decimale fra 1,01 e 1000, una probabilità fra 0 e 100, un numero di
          giocate fra 1 e {SIM_LIMITS.maxBets} e una puntata fra{" "}
          {SIM_LIMITS.minStakePct}% e {SIM_LIMITS.maxStakePct}% del capitale.
          Nessun risultato viene mostrato al posto di questi valori.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { k: "Capitale finale (mediana)", v: money(risultato.finalMedian) },
              { k: "5° percentile", v: money(risultato.finalP5) },
              { k: "95° percentile", v: money(risultato.finalP95) },
              { k: "Sequenze in perdita", v: pct(risultato.lossSharePct) },
              {
                k: `Rovinate (sotto ${RUIN_THRESHOLD_PCT}%)`,
                v: pct(risultato.ruinSharePct),
              },
              {
                k: "Calo massimo dal picco",
                v: pct(risultato.maxDrawdownMedianPct),
              },
            ].map((c) => (
              <div
                key={c.k}
                className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2"
              >
                <dt className="text-[11px] leading-tight text-slate-500">{c.k}</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-900">
                  {c.v}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            Su {risultato.trials} sequenze da {risultato.bets} giocate il
            risultato va da{" "}
            <span className="tabular-nums">{pct(risultato.worstPct)}</span> a{" "}
            <span className="tabular-nums">{pct(risultato.bestPct)}</span> del
            capitale iniziale, mentre il rendimento atteso teorico della
            sequenza è{" "}
            <span className="tabular-nums">{pct(risultato.expectedTotalPct)}</span>.
            La distanza fra questi numeri è la varianza: è il motivo per cui
            poche decine di giocate non dicono nulla su nessun metodo.
          </p>

          {mercato !== null && mercato.ok ? (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Riferimento: un mercato a due esiti pagati entrambi {price}{" "}
              contiene un margine del {mercato.data.marginPct.toFixed(2)}%, cioè
              una trattenuta del {mercato.data.holdPct.toFixed(2)}%. È il costo
              certo, prima ancora della varianza.
            </p>
          ) : null}
        </>
      )}

      <div className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-500">
        <p>{SIMULATION_NOTE}</p>
        <p>{KELLY_NOTE}</p>
        <p>{STAKE_DISCLAIMER}</p>
      </div>
    </section>
  );
}
