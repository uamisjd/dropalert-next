/**
 * Test di `sportKeyFor` e `resolveSportKey` — la mappa competizione → chiave.
 *
 * Verifica la regola di onestà: la chiave è leggibile SOLO nel formato
 * «Paese: Lega». Un nome senza paese (com'era passato dalla scheda partita)
 * restituisce `null` invece di indovinare, e `resolveSportKey` la compone
 * correttamente a partire da paese e nome separati.
 */
import { sportKeyFor, resolveSportKey } from "../sport-keys";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
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

test("sportKeyFor: «Italy: Serie A» → chiave esatta", () => {
  assert(sportKeyFor("Italy: Serie A") === "soccer_italy_serie_a", "Serie A");
});

test("sportKeyFor: senza separatore «:» → null (non si indovina)", () => {
  assert(sportKeyFor("Serie A") === null, "nome nudo non è leggibile");
  assert(sportKeyFor("Premier League") === null, "nome nudo → null");
});

test("sportKeyFor: paese sbagliato → null (niente abbagli)", () => {
  assert(sportKeyFor("Spain: Premier League") === null, "paese incoerente → null");
});

test("resolveSportKey: paese+nome separati → chiave esatta", () => {
  assert(resolveSportKey("Italy", "Serie A") === "soccer_italy_serie_a", "Italy + Serie A");
  assert(resolveSportKey("England", "Premier League") === "soccer_epl", "England + Premier League");
});

test("resolveSportKey: manca paese o nome → null (competizione non leggibile)", () => {
  assert(resolveSportKey(null, "Serie A") === null, "senza paese → null");
  assert(resolveSportKey("Italy", "") === null, "senza nome → null");
  assert(resolveSportKey("", "Serie A") === null, "paese vuoto → null");
  assert(resolveSportKey("Italy", "Serie A famminile") === null, "esclusione → null");
});

test("resolveSportKey: case e spazi non contano", () => {
  assert(resolveSportKey("  italy ", " serie a ") === "soccer_italy_serie_a", "trim case-insensitive");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
