/**
 * Test di rendering del blocco «Contesto 360°» — jsdom + React 19.
 * Eseguire con: npm run test:client
 *
 * Copre le regole di dichiarazione dei campi v2, che nessuna funzione pura
 * vede:
 *  1. nessuna chiave grezza snake_case sul DOM (le etichette sono sempre
 *     quelle leggibili, comprese forma_recente_5 e assenze_note);
 *  2. i campi «non noto» non diventano card vuote: finiscono in UNA riga
 *     dichiarativa che lo dice, senza riempirli per simmetria;
 *  3. le card restano solo per i campi con un valore dichiarato e per
 *     l'accordo col movimento;
 *  4. la riga di bassa copertura informativa compare solo quando richiesta.
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

import type { ContextRowView } from "@/lib/repo/context";
import type { ContextFieldDetail } from "@/lib/context/pure";

const CARD_CLASS = ".rounded.border.border-slate-200.bg-white.px-3.py-2";

function detailFields(over: ContextFieldDetail[] = []) {
  const base: ContextFieldDetail[] = [
    {
      key: "livello_categorie",
      valore: "prima serie contro seconda serie",
      fonteUrl: "https://esempio.it/leghe",
      fonteTitolo: "Leghe italiane",
    },
    {
      key: "anomalia_campo",
      valore: "campo neutro",
      fonteUrl: null,
      fonteTitolo: null,
    },
    {
      key: "posta_in_palo",
      valore: "semifinale playoff",
      fonteUrl: "https://esempio.it/coppa",
      fonteTitolo: "Coppa e playoff",
    },
    {
      key: "rotazioni_fatica",
      valore: "non noto",
      fonteUrl: null,
      fonteTitolo: null,
    },
    {
      key: "h2h_e_forma_recente",
      valore: "non noto",
      fonteUrl: null,
      fonteTitolo: null,
    },
    {
      key: "forma_recente_5",
      valore: "non noto",
      fonteUrl: null,
      fonteTitolo: null,
    },
    {
      key: "assenze_note",
      valore: "non noto",
      fonteUrl: null,
      fonteTitolo: null,
    },
    {
      key: "accordo_col_drop",
      valore: "sostiene",
      fonteUrl: null,
      fonteTitolo: null,
    },
  ];
  return base.map((f) => ({ ...f, ...(over.find((o) => o.key === f.key) ?? {}) }));
}

/** Un campo dichiarato «non noto», completo di tutte le proprietà. */
function unknownField(key: ContextFieldDetail["key"]): ContextFieldDetail {
  return { key, valore: "non noto", fonteUrl: null, fonteTitolo: null };
}

function contextView(over: Partial<ContextRowView> = {}): ContextRowView {
  return {
    matchId: 100,
    status: "ok",
    model: "gemini-2.5-flash",
    fields: {
      livelloCategorie: "prima serie contro seconda serie",
      anomaliaCampo: "campo neutro",
      postaInPalo: "semifinale playoff",
      rotazioniFatica: "",
      accordoColDrop: "sostiene",
    },
    detail: {
      grounded: true,
      retrieved: true,
      fields: detailFields(),
      sources: [
        { uri: "https://esempio.it/leghe", title: "Leghe italiane" },
        { uri: "https://esempio.it/notizie", title: "Notizie calcio" },
      ],
      searchProvider: "Tavily",
    },
    sources: [
      { uri: "https://esempio.it/leghe", title: "Leghe italiane" },
      { uri: "https://esempio.it/notizie", title: "Notizie calcio" },
    ],
    searchProvider: "Tavily",
    searchUnavailableReason: null,
    grounded: true,
    generatedAt: "2026-09-04T10:00:00.000Z",
    expiresAt: "2026-09-05T10:00:00.000Z",
    unavailableReason: null,
    usage: { used: 1, limit: 50, exhausted: false },
    ...over,
  };
}

async function main(): Promise<void> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { Context360 } = await import("@/components/Context360");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container as never);

  async function render(
    context: ContextRowView,
    lowInformation = false,
  ): Promise<void> {
    await act(async () => {
      root.render(
        React.createElement(Context360, {
          context,
          news: [],
          now: new Date("2026-09-04T12:00:00.000Z"),
          lowInformation,
        }),
      );
    });
  }

  const testo = () => container.textContent ?? "";

  await render(contextView());

  await test("nessuna chiave grezza snake_case nel DOM", () => {
    const t = testo();
    for (const raw of [
      "forma_recente_5",
      "assenze_note",
      "h2h_e_forma_recente",
      "rotazioni_fatica",
      "livello_categorie",
      "accordo_col_drop",
    ]) {
      assert(!t.includes(raw), `chiave grezza visibile: ${raw}`);
    }
  });

  await test("nessuna card per i campi «non noto»", () => {
    const t = testo();
    assert(!t.includes("non noto"), "il valore «non noto» non si stampa come card");
    const cards = container.querySelectorAll(CARD_CLASS);
    assert(cards.length === 4, `quattro card attese (tre campi + accordo), trovate ${cards.length}`);
  });

  await test("la riga riassuntiva dichiara i campi non recuperati", () => {
    const t = testo();
    assert(
      t.includes("Non recuperati per questa partita:"),
      "riga riassuntiva presente",
    );
    assert(
      t.includes("sono dichiarati, non riempiti per simmetria"),
      "chiusura dichiarativa presente",
    );
    /* etichette in minuscolo, mai chiavi grezze */
    assert(t.includes("forma recente (ultime cinque)"), "etichetta forma recente");
    assert(t.includes("assenze e indisponibilità"), "etichetta assenze");
    assert(t.includes("rotazioni e fatica"), "etichetta rotazioni");
    assert(t.includes("scontri diretti e forma recente"), "etichetta h2h");
  });

  await test("le card restano per i campi con valore e per l'accordo", () => {
    const t = testo();
    assert(t.includes("Livello delle categorie"), "card livello");
    assert(t.includes("prima serie contro seconda serie"), "valore livello");
    assert(t.includes("Anomalia del campo"), "card anomalia");
    assert(t.includes("Accordo col movimento osservato"), "card accordo");
    assert(t.includes("sostiene"), "verdetto accordo");
    assert(t.includes("da fonte recuperata"), "tag fonte sul campo con URL");
    /* il link già citato sotto la card non torna fra le altre fonti */
    const occ = (s: string) => t.split(s).length - 1;
    assert(t.includes("Altre fonti consultate"), "altre fonti presenti");
    assert(occ("Leghe italiane") === 1, "fonte già citata compare una sola volta");
    assert(occ("Notizie calcio") === 1, "la fonte non citata resta fra le altre");
  });

  /* nessun valore dichiarato: resta solo il verdetto dell'accordo */
  await render(
    contextView({
      detail: {
        grounded: true,
        retrieved: true,
        fields: detailFields([
          unknownField("livello_categorie"),
          unknownField("anomalia_campo"),
          unknownField("posta_in_palo"),
          unknownField("h2h_e_forma_recente"),
        ]),
        sources: [],
        searchProvider: "Tavily",
      },
      sources: [],
    }),
  );

  await test("senza campi dichiarati resta una sola card: l'accordo", () => {
    const t = testo();
    const cards = container.querySelectorAll(CARD_CLASS);
    assert(cards.length === 1, `una card attesa, trovate ${cards.length}`);
    assert(t.includes("Accordo col movimento osservato"), "l'accordo resta visibile");
    assert(t.includes("Non recuperati per questa partita:"), "riga dichiarativa presente");
    assert(!t.includes("non noto"), "nessun valore «non noto» stampato");
  });

  /* bassa copertura informativa: la riga è una dichiarazione, non un dato */
  await render(contextView(), true);

  await test("la riga di bassa copertura compare quando richiesta", () => {
    const t = testo();
    assert(
      t.includes("Competizione a bassa copertura informativa"),
      "dichiarazione presente",
    );
    assert(
      t.includes("è normale che diversi campi siano dichiarati non noti"),
      "frase completa",
    );
  });

  await render(contextView(), false);

  await test("senza la condizione la riga non compare", () => {
    assert(
      !testo().includes("bassa copertura informativa"),
      "nessuna dichiarazione fuori luogo",
    );
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
