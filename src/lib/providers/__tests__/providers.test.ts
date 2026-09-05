/**
 * Test delle fondamenta dei collector (Sprint 3A).
 * Eseguire con: npm run test:providers
 *
 * Nessuna rete, nessun database, nessuna attesa reale: il tempo è
 * iniettato e `sleep` è sostituito. Una suite che dorme è una suite che
 * non verrà eseguita.
 */
import {
  CircuitBreaker,
  RateLimiter,
  computeBackoffMs,
  getCircuitBreaker,
  getRateLimiter,
  parseRetryAfter,
  resetRateLimitState,
} from "../rate-limiter";
import {
  describeRegistry,
  envFlag,
  envInt,
  getProvider,
  listEnabledProviders,
  listProviders,
  perBookmakerOddsUnavailable,
  providersWith,
  registerProvider,
  resetRegistry,
} from "../registry";
import { runProviderCall, gapReasonFor, checkProviderHealth } from "../runner";
import {
  describeResult,
  disabledResult,
  fail,
  ok,
  outcomeOf,
  partial,
  unsupported,
  type OddsProvider,
} from "../types";
import { createTheOddsApiProvider } from "../optional/the-odds-api";

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  ✗ ${name}\n      ${msg}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label = ""): void {
  if (actual !== expected) {
    throw new Error(
      `${label ? label + ": " : ""}atteso ${String(expected)}, ottenuto ${String(actual)}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Orologio simulato                                                   */
/* ------------------------------------------------------------------ */

/** Orologio controllato dai test: avanza solo quando glielo diciamo. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    /** sleep che non attende: fa solo avanzare l'orologio */
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

/** Provider finto, pilotabile dai test. */
function makeProvider(
  overrides: Partial<OddsProvider> & { key?: string } = {},
): OddsProvider {
  return {
    key: overrides.key ?? "fake",
    label: overrides.label ?? "Fonte finta",
    enabled: overrides.enabled ?? true,
    capabilities: overrides.capabilities ?? {
      fixtures: true,
      odds: true,
      results: false,
      perBookmakerOdds: false,
    },
    rateLimit: overrides.rateLimit ?? {
      requestsPerMinute: 60,
      minIntervalMs: 0,
    },
    fetchFixtures: overrides.fetchFixtures ?? (async () => ok([], 1)),
    fetchOdds: overrides.fetchOdds ?? (async () => ok([], 1)),
    fetchResults: overrides.fetchResults ?? (async () => ok([], 1)),
    healthCheck:
      overrides.healthCheck ??
      (async () => ({
        reachable: true,
        latencyMs: 1,
        detail: "ok",
        checkedAt: new Date(),
      })),
  };
}

async function main(): Promise<void> {
  console.log("\nFondamenta collector — contratto, registry, rate limiting\n");

  /* ---------------------------------------------------------------- */
  console.log("Contratto ProviderResult");
  /* ---------------------------------------------------------------- */

  await test("esito completo è ok e non parziale", () => {
    const r = ok([1, 2], 120, 500);
    assert(r.ok, "deve essere ok");
    assert(r.ok && !r.partial, "non deve essere parziale");
    assertEqual(outcomeOf(r), "ok");
    assertEqual(r.payloadBytes, 500);
  });

  await test("esito parziale espone cosa manca", () => {
    const r = partial([1], 90, ["quote di 3 partite"], 200);
    assert(r.ok && r.partial, "deve essere parziale");
    assertEqual(outcomeOf(r), "partial");
    if (r.ok && r.partial) {
      assertEqual(r.missing.length, 1);
      assert(describeResult(r).includes("PARZIALE"), "descrizione esplicita");
    }
  });

  await test("esito parziale senza dettagli non resta muto", () => {
    const r = partial([], 10, []);
    assert(r.ok && r.partial && r.missing.length === 1, "deve avere un motivo");
  });

  await test("esito fallito porta categoria e ritentabilità", () => {
    const r = fail<number[]>(
      { kind: "network", message: "timeout", url: "https://x" },
      5000,
      true,
    );
    assert(!r.ok, "deve fallire");
    assertEqual(outcomeOf(r), "error");
    if (!r.ok) {
      assertEqual(r.error.kind, "network");
      assert(r.retryable, "un timeout è ritentabile");
    }
  });

  await test("fonte disattivata non è un errore di rete", () => {
    const r = disabledResult<number[]>("tal-fonte");
    assertEqual(outcomeOf(r), "disabled");
    assert(!r.ok && !r.retryable, "non si ritenta una fonte spenta");
  });

  await test("capacità non offerta è dichiarata, non simulata", () => {
    const r = unsupported<number[]>("be", "i risultati");
    assert(!r.ok && r.error.kind === "unsupported", "kind unsupported");
    assert(!r.ok && !r.retryable, "non ritentabile");
  });

  /* ---------------------------------------------------------------- */
  console.log("\nRate limiter");
  /* ---------------------------------------------------------------- */

  await test("la prima richiesta non attende", async () => {
    const c = fakeClock();
    const rl = new RateLimiter({
      requestsPerMinute: 30,
      minIntervalMs: 2000,
      now: c.now,
      sleep: c.sleep,
    });
    assertEqual(await rl.acquire(), 0);
  });

  await test("rispetta l'intervallo minimo fra due richieste", async () => {
    const c = fakeClock();
    const rl = new RateLimiter({
      requestsPerMinute: 60,
      minIntervalMs: 3000,
      now: c.now,
      sleep: c.sleep,
    });
    await rl.acquire();
    const waited = await rl.acquire();
    assertEqual(waited, 3000, "deve attendere l'intervallo pieno");
  });

  await test("scala l'attesa del tempo già trascorso", async () => {
    const c = fakeClock();
    const rl = new RateLimiter({
      requestsPerMinute: 60,
      minIntervalMs: 3000,
      now: c.now,
      sleep: c.sleep,
    });
    await rl.acquire();
    c.advance(1200);
    assertEqual(await rl.acquire(), 1800, "3000 - 1200");
  });

  await test("non attende se l'intervallo è già passato", async () => {
    const c = fakeClock();
    const rl = new RateLimiter({
      requestsPerMinute: 60,
      minIntervalMs: 1000,
      now: c.now,
      sleep: c.sleep,
    });
    await rl.acquire();
    c.advance(5000);
    assertEqual(await rl.acquire(), 0);
  });

  await test("il tetto al minuto blocca la richiesta in eccesso", async () => {
    const c = fakeClock();
    const rl = new RateLimiter({
      requestsPerMinute: 3,
      minIntervalMs: 0,
      now: c.now,
      sleep: c.sleep,
    });
    await rl.acquire();
    c.advance(1000);
    await rl.acquire();
    c.advance(1000);
    await rl.acquire();
    /* la quarta deve attendere che la prima esca dalla finestra di 60s */
    const waited = await rl.acquire();
    assertEqual(waited, 58_000, "60s meno i 2s già trascorsi");
    /* attesa fino a t=60000: la richiesta fatta a t=0 esce dalla finestra
       proprio in quell'istante, quindi ne restano 3 nei 60s correnti */
    assertEqual(rl.usedInWindow(), 3);
  });

  await test("la finestra scorre: dopo 60s il credito si libera", async () => {
    const c = fakeClock();
    const rl = new RateLimiter({
      requestsPerMinute: 2,
      minIntervalMs: 0,
      now: c.now,
      sleep: c.sleep,
    });
    await rl.acquire();
    await rl.acquire();
    c.advance(61_000);
    assertEqual(await rl.acquire(), 0, "finestra svuotata");
    assertEqual(rl.usedInWindow(), 1);
  });

  await test("richieste concorrenti si accodano invece di sovrapporsi", async () => {
    const c = fakeClock();
    const rl = new RateLimiter({
      requestsPerMinute: 60,
      minIntervalMs: 1000,
      now: c.now,
      sleep: c.sleep,
    });
    const waits = await Promise.all([rl.acquire(), rl.acquire(), rl.acquire()]);
    assertEqual(waits[0], 0, "la prima parte subito");
    assertEqual(waits[1], 1000, "la seconda attende un intervallo");
    assertEqual(waits[2], 1000, "anche la terza");
  });

  await test("configurazione non valida viene rifiutata subito", () => {
    let threw = false;
    try {
      new RateLimiter({ requestsPerMinute: 0, minIntervalMs: 100 });
    } catch {
      threw = true;
    }
    assert(threw, "requestsPerMinute 0 deve fallire");
  });

  /* ---------------------------------------------------------------- */
  console.log("\nBackoff");
  /* ---------------------------------------------------------------- */

  await test("il backoff cresce in modo esponenziale", () => {
    const opts = { jitterRatio: 0, baseMs: 1000, factor: 2 };
    assertEqual(computeBackoffMs(1, opts), 1000);
    assertEqual(computeBackoffMs(2, opts), 2000);
    assertEqual(computeBackoffMs(3, opts), 4000);
    assertEqual(computeBackoffMs(4, opts), 8000);
  });

  await test("il backoff è limitato dal tetto massimo", () => {
    const v = computeBackoffMs(20, { jitterRatio: 0, baseMs: 1000, maxMs: 30_000 });
    assertEqual(v, 30_000);
  });

  await test("il jitter resta nella banda dichiarata", () => {
    const low = computeBackoffMs(1, { baseMs: 1000, jitterRatio: 0.2, random: () => 0 });
    const high = computeBackoffMs(1, { baseMs: 1000, jitterRatio: 0.2, random: () => 1 });
    assertEqual(low, 800, "estremo inferiore");
    assertEqual(high, 1200, "estremo superiore");
  });

  await test("il backoff non è mai negativo", () => {
    const v = computeBackoffMs(1, { baseMs: 10, jitterRatio: 5, random: () => 0 });
    assert(v >= 0, "mai negativo");
  });

  await test("Retry-After in secondi viene rispettato", () => {
    assertEqual(parseRetryAfter("120"), 120_000);
  });

  await test("Retry-After come data viene convertito", () => {
    const now = new Date("2026-08-18T10:00:00Z");
    const v = parseRetryAfter("Tue, 18 Aug 2026 10:00:30 GMT", now);
    assertEqual(v, 30_000);
  });

  await test("Retry-After assente o illeggibile restituisce null", () => {
    assertEqual(parseRetryAfter(null), null);
    assertEqual(parseRetryAfter("   "), null);
    assertEqual(parseRetryAfter("presto"), null);
  });

  /* ---------------------------------------------------------------- */
  console.log("\nCircuit breaker");
  /* ---------------------------------------------------------------- */

  await test("il circuito parte chiuso", () => {
    const cb = new CircuitBreaker();
    assertEqual(cb.state(), "closed");
    assert(cb.canRequest(), "si può chiamare");
  });

  await test("si apre dopo la soglia di errori consecutivi", () => {
    const c = fakeClock();
    const cb = new CircuitBreaker({ threshold: 3, cooldownMs: 60_000, now: c.now });
    cb.recordError();
    cb.recordError();
    assertEqual(cb.state(), "closed", "due errori non bastano");
    cb.recordError();
    assertEqual(cb.state(), "open", "il terzo apre il circuito");
    assert(!cb.canRequest(), "in riposo non si chiama");
  });

  await test("la soglia è allineata a BLOCKED_AFTER_CONSECUTIVE_ERRORS", () => {
    assertEqual(new CircuitBreaker().threshold, 3);
  });

  await test("un successo azzera il conteggio", () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordError();
    cb.recordError();
    cb.recordSuccess();
    assertEqual(cb.errorCount(), 0);
    cb.recordError();
    assertEqual(cb.state(), "closed", "il conteggio è ripartito");
  });

  await test("dopo il riposo passa a half_open e riprova", () => {
    const c = fakeClock();
    const cb = new CircuitBreaker({ threshold: 1, cooldownMs: 30_000, now: c.now });
    cb.recordError();
    assertEqual(cb.state(), "open");
    assertEqual(cb.retryInMs(), 30_000);
    c.advance(30_000);
    assertEqual(cb.state(), "half_open");
    assert(cb.canRequest(), "un tentativo di prova è concesso");
  });

  await test("un errore in half_open fa ripartire il riposo", () => {
    const c = fakeClock();
    const cb = new CircuitBreaker({ threshold: 1, cooldownMs: 10_000, now: c.now });
    cb.recordError();
    c.advance(10_000);
    assertEqual(cb.state(), "half_open");
    cb.recordError();
    assertEqual(cb.state(), "open", "richiuso in riposo");
    assertEqual(cb.retryInMs(), 10_000);
  });

  await test("un successo in half_open richiude il circuito", () => {
    const c = fakeClock();
    const cb = new CircuitBreaker({ threshold: 1, cooldownMs: 10_000, now: c.now });
    cb.recordError();
    c.advance(10_000);
    cb.recordSuccess();
    assertEqual(cb.state(), "closed");
    assertEqual(cb.retryInMs(), 0);
  });

  /* ---------------------------------------------------------------- */
  console.log("\nRegistry");
  /* ---------------------------------------------------------------- */

  await test("registrare e ritrovare una fonte", () => {
    resetRegistry();
    registerProvider(makeProvider({ key: "alfa" }));
    assertEqual(listProviders().length, 1);
    assert(getProvider("alfa") !== null, "trovata per chiave");
    assertEqual(getProvider("inesistente"), null);
  });

  await test("una chiave duplicata è un errore immediato", () => {
    resetRegistry();
    registerProvider(makeProvider({ key: "alfa" }));
    let threw = false;
    try {
      registerProvider(makeProvider({ key: "alfa" }));
    } catch {
      threw = true;
    }
    assert(threw, "deve rifiutare il duplicato");
  });

  await test("le fonti spente non compaiono fra le attive", () => {
    resetRegistry();
    registerProvider(makeProvider({ key: "accesa", enabled: true }));
    registerProvider(makeProvider({ key: "spenta", enabled: false }));
    assertEqual(listProviders().length, 2, "dichiarate");
    assertEqual(listEnabledProviders().length, 1, "attive");
    assertEqual(listEnabledProviders()[0].key, "accesa");
  });

  await test("si selezionano le fonti per capacità", () => {
    resetRegistry();
    registerProvider(
      makeProvider({
        key: "solo-quote",
        capabilities: { fixtures: false, odds: true, results: false, perBookmakerOdds: false },
      }),
    );
    registerProvider(
      makeProvider({
        key: "solo-risultati",
        capabilities: { fixtures: false, odds: false, results: true, perBookmakerOdds: false },
      }),
    );
    assertEqual(providersWith("odds").length, 1);
    assertEqual(providersWith("odds")[0].key, "solo-quote");
    assertEqual(providersWith("results")[0].key, "solo-risultati");
    assertEqual(providersWith("fixtures").length, 0);
  });

  await test("assenza di quote per-bookmaker è rilevata e dichiarabile", () => {
    resetRegistry();
    assert(perBookmakerOddsUnavailable(), "senza fonti non è calcolabile");
    registerProvider(
      makeProvider({
        key: "consenso",
        capabilities: { fixtures: true, odds: true, results: false, perBookmakerOdds: false },
      }),
    );
    assert(
      perBookmakerOddsUnavailable(),
      "una fonte di solo consenso non abilita coordinazione e sharp",
    );
    registerProvider(
      makeProvider({
        key: "per-book",
        capabilities: { fixtures: true, odds: true, results: false, perBookmakerOdds: true },
      }),
    );
    assert(!perBookmakerOddsUnavailable(), "ora è calcolabile");
  });

  await test("la diagnostica spiega perché una fonte è ferma", () => {
    resetRegistry();
    registerProvider(makeProvider({ key: "spenta", enabled: false }));
    registerProvider(
      makeProvider({
        key: "consenso",
        enabled: true,
        capabilities: { fixtures: true, odds: true, results: false, perBookmakerOdds: false },
      }),
    );
    const d = describeRegistry();
    const spenta = d.find((x) => x.key === "spenta");
    const consenso = d.find((x) => x.key === "consenso");
    assert(spenta!.note.includes("Disattivata"), "motivo dichiarato");
    assert(
      consenso!.note.includes("non sono calcolabili"),
      "il limite del consenso è dichiarato",
    );
  });

  await test("le variabili d'ambiente sono lette in modo esplicito", () => {
    delete process.env.TEST_FLAG_X;
    assertEqual(envFlag("TEST_FLAG_X", false), false);
    process.env.TEST_FLAG_X = "true";
    assertEqual(envFlag("TEST_FLAG_X"), true);
    process.env.TEST_FLAG_X = "1";
    assertEqual(envFlag("TEST_FLAG_X"), true);
    process.env.TEST_FLAG_X = "no";
    assertEqual(envFlag("TEST_FLAG_X"), false);
    delete process.env.TEST_FLAG_X;

    delete process.env.TEST_INT_X;
    assertEqual(envInt("TEST_INT_X", 90), 90);
    process.env.TEST_INT_X = "120";
    assertEqual(envInt("TEST_INT_X", 90), 120);
    process.env.TEST_INT_X = "-5";
    assertEqual(envInt("TEST_INT_X", 90), 90, "valore assurdo ignorato");
    delete process.env.TEST_INT_X;
  });

  /* ---------------------------------------------------------------- */
  console.log("\nthe-odds-api: opzionale e spenta");
  /* ---------------------------------------------------------------- */

  await test("è disattivata senza variabili d'ambiente", () => {
    delete process.env.ODDS_API_ENABLED;
    delete process.env.ODDS_API_KEY;
    assertEqual(createTheOddsApiProvider().enabled, false);
  });

  await test("resta spenta con il flag ma senza chiave", () => {
    process.env.ODDS_API_ENABLED = "true";
    delete process.env.ODDS_API_KEY;
    assertEqual(
      createTheOddsApiProvider().enabled,
      false,
      "senza chiave non si accende",
    );
    delete process.env.ODDS_API_ENABLED;
  });

  await test("spenta, ogni metodo risponde 'disabled' senza toccare la rete", async () => {
    delete process.env.ODDS_API_ENABLED;
    delete process.env.ODDS_API_KEY;
    const p = createTheOddsApiProvider();
    const r = await p.fetchOdds({
      key: "x",
      providerMatchId: null,
      sourceUrl: null,
      kickoffAt: new Date(),
    });
    assertEqual(outcomeOf(r), "disabled");
    const h = await p.healthCheck();
    assertEqual(h.reachable, false);
    assert(h.detail.includes("ODDS_API_ENABLED"), "spiega come si accende");
  });

  /* ---------------------------------------------------------------- */
  console.log("\nRunner sorvegliato (senza DB)");
  /* ---------------------------------------------------------------- */

  await test("una fonte spenta non viene chiamata", async () => {
    resetRateLimitState();
    let called = false;
    const p = makeProvider({ key: "off", enabled: false });
    const { result, stats } = await runProviderCall(
      p,
      "fetchOdds",
      async () => {
        called = true;
        return ok([], 1);
      },
      { persist: false },
    );
    assert(!called, "non deve chiamare");
    assertEqual(stats.outcome, "disabled");
    assertEqual(stats.attempts, 0);
    assert(!result.ok, "esito fallito dichiarato");
  });

  await test("un esito completo non genera ritentativi", async () => {
    resetRateLimitState();
    let calls = 0;
    const p = makeProvider({ key: "ok-src" });
    const { stats } = await runProviderCall(
      p,
      "fetchFixtures",
      async () => {
        calls += 1;
        return ok([1], 50, 1234);
      },
      { persist: false },
    );
    assertEqual(calls, 1);
    assertEqual(stats.attempts, 1);
    assertEqual(stats.outcome, "ok");
    assertEqual(stats.payloadBytes, 1234, "la dimensione finisce nelle statistiche");
  });

  await test("un errore ritentabile viene riprovato una volta", async () => {
    resetRateLimitState();
    const c = fakeClock();
    let calls = 0;
    const p = makeProvider({ key: "flaky" });
    const { result, stats } = await runProviderCall(
      p,
      "fetchOdds",
      async () => {
        calls += 1;
        if (calls === 1) {
          return fail<number[]>({ kind: "network", message: "timeout" }, 5000, true);
        }
        return ok([1], 40);
      },
      { persist: false, sleep: c.sleep, maxAttempts: 2 },
    );
    assertEqual(calls, 2, "ha riprovato");
    assertEqual(stats.attempts, 2);
    assert(result.ok, "il secondo tentativo è riuscito");
    assert(stats.waitedMs > 0, "il backoff è stato applicato e misurato");
  });

  await test("un errore non ritentabile non viene riprovato", async () => {
    resetRateLimitState();
    let calls = 0;
    const p = makeProvider({ key: "hard-fail" });
    await runProviderCall(
      p,
      "fetchOdds",
      async () => {
        calls += 1;
        return fail<number[]>({ kind: "parse", message: "HTML cambiato" }, 10, false);
      },
      { persist: false, maxAttempts: 3 },
    );
    assertEqual(calls, 1, "un parse rotto non si risolve riprovando");
  });

  await test("un'eccezione dell'adapter non propaga e diventa esito fallito", async () => {
    resetRateLimitState();
    const p = makeProvider({ key: "boom" });
    const { result, stats } = await runProviderCall(
      p,
      "fetchOdds",
      async () => {
        throw new Error("selettore mancante");
      },
      { persist: false, maxAttempts: 1 },
    );
    assert(!result.ok, "convertita in fallimento");
    if (!result.ok) {
      assertEqual(result.error.kind, "parse");
      assert(result.error.message.includes("selettore mancante"), "messaggio conservato");
    }
    assertEqual(stats.outcome, "error");
  });

  await test("il circuito aperto impedisce la chiamata", async () => {
    resetRateLimitState();
    const c = fakeClock();
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 60_000, now: c.now });
    breaker.recordError();
    let called = false;
    const p = makeProvider({ key: "riposo" });
    const { stats } = await runProviderCall(
      p,
      "fetchOdds",
      async () => {
        called = true;
        return ok([], 1);
      },
      { persist: false, breaker },
    );
    assert(!called, "non si contatta una fonte in riposo");
    assertEqual(stats.outcome, "skipped_circuit_open");
  });

  await test("l'esito parziale è propagato come parziale", async () => {
    resetRateLimitState();
    const p = makeProvider({ key: "meta" });
    const { stats } = await runProviderCall(
      p,
      "fetchFixtures",
      async () => partial([1], 30, ["orario di 2 partite"]),
      { persist: false },
    );
    assertEqual(stats.outcome, "partial");
    assert(stats.detail.includes("PARZIALE"), "resta visibile");
  });

  await test("un parziale atteso resta visibile senza degradare la fonte", async () => {
    resetRateLimitState();
    const p = makeProvider({ key: "budget-atteso" });
    const { result, stats } = await runProviderCall(
      p,
      "fetchFixtures",
      async () => partial([1], 30, ["tetto dichiarato"]),
      { persist: false, expectedPartial: () => true },
    );
    assert(result.ok && result.partial, "il dato resta parziale nel report");
    assertEqual(stats.outcome, "ok", "source_health non va degradata");
    assert(stats.detail.includes("omissioni"), "la neutralizzazione è dichiarata");
  });

  await test("il rate limiter è condiviso per chiave di fonte", () => {
    resetRateLimitState();
    const a = getRateLimiter("stessa", { requestsPerMinute: 10, minIntervalMs: 100 });
    const b = getRateLimiter("stessa", { requestsPerMinute: 99, minIntervalMs: 999 });
    assert(a === b, "due job non possono avere due quote separate");
    assertEqual(b.minIntervalMs, 100, "vince la prima configurazione");
    const cb1 = getCircuitBreaker("stessa");
    const cb2 = getCircuitBreaker("stessa");
    assert(cb1 === cb2, "anche l'interruttore è condiviso");
  });

  await test("le categorie di errore si traducono nel motivo del buco dati", () => {
    assertEqual(gapReasonFor("parse"), "parse_error");
    assertEqual(gapReasonFor("rate_limited"), "rate_limited");
    assertEqual(gapReasonFor("blocked"), "rate_limited");
    assertEqual(gapReasonFor("network"), "provider_unavailable");
    assertEqual(gapReasonFor("http"), "provider_unavailable");
    assertEqual(gapReasonFor("unsupported"), "provider_unavailable");
  });

  await test("healthCheck che lancia non fa cadere la diagnostica", async () => {
    const p = makeProvider({
      key: "salute-rotta",
      healthCheck: async () => {
        throw new Error("DNS non risolve");
      },
    });
    const h = await checkProviderHealth(p, { persist: false });
    assertEqual(h.reachable, false);
    assert(h.detail.includes("DNS non risolve"), "motivo conservato");
  });

  await test("healthCheck di una fonte spenta non tenta la rete", async () => {
    let called = false;
    const p = makeProvider({
      key: "off2",
      enabled: false,
      healthCheck: async () => {
        called = true;
        return { reachable: true, latencyMs: 0, detail: "", checkedAt: new Date() };
      },
    });
    const h = await checkProviderHealth(p, { persist: false });
    assert(!called, "non deve chiamare");
    assert(h.detail.includes("disattivata"), "stato dichiarato");
  });

  /* ---------------------------------------------------------------- */

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Test superati: ${passed} | falliti: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFallimenti:");
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log(`${"─".repeat(60)}\n`);

  if (failed > 0) process.exit(1);
}

void main();
