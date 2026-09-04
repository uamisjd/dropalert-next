/**
 * Test dei calcolatori del lato betting in un DOM reale — jsdom + React 19.
 * Eseguire con: npm run test:client
 *
 * La matematica è già coperta da `npm run test:tools`. Qui si verifica il
 * cablaggio: che i campi finiscano nelle funzioni, che i numeri arrivino a
 * schermo e che un input assurdo produca l'avviso invece di un risultato.
 * Un calcolatore corretto con un'interfaccia rotta è comunque rotto.
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
g.localStorage = dom.window.localStorage;
g.IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

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
  const { MarginCalculator } = await import("@/components/tools/MarginCalculator");
  const { VarianceSimulator } = await import("@/components/tools/VarianceSimulator");

  const container = dom.window.document.getElementById("root")!;
  const testo = () => container.textContent ?? "";
  const inputByLabel = (label: string) =>
    container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | null;

  async function digita(
    label: string,
    valore: string,
  ): Promise<void> {
    const el = inputByLabel(label);
    assert(el !== null, `campo «${label}» presente`);
    /* React tiene traccia del valore di un input controllato: assegnarlo
       direttamente aggiorna anche quella traccia, e l'evento successivo non
       sembra più un cambiamento. Si passa quindi dal setter nativo del
       prototipo, che la traccia non la tocca, e poi si notifica "input". */
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(el, valore);
      el?.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  }

  /* ---------------------------------------------------------------- */
  /* Calcolatore di margine                                            */
  /* ---------------------------------------------------------------- */

  const rootMargin = createRoot(container as never);
  await act(async () => {
    rootMargin.render(React.createElement(MarginCalculator));
  });

  await test("margine: i valori predefiniti producono un risultato", () => {
    const t = testo();
    /* 1.72 / 4.00 / 4.80 → overround 103,97%, margine 3,97 pp, trattenuta 3,82% */
    assert(t.includes("103,97") || t.includes("103.97"), "overround a schermo");
    assert(t.includes("3,97") || t.includes("3.97"), "margine a schermo");
    assert(t.includes("3,82") || t.includes("3.82"), "trattenuta a schermo");
    assert(t.includes("Proporzionale"), "metodo proporzionale a schermo");
    assert(t.includes("Power"), "metodo power a schermo");
    assert(t.includes("Additivo"), "metodo additivo a schermo");
  });

  await test("margine: il disclaimer è presente", () => {
    assert(
      testo().includes("consiglio di scommessa"),
      "il limite dichiarato compare in pagina",
    );
  });

  await test("margine: una quota sola dichiara l'errore invece di calcolare", async () => {
    await digita("Quota decimale Esito 2", "");
    await digita("Quota decimale Esito 3", "");
    const t = testo();
    assert(
      t.includes("almeno due quote"),
      "il motivo dichiara che serve un mercato, non un numero",
    );
    assert(!t.includes("Trattenuta teorica"), "nessun risultato mostrato");
  });

  await test("margine: una quota non valida è dichiarata", async () => {
    await digita("Quota decimale Esito 2", "1.00");
    const t = testo();
    assert(
      t.includes("non utilizzabili"),
      "la quota fuori rango è nominata come problema",
    );
  });

  await act(async () => rootMargin.unmount());

  /* ---------------------------------------------------------------- */
  /* Simulatore di varianza                                            */
  /* ---------------------------------------------------------------- */

  container.textContent = "";
  const rootSim = createRoot(container as never);
  await act(async () => {
    rootSim.render(React.createElement(VarianceSimulator));
  });

  await test("varianza: i valori predefiniti producono una distribuzione", () => {
    const t = testo();
    assert(t.includes("Capitale finale (mediana)"), "mediana a schermo");
    assert(t.includes("Sequenze in perdita"), "quota in perdita a schermo");
    assert(
      t.includes("Rovinate"),
      "quota di sequenze rovinate a schermo",
    );
    /* 50% a quota 1.90 = −5% per giocata */
    assert(t.includes("−5,00") || t.includes("-5,00"), "rendimento atteso a schermo");
  });

  await test("varianza: il pareggio è sopra la probabilità della quota", () => {
    const t = testo();
    assert(
      t.includes("52,63") || t.includes("52.63"),
      "a quota 1.90 il pareggio è 52,63%, non 50%",
    );
  });

  await test("varianza: senza vantaggio lo dice esplicitamente", () => {
    assert(
      testo().includes("non c'è vantaggio"),
      "l'assenza di vantaggio è dichiarata in chiaro",
    );
  });

  await test("varianza: parametri assurdi producono l'avviso", async () => {
    await digita("Quota decimale", "0.5");
    const t = testo();
    assert(
      t.includes("Parametri non utilizzabili"),
      "nessun numero inventato al posto di un input invalido",
    );
    assert(!t.includes("Capitale finale (mediana)"), "nessuna distribuzione mostrata");
  });

  await test("varianza: il disclaimer e l'avviso su Kelly restano fissi", () => {
    const t = testo();
    assert(t.includes("consiglio di scommessa"), "limite dichiarato");
    assert(t.includes("raccomandazione"), "Kelly non è presentato come consiglio");
    assert(t.includes("deterministica"), "la riproducibilità è dichiarata");
  });

  await act(async () => rootSim.unmount());

  console.log(
    `\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`,
  );
  if (failed > 0) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

void main();
