/**
 * Il "dato vivo" con cui si confrontano le soglie personali.
 *
 * Perché questo modulo esiste: prima la mappa partita → dato vivo la
 * costruiva soltanto la rotta `POST /api/push/dispatch`, che nessuno
 * scheduler chiamava. Le iscrizioni si salvavano, il pulsante «Test
 * notifica» funzionava, ma nessun avviso partiva mai: il ciclo di
 * osservazione (GitHub Actions, cron di Vercel, CLI) si fermava a raccolta,
 * analisi e chiusura. Costruire il dato vivo qui, in un punto solo, permette
 * al ciclo di fare lo stesso identico lavoro della rotta — stessi numeri,
 * nessuna seconda implementazione che possa divergere.
 *
 * Regola ereditata dal resto del progetto: l'indice confrontato con la soglia
 * è quello NORMALIZZATO sulla base misurabile quando esiste, perché è il
 * numero che la card mostra. Usare il grezzo farebbe dire «soglia raggiunta»
 * alla notifica e «non raggiunta» alla pagina, o viceversa.
 */
import type { DashboardSignal } from "@/lib/repo/dashboard";
import { getDashboardData } from "@/lib/repo/dashboard";
import { groupByMatch, matchIdentityKey } from "@/lib/view/plain";
import type { LiveValue } from "./pure";

/**
 * Il numero da confrontare con la soglia.
 *
 * È la stessa scelta che fa la card: indice normalizzato sulla base
 * misurabile quando il motore ha potuto calcolarlo, indice grezzo quando non
 * c'è scomposizione a registro. Un solo numero per tutti i canali, così
 * pagina, notifica e soglia non possono contraddirsi.
 *
 * Funzione pura: nessun database, nessuna rete.
 */
export function liveValueOf(signal: {
  normalizedScore: number | null;
  confidenceScore: number | null;
  dropPct: number | null;
}): LiveValue {
  return {
    score: signal.normalizedScore ?? signal.confidenceScore,
    dropPct: signal.dropPct,
  };
}

/**
 * Costruisce la mappa chiave partita → dato vivo.
 *
 * Una partita con più segnali prende il valore del segnale più forte, lo
 * stesso che la card mette in vista: la soglia è una sola per partita e
 * sarebbe disonesto confrontarla con un segnale che l'utente non vede.
 */
export function liveValuesOf(
  signals: DashboardSignal[],
): Map<string, LiveValue> {
  const live = new Map<string, LiveValue>();
  for (const g of groupByMatch(signals)) {
    live.set(matchIdentityKey(g.primary), liveValueOf(g.primary));
  }
  return live;
}

/**
 * Legge il dato vivo a registro.
 *
 * @returns la mappa, oppure `null` se il registro non è leggibile. Un buco di
 *          lettura non deve diventare «nessuna soglia superata»: chi chiama
 *          dichiara il guasto invece di notificare meno del dovuto in
 *          silenzio.
 */
export async function readLiveValues(
  now: Date = new Date(),
): Promise<Map<string, LiveValue> | null> {
  const data = await getDashboardData({}, now).catch(() => null);
  if (data === null) return null;
  return liveValuesOf(data.signals);
}
