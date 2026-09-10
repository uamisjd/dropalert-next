/**
 * Test del client dell'endpoint catalogo sport di The Odds API.
 *
 * L'endpoint è quello che la fonte dichiara fuori quota. Il test verifica sia
 * la traduzione della risposta sia che il costo dichiarato negli header venga
 * letto e riportato, perché è l'unico modo di accorgersi se un giorno smettesse
 * di essere gratuito. Usa la stessa fixture del parser del catalogo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchOddsApiSports } from "../the-odds-api-sports-client";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function response(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  } as unknown as Response;
}

const fixture = join(__dirname, "fixtures", "odds-api-sports.json");
const catalogPayload = readFileSync(fixture, "utf8");

(async () => {
  await test("traduce il catalogo e legge i crediti dichiarati (0 attesi)", async () => {
    const outcome = await fetchOddsApiSports({
      apiKey: "test-key",
      fetchImpl: async () =>
        response(catalogPayload, 200, { "x-requests-last": "0", "x-requests-remaining": "489" }),
    });
    assert(outcome.result.ok, "catalogo OK");
    if (!outcome.result.ok) return;
    assert(outcome.result.data.length === 44, `attese 44 voci, trovate ${outcome.result.data.length}`);
    assert(outcome.creditsUsed === 0, "il catalogo deve costare 0 crediti");
    assert(outcome.creditsRemaining === 489, "crediti residui non letti");
  });

  await test("una risposta non-array è un errore di parse dichiarato", async () => {
    const outcome = await fetchOddsApiSports({
      apiKey: "test-key",
      fetchImpl: async () => response('{"message":"err"}', 200),
    });
    assert(!outcome.result.ok, "oggetto singolo rifiutato");
    if (!outcome.result.ok) assert(outcome.result.error.kind === "parse", "categoria parse");
  });

  await test("errore di rete è dichiarato e ritentabile", async () => {
    const outcome = await fetchOddsApiSports({
      apiKey: "test-key",
      fetchImpl: async () => {
        throw new Error("connessione rifiutata");
      },
    });
    assert(!outcome.result.ok, "errore di rete");
    if (!outcome.result.ok) {
      assert(outcome.result.error.kind === "network", "categoria network");
      assert(outcome.result.retryable, "ritentabile");
    }
    assert(outcome.creditsUsed === null, "costo non dichiarato quando la chiamata non arriva");
  });

  await test("senza chiave la chiamata non parte: esito disabled e zero crediti", async () => {
    const outcome = await fetchOddsApiSports({ apiKey: "  " });
    assert(!outcome.result.ok, "senza chiave è un esito non ok");
    if (!outcome.result.ok) assert(outcome.result.error.kind === "disabled", "categoria disabled");
    assert(outcome.creditsUsed === null, "nessun credito consumato senza chiave");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
