"use client";

import Link from "next/link";
import type { TradingOpportunity } from "@/lib/repo/trading-opportunities";
import { fmtDay, fmtTime } from "@/components/format";
import { GreenUpCalculator } from "./GreenUpCalculator";

interface Props {
  trades: TradingOpportunity[];
  /** segnali letti dall'elenco del dashboard: il denominale onesto di `trades.length` */
  signalsRead: number;
  /** true quando la lettura è fallita: la tabella vuota non è «nessuna escursione» */
  readFailed: boolean;
}

/**
 * Elenco delle escursioni di prezzo lette fra apertura e ultima rilevazione.
 *
 * Le etichette dicono «apertura letta» e «ultima lettura»: non «back» e «lay». La
 * ragione è nei dati, non nello stile — questo sito legge un solo consenso di quote
 * d'offerta, quindi la seconda gamba di un&#39;operazione di exchange (il prezzo di
 * bancata, la profondità del ladder, la commissione reale) non esiste: ciò che si vede
 * qui è quanto il prezzo si è mosso, e quanto varrebbe chiudere fra quei due numeri.
 * Per questo la sezione è «a ritroso»: misura, non trade da eseguire.
 */
export function TradingTerminalView({ trades, signalsRead, readFailed }: Props) {
  const filtered = trades;

  return (
    <div className="space-y-6">
      {/* Calcolatore Operativo Green-Up */}
      <GreenUpCalculator />

      {/* Escursioni misurate (a ritroso) */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-950 sm:text-xl">
              Escursioni di prezzo fra apertura e ultima lettura
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Ogni riga &egrave; un movimento osservato dal collettore su una selezione gi&agrave;
              segnalata: tick percorsi e quanto varrebbe chiudere fra quei due prezzi. Non
              &egrave; una posizione apribile &mdash; i prezzi di bancata di un exchange non sono
              fra i dati che questo sito legge.
            </p>
          </div>

          <div className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 tabular-nums">
            {trades.length} escursioni su {signalsRead} segnali letti
          </div>
        </div>

        {filtered.length === 0 ? (
          readFailed ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-xs leading-relaxed text-rose-900">
              Le escursioni non sono leggibili in questo momento (lettura non
              riuscita, dettaglio nel log del server). Questa tabella vuota non
              significa «nessuna escursione»: lo stato del collettore è su&nbsp;
              <Link href="/coverage" className="underline">/coverage</Link>.
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
              Nessuna escursione di almeno tre tick, fra le {signalsRead} letture
              disponibili. Se la lista è vuota non è un&#39;assenza di movimento:
              è il collettore che non l&#39;ha registrato, e la differenza sta nei
              contatori di&nbsp;<Link href="/coverage" className="underline">/coverage</Link>.
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filtered.map((trade) => (
              <div
                key={trade.signalId}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{trade.league}</span>
                  <span>
                    {fmtDay(trade.kickoffAt)} ore {fmtTime(trade.kickoffAt)}
                  </span>
                </div>

                <h3 className="mt-1 text-base font-bold text-slate-950">
                  <Link
                    href={`/matches/${trade.matchId}`}
                    className="hover:text-cyan-700 hover:underline"
                  >
                    {trade.homeTeam} – {trade.awayTeam}
                  </Link>
                </h3>

                <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-800">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
                    {trade.marketLabel}
                  </span>
                  <span>Selezione del segnale: <strong>{trade.selectionLabel}</strong></span>
                </div>

                {/* Prezzi e Ticks */}
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-center">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Apertura letta</div>
                    <div className="text-sm font-bold text-slate-900 tabular-nums">
                      {trade.priceOpening.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Ultima lettura</div>
                    <div className="text-sm font-bold text-slate-900 tabular-nums">
                      {trade.priceCurrent.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Escursione</div>
                    <div className="text-sm font-extrabold text-cyan-700 tabular-nums">
                      +{trade.tickMovement} Ticks
                    </div>
                  </div>
                </div>

                {/* Potenziale Green-up e Bottone */}
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
                  <div>
                    <div className="text-[10px] text-slate-500">
                      Valeva chiudere, fra quei due prezzi (100 € ipotetici, commissione{" "}
                      {trade.commissionAssumedPct}% assunta)
                    </div>
                    <div className="text-sm font-black text-slate-700 tabular-nums">
                      {trade.hindsightNetEuros >= 0 ? "+" : "−"}€{" "}
                      {Math.abs(trade.hindsightNetEuros).toFixed(2)}{" "}
                      <span className="text-xs font-bold text-slate-500">
                        ({trade.hindsightRoiPct >= 0 ? "+" : "−"}
                        {Math.abs(trade.hindsightRoiPct).toFixed(1)}%)
                      </span>
                    </div>
                  </div>

                  <Link
                    href={`/matches/${trade.matchId}`}
                    className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-700"
                  >
                    Scheda partita →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
