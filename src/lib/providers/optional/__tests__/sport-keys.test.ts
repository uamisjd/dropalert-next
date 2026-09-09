/**
 * Test di `sportKeyFor` e `resolveSportKey` — la mappa competizione → chiave.
 *
 * Verifica la regola di onestà: la chiave è leggibile SOLO nel formato
 * «Paese: Lega». Un nome senza paese (com'era passato dalla scheda partita)
 * restituisce `null` invece di indovinare, e `resolveSportKey` la compone
 * correttamente a partire da paese e nome separati.
 */
import {
  sportKeyFor,
  resolveSportKey,
  isCoveredBySportKey,
  COVERED_SPORT_KEYS,
} from "../sport-keys";

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

test("isCoveredBySportKey: campionato nel set coperto → true", () => {
  assert(isCoveredBySportKey("Italy", "Serie A") === true, "Serie A coperta");
  assert(isCoveredBySportKey("England", "Premier League") === true, "Premier coperta");
});

test("isCoveredBySportKey: coppa UEFA maschile → true (nel set)", () => {
  assert(isCoveredBySportKey("Europe", "Champions League") === true, "UCL coperta");
});

test("isCoveredBySportKey: fuori mappa o non leggibile → false", () => {
  assert(isCoveredBySportKey("Chad", "Division 1") === false, "Chad non coperta");
  assert(isCoveredBySportKey("Algeria", "Ligue 1") === false, "Algeria non coperta");
  assert(isCoveredBySportKey("Italy", "Serie A femminile") === false, "esclusione → false");
  assert(isCoveredBySportKey(null, "Serie A") === false, "senza paese → false");
  assert(isCoveredBySportKey("Italy", "") === false, "senza nome → false");
  assert(isCoveredBySportKey("Spain", "Premier League") === false, "paese incoerente → false");
});

test("la chiave risolta ricade nel set di campionati coperti (catena mappa→fonte)", () => {
  // La scheda partita fa: resolveSportKey(country, league) → sportKey → fetchSharpLine.
  // Qui garantiamo il primo anello della catena: ogni campionato riconosciuto
  // produce una chiave che è davvero nel set di quelli coperti dalla fonte,
  // così la conferma sharp può scattare (era il bug scoperto).
  const chiavi = [
    ["Italy", "Serie A"],
    ["England", "Premier League"],
    ["Spain", "La Liga"],
    ["Germany", "Bundesliga"],
    ["France", "Ligue 1"],
    ["Europe", "Champions League"],
  ] as const;
  for (const [paese, nome] of chiavi) {
    const chiave = resolveSportKey(paese, nome);
    assert(chiave !== null, `${paese}:${nome} → chiave non nulla`);
    if (chiave === null) continue;
    assert(
      COVERED_SPORT_KEYS.includes(chiave),
      `${paese}:${nome} → ${chiave} deve essere in COVERED_SPORT_KEYS`,
    );
    assert(isCoveredBySportKey(paese, nome) === true, `${paese}:${nome} → coperto`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
