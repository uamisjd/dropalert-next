/**
 * Test di rendering della SignalCard — jsdom + React 19.
 * Eseguire con: npm run test:client
 *
 * Copre due cose che nessuna funzione pura vede:
 *  1. la gerarchia dell'intestazione (identità del segnale / avvisi / contesto
 *     su tre righe distinte, nell'ordine giusto);
 *  2. il tempo verbale: a partita giocata la carta parla al passato.
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
/* next/link (usato dalla card) tocca `self` e IntersectionObserver: in jsdom
   vanno forniti, altrimenti il render esplode prima di arrivare alle asserzioni. */
g.self = dom.window;
g.IntersectionObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
} as unknown as typeof IntersectionObserver;
g.IS_REACT_ACT_ENVIRONMENT = true;

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

import type { DashboardSignal } from "@/lib/repo/dashboard";

function signal(over: Partial<DashboardSignal> = {}): DashboardSignal {
  return {
    id: 1,
    matchId: 100,
    status: "active",
    homeTeam: "Alfa",
    awayTeam: "Beta",
    league: "Serie X",
    country: "IT",
    kickoffAt: "2026-08-25T19:00:00.000Z",
    market: "1x2",
    marketLabel: "Esito finale",
    selection: "home",
    selectionLabel: "Vittoria casa",
    openingPrice: 2.5,
    peakPrice: 2.6,
    currentPrice: 2.0,
    dropPct: -20,
    shiftPp: 8,
    magnitudeClass: "medium",
    magnitudeLabel: "medio",
    confidenceScore: 63,
    confidenceBand: "medium",
    confidenceLabel: "media",
    level: "reale",
    levelLabel: "Segnale reale",
    booksConfirming: 4,
    booksTotal: 6,
    sharpConfirms: true,
    sharpAvailable: true,
    sustainedMinutes: 40,
    isFlash: false,
    rebounded: false,
    freshness: "live",
    freshnessLabel: "Dati aggiornati",
    freshnessReason: "",
    lastSnapshotAt: "2026-08-25T18:00:00.000Z",
    ageMinutes: 5,
    openGaps: 0,
    summary: "",
    updatedAt: "2026-08-25T18:00:00.000Z",
    algorithmVersion: "suspicion-v2",
    suspicion: null,
    wideDropPct: 18,
    wideDrop: true,
    contextCompact: "fase a gironi, posta alta",
    newsCount: 2,
    newsEmpty: false,
    sparkline: [],
    normalizedScore: 63,
    measurableMax: 80,
    gapMax: 20,
    normalizedBand: "medium",
    normalizedLabel: "Media",
    ...over,
  } as DashboardSignal;
}

async function main(): Promise<void> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { SignalCard } = await import("@/components/SignalCard");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container as never);

  async function render(sig: DashboardSignal, now: Date): Promise<void> {
    await act(async () => {
      root.render(
        React.createElement(SignalCard, { signal: sig, now }),
      );
    });
  }

  const header = () => container.querySelector("header")!;
  const rows = () => Array.from(header().children) as HTMLElement[];
  const rowWith = (text: string) =>
    rows().find((r) => r.textContent?.includes(text)) ?? null;

  /* --- partita da giocare: gerarchia dell'intestazione --- */
  await render(
    signal({
      suspicion: {
        multiplier: 0.8,
        reasons: [{ code: "x", label: "storico", detail: "dettaglio" }],
        scoreBefore: 70,
      },
    }),
    new Date("2026-08-25T18:00:00.000Z"),
  );

  await test("riga 1: livello, tempo e freschezza stanno insieme", () => {
    const r1 = rows()[0];
    assert(r1.textContent!.includes("Segnale reale"), "livello in riga 1");
    assert(r1.textContent!.includes("Dati aggiornati"), "freschezza in riga 1");
  });

  await test("riga 2: avvisi (iper-reazione + drop ampio) prima del titolo", () => {
    const avvisi = rowWith("iper-reazione");
    assert(avvisi !== null, "riga avvisi presente");
    assert(avvisi!.textContent!.includes("drop ampio"), "drop ampio con gli avvisi");
    const h3 = header().querySelector("h3")!;
    assert(
      (avvisi!.compareDocumentPosition(h3) &
        dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      "gli avvisi precedono il titolo",
    );
  });

  await test("riga 3: contesto e notizie dopo il titolo, separati", () => {
    const contesto = rowWith("Contesto:");
    const notizie = rowWith("Notizie:");
    assert(contesto !== null, "riga contesto presente");
    assert(contesto === notizie, "contesto e notizie nella stessa riga");
    const p = header().querySelector("p")!;
    assert(
      (p.compareDocumentPosition(contesto!) &
        dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      "il contesto segue la riga competizione/data",
    );
    assert(
      contesto!.className.includes("border-t"),
      "la riga di contesto è separata da un bordo",
    );
  });

  await test("il contesto non sta nella riga del livello", () => {
    const r1 = rows()[0];
    assert(!r1.textContent!.includes("Contesto:"), "contesto fuori dalla riga 1");
  });

  /* --- partita giocata: la carta parla al passato --- */
  await render(signal(), new Date("2026-08-25T21:00:00.000Z"));

  await test("a partita giocata la frase piana è al passato", () => {
    const testo = container.textContent!;
    assert(testo.includes("si è spostato verso"), `atteso passato, ottenuto: ${testo.slice(0, 0)}`);
    assert(!testo.includes("si sta spostando"), "niente presente progressivo");
  });

  await test("a partita giocata l'etichetta di forza è al passato", () => {
    const testo = container.textContent!;
    assert(
      testo.includes("Il mercato si è mosso") ||
        testo.includes("Movimento ampio") ||
        testo.includes("probabilmente rumore"),
      "etichetta di forza coerente",
    );
    assert(!testo.includes("Il mercato si sta muovendo"), "niente «si sta muovendo»");
  });

  console.log(
    `\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`,
  );
  if (failed > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

void main();
