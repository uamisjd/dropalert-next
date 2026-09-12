import assert from "node:assert/strict";
import { evaluateIndependentCandidate as evaluate, type IndependentCandidateInput, type CandidateSnapshot } from "../independent-candidate";
const now = new Date("2026-09-12T12:00:00Z");
const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const line = (bookmaker: string, minutes: number, home: number): CandidateSnapshot[] => ["home", "draw", "away"].map((selection, i) => ({ matchId: 42, market: "1x2", selection, bookmaker, source: "the-odds-api", at: at(minutes), price: [home, 3.5, 4][i], isStale: false, providerTimestampVerified: true }));
function fixture(): IndependentCandidateInput {
  return { matchId: 42, matchKey: "real-42", matchStatus: "scheduled", kickoffAt: at(-60), selection: "home", targetBookmaker: "testbook", confidenceScore: 60, now,
    snapshots: [...line("testbook", 10, 2.5), ...line("testbook", 0, 2.4), ...line("pinnacle", 10, 2.1), ...line("pinnacle", 0, 2)],
    execution: { matchId: 42, market: "1x2", selection: "home", bookmaker: "testbook", price: 2.4, checkedAt: now } };
}
let count = 0;
function test(name: string, edit: (i: IndependentCandidateInput) => void, state?: string) {
  const input = fixture(); edit(input); const result = evaluate(input);
  if (state) assert.equal(result.decision.state, state, name);
  else assert.notEqual(result.decision.state, "CANDIDATA", name);
  assert.notEqual(result.decision.state, "VALORE_VERIFICATO"); count++;
}
const ok = evaluate(fixture());
assert.equal(ok.decision.state, "CANDIDATA");
assert.ok(Math.abs(ok.fairProbability! - (0.5 / (0.5 + 1 / 3.5 + 0.25))) < 1e-12);
assert.ok(Math.abs(ok.edgePct! - (2.4 * ok.fairProbability! - 1) * 100) < 1e-12);
assert.ok(ok.decision.warnings.some(w => w.includes("fuori campione"))); count++;
test("timestamp non attestato", i => { i.snapshots.forEach(r => { r.providerTimestampVerified = false; }); });
test("nessuna prova esecuzione", i => { i.execution = null; });
test("proof altro evento", i => { i.execution!.matchId = 43; });
test("proof altro esito", i => { i.execution!.selection = "away"; });
test("proof altro prezzo", i => { i.execution!.price = 3; });
test("proof scaduta", i => { i.execution!.checkedAt = at(6); });
test("proof futura", i => { i.execution!.checkedAt = at(-1); });
test("stesso bookmaker", i => { i.targetBookmaker = "pinnacle"; });
test("exchange senza costi", i => { i.targetBookmaker = "betfair_ex_eu"; });
test("consenso", i => { i.targetBookmaker = "betexplorer-consensus"; });
test("kickoff passato", i => { i.kickoffAt = at(1); });
test("demo", i => { i.matchKey = "demo-42"; });
test("rinviata", i => { i.matchStatus = "postponed"; });
test("sotto soglia", i => { i.confidenceScore = 26.63; });
test("NaN indice", i => { i.confidenceScore = NaN; });
test("fonti smoke escluse", i => { i.snapshots.forEach(r => { r.source = "the-odds-api-wire-smoke"; }); });
test("altro evento escluso", i => { i.snapshots.forEach(r => { r.matchId = 43; }); });
test("altro mercato escluso", i => { i.snapshots.forEach(r => { r.market = "btts"; }); });
test("ultima terna incompleta non eredita", i => { i.snapshots = i.snapshots.filter(r => !(r.bookmaker === "pinnacle" && r.at.getTime() === now.getTime() && r.selection === "draw")); });
test("stale non recupera vecchia lettura", i => { i.snapshots.find(r => r.at.getTime() === now.getTime())!.isStale = true; });
test("prezzo non valido", i => { i.snapshots.find(r => r.at.getTime() === now.getTime())!.price = NaN; });
test("timestamp invalido", i => { i.snapshots[0].at = new Date(NaN); });
test("lettura futura", i => { i.snapshots.push(...line("testbook", -1, 2.4)); });
test("letture vecchie", i => { i.now = at(-6); });
test("skew", i => { i.snapshots.filter(r => r.bookmaker === "pinnacle" && r.at.getTime() === now.getTime()).forEach(r => { r.at = at(2); }); });
test("duplicato ambiguo", i => { i.snapshots.push({ ...i.snapshots[3] }); });
test("storia senza timestamp attestato", i => { i.snapshots.filter(r => r.at.getTime() !== now.getTime()).forEach(r => { r.providerTimestampVerified = false; }); }, "OSSERVAZIONE");
test("nessuna storia target", i => { i.snapshots = i.snapshots.filter(r => r.bookmaker !== "testbook" || r.at.getTime() === now.getTime()); }, "OSSERVAZIONE");
test("nessuna conferma movimento sharp", i => { i.snapshots = i.snapshots.filter(r => r.bookmaker !== "pinnacle" || r.at.getTime() === now.getTime()); }, "OSSERVAZIONE");
test("rimbalzo target", i => { i.snapshots.push(...line("testbook", 5, 2.3)); }, "OSSERVAZIONE");
test("rimbalzo sharp", i => { i.snapshots.push(...line("pinnacle", 5, 1.9)); }, "OSSERVAZIONE");
test("edge negativo", i => { i.snapshots.filter(r => r.bookmaker === "testbook" && r.at.getTime() === now.getTime() && r.selection === "home").forEach(r => { r.price = 1.8; }); i.execution!.price = 1.8; }, "OSSERVAZIONE");
test("ordine indipendente", i => { i.snapshots.reverse(); }, "CANDIDATA");
assert.throws(() => evaluate({ ...fixture(), now: new Date(NaN) })); count++;
console.log(`✓ ${count} scenari scanner indipendente (fixture sintetiche, nessun provider)`);
