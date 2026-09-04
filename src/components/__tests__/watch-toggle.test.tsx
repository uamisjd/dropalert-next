/**
 * Test del componente WatchToggle in un DOM reale — jsdom + React 19.
 * Eseguire con: npm run test:client
 *
 * Perché esiste un test con il DOM e non solo sulle funzioni pure: il difetto
 * che questo file copre non vive nella logica della watchlist (già coperta da
 * `test:watchlist`) ma nel contratto con React. `useSyncExternalStore`
 * confronta lo snapshot con `Object.is`: se la lettura restituisce un oggetto
 * nuovo a ogni chiamata, React conclude che il negozio è cambiato a ogni
 * render e rilancia all'infinito, fino a «Maximum update depth exceeded» e
 * allo smontaggio dell'albero. In pratica: cliccare «☆ Segui» rompeva la
 * pagina. Nessuna funzione pura può accorgersene.
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

function assertEqual<T>(actual: T, expected: T, label = ""): void {
  if (actual !== expected) {
    throw new Error(
      `${label ? label + ": " : ""}atteso ${String(expected)}, ottenuto ${String(actual)}`,
    );
  }
}

/* ------------------------------------------------------------------ */

/** Errori di React intercettati: un render in loop li scrive in console. */
const consoleErrors: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => {
  consoleErrors.push(args.map(String).join(" "));
};

async function main(): Promise<void> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { WatchToggle } = await import("@/components/WatchToggle");
  const { WATCHLIST_KEY, parseWatchlist } = await import("@/lib/view/watchlist");

  const ENTRY_KEY = "m:1";
  const container = dom.window.document.getElementById("root")!;
  const button = () =>
    dom.window.document.querySelector("button") as HTMLElement | null;

  const root = createRoot(container as never);
  await act(async () => {
    root.render(
      React.createElement(WatchToggle, {
        entryKey: ENTRY_KEY,
        matchId: 1,
        homeTeam: "Casa",
        awayTeam: "Ospite",
        kickoffAt: new Date().toISOString(),
      }),
    );
  });

  function storage(): string | null {
    return dom.window.localStorage.getItem(WATCHLIST_KEY);
  }

  await test("partenza: partita non seguita", () => {
    assertEqual(button()?.textContent, "☆ Segui", "etichetta");
    assertEqual(button()?.getAttribute("aria-pressed"), "false", "aria-pressed");
    assertEqual(storage(), null, "localStorage vuoto");
  });

  await test("un clic su «Segui» non manda React in loop", async () => {
    await act(async () => {
      button()?.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    });
    assertEqual(
      consoleErrors.filter((e) => /getSnapshot should be cached/.test(e)).length,
      0,
      "nessun avviso di snapshot non memorizzato",
    );
  });

  await test("dopo il clic la partita è seguita e salvata nel browser", () => {
    assertEqual(button()?.textContent, "★ Seguita", "etichetta");
    assertEqual(button()?.getAttribute("aria-pressed"), "true", "aria-pressed");
    const list = parseWatchlist(storage());
    assertEqual(list.length, 1, "una voce salvata");
    assertEqual(list[0]?.key, ENTRY_KEY, "chiave della voce");
  });

  await test("la soglia personale resta scritta sulla stessa voce", async () => {
    const soglia = dom.window.document.querySelectorAll("button")[1] as
      | HTMLElement
      | undefined;
    assert(soglia !== undefined, "il pannello delle soglie è aperto");
    await act(async () => {
      soglia?.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    });
    const list = parseWatchlist(storage());
    assertEqual(list.length, 1, "nessuna voce duplicata");
    assertEqual(list[0]?.thresholdKind, "indice", "tipo di soglia");
    assertEqual(list[0]?.thresholdValue, 60, "valore di soglia");
  });

  await test("un secondo clic toglie la partita dalle preferite", async () => {
    await act(async () => {
      button()?.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    });
    assertEqual(button()?.textContent, "☆ Segui", "etichetta");
    assertEqual(parseWatchlist(storage()).length, 0, "lista svuotata");
  });

  await test(
    "partita già seguita all'apertura: nessuna tempesta di render",
    async () => {
      /* è lo stato che si trova tornando sulla pagina il giorno dopo */
      await act(async () => {
        dom.window.localStorage.setItem(
          WATCHLIST_KEY,
          JSON.stringify([
            {
              key: ENTRY_KEY,
              matchId: 1,
              homeTeam: "Casa",
              awayTeam: "Ospite",
              kickoffAt: new Date().toISOString(),
              thresholdKind: null,
              thresholdValue: null,
              addedAt: new Date().toISOString(),
            },
          ]),
        );
        dom.window.dispatchEvent(new dom.window.Event("dropalert:watchlist"));
      });
      assertEqual(button()?.textContent, "★ Seguita", "etichetta");
      assertEqual(
        consoleErrors.filter((e) => /Maximum update depth/.test(e)).length,
        0,
        "nessun superamento della profondità di aggiornamento",
      );
    },
  );

  await test("nessun errore React in console su tutto il percorso", () => {
    assertEqual(
      consoleErrors.filter((e) => /Warning|Maximum update/.test(e)).join(" | "),
      "",
      "console pulita",
    );
  });

  await act(async () => root.unmount());
  console.error = originalError;

  console.log(
    `\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`,
  );
  if (failed > 0) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

void main();
