/**
 * Test puri delle notizie pubbliche (Sprint notizie).
 * Eseguire con: npm run test:news
 *
 * Nessun database, nessuna rete reale: la fonte si simula con fetch
 * iniettabile. Si verifica che la cortesia (5s, 20 per finestra) non si
 * possa aggirare, che il parsing legga ciò che c'è e che il fallback di
 * lingua scatti solo quando serve.
 */
import {
  NEWS_MAX_ITEMS,
  DEFAULT_FEEDS_EN,
  DEFAULT_FEEDS_IT,
  fallbackQuery,
  fetchMatchNews,
  filterByTeams,
  italianQuery,
  italianTranslationLink,
  parseNewsRss,
  resetNewsFeedCacheForTests,
  titleMentionsTeam,
} from "../source";
import {
  acquireNewsSlot,
  isWindowExhausted,
  remainingInWindow,
  resetNewsLimiterForTests,
} from "../limiter";

let passed = 0;
let failed = 0;
const failures: string[] = [];
const queue: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>): void {
  queue.push({ name, fn });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expectedVal: T, label = ""): void {
  if (actual !== expectedVal) {
    throw new Error(
      `${label ? label + ": " : ""}atteso ${String(expectedVal)}, ottenuto ${String(actual)}`,
    );
  }
}

const RSS_SAMPLE = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>test</title>
<item>
  <title>Il Catanzaro vince il derby &amp; vola</title>
  <link>https://esempio.it/catanzaro-derby</link>
  <source url="https://esempio.it">Gazzetta di Prova</source>
  <pubDate>Thu, 20 Aug 2026 10:30:00 +0000</pubDate>
</item>
<item>
  <title>Cosenza: rotazioni attese</title>
  <link>https://esempio.org/cosenza-rotazioni</link>
  <News:Source>Testata Estera</News:Source>
  <pubDate>invalid-date</pubDate>
</item>
<item>
  <title></title>
  <link>https://esempio.org/senza-titolo</link>
</item>
</channel></rss>`;

function main(): void {
  console.log("\n=== Notizie pubbliche — regole pure ===\n");
  test("parsing RSS: titolo, link, fonte e data; i monchi si scartano", () => {
    const items = parseNewsRss(RSS_SAMPLE);
    assertEqual(items.length, 2, "due soli item validi");
    assertEqual(items[0].title, "Il Catanzaro vince il derby & vola");
    assertEqual(items[0].source, "Gazzetta di Prova");
    assert(items[0].publishedAt !== null, "data valida letta");
    assertEqual(items[1].publishedAt, null, "data illeggibile → null, non inventata");
    assertEqual(items[1].source, "Testata Estera", "la testata di Bing si legge");
  });

  test("i filtri citano entrambe le squadre, it ed en sono gli stessi termini", () => {
    assert(italianQuery("A", "B") === "A B", "termini semplici, niente sintassi di motore");
    assertEqual(fallbackQuery("A", "B"), italianQuery("A", "B"));
  });

  test("il filtro per squadra: il titolo deve citare la squadra", () => {
    assert(titleMentionsTeam("Il Catanzaro vince il derby", "catanzaro"), "filtro squadra");
    assert(!titleMentionsTeam("Il Catanzaro vince il derby", "cosenza"), "nessuna citazione, nessun match");
    assert(!titleMentionsTeam("Gol di Rossi", "Rom"), "nome corto (3 lettere): non si filtra per caso");
    const items = [
      { title: "Catanzaro in forma", link: "a", source: null, publishedAt: null },
      { title: "Altro sport", link: "b", source: null, publishedAt: null },
      { title: "Cosenza: rotazioni", link: "c", source: null, publishedAt: null },
    ];
    assertEqual(filterByTeams(items, "Catanzaro", "Cosenza").length, 2);
  });

  test("feed di default: Gazzetta in italiano, BBC nel fallback", () => {
    assert(DEFAULT_FEEDS_IT.join(",").includes("gazzetta"), "feed di default");
    assert(DEFAULT_FEEDS_EN.join(",").includes("bbci"), "feed di default");
  });

  test("link di traduzione: url codificato, lingua destinazione italiana", () => {
    const l = italianTranslationLink("https://example.com/news?a=1&b=2");
    assert(l.startsWith("https://translate.google.com/translate?sl=auto&tl=it&u="), "prefisso traduzione");
    assert(l.includes(encodeURIComponent("https://example.com/news?a=1&b=2")), "url codificato");
  });

  test("massimo dichiarato di notizie per partita", () => {
    assert(NEWS_MAX_ITEMS === 6, "sei notizie per partita");
  });

  test("fetch: feed italiano con citazioni non chiama il fallback", async () => {
    resetNewsFeedCacheForTests();
    const calls: string[] = [];
    const fake: typeof fetch = async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response(RSS_SAMPLE, { status: 200 });
    };
    const r = await fetchMatchNews("Catanzaro", "Cosenza", { fetchImpl: fake });
    assert(r.ok, "deve riuscire");
    if (r.ok) {
      assertEqual(r.result.language, "it");
      assert(r.result.items.length > 0, "citazioni trovate");
    }
    assertEqual(calls.length, DEFAULT_FEEDS_IT.length, "solo i feed italiani");
  });

  test("fetch: feed italiano senza citazioni va al fallback e dichiara il vuoto", async () => {
    resetNewsFeedCacheForTests();
    const calls: string[] = [];
    const fake: typeof fetch = async (url: RequestInfo | URL) => {
      calls.push(String(url));
      /* il feed italiano non cita le squadre, quello inglese nemmeno */
      const noMatch =
        '<?xml version="1.0"?><rss version="2.0"><channel><title>vuoto</title>' +
        '<item><title>Altro campionato</title><link>https://x/1</link></item></channel></rss>';
      return new Response(noMatch, { status: 200 });
    };
    const r = await fetchMatchNews("Yaracuyanos", "La Guaira", { fetchImpl: fake });
    assert(r.ok, "la lettura riesce: è vuoto, non guasto");
    if (r.ok) {
      assertEqual(r.result.language, "en");
      assertEqual(r.result.items.length, 0, "zero citazioni: stato valido");
    }
    assertEqual(
      calls.length,
      DEFAULT_FEEDS_IT.length + DEFAULT_FEEDS_EN.length,
      "it poi fallback",
    );
  });

  test("fetch: tutti i feed giù si dichiara irraggiungibile, non si indovina", async () => {
    resetNewsFeedCacheForTests();
    const fake: typeof fetch = async () => new Response("no", { status: 503 });
    const r = await fetchMatchNews("Catanzaro", "Cosenza", { fetchImpl: fake });
    assert(!r.ok, "503 su ogni feed non è ok");
    if (!r.ok) assertEqual(r.reason, "irraggiungibile");
  });

  test("limiter: la prima richiesta passa subito, la seconda attende", async () => {
    resetNewsLimiterForTests();
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };
    const first = await acquireNewsSlot(sleep, 1_000_000);
    const second = await acquireNewsSlot(sleep, 1_000_000 + 1_000);
    assertEqual(first, true);
    assertEqual(second, true);
    assertEqual(sleeps.length, 1, "solo la seconda attende");
    assertEqual(sleeps[0], 4_000, "attende il resto dei 5 secondi");
  });

  test("limiter: 20 richieste per finestra, poi niente slot", async () => {
    resetNewsLimiterForTests();
    const noSleep = async () => {};
    let now = 10_000_000;
    let granted = 0;
    for (let i = 0; i < 25; i += 1) {
      now += 6_000; /* rispetta sempre l'intervallo: conta solo la finestra */
      if (await acquireNewsSlot(noSleep, now)) granted += 1;
    }
    assertEqual(granted, 20, "la ventunesima è oltre il tetto");
    assert(isWindowExhausted(now + 1), "finestra piena dichiarata");
  });

  test("limiter: la finestra si svuota col tempo", () => {
    resetNewsLimiterForTests();
    assertEqual(remainingInWindow(0), 20);
  });

  test("limiter: finestra piena non lancia mai, rifiuta e basta", async () => {
    resetNewsLimiterForTests();
    const noSleep = async () => {};
    let now = 50_000_000;
    for (let i = 0; i < 20; i += 1) {
      now += 6_000;
      assert(await acquireNewsSlot(noSleep, now), "primi 20 concessi");
    }
    assertEqual(await acquireNewsSlot(noSleep, now + 6_000), false, "il 21° rifiutato");
  });
}

async function run(): Promise<void> {
  main();
  for (const { name, fn } of queue) {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${name}: ${msg}`);
      console.log(`  ✗ ${name}\n      ${msg}`);
    }
  }
  console.log(
    `\n${passed} superati, ${failed} non superati su ${passed + failed} totali.`,
  );
  if (failed > 0) {
    console.error("\nFallimenti:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

run();
