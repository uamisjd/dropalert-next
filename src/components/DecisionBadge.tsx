/**
 * Badge decisionale compatto per le card della dashboard.
 *
 * Propaga il contratto decisionale alla vista principale senza
 * chiamare `assessDecision` (che richiede dati DB): usa i campi
 * già presenti in `DashboardSignal` per stimare lo stato e mostra
 * una pill informativa.
 *
 * La distinzione importante per chi legge è:
 * - "NON AZIONABILE" — la fonte espone consenso, non un prezzo eseguibile;
 * - "OSSERVAZIONE" — dati presenti ma manca fair indipendente;
 * - le fasce alte non sono attualmente raggiungibili (tetto 53,5/100).
 *
 * Questo badge NON sostituisce il DecisionStatusBlock del dettaglio partita:
 * è un indicatore rapido, non un'analisi completa.
 */
import type { DashboardSignal } from "@/lib/repo/dashboard";

type QuickState = "non_azionabile" | "osservazione" | "indisponibile";

function quickDecisionState(signal: DashboardSignal): QuickState {
  /* La fonte espone consenso: il prezzo non è eseguibile */
  if (!signal.sharpAvailable) return "non_azionabile";

  /* Dati freschi e segnale attivo: c'è qualcosa da osservare */
  if (
    signal.status === "active" &&
    signal.currentPrice !== null &&
    signal.currentPrice > 1
  ) {
    return "osservazione";
  }

  return "non_azionabile";
}

const STATE_LABELS: Record<QuickState, string> = {
  non_azionabile: "NO BET",
  osservazione: "OSSERVAZIONE",
  indisponibile: "n/d",
};

const STATE_STYLES: Record<QuickState, string> = {
  non_azionabile:
    "border-rose-200 bg-rose-50 text-rose-800",
  osservazione:
    "border-amber-200 bg-amber-50 text-amber-800",
  indisponibile:
    "border-slate-200 bg-slate-50 text-slate-500",
};

const STATE_TITLES: Record<QuickState, string> = {
  non_azionabile:
    "NON AZIONABILE: la fonte espone consenso, non una quota acquistabile presso un singolo operatore.",
  osservazione:
    "OSSERVAZIONE: movimento degno di studio, ma manca una fair indipendente per valutare.",
  indisponibile:
    "Stato decisionale non valutabile: dati insufficienti.",
};

export function DecisionBadge({ signal }: { signal: DashboardSignal }) {
  const state = quickDecisionState(signal);

  return (
    <span
      title={STATE_TITLES[state]}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${STATE_STYLES[state]}`}
    >
      {STATE_LABELS[state]}
    </span>
  );
}
