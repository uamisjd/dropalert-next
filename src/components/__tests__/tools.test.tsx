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
import type { MarketSeries } from "@/lib/repo/match-detail";

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
/* `next/link` tocca `self` (requestIdleCallback): in Node non esiste. */
(g as Record<string, unknown>).self = dom.window as unknown;
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
  const { SurebetCalculator } = await import("@/components/tools/SurebetCalculator");
  const { GreenUpCalculator } = await import("@/components/trading/GreenUpCalculator");
  const { DutchingCalculator } = await import("@/components/tools/DutchingCalculator");
  const { MatchQuantPanel } = await import("@/components/MatchQuantPanel");

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
    await impostaValore(el, valore);
  }

  async function impostaValore(
    el: HTMLInputElement | null,
    valore: string,
  ): Promise<void> {
    assert(el !== null, "campo presente");
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
      testo().includes("non garantisce vincite"),
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
    assert(t.includes("non garantisce vincite"), "limite dichiarato");
    assert(t.includes("raccomandazione"), "Kelly non è presentato come consiglio");
    assert(t.includes("deterministica"), "la riproducibilità è dichiarata");
  });

  await act(async () => rootSim.unmount());

  /* ---------------------------------------------------------------- */
  /* Surebet: verdetto condizionale, mai «garantito»                    */
  /* ---------------------------------------------------------------- */

  container.textContent = "";
  const rootSure = createRoot(container as never);
  await act(async () => {
    rootSure.render(React.createElement(SurebetCalculator));
  });

  await test("surebet: i valori predefiniti trovano l'arbitraggio senza prometterlo", () => {
    /* 2.10 / 2.05 → S = 0,964 < 1: arbitraggio presente */
    const t = testo();
    assert(t.includes("Surebet aritmetica"), "verdetto condizionale a schermo");
    assert(!t.includes("GARANTITO"), "nessuna garanzia nel verdetto");
    assert(!t.toLowerCase().includes("ritorno sicuro"), "nessun ritorno sicuro");
    assert(t.includes("Spesa effettiva"), "la spesa dopo l'arrotondamento è dichiarata");
    assert(t.includes("Nessuna vincita è garantita"), "il limite è nel verdetto");
  });

  await test("surebet: a quota mancante nessun verdetto, solo l'invito", async () => {
    const prima = container.querySelector(
      'input[placeholder="Quota (es. 2.10)"]',
    ) as HTMLInputElement | null;
    await impostaValore(prima, "");
    const t = testo();
    assert(
      t.includes("Inserisci una quota valida"),
      "l'invito compare al posto del verdetto",
    );
    assert(
      !t.includes("Nessuna Surebet (Mercato con Margine)"),
      "nessun overround fittizio a caselle vuote",
    );
  });

  await act(async () => rootSure.unmount());

  /* ---------------------------------------------------------------- */
  /* Green-Up: segni e responsabilità seguono i numeri                  */
  /* ---------------------------------------------------------------- */

  container.textContent = "";
  const rootGreen = createRoot(container as never);
  await act(async () => {
    rootGreen.render(React.createElement(GreenUpCalculator));
  });

  await test("green-up: i valori predefiniti mostrano un trade in profitto", () => {
    /* entrata 2.60, uscita 2.10, commissione 4,5%: quota scesa, trade sopra zero */
    const t = testo();
    assert(!t.includes("Rischio Zero"), "l'etichetta assolutoria è sparita");
    assert(t.includes("perdente a zero"), "la freebet dice ciò che azzera");
    assert(
      t.includes("Coperta dal profitto della puntata"),
      "responsabilità coperta a schermo",
    );
    assert(
      !t.includes("quota di uscita è sopra"),
      "nessun avviso di quota salita su un trade in profitto",
    );
  });

  await test("green-up: a quota salita scattano avviso e responsabilità scoperta", async () => {
    /* gli input sono nell'ordine: entrata, puntata, uscita, commissione */
    const inputs = container.querySelectorAll('input[type="text"]');
    assert(inputs.length === 4, "quattro campi nel calcolatore");
    await impostaValore(inputs[2] as HTMLInputElement, "3.00");
    const t = testo();
    assert(
      t.includes("quota di uscita è sopra quella di entrata"),
      "l'avviso di quota salita compare",
    );
    assert(
      t.includes("Supera il profitto della puntata"),
      "la responsabilità non è più detta coperta",
    );
    assert(
      !t.includes("Coperta dal profitto della puntata"),
      "la frase incondizionata è sparita",
    );
  });

  await act(async () => rootGreen.unmount());

  /* ---------------------------------------------------------------- */
  /* Dutching: sintesi solo a quote complete                            */
  /* ---------------------------------------------------------------- */

  container.textContent = "";
  const rootDutch = createRoot(container as never);
  await act(async () => {
    rootDutch.render(React.createElement(DutchingCalculator));
  });

  await test("dutching: i valori predefiniti mostrano la sintesi", () => {
    const t = testo();
    assert(t.includes("Sintesi Strategia Dutching"), "sintesi a schermo");
    assert(t.includes("Quota sintetica combinata"), "combinata a schermo");
  });

  await test("dutching: a quota mancante nessun numero, solo l'invito", async () => {
    /* text: etichetta esito 1, quota esito 1, etichetta esito 2, ... */
    const inputs = container.querySelectorAll('input[type="text"]');
    await impostaValore(inputs[1] as HTMLInputElement, "");
    const t = testo();
    assert(
      t.includes("Inserisci una quota valida"),
      "l'invito compare al posto della sintesi",
    );
    assert(
      !t.includes("Quota sintetica combinata"),
      "nessuna combinata a caselle vuote",
    );
  });

  await act(async () => rootDutch.unmount());

  /* ---------------------------------------------------------------- */
  /* Pannello quantitativo partita: divario in % con riconciliazione    */
  /* ---------------------------------------------------------------- */

  container.textContent = "";
  const serie = (
    selection: "home" | "draw" | "away",
    current: number,
  ): MarketSeries => ({
    market: "1x2",
    marketLabel: "1X2",
    selection,
    selectionLabel: selection,
    bookmakerKey: "betexplorer-consensus",
    bookmakerName: "Consenso",
    isSharp: false,
    points: [],
    opening: current + 0.3,
    current,
    peak: current + 0.3,
    dropPct: null,
    shiftPp: null,
    pointCount: 2,
    spanMinutes: 120,
    firstAt: null,
    lastAt: new Date("2026-09-05T08:00:00Z").toISOString(),
    depthNote: "",
    shallow: false,
    hasSignal: true,
  });
  /* terna 2.10 / 3.40 / 3.60, selezione 1: overround ~109,9% */
  const terna = [serie("home", 2.1), serie("draw", 3.4), serie("away", 3.6)];
  const rootQuant = createRoot(container as never);
  await act(async () => {
    rootQuant.render(
      React.createElement(MatchQuantPanel, {
        signal: null,
        series: terna[0],
        allSeries: terna,
        homeTeam: "Casa",
        awayTeam: "Ospiti",
      }),
    );
  });

  await test("quant partita: il divario è in % con la differenza in pp", () => {
    const t = testo();
    assert(t.includes("Divario contro la linea senza margine"), "box divario");
    /* edge = fair/currente − 1: deve esserci il % e NON il «pp» sul divario */
    assert(/Divario[\s\S]{0,60}\d+[.,]\d+\s*%/.test(t), "divario in percento");
    assert(t.includes("implicita"), "riconciliazione fair/implicita a schermo");
  });

  await act(async () => rootQuant.unmount());

  console.log(
    `\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`,
  );
  if (failed > 0) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

void main();
