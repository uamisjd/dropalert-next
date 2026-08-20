/**
 * Esecuzione sorvegliata delle chiamate alle fonti (Sprint 3A).
 *
 * Ogni chiamata a una fonte passa da qui, e ogni passaggio lascia traccia:
 *
 *   rate limiter → circuit breaker → chiamata → source_health → data_gaps
 *
 * Garanzie:
 * - nessuna chiamata parte senza aver rispettato l'intervallo minimo;
 * - una fonte in riposo non viene contattata (circuito aperto);
 * - ogni esito, anche il fallimento, aggiorna `source_health`;
 * - un esito parziale o fallito apre un `data_gaps` esplicito;
 * - un'eccezione imprevista viene catturata e convertita in esito fallito,
 *   perché un adapter che lancia non deve poter fermare il job.
 *
 * Quello che qui NON si fa: dedurre valori, riempire buchi, ritentare
 * all'infinito. Il numero di tentativi è limitato e dichiarato.
 */
import { recordGap } from "@/lib/pipeline/detect";
import { recordSourcePing } from "@/lib/pipeline/runs";
import {
  CircuitBreaker,
  computeBackoffMs,
  getCircuitBreaker,
  getRateLimiter,
  realSleep,
  type SleepFn,
} from "./rate-limiter";
import {
  describeResult,
  fail,
  outcomeOf,
  type OddsProvider,
  type ProviderErrorKind,
  type ProviderResult,
} from "./types";

/* ------------------------------------------------------------------ */
/* Statistiche di chiamata                                             */
/* ------------------------------------------------------------------ */

/** Misure di una singola operazione, destinate a `collector_runs.meta`. */
export interface CallStats {
  providerKey: string;
  operation: string;
  attempts: number;
  /** millisecondi passati ad aspettare il rate limiter */
  waitedMs: number;
  /** millisecondi della sola chiamata andata a buon fine (o dell'ultima) */
  latencyMs: number;
  payloadBytes: number;
  outcome: "ok" | "partial" | "error" | "disabled" | "skipped_circuit_open";
  detail: string;
}

export interface RunProviderCallOptions {
  /** tentativi totali, incluso il primo. Default 2: si riprova una volta. */
  maxAttempts?: number;
  /** partita a cui legare un eventuale buco dati */
  matchId?: number | null;
  /** sostituibile nei test per non dormire davvero */
  sleep?: SleepFn;
  /** interruttore condiviso; se omesso si usa quello globale della fonte */
  breaker?: CircuitBreaker;
  /** false per non scrivere su DB (test di unità) */
  persist?: boolean;
}

export interface SupervisedResult<T> {
  result: ProviderResult<T>;
  stats: CallStats;
}

/* ------------------------------------------------------------------ */
/* Esecuzione                                                          */
/* ------------------------------------------------------------------ */

/**
 * Esegue un'operazione di una fonte rispettando limiti, backoff e
 * interruttore, e registrando l'esito nell'osservabilità.
 *
 * `operation` è un'etichetta leggibile ("fetchFixtures", "fetchOdds"):
 * finisce nei log, nei gap e nei meta del run.
 */
export async function runProviderCall<T>(
  provider: OddsProvider,
  operation: string,
  call: () => Promise<ProviderResult<T>>,
  options: RunProviderCallOptions = {},
): Promise<SupervisedResult<T>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const sleep = options.sleep ?? realSleep;
  const persist = options.persist ?? true;
  const matchId = options.matchId ?? null;

  const breaker =
    options.breaker ?? getCircuitBreaker(provider.key, { threshold: 3 });

  /* --- fonte spenta: nessuna chiamata, stato dichiarato ------------- */
  if (!provider.enabled) {
    const result = fail<T>(
      {
        kind: "disabled",
        message: `La fonte "${provider.key}" è disattivata da configurazione.`,
      },
      0,
      false,
    );
    const stats: CallStats = {
      providerKey: provider.key,
      operation,
      attempts: 0,
      waitedMs: 0,
      latencyMs: 0,
      payloadBytes: 0,
      outcome: "disabled",
      detail: "fonte disattivata",
    };
    if (persist) {
      await recordSourcePing({
        sourceKey: provider.key,
        label: provider.label,
        outcome: "disabled",
      });
    }
    return { result, stats };
  }

  /* --- circuito aperto: si rispetta il riposo ----------------------- */
  if (!breaker.canRequest()) {
    const retryIn = breaker.retryInMs();
    const message = `Circuito aperto per "${provider.key}": nuovo tentativo fra ${Math.ceil(retryIn / 1000)}s.`;
    const result = fail<T>(
      { kind: "rate_limited", message },
      0,
      true,
    );
    const stats: CallStats = {
      providerKey: provider.key,
      operation,
      attempts: 0,
      waitedMs: 0,
      latencyMs: 0,
      payloadBytes: 0,
      outcome: "skipped_circuit_open",
      detail: message,
    };
    if (persist) {
      await recordSourcePing({
        sourceKey: provider.key,
        label: provider.label,
        outcome: "error",
        errorMessage: message,
        rateLimited: true,
      });
      await recordGap({
        matchId,
        reason: "rate_limited",
        detail: `${provider.label} — ${operation}: ${message}`,
      });
    }
    return { result, stats };
  }

  const limiter = getRateLimiter(provider.key, provider.rateLimit);

  let waitedMs = 0;
  let attempts = 0;
  let last: ProviderResult<T> | null = null;

  while (attempts < maxAttempts) {
    attempts += 1;
    waitedMs += await limiter.acquire();

    let current: ProviderResult<T>;
    try {
      current = await call();
    } catch (err) {
      /* un adapter non deve poter far cadere il job */
      current = fail<T>(
        {
          kind: "parse",
          message: `Eccezione non gestita nell'adapter: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        0,
        false,
      );
    }
    last = current;

    if (current.ok) {
      breaker.recordSuccess();
      break;
    }

    breaker.recordError();

    const canRetry = current.retryable && attempts < maxAttempts;
    if (!canRetry) break;

    const backoff = computeBackoffMs(attempts);
    await sleep(backoff);
    waitedMs += backoff;
  }

  /* `last` è sempre valorizzato: il ciclo gira almeno una volta */
  const result = last as ProviderResult<T>;
  const outcome = outcomeOf(result);
  const detail = describeResult(result);

  const stats: CallStats = {
    providerKey: provider.key,
    operation,
    attempts,
    waitedMs,
    latencyMs: result.latencyMs,
    payloadBytes: result.payloadBytes,
    outcome,
    detail,
  };

  if (persist) {
    await recordSourcePing({
      sourceKey: provider.key,
      label: provider.label,
      outcome,
      latencyMs: result.latencyMs,
      errorMessage: result.ok ? undefined : result.error.message,
      /* 429 e blocchi sono limiti della fonte: datati a parte, non
         confusi con i dati che non siamo riusciti a leggere noi */
      rateLimited:
        !result.ok &&
        (result.error.kind === "rate_limited" ||
          result.error.kind === "blocked"),
    });

    /* Un buco dichiarato vale più di un numero inventato. */
    if (!result.ok) {
      await recordGap({
        matchId,
        reason: gapReasonFor(result.error.kind),
        detail: `${provider.label} — ${operation}: ${result.error.message}`,
      });
    } else if (result.partial) {
      await recordGap({
        matchId,
        reason: "provider_unavailable",
        detail: `${provider.label} — ${operation}: dati parziali. Mancano: ${result.missing.join("; ")}`,
      });
    }
  }

  return { result, stats };
}

/** Traduce la categoria di errore nel motivo di `data_gaps`. */
export function gapReasonFor(
  kind: ProviderErrorKind,
): "provider_unavailable" | "parse_error" | "rate_limited" {
  switch (kind) {
    case "parse":
      return "parse_error";
    case "rate_limited":
    case "blocked":
      return "rate_limited";
    default:
      return "provider_unavailable";
  }
}

/* ------------------------------------------------------------------ */
/* Controllo di salute                                                 */
/* ------------------------------------------------------------------ */

/**
 * Esegue `healthCheck()` su una fonte e ne registra l'esito.
 * Usato all'avvio e dalla diagnostica: popola `source_health` anche prima
 * che sia stata raccolta una sola quota.
 */
export async function checkProviderHealth(
  provider: OddsProvider,
  options: { persist?: boolean } = {},
): Promise<{ key: string; reachable: boolean; latencyMs: number; detail: string }> {
  const persist = options.persist ?? true;

  if (!provider.enabled) {
    if (persist) {
      await recordSourcePing({
        sourceKey: provider.key,
        label: provider.label,
        outcome: "disabled",
      });
    }
    return {
      key: provider.key,
      reachable: false,
      latencyMs: 0,
      detail: "Fonte disattivata da configurazione.",
    };
  }

  let reachable = false;
  let latencyMs = 0;
  let detail: string;

  try {
    const health = await provider.healthCheck();
    reachable = health.reachable;
    latencyMs = health.latencyMs;
    detail = health.detail;
  } catch (err) {
    detail = `Eccezione durante il controllo: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }

  if (persist) {
    await recordSourcePing({
      sourceKey: provider.key,
      label: provider.label,
      outcome: reachable ? "ok" : "error",
      latencyMs,
      errorMessage: reachable ? undefined : detail,
    });
  }

  return { key: provider.key, reachable, latencyMs, detail };
}
