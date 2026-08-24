/**
 * Riduzione della pressione gratuita sulla fonte (Sprint backoff).
 *
 * MODULO PURO: costanti dichiarate e la regola delle quote stabili.
 *
 * Due leve, entrambe dichiarate:
 *  1. QUOTE STABILI: una partita il cui prezzo di consenso è rimasto
 *     identico per STABLE_SKIP_CYCLES giri consecutivi non viene più
 *     riscritta né ritentata: la riga che arriverebbe sarebbe una copia
 *     di quella di prima. N = 3, dichiarato.
 *  2. PAGINE RISULTATI: la pagina risultati di un campionato non si
 *     rilegge più di una volta ogni RESULTS_LEAGUE_TTL_MIN minuti: il
 *     cron passa ogni 45, i risultati non cambiano a quella cadenza.
 *  Inoltre: massimo UN retry per pagina entro lo stesso giro (il secondo
 *  tentativo dell'elenco, già unico per costruzione).
 */

/** Giri consecutivi con prezzo identico dopo i quali la quota è "stabile". */
export const STABLE_SKIP_CYCLES = 3;

/** Minuti minimi fra due letture della stessa pagina risultati. */
export const RESULTS_LEAGUE_TTL_MIN = 120;

/**
 * true se il prezzo in arrivo è identico agli ultimi `minRuns` prezzi
 * registrati: la rilevazione non porterebbe informazione nuova.
 * Con meno cronologie di `minRuns` non si salta mai: tre giri fermi si
 * dimostrano, non si presumono.
 */
export function isStableQuote(
  lastPrices: number[],
  incoming: number,
  minRuns: number = STABLE_SKIP_CYCLES,
): boolean {
  if (lastPrices.length < minRuns) return false;
  const recent = lastPrices.slice(0, minRuns);
  return recent.every((p) => Math.abs(p - incoming) < 0.0005);
}
