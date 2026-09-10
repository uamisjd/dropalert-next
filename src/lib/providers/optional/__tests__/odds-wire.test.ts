/**
 * Test del cablaggio per-bookmaker — parti pure soltanto.
 * Eseguire con: npm run test:odds-wire
 *
 * Qui si fissano le regole di onestà della fase, senza DB né rete:
 *  - i due flag vanno accesi INSIEME, altrimenti la fase resta spenta con
 *    motivo dichiarato (il solo ODDS_WIRE_COLLECT inquinerebbe il consenso);
 *  - un candidato è solo un segnale attivo, con indice ≥ 45, partita non
 *    demo e giocabile, kickoff futuro, squadre presenti e competizione
 *    coperta; ogni scarto ha un motivo, mai un silenzio;
 *  - più segnali sulla stessa partita collassano in una sola lettura;
 *  - il credito si conta solo quando la richiesta esce verso la fonte.
 */
import {
  creditsSpentFor,
  pickWireCandidates,
  wireGate,
  WIRE_MIN_CONFIDENCE,
  type WireSignalRow,
} from "../odds-collect-wire";
import { alreadyReadToday, wireMatchKey } from "../odds-api-budget";
import type { OddsQuoteDTO, ProviderResult } from "../../types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${name}\n      ${message}`);
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

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const FUTURE = new Date("2026-09-12T18:00:00Z");
const NOW = new Date("2026-09-10T12:00:00Z");

function row(partial: Partial<WireSignalRow> & { matchId: number }): WireSignalRow {
  return {
    matchKey: "be-abc123",
    signalStatus: "active",
    matchStatus: "scheduled",
    confidenceScore: 60,
    kickoffAt: FUTURE,
    country: "Italy",
    league: "Serie A",
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    ...partial,
  };
}

function okResult(): ProviderResult<OddsQuoteDTO[]> {
  return { ok: true, data: [], latencyMs: 0, partial: false, payloadBytes: 0 };
}

type FailKind = "disabled" | "unsupported" | "network" | "blocked" | "parse";

function failResult(kind: FailKind): ProviderResult<OddsQuoteDTO[]> {
  return {
    ok: false,
    error: { kind, message: "x" },
    latencyMs: 0,
    retryable: false,
    payloadBytes: 0,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Il cancello: due flag, sempre insieme                            */
/* ------------------------------------------------------------------ */

test("gate acceso solo con entrambi i flag", () => {
  const gate = wireGate({
    ODDS_WIRE_COLLECT: "true",
    DROP_EXCLUDE_CONSENSUS_BOOKS: "true",
  });
  assert(gate.enabled, "entrambi i flag → fase accesa");
  assertEqual(gate.reason, null);
});

test("gate spento quando manca ODDS_WIRE_COLLECT", () => {
  const gate = wireGate({ DROP_EXCLUDE_CONSENSUS_BOOKS: "true" });
  assert(!gate.enabled, "manca il flag di cablaggio → spenta");
  assert(
    gate.reason !== null && gate.reason.includes("ODDS_WIRE_COLLECT"),
    `motivo deve citare il flag mancante: ${gate.reason}`,
  );
});

test("gate spento quando manca DROP_EXCLUDE_CONSENSUS_BOOKS", () => {
  const gate = wireGate({ ODDS_WIRE_COLLECT: "true" });
  assert(!gate.enabled, "senza esclusione del consenso → spenta");
  assert(
    gate.reason !== null && gate.reason.includes("DROP_EXCLUDE_CONSENSUS_BOOKS"),
    `motivo deve citare il flag mancante: ${gate.reason}`,
  );
  assert(
    gate.reason !== null && gate.reason.includes("inquinerebbero"),
    "il motivo deve spiegare il rischio di inquinare il consenso",
  );
});

test("gate spento senza alcun flag, motivo completo", () => {
  const gate = wireGate({});
  assert(!gate.enabled, "nessun flag → spenta");
  assert(
    gate.reason !== null &&
      gate.reason.includes("ODDS_WIRE_COLLECT") &&
      gate.reason.includes("DROP_EXCLUDE_CONSENSUS_BOOKS"),
    "il motivo deve citare entrambi i flag",
  );
});

/* ------------------------------------------------------------------ */
/* 2. Selezione dei candidati                                          */
/* ------------------------------------------------------------------ */

test("segnale attivo su lega coperta → candidato", () => {
  const { candidates, skipped } = pickWireCandidates([row({ matchId: 1 })], NOW);
  assertEqual(candidates.length, 1);
  assertEqual(skipped.length, 0);
  assertEqual(candidates[0].sportKey, "soccer_italy_serie_a");
  assertEqual(candidates[0].fixtureKey, "be-abc123");
});

test("più segnali sulla stessa partita → una sola lettura, indice più alto", () => {
  const { candidates } = pickWireCandidates(
    [row({ matchId: 7, confidenceScore: 55 }), row({ matchId: 7, confidenceScore: 78 })],
    NOW,
  );
  assertEqual(candidates.length, 1, "una lettura per partita, non per segnale");
  assertEqual(candidates[0].confidenceScore, 78, "vince il segnale con indice più alto");
});

test("segnale non attivo → scartato con motivo", () => {
  const { candidates, skipped } = pickWireCandidates(
    [row({ matchId: 2, signalStatus: "forming" })],
    NOW,
  );
  assertEqual(candidates.length, 0);
  assertEqual(skipped.length, 1);
  assert(skipped[0].reason.includes("non attivo"), skipped[0].reason);
});

test("indice sotto soglia → scartato con motivo", () => {
  const { candidates, skipped } = pickWireCandidates(
    [row({ matchId: 3, confidenceScore: WIRE_MIN_CONFIDENCE - 1 })],
    NOW,
  );
  assertEqual(candidates.length, 0);
  assertEqual(skipped.length, 1);
  assert(skipped[0].reason.includes("soglia"), skipped[0].reason);
});

test("partita demo → scartata, nessun credito per il sintetico", () => {
  const { candidates, skipped } = pickWireCandidates(
    [row({ matchId: 4, matchKey: "demo-xyz" })],
    NOW,
  );
  assertEqual(candidates.length, 0);
  assertEqual(skipped.length, 1);
  assert(skipped[0].reason.includes("dimostrativa"), skipped[0].reason);
});

test("partita non giocabile → scartata", () => {
  const { candidates, skipped } = pickWireCandidates(
    [row({ matchId: 5, matchStatus: "postponed" })],
    NOW,
  );
  assertEqual(candidates.length, 0);
  assertEqual(skipped.length, 1);
  assert(skipped[0].reason.includes("postponed"), skipped[0].reason);
});

test("kickoff passato → scartato", () => {
  const { candidates, skipped } = pickWireCandidates(
    [row({ matchId: 6, kickoffAt: new Date("2026-09-09T12:00:00Z") })],
    NOW,
  );
  assertEqual(candidates.length, 0);
  assertEqual(skipped.length, 1);
  assert(skipped[0].reason.includes("kickoff"), skipped[0].reason);
});

test("squadre mancanti → scartato", () => {
  const { candidates, skipped } = pickWireCandidates(
    [row({ matchId: 8, homeTeam: null })],
    NOW,
  );
  assertEqual(candidates.length, 0);
  assertEqual(skipped.length, 1);
  assert(skipped[0].reason.includes("squadre"), skipped[0].reason);
});

test("competizione fuori copertura → scartato, nessun credito", () => {
  const { candidates, skipped } = pickWireCandidates(
    [row({ matchId: 9, country: "Algeria", league: "Ligue 1" })],
    NOW,
  );
  assertEqual(candidates.length, 0);
  assertEqual(skipped.length, 1);
  assert(skipped[0].reason.includes("fuori copertura"), skipped[0].reason);
});

test("competizione senza paese → scartato (fallire chiuso, non si indovina)", () => {
  const { candidates, skipped } = pickWireCandidates(
    [row({ matchId: 10, country: null, league: "Serie A" })],
    NOW,
  );
  assertEqual(candidates.length, 0);
  assertEqual(skipped.length, 1);
  assert(skipped[0].reason.includes("fuori copertura"), skipped[0].reason);
});

/* ------------------------------------------------------------------ */
/* 3. Contabilità dei crediti                                          */
/* ------------------------------------------------------------------ */

test("ok → 1 credito", () => {
  assertEqual(creditsSpentFor(okResult()), 1);
});

test("parziale (evento trovato ma quote parziali) → 1 credito", () => {
  const partial: ProviderResult<OddsQuoteDTO[]> = {
    ok: true,
    data: [],
    latencyMs: 0,
    partial: true,
    missing: ["evento trovato ma nessuna quota valida"],
    payloadBytes: 0,
  };
  assertEqual(creditsSpentFor(partial), 1);
});

test("disabled (chiave assente) → 0 crediti", () => {
  assertEqual(creditsSpentFor(failResult("disabled")), 0);
});

test("unsupported (adapter non dichiarato) → 0 crediti", () => {
  assertEqual(creditsSpentFor(failResult("unsupported")), 0);
});

test("errore di rete/timeout/HTTP → 1 credito (la richiesta è uscita)", () => {
  assertEqual(creditsSpentFor(failResult("network")), 1);
  assertEqual(creditsSpentFor(failResult("blocked")), 1);
  assertEqual(creditsSpentFor(failResult("parse")), 1);
});

/* ------------------------------------------------------------------ */
/* 4. Marcatore di lettura                                             */
/* ------------------------------------------------------------------ */

test("il marcatore del cablaggio è distinto dalla cache della linea sharp", () => {
  const wire = wireMatchKey(42, NOW);
  assert(wire.includes("odds-api:wire:match:"), `prefisso errato: ${wire}`);
  assert(wire.includes("2026-09-10"), `giorno mancante: ${wire}`);
  assert(wire.includes("42"), `partita mancante: ${wire}`);
  assert(!wire.startsWith("odds-api:match:"), "non deve collidere con la cache sharp");
});

/* ------------------------------------------------------------------ */
/* 5. Una lettura al giorno, attraverso entrambi i percorsi            */
/* ------------------------------------------------------------------ */

test("nessuno dei due percorsi ha letto → partita leggibile", () => {
  assert(!alreadyReadToday(false, false), "entrambe le cache vuote → leggibile");
});

test("il cablaggio ha già letto → la scheda partita non deve rileggere", () => {
  assert(
    alreadyReadToday(false, true),
    "marcatore del cablaggio presente → non rileggere dalla scheda partita",
  );
});

test("la scheda partita ha già letto → il cablaggio non deve rileggere", () => {
  assert(
    alreadyReadToday(true, false),
    "cache sharp presente → non rileggere dal cablaggio",
  );
});

test("entrambi hanno letto → partita non rileggibile", () => {
  assert(alreadyReadToday(true, true), "entrambe le cache presenti → non rileggibile");
});

/* ------------------------------------------------------------------ */

(async () => {
  console.log(`\n${passed + failed} test eseguiti, ${passed} superati, ${failed} falliti.\n`);
  if (failed > 0) {
    process.exit(1);
  }
})();
