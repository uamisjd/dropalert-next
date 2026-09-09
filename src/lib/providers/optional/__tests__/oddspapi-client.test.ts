/**
 * Test del client HTTP di OddsPapi — chiamata `/odds`, parsing ed errori.
 *
 * Verifica il comportamento del confine di rete: esito completo, parziale
 * (esiti scartati), errore di rete ritentabile e "disabled" senza chiave.
 * Usa la stessa fixture congelata del parser. Non tocca il database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchOddsPapiOdds } from "../oddspapi-client";

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

const fixture = join(__dirname, "fixtures", "oddspapi-odds.json");
const oddsBody = readFileSync(fixture, "utf8");

const base = {
  sportKey: "10",
  providerMatchId: "id1300010963301407",
  fixtureKey: "be-test123",
  homeTeam: "Inter",
  awayTeam: "Juventus",
  kickoffAt: new Date("2026-09-12T19:00:00Z"),
};

(async () => {
  await test("traduce la risposta notFound in quote per-bookmaker", async () => {
    const outcome = await fetchOddsPapiOdds({
      ...base,
      apiKey: "test-key",
      fetchImpl: async () => response(oddsBody, 200),
    });
    assert(outcome.ok, "risposta OK");
    if (!outcome.ok) return;
    const keys = new Set(outcome.data.map((q) => q.bookmakerKey));
    assert(outcome.data.length > 0, "attese quote");
    assert(keys.has("pinnacle"), "manca pinnacle");
    assert(outcome.data.every((q) => !q.isConsensus), "nessun consenso finto");
  });

  await test("risposta non riconoscibile è un errore di parse dichiarato", async () => {
    const outcome = await fetchOddsPapiOdds({
      ...base,
      apiKey: "test-key",
      fetchImpl: async () => response('{"message":"err"}', 200),
    });
    assert(!outcome.ok, "struttura non riconosciuta → non ok");
    if (!outcome.ok) assert(outcome.error.kind === "parse", "categoria parse");
  });

  await test("array data vuoto è un esito parziale, non un errore", async () => {
    const outcome = await fetchOddsPapiOdds({
      ...base,
      apiKey: "test-key",
      fetchImpl: async () => response('{"data": []}', 200),
    });
    assert(outcome.ok && outcome.partial, "array vuoto riconosciuto → parziale");
    if (!outcome.ok) return;
    assert(outcome.data.length === 0, "nessuna quota da array vuoto");
  });

  await test("errore di rete è dichiarato e ritentabile", async () => {
    const outcome = await fetchOddsPapiOdds({
      ...base,
      apiKey: "test-key",
      fetchImpl: async () => {
        throw new Error("connessione rifiutata");
      },
    });
    assert(!outcome.ok, "errore di rete");
    if (!outcome.ok) {
      assert(outcome.error.kind === "network", "categoria network");
      assert(outcome.retryable, "ritentabile");
    }
  });

  await test("senza chiave la chiamata non parte: esito disabled", async () => {
    const outcome = await fetchOddsPapiOdds({
      ...base,
      apiKey: "  ",
      fetchImpl: async () => response(oddsBody, 200),
    });
    assert(!outcome.ok, "senza chiave è non ok");
    if (!outcome.ok) assert(outcome.error.kind === "disabled", "categoria disabled");
  });

  await test("HTTP 429 è rate_limited", async () => {
    const outcome = await fetchOddsPapiOdds({
      ...base,
      apiKey: "test-key",
      fetchImpl: async () => response("too many", 429),
    });
    assert(!outcome.ok, "429 non ok");
    if (!outcome.ok) {
      assert(outcome.error.kind === "rate_limited", "categoria rate_limited");
      assert(outcome.retryable, "429 ritentabile");
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
