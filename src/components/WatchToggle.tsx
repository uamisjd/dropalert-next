"use client";

/**
 * Interruttore «Segui» sulla card (Sprint lancio, punto H).
 *
 * Scrive nel localStorage e non parla col server: la preferita resta su
 * questo dispositivo, e la pagina /preferite lo dichiara.
 *
 * Il pulsante sta FUORI dal link che copre la card: dev'essere cliccabile
 * senza aprire il dettaglio, quindi vive in un livello sopra.
 */
import { useCallback, useState, useSyncExternalStore } from "react";
import {
  THRESHOLD_PRESETS,
  WATCHLIST_KEY,
  parseWatchlist,
  removeEntry,
  serializeWatchlist,
  upsertEntry,
  type ThresholdKind,
  type WatchEntry,
} from "@/lib/view/watchlist";

/**
 * Lettura CON MEMORIA della lista.
 *
 * Non è un'ottimizzazione: è ciò che tiene in piedi il componente.
 * `useSyncExternalStore` confronta lo snapshot con `Object.is` e, se a ogni
 * lettura arriva un oggetto nuovo, ritiene che il negozio sia cambiato e
 * forza un altro render — all'infinito, fino a «Maximum update depth
 * exceeded» e allo smontaggio dell'albero. Finché il contenuto grezzo del
 * localStorage non cambia, qui si restituisce LO STESSO array e gli stessi
 * oggetti al suo interno.
 */
let cacheRaw: string | null | undefined;
let cacheList: WatchEntry[] = [];

function read(): WatchEntry[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WATCHLIST_KEY);
  } catch {
    /* storage negato: la lista è vuota e il pulsante non ricorda nulla */
    raw = null;
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    try {
      cacheList = parseWatchlist(raw);
    } catch {
      cacheList = [];
    }
  }
  return cacheList;
}

function write(entries: WatchEntry[]): void {
  try {
    window.localStorage.setItem(WATCHLIST_KEY, serializeWatchlist(entries));
    window.dispatchEvent(new Event("dropalert:watchlist"));
  } catch {
    /* storage negato: il pulsante resta visibile ma non ricorda nulla */
  }
}

/* Le preferite vivono fuori da React (nel browser): si leggono con
   useSyncExternalStore, così il server rende «non seguita» e non c'è né
   lampeggio né render a cascata. */
function subscribe(fn: () => void): () => void {
  window.addEventListener("dropalert:watchlist", fn);
  return () => window.removeEventListener("dropalert:watchlist", fn);
}

export function WatchToggle({
  entryKey,
  matchId,
  homeTeam,
  awayTeam,
  kickoffAt,
}: {
  entryKey: string;
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
}) {
  const [open, setOpen] = useState(false);

  const snapshot = useCallback(
    () => read().find((e) => e.key === entryKey) ?? null,
    [entryKey],
  );
  /* sul server non esiste localStorage: lo stato di partenza è «non seguita» */
  const entry = useSyncExternalStore(subscribe, snapshot, () => null);
  const following = entry !== null;

  function toggle() {
    const list = read();
    if (following) {
      write(removeEntry(list, entryKey));
      setOpen(false);
      return;
    }
    const nuovo: WatchEntry = {
      key: entryKey,
      matchId,
      homeTeam,
      awayTeam,
      kickoffAt,
      thresholdKind: null,
      thresholdValue: null,
      addedAt: new Date().toISOString(),
    };
    write(upsertEntry(list, nuovo));
    setOpen(true);
  }

  function setThreshold(kind: ThresholdKind | null, value: number | null) {
    if (entry === null) return;
    write(upsertEntry(read(), { ...entry, thresholdKind: kind, thresholdValue: value }));
  }

  return (
    <div className="relative z-10">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={following}
        title={
          following
            ? "Rimuovi dalle preferite (salvate solo su questo browser)"
            : "Segui questa partita: la trovi in /preferite, salvata solo su questo browser"
        }
        className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
          following
            ? "border-slate-800 bg-slate-800 text-white"
            : "border-slate-300 bg-white text-slate-600 hover:border-slate-500"
        }`}
      >
        {following ? "★ Seguita" : "☆ Segui"}
      </button>

      {following && open ? (
        <div className="mt-1 rounded border border-slate-200 bg-white p-2">
          <p className="mb-1 text-[11px] text-slate-600">
            Soglia personale (facoltativa):
          </p>
          <div className="flex flex-wrap gap-1">
            {THRESHOLD_PRESETS.map((p) => {
              const on =
                entry?.thresholdKind === p.kind &&
                entry?.thresholdValue === p.value;
              return (
                <button
                  key={`${p.kind}-${p.value}`}
                  type="button"
                  onClick={() => setThreshold(on ? null : p.kind, on ? null : p.value)}
                  aria-pressed={on}
                  className={`rounded border px-1.5 py-0.5 text-[11px] ${
                    on
                      ? "border-slate-800 bg-slate-100 text-slate-900"
                      : "border-slate-300 text-slate-600 hover:border-slate-500"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500"
            >
              Chiudi
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
