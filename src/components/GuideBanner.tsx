"use client";

/**
 * "Guida in 60 secondi" (Sprint UX-2).
 *
 * Compare al primo accesso, si chiude e non torna: la memoria sta nel
 * localStorage del browser, nessun cookie e nessun dato inviato al server.
 * Il banner monta solo dopo il primo render lato client, così non lampeggia
 * per chi lo ha già chiuso.
 */
import { useState, useSyncExternalStore } from "react";
import { Info } from "./Info";

const KEY = "dropalert.guida60.chiusa.v1";

/* Lo stato di chiusura è esterno a React (vive nel browser): lo si legge con
   useSyncExternalStore, così il server rende sempre "chiuso" e non c'è
   lampeggio né render a cascata. */
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function readClosed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    /* storage negato: la guida non compare, invece di comparire ogni volta */
    return true;
  }
}

export function GuideBanner() {
  const [dismissed, setDismissed] = useState(false);
  const closed = useSyncExternalStore(subscribe, readClosed, () => true);

  if (closed || dismissed) return null;

  function close() {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* nulla da salvare: si chiude comunque per questa sessione */
    }
    setDismissed(true);
    for (const fn of listeners) fn();
  }

  return (
    <aside
      aria-labelledby="guida-60"
      className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <button
        type="button"
        onClick={close}
        aria-label="Chiudi la guida"
        className="absolute top-2 right-2 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:border-slate-500 hover:text-slate-900"
      >
        Chiudi
      </button>
      <h2
        id="guida-60"
        className="mb-2 pr-16 text-sm font-semibold text-slate-900"
      >
        Guida in 60 secondi
      </h2>
      <ul className="space-y-1.5 text-xs leading-relaxed text-slate-700">
        <li>
          <span className="font-medium text-slate-900">
            Che cos&apos;è un drop
          </span>
          <Info term="drop" /> — la quota di un esito scende rispetto a quando
          il monitor l&apos;ha vista la prima volta. Vuol dire che il mercato
          sta prezzando quell&apos;esito più caro di prima.
        </li>
        <li>
          <span className="font-medium text-slate-900">
            Che cos&apos;è l&apos;indice
          </span>
          <Info term="indice" /> — un numero da 0 a 100 che riassume quanto il
          movimento è ampio, confermato da più bookmaker, durato nel tempo e
          coperto da dati completi.
        </li>
        <li>
          <span className="font-medium text-slate-900">
            Non prevede il risultato: misura il mercato.
          </span>{" "}
          Un drop non dice chi vincerà e non garantisce alcun vantaggio: usalo
          per informare le tue giocate. La sola
          metrica di qualità pubblicata è il CLV
          <Info term="clv" />.
        </li>
      </ul>
    </aside>
  );
}
