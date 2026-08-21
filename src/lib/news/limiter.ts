/**
 * Limiter di cortesia verso la fonte notizie (Sprint notizie).
 *
 * Regole dichiarate, entrambe vincolanti:
 *  - max UNA richiesta ogni 5 secondi, fra tutte le partite;
 *  - max 20 richieste per finestra mobile di 15 minuti ("giro").
 *
 * Stato su `globalThis` come il pool del database: i ricarichi a caldo di
 * Next non devono creare due limiter che si credono soli al mondo.
 */
const MIN_INTERVAL_MS = 5_000;
const WINDOW_MS = 15 * 60_000;
const MAX_PER_WINDOW = 20;

interface NewsLimiterState {
  lastAt: number;
  timestamps: number[];
}

const globalForNews = globalThis as unknown as {
  __newsLimiter?: NewsLimiterState;
};

function state(): NewsLimiterState {
  if (globalForNews.__newsLimiter === undefined) {
    globalForNews.__newsLimiter = { lastAt: 0, timestamps: [] };
  }
  return globalForNews.__newsLimiter;
}

/** Quante richieste restano nella finestra corrente. */
export function remainingInWindow(now: number = Date.now()): number {
  const s = state();
  const inWindow = s.timestamps.filter((t) => now - t < WINDOW_MS).length;
  return Math.max(0, MAX_PER_WINDOW - inWindow);
}

/** True se la finestra è piena: lettura da rimandare, dichiarato. */
export function isWindowExhausted(now: number = Date.now()): boolean {
  return remainingInWindow(now) === 0;
}

/**
 * Attende il turno rispettando l'intervallo minimo, se serve, e registra
 * la richiesta. Restituisce false se la finestra è piena: niente slot,
 * niente richiesta — mai un'eccezione, mai un aggiramento.
 */
export async function acquireNewsSlot(
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  now: number = Date.now(),
): Promise<boolean> {
  const s = state();
  if (isWindowExhausted(now)) return false;

  /* l'attesa rispetta l'intervallo minimo dall'ultima richiesta concessa */
  const wait = Math.max(0, MIN_INTERVAL_MS - (now - s.lastAt));
  if (wait > 0) await sleep(wait);

  /* l'istante della richiesta: quello dichiarato da chi chiama */
  s.lastAt = now;
  s.timestamps = [...s.timestamps.filter((t) => now - t < WINDOW_MS), now];
  return true;
}

/** Solo per i test: azzera lo stato del processo. */
export function resetNewsLimiterForTests(): void {
  globalForNews.__newsLimiter = { lastAt: 0, timestamps: [] };
}
