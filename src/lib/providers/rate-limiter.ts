/**
 * Rate limiting e backoff (Sprint 3A).
 *
 * Obiettivo dichiarato: il server non deve martellare le fonti.
 *
 * Tre meccanismi indipendenti, tutti in-process e senza dipendenze:
 *
 * 1. `RateLimiter` — intervallo minimo fra richieste + tetto al minuto,
 *    per chiave di fonte. Serializza le attese: due chiamate concorrenti
 *    alla stessa fonte si accodano invece di partire insieme.
 *
 * 2. `computeBackoffMs` — attesa crescente dopo un errore, con jitter per
 *    non risincronizzare i tentativi.
 *
 * 3. `CircuitBreaker` — dopo N errori consecutivi smette di provare per un
 *    periodo di riposo. Coerente con `BLOCKED_AFTER_CONSECUTIVE_ERRORS`
 *    di `runs.ts`: una fonte bloccata non viene ricontattata subito.
 *
 * Nota sul tempo: tutte le funzioni accettano un `now` iniettabile e un
 * `sleep` sostituibile, così i test verificano il comportamento senza
 * attese reali. Nessun test deve dormire davvero.
 */

/* ------------------------------------------------------------------ */
/* Utilità di tempo                                                    */
/* ------------------------------------------------------------------ */

export type SleepFn = (ms: number) => Promise<void>;
export type NowFn = () => number;

/** Attesa reale, usata in produzione. */
export const realSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/* ------------------------------------------------------------------ */
/* Rate limiter                                                        */
/* ------------------------------------------------------------------ */

export interface RateLimiterOptions {
  requestsPerMinute: number;
  minIntervalMs: number;
  now?: NowFn;
  sleep?: SleepFn;
}

/**
 * Limitatore per singola fonte.
 *
 * `acquire()` restituisce quanti millisecondi ha atteso: il valore finisce
 * nei meta di `collector_runs`, così l'attesa è misurabile e non un
 * dettaglio invisibile.
 */
export class RateLimiter {
  readonly requestsPerMinute: number;
  readonly minIntervalMs: number;
  private readonly now: NowFn;
  private readonly sleep: SleepFn;
  /** istanti delle richieste concesse nell'ultimo minuto */
  private recent: number[] = [];
  private lastRequestAt: number | null = null;
  /** catena di attese: garantisce l'ordine FIFO fra chiamate concorrenti */
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions) {
    if (options.requestsPerMinute <= 0) {
      throw new Error("requestsPerMinute deve essere positivo");
    }
    if (options.minIntervalMs < 0) {
      throw new Error("minIntervalMs non può essere negativo");
    }
    this.requestsPerMinute = options.requestsPerMinute;
    this.minIntervalMs = options.minIntervalMs;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? realSleep;
  }

  /** Calcola l'attesa necessaria adesso, senza consumare il permesso. */
  computeWaitMs(): number {
    const t = this.now();
    this.prune(t);

    const sinceLast =
      this.lastRequestAt === null ? Number.POSITIVE_INFINITY : t - this.lastRequestAt;
    const intervalWait =
      sinceLast >= this.minIntervalMs ? 0 : this.minIntervalMs - sinceLast;

    let quotaWait = 0;
    if (this.recent.length >= this.requestsPerMinute) {
      /* la richiesta più vecchia della finestra deve uscire dai 60s */
      const oldest = this.recent[0];
      quotaWait = Math.max(0, oldest + 60_000 - t);
    }

    return Math.max(intervalWait, quotaWait);
  }

  /**
   * Attende il proprio turno e consuma un permesso.
   * Restituisce i millisecondi effettivamente attesi.
   */
  async acquire(): Promise<number> {
    let waited = 0;
    /* accodamento: ogni chiamata attende la precedente, così l'intervallo
       minimo vale anche fra richieste partite nello stesso istante */
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      await previous;
      /* può servire più di un giro: dopo l'attesa la finestra è cambiata */
      for (;;) {
        const wait = this.computeWaitMs();
        if (wait <= 0) break;
        await this.sleep(wait);
        waited += wait;
      }
      const t = this.now();
      this.recent.push(t);
      this.lastRequestAt = t;
      return waited;
    } finally {
      release();
    }
  }

  /** Numero di richieste concesse negli ultimi 60 secondi. */
  usedInWindow(): number {
    this.prune(this.now());
    return this.recent.length;
  }

  /** Scarta dalla finestra le richieste più vecchie di 60 secondi. */
  private prune(t: number): void {
    const cutoff = t - 60_000;
    if (this.recent.length > 0 && this.recent[0] <= cutoff) {
      this.recent = this.recent.filter((ts) => ts > cutoff);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Backoff                                                             */
/* ------------------------------------------------------------------ */

export interface BackoffOptions {
  baseMs?: number;
  factor?: number;
  maxMs?: number;
  /** ampiezza del jitter, 0–1. 0.2 = ±20% */
  jitterRatio?: number;
  /** sorgente casuale iniettabile, per test deterministici */
  random?: () => number;
}

export const DEFAULT_BACKOFF: Required<Omit<BackoffOptions, "random">> = {
  baseMs: 2_000,
  factor: 2,
  maxMs: 60_000,
  jitterRatio: 0.2,
};

/**
 * Attesa dopo l'ennesimo errore consecutivo.
 * `attempt` parte da 1. Crescita esponenziale limitata da `maxMs`,
 * con jitter per evitare che più fonti ripartano nello stesso istante.
 */
export function computeBackoffMs(
  attempt: number,
  options: BackoffOptions = {},
): number {
  const base = options.baseMs ?? DEFAULT_BACKOFF.baseMs;
  const factor = options.factor ?? DEFAULT_BACKOFF.factor;
  const max = options.maxMs ?? DEFAULT_BACKOFF.maxMs;
  const jitterRatio = options.jitterRatio ?? DEFAULT_BACKOFF.jitterRatio;
  const random = options.random ?? Math.random;

  const safeAttempt = Math.max(1, Math.floor(attempt));
  const raw = base * Math.pow(factor, safeAttempt - 1);
  const capped = Math.min(raw, max);

  if (jitterRatio <= 0) return Math.round(capped);

  /* jitter simmetrico: [-ratio, +ratio] */
  const delta = capped * jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(capped + delta));
}

/**
 * Rispetta l'header `Retry-After` quando la fonte lo dichiara.
 * Accetta sia i secondi sia la data HTTP. Restituisce `null` se il valore
 * è assente o illeggibile: in quel caso si usa il backoff calcolato.
 */
export function parseRetryAfter(
  headerValue: string | null,
  now: Date = new Date(),
): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (trimmed === "") return null;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  return Math.max(0, asDate - now.getTime());
}

/* ------------------------------------------------------------------ */
/* Circuit breaker                                                     */
/* ------------------------------------------------------------------ */

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** errori consecutivi oltre i quali il circuito si apre */
  threshold?: number;
  /** durata del riposo prima di riprovare */
  cooldownMs?: number;
  now?: NowFn;
}

/**
 * Interruttore per fonte.
 *
 * `closed` = si può chiamare. `open` = riposo, non si chiama.
 * `half_open` = riposo scaduto, si concede UN tentativo di prova:
 * se riesce il circuito si richiude, se fallisce riparte il riposo.
 *
 * La soglia predefinita è 3, allineata a
 * `BLOCKED_AFTER_CONSECUTIVE_ERRORS` in `src/lib/pipeline/runs.ts`.
 */
export class CircuitBreaker {
  readonly threshold: number;
  readonly cooldownMs: number;
  private readonly now: NowFn;
  private consecutiveErrors = 0;
  private openedAt: number | null = null;

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 5 * 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  state(): CircuitState {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.cooldownMs ? "half_open" : "open";
  }

  /** true se è lecito tentare una chiamata adesso. */
  canRequest(): boolean {
    return this.state() !== "open";
  }

  /** Millisecondi mancanti alla fine del riposo, 0 se non in riposo. */
  retryInMs(): number {
    if (this.openedAt === null) return 0;
    return Math.max(0, this.openedAt + this.cooldownMs - this.now());
  }

  recordSuccess(): void {
    this.consecutiveErrors = 0;
    this.openedAt = null;
  }

  recordError(): void {
    this.consecutiveErrors += 1;
    if (this.consecutiveErrors >= this.threshold) {
      /* in half_open un nuovo errore fa ripartire il riposo da adesso */
      this.openedAt = this.now();
    }
  }

  errorCount(): number {
    return this.consecutiveErrors;
  }
}

/* ------------------------------------------------------------------ */
/* Registro dei limitatori                                             */
/* ------------------------------------------------------------------ */

/**
 * Un limitatore e un interruttore per ogni fonte, condivisi nel processo.
 * Due job che girano insieme devono rispettare lo STESSO limite, non uno
 * ciascuno: per questo lo stato è per chiave, non per chiamante.
 */
const limiters = new Map<string, RateLimiter>();
const breakers = new Map<string, CircuitBreaker>();

export function getRateLimiter(
  key: string,
  config: { requestsPerMinute: number; minIntervalMs: number },
): RateLimiter {
  const existing = limiters.get(key);
  if (existing) return existing;
  const created = new RateLimiter(config);
  limiters.set(key, created);
  return created;
}

export function getCircuitBreaker(
  key: string,
  options: CircuitBreakerOptions = {},
): CircuitBreaker {
  const existing = breakers.get(key);
  if (existing) return existing;
  const created = new CircuitBreaker(options);
  breakers.set(key, created);
  return created;
}

/** Azzera lo stato condiviso. Usato dai test per partire puliti. */
export function resetRateLimitState(): void {
  limiters.clear();
  breakers.clear();
}
