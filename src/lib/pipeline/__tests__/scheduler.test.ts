/**
 * Test del runner schedulato — parti pure soltanto.
 * Eseguire con: npm run test:scheduler
 *
 * Non accende nessun timer e non scrive in archivio: qui si verificano
 * l'intervallo, il gate e il conto alla rovescia, cioè le decisioni che
 * governano quanto spesso il sistema bussa alla fonte. Il giro vero è
 * coperto dai test di pipeline.
 */
import {
  minutesUntil,
  readSchedulerConfig,
  schedulerHealth,
  shouldRunNow,
  DEFAULT_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  STALE_INTERVAL_MULTIPLIER,
  type LoopState,
} from "../scheduler";
import { schedulerEnabled, FIRST_RUN_DELAY_MS } from "../collect-loop";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${message}`);
    console.log(`  ✗ ${name}\n      ${message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message = ""): void {
  if (actual !== expected) {
    throw new Error(
      `${message} — atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`,
    );
  }
}

/** Esegue con una variabile d'ambiente impostata, e la rimette com'era. */
function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

function main(): void {
  console.log("\n=== Runner schedulato ===\n");

  /* ---------------- intervallo ---------------- */

  console.log("-- Intervallo --\n");

  test("l'intervallo predefinito è quello concordato", () => {
    assertEqual(DEFAULT_INTERVAL_MINUTES, 45);
    assert(
      DEFAULT_INTERVAL_MINUTES >= 45 && DEFAULT_INTERVAL_MINUTES <= 60,
      "il default deve restare nella banda 45-60 minuti",
    );
  });

  test("senza variabile d'ambiente vale il predefinito, e lo dichiara", () => {
    withEnv("COLLECT_INTERVAL_MINUTES", undefined, () => {
      const c = readSchedulerConfig();
      assertEqual(c.intervalMinutes, DEFAULT_INTERVAL_MINUTES);
      assertEqual(c.source, "default");
    });
  });

  test("la variabile d'ambiente vince sul predefinito", () => {
    withEnv("COLLECT_INTERVAL_MINUTES", "60", () => {
      const c = readSchedulerConfig();
      assertEqual(c.intervalMinutes, 60);
      assertEqual(c.source, "env");
    });
  });

  test("un intervallo troppo fitto viene alzato al minimo", () => {
    withEnv("COLLECT_INTERVAL_MINUTES", "1", () => {
      assertEqual(readSchedulerConfig().intervalMinutes, MIN_INTERVAL_MINUTES);
    });
  });

  test("un intervallo assurdo viene ricondotto al massimo", () => {
    withEnv("COLLECT_INTERVAL_MINUTES", "999999", () => {
      assertEqual(readSchedulerConfig().intervalMinutes, MAX_INTERVAL_MINUTES);
    });
  });

  test("un valore illeggibile non spegne lo scheduler: torna al predefinito", () => {
    withEnv("COLLECT_INTERVAL_MINUTES", "presto", () => {
      const c = readSchedulerConfig();
      assertEqual(c.intervalMinutes, DEFAULT_INTERVAL_MINUTES);
      assertEqual(c.source, "default", "il fallback è dichiarato");
    });
  });

  /* ---------------- interruttore ---------------- */

  console.log("\n-- Interruttore --\n");

  test("il runner è spento se non lo si accende esplicitamente", () => {
    assertEqual(schedulerEnabled({}), false);
    assertEqual(schedulerEnabled({ SCHEDULER_ENABLED: "" }), false);
    assertEqual(schedulerEnabled({ SCHEDULER_ENABLED: "false" }), false);
    assertEqual(schedulerEnabled({ SCHEDULER_ENABLED: "1" }), false);
  });

  test("si accende solo con true", () => {
    assertEqual(schedulerEnabled({ SCHEDULER_ENABLED: "true" }), true);
    assertEqual(schedulerEnabled({ SCHEDULER_ENABLED: " TRUE " }), true);
  });

  test("il primo giro non parte nell'istante dell'avvio", () => {
    assert(FIRST_RUN_DELAY_MS > 0, "serve un margine per far salire il server");
    assert(
      FIRST_RUN_DELAY_MS < DEFAULT_INTERVAL_MINUTES * 60_000,
      "il primo giro arriva prima dell'intervallo pieno",
    );
  });

  /* ---------------- gate dell'intervallo ---------------- */

  console.log("\n-- Gate dell'intervallo --\n");

  const t0 = new Date("2026-08-19T10:00:00Z");

  test("primo giro in assoluto: si parte", () => {
    const g = shouldRunNow(null, t0, 45, false);
    assert(g.run, g.reason);
    assertEqual(g.waitedMinutes, null);
  });

  test("il timer che scatta troppo presto non fa passare la raccolta", () => {
    const last = new Date("2026-08-19T09:30:00Z");
    const g = shouldRunNow(last, t0, 45, false);
    assert(!g.run, "30 minuti su 45: la raccolta va saltata");
    assert(g.reason.includes("intervallo minimo"), g.reason);
  });

  test("passato l'intervallo il giro parte", () => {
    const last = new Date("2026-08-19T09:10:00Z");
    const g = shouldRunNow(last, t0, 45, false);
    assert(g.run, g.reason);
    assertEqual(Math.round(g.waitedMinutes!), 50);
  });

  test("un giro manuale appena fatto ferma il giro schedulato", () => {
    /* il gate legge l'ultimo giro chiunque lo abbia chiesto: è così che
       il pulsante e il timer non si sommano sulla fonte */
    const last = new Date("2026-08-19T09:59:00Z");
    assert(!shouldRunNow(last, t0, 45, false).run, "un minuto fa: si salta");
  });

  test("la forzatura ignora l'intervallo, e lo dichiara", () => {
    const last = new Date("2026-08-19T09:59:00Z");
    const g = shouldRunNow(last, t0, 45, true);
    assert(g.run, "forzato");
    assert(g.reason.includes("forzata"), g.reason);
  });

  /* ---------------- conto alla rovescia ---------------- */

  console.log("\n-- Prossimo giro --\n");

  test("senza prossimo giro non si inventa un tempo", () => {
    assertEqual(minutesUntil(null, t0), null);
  });

  test("i minuti mancanti sono arrotondati per eccesso", () => {
    assertEqual(minutesUntil(new Date("2026-08-19T10:12:30Z"), t0), 13);
    assertEqual(minutesUntil(new Date("2026-08-19T10:45:00Z"), t0), 45);
  });

  test("un giro in ritardo vale zero, mai un numero negativo", () => {
    assertEqual(minutesUntil(new Date("2026-08-19T09:50:00Z"), t0), 0);
    assertEqual(minutesUntil(t0, t0), 0);
  });

  /* ---------------- credibilità dello stato ---------------- */

  console.log("\n-- Stato del runner --\n");

  /** riga di stato di comodo, con l'istante di vita che serve al caso */
  const loop = (over: Partial<LoopState> = {}): LoopState => ({
    running: true,
    intervalMinutes: 45,
    startedAt: "2026-08-19T09:30:00Z",
    lastTickAt: "2026-08-19T09:55:00Z",
    nextRunAt: "2026-08-19T10:40:00Z",
    cyclesCompleted: 1,
    lastStatus: "success",
    ...over,
  });

  test("runner spento: nessun conto alla rovescia", () => {
    const v = schedulerHealth(loop({ running: false }), t0);
    assertEqual(v.health, "off");
    assertEqual(v.nextRunMinutes, null);
  });

  test("runner vivo e recente: orario dichiarato", () => {
    const v = schedulerHealth(loop(), t0);
    assertEqual(v.health, "running");
    assertEqual(v.nextRunMinutes, 40);
  });

  test("prima del primo tick vale l'accensione", () => {
    const v = schedulerHealth(loop({ lastTickAt: null }), t0);
    assertEqual(v.health, "running");
    assertEqual(v.nextRunMinutes, 40);
  });

  test("silenzio oltre due intervalli: stato incerto, nessun orario", () => {
    /* ultimo segno di vita alle 08:00, ora 10:00: 120 min > 2×45 */
    const v = schedulerHealth(
      loop({ lastTickAt: "2026-08-19T08:00:00Z" }),
      t0,
    );
    assertEqual(v.health, "uncertain");
    assertEqual(v.nextRunMinutes, null);
    assertEqual(v.silentMinutes, 120);
  });

  test("il processo morto non resta 'in esecuzione'", () => {
    /* il caso reale: riga con running:true e nextRunAt nel futuro,
       ma nessun tick da ore perché il processo non esiste più */
    const v = schedulerHealth(
      loop({
        lastTickAt: "2026-08-18T20:00:00Z",
        nextRunAt: "2026-08-19T10:27:00Z",
      }),
      t0,
    );
    assertEqual(v.health, "uncertain");
    assertEqual(v.nextRunMinutes, null);
  });

  test("esattamente due intervalli è ancora credibile", () => {
    /* 90 minuti tondi: la soglia è 'oltre', non 'pari a' */
    const v = schedulerHealth(
      loop({ lastTickAt: "2026-08-19T08:30:00Z" }),
      t0,
    );
    assertEqual(v.health, "running");
  });

  test("stato senza istanti verificabili: incerto", () => {
    const v = schedulerHealth(
      loop({ lastTickAt: null, startedAt: "non-una-data" }),
      t0,
    );
    assertEqual(v.health, "uncertain");
    assertEqual(v.nextRunMinutes, null);
  });

  test("intervallo assurdo nella riga: si usa il predefinito", () => {
    const v = schedulerHealth(
      loop({ intervalMinutes: 0, lastTickAt: "2026-08-19T09:40:00Z" }),
      t0,
    );
    assertEqual(v.health, "running");
  });

  test("la soglia di scadenza è due intervalli", () => {
    assertEqual(STALE_INTERVAL_MULTIPLIER, 2);
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

main();
