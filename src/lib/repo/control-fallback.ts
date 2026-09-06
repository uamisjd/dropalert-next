/**
 * Ripiego «dalla fonte» per la lettura di controllo.
 *
 * La lettura di controllo normale sceglie la partita dall'archivio BetExplorer
 * (`matches`), perché in produzione è lì che nascono le partite che il sito
 * mostra. Ma l'archivio può restare vuoto sul turno corrente (il collettore
 * non ha ancora visto i movimenti di giornata): in quel caso la lettura di
 * controllo non avrebbe nulla da leggere pur essendoci partite reali coperte
 * in programma — esattamente lo scenario del 06/09/2026, con la Serie A in
 * campo e l'archivio senza partite coperte.
 *
 * Il ripiego sceglie la partita DIRETTAMENTE dalla fonte, con l'endpoint
 * GRATUITO `/sports/{key}/events` (fuori quota, dichiarato in
 * `the-odds-api-events.ts`), limitato alle chiavi coperte. Poi la lettura
 * vera passa comunque da `getSharpLine`: stesso percorso di produzione,
 * stesso credito, stessi contatori.
 *
 * `getSharpLine` non tocca mai `matches`: persiste in `system_state` con una
 * chiave di stringa costruita da `matchKey(matchId, giorno)`, senza vincoli
 * esterni. Quindi per una partita nata dalla fonte si usa un id sintetico
 * NEGATIVO, derivato in modo deterministico dall'id evento: non può collidere
 * con gli id reali (serial positivi) e rilanciando la lettura nello stesso
 * giorno ritrova la propria fotografia in cache, come farebbe una partita
 * vera.
 */
import type { OddsApiEventLite } from "@/lib/providers/optional/odds-match-resolver";

/**
 * Id sintetico negativo per una partita che non esiste in archivio.
 * Deterministico: stesso evento → stesso id, quindi stessa chiave snapshot.
 * Gli id evento della fonte sono esadecimali; si usano i primi 8 caratteri
 * (32 bit). Se l'id non è interpretabile si usa -1, pur restando negativo.
 */
export function syntheticMatchId(eventId: string): number {
  const parsed = Number.parseInt(eventId.slice(0, 8), 16);
  if (!Number.isFinite(parsed) || parsed <= 0) return -1;
  return -parsed;
}

/**
 * Prima partita in programma nella finestra, secondo l'orario della fonte.
 * `null` se la fonte non espone nulla nel periodo: non è un errore, è un
 * esito dichiarato (turno davvero assente su quella chiave).
 */
export function pickUpcomingEvent(
  events: readonly OddsApiEventLite[],
  now: Date,
  until: Date,
): OddsApiEventLite | null {
  const inWindow = events
    .filter((e) => e.commenceTime.getTime() >= now.getTime() && e.commenceTime.getTime() <= until.getTime())
    .sort((a, b) => a.commenceTime.getTime() - b.commenceTime.getTime());
  return inWindow[0] ?? null;
}
