/**
 * Pagina /preferite (Sprint lancio, punto H; URL italiano dallo sprint FIX-1).
 *
 * Le preferite stanno nel browser, quindi la pagina è un client component:
 * il server non sa e non deve sapere che cosa segui. I dati vivi di ciascuna
 * partita (indice normalizzato e calo) arrivano dall'API pubblica dei
 * segnali, la stessa che alimenta la lista.
 *
 * Se una partita seguita non ha più un segnale a registro, lo si dice: non
 * si inventa un valore per far quadrare la riga.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  WATCHLIST_KEY,
  parseWatchlist,
  removeEntry,
  serializeWatchlist,
  sortForDisplay,
  thresholdLabel,
  thresholdReached,
  type WatchEntry,
} from "@/lib/view/watchlist";

interface LiveRow {
  matchId: number;
  score: number | null;
  dropPct: number | null;
}

export default function WatchlistPage() {
  const [entries, setEntries] = useState<WatchEntry[]>([]);
  const [live, setLive] = useState<Map<number, LiveRow>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sync = () => {
      try {
        setEntries(parseWatchlist(window.localStorage.getItem(WATCHLIST_KEY)));
      } catch {
        setEntries([]);
      }
    };
    sync();
    window.addEventListener("dropalert:watchlist", sync);
    return () => window.removeEventListener("dropalert:watchlist", sync);
  }, []);

  useEffect(() => {
    let annullato = false;
    (async () => {
      try {
        const res = await fetch("/api/signals", { cache: "no-store" });
        if (!res.ok) throw new Error("no");
        const body: unknown = await res.json();
        /* l'API pubblica espone `items` con la partita annidata e i prezzi:
           il calo si ricava da apertura e corrente, non si inventa */
        const raw = body as { items?: unknown; signals?: unknown };
        const rows = (
          Array.isArray(raw.items)
            ? raw.items
            : Array.isArray(raw.signals)
              ? raw.signals
              : []
        ) as Array<Record<string, unknown>>;
        const map = new Map<number, LiveRow>();
        for (const r of rows) {
          const partita = r.match as { id?: unknown } | undefined;
          const id =
            typeof partita?.id === "number"
              ? partita.id
              : typeof r.matchId === "number"
                ? r.matchId
                : null;
          if (id === null) continue;
          const score =
            typeof r.confidenceScore === "number" ? r.confidenceScore : null;
          const apertura =
            typeof r.openingPrice === "number" ? r.openingPrice : null;
          const corrente =
            typeof r.currentPrice === "number" ? r.currentPrice : null;
          const dropPct =
            apertura !== null && corrente !== null && apertura > 0
              ? (corrente / apertura - 1) * 100
              : null;
          const prev = map.get(id);
          if (prev === undefined || (score ?? -1) > (prev.score ?? -1)) {
            map.set(id, { matchId: id, score, dropPct });
          }
        }
        if (!annullato) setLive(map);
      } catch {
        if (!annullato) setLive(new Map());
      } finally {
        if (!annullato) setLoading(false);
      }
    })();
    return () => {
      annullato = true;
    };
  }, [entries.length]);

  function drop(key: string) {
    const next = removeEntry(entries, key);
    setEntries(next);
    try {
      window.localStorage.setItem(WATCHLIST_KEY, serializeWatchlist(next));
    } catch {
      /* niente da salvare: la lista resta comunque aggiornata a schermo */
    }
  }

  const rows = sortForDisplay(
    entries.map((e) => {
      const l = live.get(e.matchId) ?? { score: null, dropPct: null };
      return {
        ...e,
        score: l.score,
        dropPct: l.dropPct,
        reached: thresholdReached(e, { score: l.score, dropPct: l.dropPct }),
        noData: l.score === null && l.dropPct === null,
      };
    }),
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">
        Preferite
      </h1>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Le partite che segui, con la tua soglia personale. La lista è salvata
        solo in questo browser: non viene inviata al server e non la ritrovi su
        un altro dispositivo.
      </p>

      {entries.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
          Nessuna partita seguita. Usa il pulsante «☆ Segui» su una card della{" "}
          <Link href="/" className="underline underline-offset-2">
            lista principale
          </Link>{" "}
          per aggiungerla qui.
        </p>
      ) : (
        <ul className="mt-5 space-y-2">
          {rows.map((r) => (
            <li
              key={r.key}
              className="rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/matches/${r.matchId}`}
                    className="text-sm font-semibold text-slate-900 underline-offset-2 hover:underline"
                  >
                    {r.homeTeam} – {r.awayTeam}
                  </Link>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {thresholdLabel(r)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => drop(r.key)}
                  className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:border-slate-500"
                >
                  Rimuovi
                </button>
              </div>

              <p className="mt-2 text-xs text-slate-700">
                {loading ? (
                  <span className="text-slate-500">lettura dei dati vivi…</span>
                ) : r.noData ? (
                  <span className="text-slate-500">
                    nessun segnale a registro in questo momento per questa
                    partita
                  </span>
                ) : (
                  <>
                    <span className="tabular-nums">
                      indice {r.score ?? "n/d"}/100
                    </span>
                    <span className="mx-1.5 text-slate-300">|</span>
                    <span className="tabular-nums">
                      variazione quota{" "}
                      {r.dropPct === null ? "n/d" : `${r.dropPct.toFixed(2)}%`}
                    </span>
                  </>
                )}
              </p>

              {r.reached === true ? (
                <p className="mt-1 inline-block rounded border border-slate-800 bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white">
                  soglia raggiunta
                </p>
              ) : r.reached === false ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  soglia non ancora raggiunta
                </p>
              ) : r.thresholdKind !== null ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  soglia non valutabile: manca il dato con cui confrontarla
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-slate-500">
        La soglia personale non cambia il punteggio, non filtra la lista
        principale e non è un consiglio: serve solo a ritrovare in fretta ciò
        che stai osservando.
      </p>
    </main>
  );
}
