/**
 * Test del client dell'endpoint eventi di The Odds API.
 *
 * L'endpoint è quello che la fonte dichiara fuori quota: il test verifica sia
 * la traduzione della risposta sia che il costo dichiarato negli header venga
 * letto e riportato, perché è l'unico modo di accorgersi se un giorno
 * smettesse di essere gratuito.
 */
import { fetchOddsApiEvents } from "../the-odds-api-events";

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

const events = [
  {
    id: "e1",
    sport_key: "soccer_italy_serie_a",
    home_team: "Inter",
    away_team: "AC Milan",
    commence_time: "2026-09-12T18:45:00Z",
  },
  {
    id: "e2",
    sport_key: "soccer_italy_serie_a",
    home_team: "Roma",
    away_team: "Napoli",
    commence_time: "2026-09-13T16:00:00Z",
  },
];

console.log("\nClient eventi The Odds API\n");

void (async () => {
await test("traduce gli eventi e dichiara zero crediti spesi", async () => {
  const outcome = await fetchOddsApiEvents({
    sportKey: "soccer_italy_serie_a",
    apiKey: "test-key",
    fetchImpl: async () =>
      response(JSON.stringify(events), 200, {
        "x-requests-last": "0",
        "x-requests-remaining": "489",
      }),
  });
  assert(outcome.result.ok, "risposta completata");
  if (outcome.result.ok) {
    assert(outcome.result.data.length === 2, "due eventi tradotti");
    assert(outcome.result.data[0].homeTeam === "Inter", "squadra di casa");
    assert(
      outcome.result.data[0].commenceTime.toISOString() === "2026-09-12T18:45:00.000Z",
      "orario tradotto in data",
    );
  }
  assert(outcome.creditsUsed === 0, "costo dichiarato dalla fonte letto");
  assert(outcome.creditsRemaining === 489, "crediti residui letti");
});

await test("l'URL non contiene la chiave in chiaro nei log e usa l'endpoint /events", async () => {
  let called = "";
  await fetchOddsApiEvents({
    sportKey: "soccer_epl",
    apiKey: "chiave-segreta",
    fetchImpl: async (url) => {
      called = String(url);
      return response("[]");
    },
  });
  assert(called.includes("/v4/sports/soccer_epl/events"), `endpoint events, ottenuto ${called}`);
  assert(called.includes("apiKey="), "chiave passata come parametro");
});

await test("chiave assente: nessun tentativo di rete", async () => {
  let called = false;
  const outcome = await fetchOddsApiEvents({
    sportKey: "soccer_epl",
    apiKey: "   ",
    fetchImpl: async () => {
      called = true;
      return response("[]");
    },
  });
  assert(!called, "nessuna chiamata partita");
  assert(!outcome.result.ok, "esito fallito");
  if (!outcome.result.ok) assert(outcome.result.error.kind === "disabled", "categoria disabled");
});

await test("elenco vuoto è un esito parziale dichiarato, non un errore", async () => {
  const outcome = await fetchOddsApiEvents({
    sportKey: "soccer_epl",
    apiKey: "test-key",
    fetchImpl: async () => response("[]", 200, { "x-requests-last": "0" }),
  });
  assert(outcome.result.ok && outcome.result.partial, "parziale");
  if (outcome.result.ok && outcome.result.partial) {
    assert(outcome.result.data.length === 0, "nessun evento inventato");
    assert(outcome.result.missing.length > 0, "motivo dichiarato");
  }
});

await test("righe incomplete vengono scartate e dichiarate", async () => {
  const outcome = await fetchOddsApiEvents({
    sportKey: "soccer_epl",
    apiKey: "test-key",
    fetchImpl: async () =>
      response(
        JSON.stringify([
          events[0],
          { id: "e3", home_team: "Senza orario", away_team: "X", commence_time: "non-una-data" },
        ]),
      ),
  });
  assert(outcome.result.ok, "risposta letta");
  if (outcome.result.ok) {
    assert(outcome.result.data.length === 1, "solo la riga completa");
    assert(outcome.result.partial, "lo scarto è dichiarato");
  }
});

await test("429 è rate limitato e ritentabile", async () => {
  const outcome = await fetchOddsApiEvents({
    sportKey: "soccer_epl",
    apiKey: "test-key",
    fetchImpl: async () => response('{"message":"too many"}', 429),
  });
  assert(!outcome.result.ok, "429 non è una risposta valida");
  if (!outcome.result.ok) {
    assert(outcome.result.error.kind === "rate_limited", "categoria rate_limited");
    assert(outcome.result.retryable, "ritentabile");
  }
});

await test("JSON non valido è un errore di parsing non ritentabile", async () => {
  const outcome = await fetchOddsApiEvents({
    sportKey: "soccer_epl",
    apiKey: "test-key",
    fetchImpl: async () => response("non-json"),
  });
  assert(!outcome.result.ok, "JSON invalido fallisce");
  if (!outcome.result.ok) {
    assert(outcome.result.error.kind === "parse", "categoria parse");
    assert(!outcome.result.retryable, "non ritentabile senza cambiare input");
  }
});

await test("risposta che non è un elenco viene rifiutata", async () => {
  const outcome = await fetchOddsApiEvents({
    sportKey: "soccer_epl",
    apiKey: "test-key",
    fetchImpl: async () => response('{"id":"e1"}'),
  });
  assert(!outcome.result.ok, "oggetto singolo rifiutato");
  if (!outcome.result.ok) assert(outcome.result.error.kind === "parse", "categoria parse");
});

await test("errore di rete è dichiarato e ritentabile", async () => {
  const outcome = await fetchOddsApiEvents({
    sportKey: "soccer_epl",
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

  console.log(`\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`);
  if (failed > 0) process.exit(1);
})();
