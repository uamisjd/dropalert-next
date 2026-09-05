"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { DetailSignal, MarketSeries } from "@/lib/repo/match-detail";
import type { MarketType, SelectionCode } from "@/db/schema";
import { calculateKellyStake } from "@/lib/quant/kelly";
import { calculateGreenUp, calculateTickDistance } from "@/lib/quant/exchange-trading";
import { computeValueGap } from "@/lib/quant/value-gap";
import { buildSyntheticMarkets } from "@/lib/quant/synthetic-odds";
import { round } from "@/lib/drop/math";

interface Props {
  signal: DetailSignal | null;
  series: MarketSeries | null;
  allSeries: MarketSeries[];
  homeTeam: string;
  awayTeam: string;
}

/** Quante cifre servono per non far sembrare precisa una misura indicativa. */
const pct = (v: number): string => `${v > 0 ? "+" : ""}${v.toFixed(2)} pp`;

/**
 * Pannello quantitativo della partita.
 *
 * Cosa fa qui dentro, in ordine di affidabilità:
 *  1. il **divario** fra l'ultima lettura della selezione e la linea senza margine
 *     (no-vig) dello stesso bookmaker sullo stesso mercato — stessa formula dello
 *     scanner `/value-bets` e della chiusura fair del CLV (`value-gap.ts`);
 *  2. l'**escursione** del prezzo (apertura → ora) in tick, con accanto quanto valeva
 *     chiuderla a ritroso: è storia del movimento, non un'operazione eseguibile;
 *  3. le **quote sintetiche** derivate dalla terna: aritmetica della linea, non
 *     un'offerta confrontabile con qualcuno (nessun bookmaker alternativo è letto).
 *
 * Cosa NON fa: nessuna «fair» ipotizzata dividendo per un margine di comodo, nessun
 * edge calcolato sul prezzo di apertura (non è più acquistabile), nessuna probabilità
 * inventata quando la terna è incompleta, nessuna puntata suggerita — la Kelly resta
 * una calcolatrice e i numeri li inserisce chi legge, come in `/strumenti`.
 */
export function MatchQuantPanel({ signal, series, allSeries }: Props) {
  const [bankroll, setBankroll] = useState<number>(1000);
  const [probPct, setProbPct] = useState<string>("");
  const [kellyTier, setKellyTier] = useState<"eighth" | "quarter" | "half">("quarter");

  const currentPrice = series?.current ?? signal?.currentPrice ?? null;
  const openingPrice = series?.opening ?? signal?.openingPrice ?? null;
  const market = series?.market ?? signal?.market ?? null;
  const selection = series?.selection ?? signal?.selection ?? null;

  /* ------------------------------------------------------------------ */
  /* 1 — divario contro la linea no-vig dello stesso bookmaker           */
  /* ------------------------------------------------------------------ */

  const gap = useMemo(() => {
    if (!market || !selection || !currentPrice || currentPrice <= 1.01) {
      return { ok: false as const, reason: "nessuna selezione di mercato selezionata" };
    }
    const bookmaker = series?.bookmakerKey ?? null;
    /**
     * La linea =letture della STESSA fonte e dello STESSO mercato. Se la fonte non è
     * nota si usano tutte le serie del mercato: il divario va allora letto come
     * indicativo, e la nota sotto lo dice.
     */
    const peers = allSeries.filter(
      (s) => s.market === market && (bookmaker === null || s.bookmakerKey === bookmaker),
    );
    const line: Partial<Record<SelectionCode, number>> = {};
    for (const s of peers) {
      if (s.current !== null) line[s.selection] = s.current;
    }
    const res = computeValueGap({
      market: market as MarketType,
      selection: selection as SelectionCode,
      currentPrice,
      line,
    });
    if (!res.ok) return { ...res, maxSkewMinutes: null as number | null };

    const times = peers
      .map((s) => (s.lastAt ? new Date(s.lastAt).getTime() : NaN))
      .filter((t) => Number.isFinite(t));
    const maxSkewMinutes =
      times.length >= 2
        ? Math.round((Math.max(...times) - Math.min(...times)) / 60_000)
        : null;
    return { ...res, maxSkewMinutes };
  }, [allSeries, currentPrice, market, selection, series]);

  /* ------------------------------------------------------------------ */
  /* 2 — escursione del prezzo (a ritroso)                               */
  /* ------------------------------------------------------------------ */

  const movement = useMemo(() => {
    if (!openingPrice || !currentPrice || openingPrice <= currentPrice) return null;
    const ticks = calculateTickDistance(openingPrice, currentPrice);
    const greenUp = calculateGreenUp({
      backOdds: openingPrice,
      backStake: 100,
      layOdds: currentPrice,
      commissionPct: 4.5,
    });
    return { ticks, greenUp };
  }, [openingPrice, currentPrice]);

  /* ------------------------------------------------------------------ */
  /* 3 — Kelly come calcolatrice, con la probabilità scritta qui         */
  /* ------------------------------------------------------------------ */

  const p = Number(probPct.replace(",", "."));
  const probValid = probPct.trim() !== "" && Number.isFinite(p) && p > 0 && p <= 100;
  const kelly =
    probValid && currentPrice && currentPrice > 1.01
      ? calculateKellyStake({
          offeredOdds: currentPrice,
          trueProbability: p / 100,
          bankroll,
          tier: kellyTier,
        })
      : null;

  /* ------------------------------------------------------------------ */
  /* 4 — sintetiche: solo se la terna c'è davvero                        */
  /* ------------------------------------------------------------------ */

  const synthetic = useMemo(() => {
    const of = (sel: SelectionCode): number | null =>
      allSeries.find((s) => s.market === market && s.selection === sel)?.current ?? null;
    const h = of("home");
    const d = of("draw");
    const a = of("away");
    if (h === null || d === null || a === null) return null;
    return buildSyntheticMarkets(h, d, a);
  }, [allSeries, market]);

  return (
    <section
      id="quant-alpha"
      aria-labelledby="titolo-quant"
      className="scroll-mt-20 pt-10"
    >
      <div className="mb-4">
        <p className="text-xs font-bold tracking-[0.16em] text-emerald-700 uppercase">
          Misura del prezzo · non un consiglio
        </p>
        <h2
          id="titolo-quant"
          className="mt-1 text-xl font-bold tracking-tight text-slate-950"
        >
          Divario, escursione e linea no-vig di questa partita
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Tre letture della stessa serie di prezzi: che cosa resta del margine se lo
          togli, quanto si è mossa la quota e quanto varrebbe chiuderla oggi a ritroso.
          Nessuna di queste &egrave; un&apos;istruzione su cosa fare.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Box 1: divario e linea no-vig */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
            Divario contro la linea senza margine
          </h3>

          {gap.ok ? (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3 text-center">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Quota corrente</div>
                  <div className="text-base font-bold text-slate-950 tabular-nums">
                    {currentPrice?.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">Fair no-vig</div>
                  <div className="text-base font-bold text-slate-700 tabular-nums">
                    {gap.fairOdds.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-700 uppercase">
                    Divario
                  </div>
                  <div
                    className={`text-base font-extrabold tabular-nums ${
                      gap.edgePct > 0 ? "text-emerald-700" : "text-slate-500"
                    }`}
                  >
                    {pct(gap.edgePct)}
                  </div>
                </div>
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Margine rimosso dalla linea: <strong>{gap.marginPct.toFixed(2)}%</strong> su{" "}
                {gap.selectionsUsed} selezioni · metodo no-vig proporzionale, lo stesso della
                chiusura fair del CLV.
                {gap.maxSkewMinutes !== null && gap.maxSkewMinutes > 0
                  ? ` Le letture della terna distano fra loro fino a ${gap.maxSkewMinutes} minuti: finché la fonte non espone una fotografia simultanea, il divario è indicativo.`
                  : ""}
                {currentPrice !== null && openingPrice !== null && openingPrice > currentPrice
                  ? " Nota: qui il prezzo valutato è quello eseguibile oggi, non l'apertura."
                  : ""}
              </p>
            </>
          ) : (
            <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              <strong className="font-semibold text-slate-800">
                Nessun divario da mostrare.
              </strong>{" "}
              {gap.ok === false ? gap.reason : ""} Il no-vig richiede la terna completa dello
              stesso mercato: se manca una selezione non si stima il margine mancante
              (&nbsp;<Link href="/metodologia" className="underline">
                metodologia
              </Link>).
            </p>
          )}

          {/* Calcolatrice Kelly: i numeri li inserisce chi legge */}
          <div className="mt-4 rounded-2xl border border-slate-200 p-3.5">
            <p className="text-xs font-semibold text-slate-700">
              Kelly, se hai una tua probabilità
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-slate-500">
                Probabilità che le dai (%)
                <input
                  type="number"
                  min="1"
                  max="99"
                  step="0.5"
                  value={probPct}
                  onChange={(e) => setProbPct(e.target.value)}
                  placeholder="es. 52"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold text-slate-900"
                />
              </label>
              <label className="text-[11px] text-slate-500">
                Bankroll (€)
                <input
                  type="number"
                  min="10"
                  step="50"
                  value={bankroll}
                  onChange={(e) => setBankroll(Math.max(10, Number(e.target.value) || 0))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold text-slate-900"
                />
              </label>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex gap-1">
                {(["eighth", "quarter", "half"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setKellyTier(t)}
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                      kellyTier === t
                        ? "bg-slate-950 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {t === "eighth" ? "⅛" : t === "quarter" ? "¼" : "½"}
                  </button>
                ))}
              </div>
              <span className="text-xs font-bold text-slate-700 tabular-nums">
                {kelly && kelly.hasEdge
                  ? `€ ${kelly.recommendedStakeAmount.toFixed(2)} (${round(
                      kelly.recommendedStakePct,
                      2,
                    )}%)`
                  : kelly
                    ? "la tua probabilità non supera l'implicita: niente stake"
                    : "in attesa di una tua probabilità"}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              La probabilità del divario qui sopra non è usabile come input: è la linea dello
              stesso bookmaker, non un&#39;opinione indipendente. Inseriscine una tua, o usa
              gli&nbsp;
              <Link href="/strumenti" className="underline">
                strumenti
              </Link>
              .
            </p>
          </div>
        </div>

        {/* Box 2: escursione del prezzo, a ritroso */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
            Escursione del prezzo e chiusura a ritroso
          </h3>

          {movement ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-950 p-4 text-white">
                <div>
                  <div className="text-[10px] font-bold uppercase text-cyan-300">
                    Movimento rilevato
                  </div>
                  <div className="text-base font-extrabold tabular-nums">
                    {openingPrice?.toFixed(2)} → {currentPrice?.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {movement.ticks} tick di distanza
                  </div>
                </div>
                <div className="border-l border-white/15 pl-3">
                  <div className="text-[10px] font-bold uppercase text-emerald-400">
                    Valeva chiuderla (100 €)
                  </div>
                  <div className="text-xl font-black text-emerald-400 tabular-nums">
                    {movement.greenUp
                      ? `${movement.greenUp.hedgedProfitNet >= 0 ? "+" : ""}€ ${movement.greenUp.hedgedProfitNet.toFixed(2)}`
                      : "n/d"}
                  </div>
                  <div className="text-[11px] text-emerald-200/80">
                    con commissione ipotizzata 4,5%
                  </div>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Questo numero è <strong>a ritroso</strong>: descrive quanto valeva il movimento
                dal punto di osservazione all&#39;ultimo. Non è un&#39;operazione eseguibile — la
                quota di bancata di un exchange non è fra i dati che questo sito legge, e la
                commissione è un&#39;ipotesi, non una tariffa rilevata.
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-xs text-slate-600">
              <p className="font-semibold text-slate-800">
                Nessun calo da raccontare, in questa partita.
              </p>
              <p className="mt-1">
                L&#39;escursione si calcola solo quando la quota corrente è sotto
                l&#39;apertura: qui non lo è, e non si costruisce un&#39;alternativa per
                riempire lo spazio.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Box 3: sintetiche derivate, solo con terna completa */}
      <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
          Quote sintetiche derivate dalla terna 1X2
        </h3>
        {synthetic ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Doppia Chance 1X", v: synthetic.doubleChance.oneX },
                { label: "Doppia Chance X2", v: synthetic.doubleChance.xTwo },
                { label: "Draw No Bet (1)", v: synthetic.drawNoBet.dnb1 },
                { label: "Draw No Bet (2)", v: synthetic.drawNoBet.dnb2 },
              ].map((x) => (
                <div key={x.label} className="rounded-2xl bg-slate-50 p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">{x.label}</div>
                  <div className="text-base font-bold text-slate-900 tabular-nums">
                    @{x.v.toFixed(2)}
                  </div>
                  {x.v < 1.01 ? (
                    <div className="mt-1 text-[10px] leading-tight text-amber-700">
                      sotto 1,00: la terna letta rende questo esito così probabile che nessuna
                      quota reale lo esprime
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              Sono aritmetica della linea letta (nessun margine, nessuna assunzione): dicono
              che prezzo avrebbe un mercato derivato se la terna fosse prezzata senza vigore.
              Confrontarle con le quote di un altro operatore sarebbe il passo successivo — ma
              un secondo operatore, nei dati attuali, non c&#39;è.
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            La terna 1X2 non è completa nelle letture di questa partita: nessuna quota
            sintetica viene calcolata e nessun valore mancante è stimato.
          </p>
        )}
      </div>
    </section>
  );
}
