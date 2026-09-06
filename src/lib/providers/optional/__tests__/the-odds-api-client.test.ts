import { fetchTheOddsApiOdds } from "../the-odds-api-client";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

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

const event = {
  id: "event-1",
  commence_time: "2026-09-06T14:00:00.000Z",
  home_team: "Arsenal",
  away_team: "Chelsea",
  bookmakers: [
    {
      key: "pinnacle",
      last_update: "2026-09-06T11:59:00.000Z",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Arsenal", price: 2.1 },
            { name: "Chelsea", price: 3.6 },
            { name: "Draw", price: 3.4 },
          ],
        },
      ],
    },
  ],
};

function response(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

const base = {
  sportKey: "soccer_epl",
  fixtureKey: "internal-1",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  kickoffAt: new Date("2026-09-06T14:00:00.000Z"),
  observedAt: new Date("2026-09-06T12:00:00.000Z"),
  apiKey: "test-key",
};

console.log("\nClient The Odds API\n");

void (async () => {
  await test("traduce solo l'evento con kickoff verificato", async () => {
    const result = await fetchTheOddsApiOdds({
      ...base,
      fetchImpl: async () => response(JSON.stringify([event])),
    });
    assert(result.ok, "risposta completata");
    if (result.ok) {
      assert(result.data.length === 3, "tre esiti 1x2");
      assert(result.data[0]?.isConsensus === false, "linea non consensus");
      assert(result.data[0]?.isSharp === true, "Pinnacle marcato sharp");
      assert(result.payloadBytes > 0, "payload misurato");
    }
  });

  await test("evento non trovato resta parziale e non diventa quota vuota valida", async () => {
    const result = await fetchTheOddsApiOdds({
      ...base,
      fetchImpl: async () => response(JSON.stringify([])),
    });
    assert(result.ok && result.partial, "evento mancante esplicito");
    if (result.ok && result.partial) {
      assert(result.data.length === 0, "nessuna quota inventata");
      assert(result.missing.some((item) => item.includes("evento non trovato")), "motivo presente");
    }
  });

  await test("429 è rate limitato e ritentabile", async () => {
    const result = await fetchTheOddsApiOdds({
      ...base,
      fetchImpl: async () => response("{\"message\":\"too many\"}", 429),
    });
    assert(!result.ok, "429 non è una risposta valida");
    if (!result.ok) {
      assert(result.error.kind === "rate_limited", "categoria 429");
      assert(result.retryable, "429 ritentabile");
    }
  });

  await test("JSON non valido è un errore di parsing non ritentabile", async () => {
    const result = await fetchTheOddsApiOdds({
      ...base,
      fetchImpl: async () => response("non-json"),
    });
    assert(!result.ok, "JSON invalido fallisce");
    if (!result.ok) {
      assert(result.error.kind === "parse", "categoria parse");
      assert(!result.retryable, "parse non ritentabile senza cambiare input");
    }
  });

  console.log(`\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`);
  if (failed > 0) process.exit(1);
})();
