"use client";

/**
 * Calcolatore di margine e quote fair (lato betting, uso analitico).
 *
 * Mostra quanto margine contiene un insieme di quote e che cosa resta
 * togliendolo, con tre metodi a confronto. Non indica una selezione, non
 * confronta operatori e non collega a nessuno: è aritmetica su numeri che
 * inserisci tu, e lo dice in testa e in coda.
 */
import { useMemo, useState } from "react";
import {
  DEVIG_METHODS,
  devigAll,
  marginOf,
  type DevigMethod,
} from "@/lib/tools/margin";
import { STAKE_DISCLAIMER } from "@/lib/tools/stake";

/** Un mercato a due o tre esiti: oltre, la pagina non pretende di coprirlo. */
const MAX_ESITI = 3;

const ETICHETTE = ["Esito 1", "Esito 2", "Esito 3"];

function toNumber(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "n/d" : `${v.toFixed(2)}%`;
}

export function MarginCalculator() {
  const [raw, setRaw] = useState<string[]>(["1.72", "4.00", "4.80"]);

  /* le quote valide restano in una memo: la lista è un riferimento stabile
     finché non cambia un campo, e le due memo qui sotto possono dipenderne
     senza ricalcolare a ogni render */
  const usati = useMemo(
    () => raw.map(toNumber).filter((p): p is number => p !== null),
    [raw],
  );

  const margin = useMemo(() => marginOf(usati), [usati]);
  const devig = useMemo(() => devigAll(usati), [usati]);

  function set(index: number, value: string): void {
    setRaw((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function togliUltimo(): void {
    setRaw((prev) => (prev.length > 2 ? prev.slice(0, -1) : prev));
  }
  function aggiungi(): void {
    setRaw((prev) => (prev.length < MAX_ESITI ? [...prev, ""] : prev));
  }

  return (
    <section
      aria-labelledby="margine"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2
        id="margine"
        className="text-sm font-semibold tracking-wide text-slate-900 uppercase"
      >
        Quanto margine contiene un prezzo
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        Inserisci le quote decimali di <strong>tutti</strong> gli esiti dello
        stesso mercato. Le probabilità implicite sommate danno
        l&apos;overround: ciò che sta sopra il 100% è il margine del banco.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {raw.map((value, i) => (
          <label key={ETICHETTE[i]} className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-slate-500">
              {ETICHETTE[i]}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => set(i, e.target.value)}
              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm tabular-nums text-slate-900 focus:border-slate-500 focus:outline-none"
              aria-label={`Quota decimale ${ETICHETTE[i]}`}
            />
          </label>
        ))}
        {raw.length < MAX_ESITI ? (
          <button
            type="button"
            onClick={aggiungi}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:border-slate-500"
          >
            + esito
          </button>
        ) : null}
        {raw.length > 2 ? (
          <button
            type="button"
            onClick={togliUltimo}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:border-slate-500"
          >
            − esito
          </button>
        ) : null}
      </div>

      {!margin.ok ? (
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {margin.failure.reason}
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { k: "Overround", v: pct(margin.data.overroundPct) },
              { k: "Margine", v: `${margin.data.marginPct.toFixed(2)} pp` },
              { k: "Trattenuta teorica", v: pct(margin.data.holdPct) },
            ].map((c) => (
              <div
                key={c.k}
                className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2"
              >
                <dt className="text-[11px] text-slate-500">{c.k}</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-900">
                  {c.v}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            La trattenuta non è il margine: è quanto il banco trattiene in
            media per ogni euro giocato su questo mercato, cioè{" "}
            <span className="tabular-nums">margine ÷ overround</span>. Coprire
            tutti gli esiti alle quote pubblicate restituisce esattamente
            questa percentuale in meno di quanto giocato.
          </p>

          <h3 className="mt-4 text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Quote fair, per metodo
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] text-slate-500">
                  <th className="py-1 pr-2 font-medium">Metodo</th>
                  {ETICHETTE.slice(0, raw.length).map((e) => (
                    <th key={e} className="py-1 pr-2 font-medium">
                      {e}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100">
                  <th className="py-1.5 pr-2 text-left font-medium text-slate-500">
                    Quota pubblicata
                  </th>
                  {usati.map((p, i) => (
                    <td key={i} className="py-1.5 pr-2 tabular-nums text-slate-900">
                      {p.toFixed(3)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-slate-100">
                  <th className="py-1.5 pr-2 text-left font-medium text-slate-500">
                    Probabilità implicita
                  </th>
                  {(margin.data.impliedPct ?? []).map((p, i) => (
                    <td key={i} className="py-1.5 pr-2 tabular-nums text-slate-700">
                      {p.toFixed(2)}%
                    </td>
                  ))}
                </tr>
                {devig.results.map((r, i) => {
                  const metodo = DEVIG_METHODS[i] as
                    | { key: DevigMethod; label: string }
                    | undefined;
                  if (metodo === undefined) return null;
                  if (!r.ok) {
                    return (
                      <tr key={metodo.key} className="border-b border-slate-100">
                        <th className="py-1.5 pr-2 text-left font-medium text-slate-500">
                          {metodo.label}
                        </th>
                        <td
                          colSpan={raw.length}
                          className="py-1.5 pr-2 text-[11px] leading-relaxed text-amber-800"
                        >
                          non applicabile: {r.failure.reason}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={metodo.key} className="border-b border-slate-100">
                      <th className="py-1.5 pr-2 text-left font-medium text-slate-900">
                        {metodo.label}
                      </th>
                      {r.data.fairPrice.map((p, j) => (
                        <td
                          key={j}
                          className="py-1.5 pr-2 tabular-nums text-slate-900"
                        >
                          {p.toFixed(3)}
                          <span className="ml-1 text-[11px] text-slate-400">
                            ({(r.data.fairPct[j] ?? 0).toFixed(1)}%)
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {devig.spreadPct !== null ? (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Scostamento massimo fra i metodi:{" "}
              <span className="tabular-nums">{devig.spreadPct.toFixed(2)} pp</span>.
              Non esiste un metodo giusto: sono tre ipotesi diverse su come il
              banco ripartisce il margine, e lo scostamento dice quanto il
              risultato dipende da quella scelta.
            </p>
          ) : null}

          <ul className="mt-3 space-y-1.5">
            {DEVIG_METHODS.map((d) => (
              <li
                key={d.key}
                className="text-[11px] leading-relaxed text-slate-500"
              >
                <span className="font-medium text-slate-700">{d.label}</span> —{" "}
                {d.note}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-500">
        {STAKE_DISCLAIMER} La quota fair è una convenzione di calcolo, non una
        previsione: dice che cosa implicherebbe quel mercato senza margine, non
        che cosa accadrà.
      </p>
    </section>
  );
}
