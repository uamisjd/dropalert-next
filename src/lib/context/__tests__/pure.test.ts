/**
 * Test delle regole pure del Contesto 360°.
 * Eseguire con: npm run test:context
 *
 * Verifica le tre cose che non devono mai rompersi: la dicitura fissa,
 * la validazione che respinge i contesti monchi invece di completarli,
 * e le finestre (cache, riprova, tetto giornaliero).
 */
import {
  ACCORDO_VALUES,
  CONTEXT_CACHE_HOURS,
  CONTEXT_DAILY_LIMIT,
  CONTEXT_DISCLAIMER,
  CONTEXT_RETRY_HOURS,
  MODEL_KNOWLEDGE_TAG,
  dailyUsageKey,
  isContextFresh,
  isDailyBudgetExhausted,
  parseContextFields,
} from "../pure";

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

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    livello_categorie: "prima serie contro seconda serie",
    anomalia_campo: "campo neutro",
    posta_in_palo: "passaggio del turno",
    rotazioni_fatica: "rotazioni attese per il turno di coppa",
    accordo_col_drop: "sostiene",
    ...over,
  };
}

function main(): void {
  console.log("\n=== Contesto 360° — regole pure ===\n");

  console.log("-- Dichiarazioni fisse --\n");

  test("la dicitura fissa è quella concordata, parola per parola", () => {
    assertEqual(
      CONTEXT_DISCLAIMER,
      "Contesto generato automaticamente: non è un pronostico né una garanzia.",
    );
  });

  test("il tag della conoscenza modello è quello concordato", () => {
    assertEqual(MODEL_KNOWLEDGE_TAG, "conoscenza modello, da verificare");
  });

  console.log("\n-- Validazione della risposta --\n");

  test("payload completo e valido passa, con i cinque campi", () => {
    const f = parseContextFields(payload())!;
    assert(f !== null, "payload completo valido");
    assertEqual(f.livelloCategorie, "prima serie contro seconda serie");
    assertEqual(f.accordoColDrop, "sostiene");
  });

  test("i tre valori d'accordo sono ammessi, sinonimi no", () => {
    assertEqual(parseContextFields(payload({ accordo_col_drop: "contraddice" }))!.accordoColDrop, "contraddice");
    assertEqual(parseContextFields(payload({ accordo_col_drop: "non c'entra" }))!.accordoColDrop, "non c'entra");
    assertEqual(parseContextFields(payload({ accordo_col_drop: "favorevole" })), null);
    assertEqual(parseContextFields(payload({ accordo_col_drop: "sostenuto" })), null);
  });

  test("un campo mancante respinge tutto: nessun contesto mezzo fatto", () => {
    const senzaPosta = payload();
    delete senzaPosta.posta_in_palo;
    assertEqual(parseContextFields(senzaPosta), null);
    assertEqual(parseContextFields(payload({ anomalia_campo: "   " })), null);
    assertEqual(parseContextFields(payload({ rotazioni_fatica: null })), null);
  });

  test("campo oltre i 300 caratteri respinto, mai tagliato in silenzio", () => {
    const lungo = "x".repeat(301);
    assertEqual(parseContextFields(payload({ posta_in_palo: lungo })), null);
    assert(parseContextFields(payload({ posta_in_palo: "x".repeat(300) })) !== null, "300 caratteri passano");
  });

  test("payload non oggetto o JSON rotto respinto", () => {
    assertEqual(parseContextFields("testo"), null);
    assertEqual(parseContextFields(null), null);
    assertEqual(parseContextFields([payload()]), null);
  });

  test("gli spazi si normalizzano, il testo resta quello del modello", () => {
    const f = parseContextFields(payload({ livello_categorie: "  prima   serie  " }))!;
    assertEqual(f.livelloCategorie, "prima serie");
  });

  console.log("\n-- Finestre --\n");

  const NOW = new Date("2026-08-21T15:00:00Z");

  test("cache fresca se la scadenza è nel futuro, scaduta se è passata", () => {
    assertEqual(isContextFresh(new Date("2026-08-22T14:59:00Z"), NOW), true);
    assertEqual(isContextFresh(new Date("2026-08-21T14:59:00Z"), NOW), false);
    assertEqual(isContextFresh(NOW, NOW), false);
  });

  test("le finestre dichiarate sono 24h di cache e 1h di riprova", () => {
    assertEqual(CONTEXT_CACHE_HOURS, 24);
    assertEqual(CONTEXT_RETRY_HOURS, 1);
  });

  test("il tetto giornaliero scatta al limite dichiarato, non oltre", () => {
    assertEqual(CONTEXT_DAILY_LIMIT, 50);
    assertEqual(isDailyBudgetExhausted(49), false);
    assertEqual(isDailyBudgetExhausted(50), true);
    assertEqual(isDailyBudgetExhausted(51), true);
  });

  test("il contatore è chiave per giornata italiana", () => {
    const sera = new Date("2026-08-21T23:30:00Z"); /* 01:30 del 22/8 a Roma */
    assertEqual(dailyUsageKey(sera), "context:daily:2026-08-22");
    assertEqual(dailyUsageKey(NOW), "context:daily:2026-08-21");
  });

  test("i valori d'accordo sono esattamente tre", () => {
    assertEqual(ACCORDO_VALUES.length, 3);
  });

  console.log(
    `\n${passed} superati, ${failed} non superati su ${passed + failed} totali.`,
  );
  if (failed > 0) {
    console.error("\nFallimenti:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main();
