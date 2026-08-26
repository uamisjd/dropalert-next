/**
 * Cache dati condivisa per le pagine dinamiche (Sprint lancio, punto C).
 *
 * Home e dettaglio partita leggono `searchParams`/`params`, quindi Next le
 * rende a richiesta e la CDN non può conservarle: senza questo strato ogni
 * visita ripagherebbe per intero l'interrogazione al database.
 *
 * Qui la cache sta sul DATO, non sulla pagina: la stessa lettura viene
 * riusata per 300 secondi (la stessa finestra dell'ISR delle pagine
 * statiche), poi si rinfresca. La freschezza vera resta dichiarata in pagina
 * dal pannello «Stato dati» e dai badge di rilevazione, che continuano a
 * dire quanti minuti ha il dato: la cache accorcia il tempo di risposta, non
 * nasconde l'età dell'osservazione.
 *
 * Le SCRITTURE non passano di qui: il collector gira su GitHub Actions e non
 * dipende dal render.
 */
import { unstable_cache } from "next/cache";

/** Stessa finestra dell'ISR delle pagine di contenuto. */
export const DATA_REVALIDATE_SECONDS = 300;

/**
 * Avvolge una lettura di sola consultazione in una cache a tempo.
 * `keyParts` deve identificare TUTTI gli argomenti che cambiano il risultato:
 * una chiave incompleta servirebbe il dato di un'altra richiesta.
 */
export function cachedRead<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  keyParts: string[],
  tags: string[] = [],
): (...args: A) => Promise<R> {
  return unstable_cache(fn, keyParts, {
    revalidate: DATA_REVALIDATE_SECONDS,
    tags,
  });
}
