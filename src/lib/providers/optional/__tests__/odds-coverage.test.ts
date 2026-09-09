/**
 * Test della classificazione di copertura: The Odds API contro il monitor.
 *
 * La funzione è PURA (nessun DB, nessuna rete): è il cuore dello strumento di
 * scoperta `npm run odds:scopri`. Il test fissa le regole di onestà:
 *  - la somiglianza NON è una copertura: si segnala come candidato da verificare;
 *  - un titolo di un altro paese non è mai un candidato (niente abbagli);
 *  - ciò che la fonte non espone resta un buco dichiarato, mai una stima.
 */
import {
  classifyCoverage,
  findNearKey,
  coverageClassFor,
  type CoverageLeague,
  type CoverageSport,
} from "../odds-coverage";

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

const SOCCER: CoverageSport[] = [
  { key: "soccer_argentina_primera_division", title: "Argentina Primera División" },
  { key: "soccer_australia_aleague", title: "Australia A-League" },
  { key: "soccer_brazil_campeonato", title: "Brazil Campeonato" },
  { key: "soccer_denmark_superliga", title: "Denmark Superliga" },
  { key: "soccer_italy_serie_a", title: "Italy Serie A" },
  { key: "soccer_japan_j_league", title: "Japan J-League" },
  { key: "soccer_mexico_ligamx", title: "Mexico Liga MX" },
  { key: "soccer_mls", title: "MLS" },
  { key: "soccer_norway_eliteserien", title: "Norway Eliteserien" },
  { key: "soccer_sweden_allsvenskan", title: "Sweden Allsvenskan" },
  { key: "soccer_switzerland_superleague", title: "Switzerland Super League" },
  { key: "soccer_turkey_super_league", title: "Turkey Süper Lig" },
  { key: "soccer_uefa_nations_league", title: "UEFA Nations League" },
];

(async () => {
  await test("nazione corrispondente → candidato corretto, non abbaglio", async () => {
    const hit = findNearKey({ key: "mx-ligamx", name: "Liga MX", country: "Mexico" }, SOCCER);
    assert(hit !== null, "Mexico Liga MX dovrebbe avere un candidato");
    assert(hit!.candidate === "soccer_mexico_ligamx", `candidato errato: ${hit!.candidate}`);
    assert(hit!.title === "Mexico Liga MX", "titolo errato");
  });

  await test("titolo di un ALTRO paese non è mai un candidato", async () => {
    // Il monitor ha "Mexico": la fonte non deve mai proporre "Denmark Superliga".
    const hit = findNearKey({ key: "mx-ligamx", name: "Liga MX", country: "Mexico" }, [
      { key: "soccer_denmark_superliga", title: "Denmark Superliga" },
    ]);
    assert(hit === null, "un titolo di un altro paese non è un candidato");
  });

  await test("competizione internazionale riconosciuta con due token", async () => {
    const hit = findNearKey({ key: "uefa-nations", name: "Nations League", country: "Europe" }, SOCCER);
    assert(hit !== null, "Nations League dovrebbe avere un candidato");
    assert(hit!.candidate === "soccer_uefa_nations_league", `candidato errato: ${hit!.candidate}`);
  });

  await test("nazione assente nella fonte → resta fuori copertura, non stimato", async () => {
    // Algeria non compare nel catalogo della fonte: nessun candidato.
    const hit = findNearKey({ key: "dz-ligue1", name: "Ligue 1", country: "Algeria" }, SOCCER);
    assert(hit === null, "Algeria non è coperta: nessun candidato");
  });

  await test("classifica in tre gruppi senza perdere campionati", async () => {
    const leagues: CoverageLeague[] = [
      { key: "it-serie-a", name: "Serie A", country: "Italy" },
      { key: "mx-ligamx", name: "Liga MX", country: "Mexico" },
      { key: "dz-ligue1", name: "Ligue 1", country: "Algeria" },
    ];
    const catalogKeys = new Set(["soccer_italy_serie_a", "soccer_mexico_ligamx"]);
    const report = classifyCoverage(leagues, catalogKeys, SOCCER);
    assert(report.mapped.length === 1 && report.mapped[0].name === "Serie A", "Serie A deve essere mappata");
    assert(report.near.length === 1 && report.near[0].league.name === "Liga MX", "Liga MX deve essere candidata");
    assert(report.uncovered.length === 1 && report.uncovered[0].name === "Ligue 1", "Algeria fuori copertura");
  });

  await test("una chiave della fonte in pausa non dà copertura", async () => {
    // catalogKeys è il set delle chiavi ATTIVE: una chiave assente non è coperta.
    const leagues: CoverageLeague[] = [{ key: "at-bundesliga", name: "Bundesliga", country: "Austria" }];
    const report = classifyCoverage(leagues, new Set(["soccer_germany_bundesliga"]), SOCCER);
    assert(report.mapped.length === 0, "Austria Bundesliga non deve essere mappata (non attiva nel catalogo)");
  });

  /* ------------------------------------------------------------------ */
  /* coverageClassFor — la classe di UNA competizione (scheda partita)   */
  /* ------------------------------------------------------------------ */

  const ACTIVE_KEYS = new Set([
    "soccer_italy_serie_a",
    "soccer_mexico_ligamx",
    "soccer_denmark_superliga",
    "soccer_mls",
  ]);

  await test("coverageClassFor: campionato mappato → mapped senza motivo", async () => {
    const c = coverageClassFor(
      { key: "it-serie-a", name: "Serie A", country: "Italy" },
      ACTIVE_KEYS,
      SOCCER,
    );
    assert(c.coverage === "mapped", `atteso mapped, trovato ${c.coverage}`);
    assert(c.reason === null, "mapped non ha motivo di indisponibilità");
  });

  await test("coverageClassFor: campionato simile → near, mai usato come certezza", async () => {
    const c = coverageClassFor(
      { key: "mx-ligamx", name: "Liga MX", country: "Mexico" },
      ACTIVE_KEYS,
      SOCCER,
    );
    assert(c.coverage === "near", `atteso near, trovato ${c.coverage}`);
    assert(c.candidate === "soccer_mexico_ligamx", "candidato errato");
    assert(c.reason !== null && c.reason!.length > 0, "near deve avere un motivo di verifica");
  });

  await test("coverageClassFor: campionato assente → uncovered con motivo onesto", async () => {
    const c = coverageClassFor(
      { key: "chad-div1", name: "Division 1", country: "Chad" },
      ACTIVE_KEYS,
      SOCCER,
    );
    assert(c.coverage === "uncovered", `atteso uncovered, trovato ${c.coverage}`);
    assert(c.reason !== null && c.reason!.includes("non osservabile"), "il motivo dichiara la non osservabilità");
  });

  await test("coverageClassFor: competizione non leggibile → unknown, mai decisa", async () => {
    const c = coverageClassFor({ key: "x", name: "", country: "" }, ACTIVE_KEYS, SOCCER);
    assert(c.coverage === "unknown", `atteso unknown, trovato ${c.coverage}`);
    assert(c.reason !== null && c.reason!.includes("non leggibile"), "unknown dichiara il motivo");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
