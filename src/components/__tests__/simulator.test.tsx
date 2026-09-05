/**
 * Test del simulatore xG / Dixon-Coles in un DOM reale — jsdom + React 19.
 * Eseguire con: npm run test:simulator
 *
 * La matematica del modello vive in `src/lib/quant/dixon-coles.ts`. Qui si
 * verifica il cablaggio, cioè la cosa che un calcolo corretto non garantisce:
 * che la tabella esposta abbia tante intestazioni di colonna quante celle per
 * riga, che il titolo dichiari l'intervallo che il modello calcola davvero, e
 * che la pagina dichiari lo stato del modello — che non è mai stato validato
 * contro il mercato (vincolo di `docs/RESEARCH-BACKLOG.md`, voce 7).
 *
 * I parametri di riferimento sono quelli della pagina, non quelli di default
 * del modello: la vista passa `maxGoals: 5` e il default della funzione è 6.
 * Un test che simula da sé senza gli stessi parametri misura un'altra cosa.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  `<!doctype html><html><body><div id="root"></div></body></html>`,
  { url: "http://localhost/" },
);

const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
(g as Record<string, unknown>).self = dom.window as unknown;
g.localStorage = dom.window.localStorage;
g.IS_REACT_ACT_ENVIRONMENT = true;

/* parametri di default della vista: cambiarli qui significa cambiare il test */
const VIEW_LAMBDA_HOME = 1.65;
const VIEW_MU_AWAY = 1.15;
const VIEW_RHO = -0.12;
const VIEW_MAX_GOALS = 5;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((err: unknown) => {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${name}: ${msg}`);
      console.log(`  ✗ ${name}\n      ${msg}`);
    });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { PoissonSimulatorView } = await import(
    "@/components/simulator/PoissonSimulatorView"
  );
  const { simulateDixonColes } = await import("@/lib/quant/dixon-coles");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container as never);
  await act(async () => {
    root.render(React.createElement(PoissonSimulatorView));
  });

  /* il modello con GLI STESSI parametri della vista */
  const sim = simulateDixonColes({
    lambdaHome: VIEW_LAMBDA_HOME,
    muAway: VIEW_MU_AWAY,
    rho: VIEW_RHO,
    maxGoals: VIEW_MAX_GOALS,
  });
  const lati = VIEW_MAX_GOALS + 1;

  await test("la matrice ha il lato dichiarato dalla pagina", () => {
    assert(sim.scoreMatrix.length === lati, `righe ${sim.scoreMatrix.length}, attese ${lati}`);
    assert(
      sim.scoreMatrix[0].length === lati,
      `colonne ${sim.scoreMatrix[0].length}, attese ${lati}`,
    );
  });

  await test("la tabella esposta allinea intestazioni e celle", () => {
    const table = container.querySelector("table");
    assert(table !== null, "tabella della matrice presente");
    const headers = table!.querySelectorAll("thead th");
    const cells = table!.querySelectorAll("tbody tr:first-child td");
    const rows = table!.querySelectorAll("tbody tr");
    assert(
      headers.length === cells.length,
      `intestazioni ${headers.length}, celle per riga ${cells.length}`,
    );
    assert(rows.length === lati, `righe a schermo ${rows.length}, attese ${lati}`);
  });

  await test("ogni colonna della tabella ha la sua intestazione di gol", () => {
    const table = container.querySelector("table")!;
    const etichetteGol = [...table.querySelectorAll("thead th")]
      .map((th) => th.textContent ?? "")
      .filter((h) => /gol/.test(h));
    assert(
      etichetteGol.length === lati,
      `intestazioni «N gol» ${etichetteGol.length}, colonne ${lati}`,
    );
  });

  await test("il titolo dichiara l'intervallo che il modello calcola davvero", () => {
    const t = container.textContent ?? "";
    assert(
      t.includes(`0-0 a ${VIEW_MAX_GOALS}-${VIEW_MAX_GOALS}`) ||
        t.includes(`0-0 a ${VIEW_MAX_GOALS}–${VIEW_MAX_GOALS}`),
      `il testo dichiara l'intervallo 0-0 → ${VIEW_MAX_GOALS}-${VIEW_MAX_GOALS}`,
    );
  });

  await test("il default del modello non diverge da ciò che la pagina espone", () => {
    /* se il default torna a 6, chi chiama la funzione senza `maxGoals` ottiene
       una matrice 7×7 che nessuna intestazione della pagina descrive: il
       disallineamento rientra dalla finestra. Questo test lo blocca. */
    const d = simulateDixonColes({ lambdaHome: VIEW_LAMBDA_HOME, muAway: VIEW_MU_AWAY });
    assert(
      d.scoreMatrix.length === lati,
      `default del modello ${d.scoreMatrix.length}×${d.scoreMatrix[0].length}, la pagina espone ${lati}×${lati}`,
    );
  });

  await test("la probabilità della matrice esposta è normalizzata a ~100%", () => {
    const somma = sim.scoreMatrix
      .flat()
      .reduce((acc, c) => acc + c.probPct, 0);
    assert(Math.abs(somma - 100) < 0.5, `somma ${somma.toFixed(3)}%`);
  });

  await test("il 1X2 somma 100 e le quote fair sono senza margine", () => {
    const p = sim.probabilities;
    const somma = p.homeWinPct + p.drawPct + p.awayWinPct;
    assert(Math.abs(somma - 100) < 0.5, `somma 1X2 ${somma.toFixed(3)}%`);
    const overround =
      1 / sim.fairOdds.homeWin + 1 / sim.fairOdds.draw + 1 / sim.fairOdds.awayWin;
    /* l'arrotondamento delle quote a due decimali sposta l'overround di pochi
       decimillesimi: la soglia è quella, non lo zero esatto */
    assert(overround > 0.99 && overround < 1.01, `overround ${overround.toFixed(5)}`);
  });

  await test("la pagina dichiara che il modello non è validato sul mercato", () => {
    const t = container.textContent ?? "";
    assert(
      /non è (mai )?stat[oa] validat[oa]/i.test(t),
      "dichiarazione di modello non validato presente",
    );
  });

  await test("la pagina rimanda ai limiti personali", () => {
    const link = container.querySelector('a[href="/gioco-responsabile"]');
    assert(link !== null, "link a /gioco-responsabile presente");
  });

  if (failed > 0) {
    console.error(`\n✗ ${failed} test falliti su ${passed + failed}`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n✓ ${passed} test superati (simulatore xG)`);
}

void main();
