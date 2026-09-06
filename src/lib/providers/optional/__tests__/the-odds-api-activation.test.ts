/**
 * Attivazione controllata di The Odds API.
 *
 * File separato perché il valore di `ADAPTER_IMPLEMENTED` è letto all'import:
 * qui impostiamo i flag PRIMA di importare il modulo, in un processo pulito,
 * per dimostrare che l'interruttore `ODDS_ADAPTER_IMPLEMENTED=true` dichiara
 * davvero la capacità — e che senza resta tutto spento (coperto da
 * providers.test.ts).
 *
 * Eseguire con: npm run test:odds-activation
 */
export {};

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  /* Interruttori accesi PRIMA dell'import. */
  process.env.ODDS_API_ENABLED = "true";
  process.env.THE_ODDS_API_KEY = "chiave-di-prova";
  process.env.ODDS_ADAPTER_IMPLEMENTED = "true";

  const { createTheOddsApiProvider, ADAPTER_IMPLEMENTED } = await import(
    "../the-odds-api"
  );

  try {
    assert(ADAPTER_IMPLEMENTED === true, "con il flag l'adapter è dichiarato implementato");

    const p = createTheOddsApiProvider();
    assert(p.enabled === true, "fonte accesa con flag e chiave");
    assert(p.capabilities.odds === true, "capacità odds dichiarata");
    assert(p.capabilities.perBookmakerOdds === true, "quote per bookmaker dichiarate");

    /* Senza sportKey e nomi verificati non parte alcuna chiamata di rete. */
    const r = await p.fetchOdds({
      key: "x",
      providerMatchId: null,
      sourceUrl: null,
      kickoffAt: new Date(),
    });
    assert(!r.ok, "senza sportKey la lettura è rifiutata");
    if (!r.ok) {
      assert(r.error.kind === "unsupported", "rifiuto dichiarato, non errore silenzioso");
    }

    const health = await p.healthCheck();
    assert(health.detail.includes("budget"), "l'health dichiara il governo del budget");

    passed += 1;
    console.log("  ✓ attivazione via flag dichiara la capacità e resta sicura");
  } catch (error) {
    failed += 1;
    console.error(`  ✗ attivazione\n      ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`);
  if (failed > 0) process.exit(1);
}

void main();
