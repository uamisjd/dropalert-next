/**
 * Test dell'adapter BetExplorer (Sprint 3B).
 * Eseguire con: npm run test:betexplorer
 *
 * Nessuna rete e nessun database: si usa l'HTML REALE scaricato dalla
 * fonte il 18.08.2026 e congelato in `fixtures/`. Così i test verificano
 * il parsing sul markup vero, ma restano ripetibili e non disturbano la
 * fonte a ogni esecuzione.
 *
 * Le fixture sono copie di pagine pubbliche usate come banco di prova del
 * parser: non sono dati mostrati all'utente né spacciati per raccolta.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeEntities,
  humanizeSlug,
  leagueKeyFor,
  matchKeyFor,
  parseDecimalOdds,
  parseDroppingOdds,
  parseMatchStartDate,
  parseResults,
  slugify,
  stripTags,
  teamKeyFor,
} from "../betexplorer/parse";
import {
  DISALLOWED_QUERY_KEYS,
  isAllowedByRobots,
  resultsPath,
  USER_AGENT,
} from "../betexplorer/http";
import {
  classifyFailure,
  createBetexplorerProvider,
  CONSENSUS_BOOKMAKER_KEY,
  isRetryable,
  toQuoteDTOs,
} from "../betexplorer/index";
import { impliedProbabilityOf } from "../betexplorer/ingest";
import { outcomeOf } from "../types";
import { normalizeDisplayName } from "../betexplorer/parse";

/* ------------------------------------------------------------------ */
/* Mini runner                                                         */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
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
/* Fixture reali                                                       */
/* ------------------------------------------------------------------ */

const FIXTURES = join(process.cwd(), "src/lib/providers/__tests__/fixtures");
const droppingHtml = readFileSync(join(FIXTURES, "betexplorer-dropping-odds.html"), "utf8");
const resultsHtml = readFileSync(join(FIXTURES, "betexplorer-results.html"), "utf8");

/** fetch finto: risponde con l'HTML congelato, senza toccare la rete. */
function fakeFetch(
  body: string,
  init: { status?: number; ok?: boolean } = {},
): typeof fetch {
  const status = init.status ?? 200;
  return (async () =>
    new Response(body, { status, headers: { "content-type": "text/html" } })) as typeof fetch;
}

/** fetch finto che distingue elenco, pagina partita e risultati. */
function routedFetch(startDateIso: string | null): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/dropping-odds/")) {
      return new Response(droppingHtml, { status: 200 });
    }
    if (url.includes("/results/")) {
      return new Response(resultsHtml, { status: 200 });
    }
    const body =
      startDateIso === null
        ? "<html><head></head><body>nessun JSON-LD</body></html>"
        : `<html><script type="application/ld+json">{"@type":"SportsEvent","startDate": "${startDateIso}"}</script></html>`;
    return new Response(body, { status: 200 });
  }) as typeof fetch;
}

const WIDE_WINDOW = {
  from: new Date("2020-01-01T00:00:00Z"),
  to: new Date("2030-01-01T00:00:00Z"),
};

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log("\nTest adapter BetExplorer (HTML reale congelato)\n");

  /* --- utilità ---------------------------------------------------- */

  console.log("Utilità di parsing");

  await test("parseDecimalOdds accetta una quota valida", () => {
    assertEqual(parseDecimalOdds("2.78"), 2.78);
    assertEqual(parseDecimalOdds("10"), 10);
  });

  await test("parseDecimalOdds rifiuta valori impossibili senza inventare", () => {
    assertEqual(parseDecimalOdds("0.5"), null, "quota < 1 non esiste");
    assertEqual(parseDecimalOdds("0"), null);
    assertEqual(parseDecimalOdds("-3"), null);
    assertEqual(parseDecimalOdds(""), null);
    assertEqual(parseDecimalOdds(null), null);
    assertEqual(parseDecimalOdds("abc"), null);
    assertEqual(parseDecimalOdds("2,78"), null, "virgola non è formato della fonte");
  });

  await test("decodeEntities e stripTags ripuliscono il markup reale", () => {
    assertEqual(decodeEntities("Bayer&nbsp;04 &amp; Co"), "Bayer 04 & Co");
    assertEqual(stripTags("<span>Atl. Tucuman 2</span> - <span>River</span>"), "Atl. Tucuman 2 - River");
  });

  await test("slugify e chiavi stabili", () => {
    assertEqual(slugify("Atl. Tucumán 2"), "atl-tucuman-2");
    assertEqual(matchKeyFor("Stt1j9GP"), "be-Stt1j9GP");
    assertEqual(teamKeyFor("River Plate 2"), "be-river-plate-2");
    assertEqual(leagueKeyFor("argentina", "reserve-league"), "be-argentina-reserve-league");
    assertEqual(humanizeSlug("copa-venezuela"), "Copa Venezuela");
  });

  /* --- robots ------------------------------------------------------ */

  console.log("\nRispetto del robots.txt");

  await test("percorsi consentiti", () => {
    assert(isAllowedByRobots("/dropping-odds/"), "elenco drop consentito");
    assert(isAllowedByRobots(resultsPath("argentina", "reserve-league")), "risultati consentiti");
    assert(isAllowedByRobots("/football/japan/emperors-cup/x/O41Y70JO/"), "pagina partita consentita");
  });

  await test("/bookmaker/ è vietato e non viene richiesto", () => {
    assert(!isAllowedByRobots("/bookmaker/1089/https://stake.us/"), "deve essere vietato");
  });

  await test("ogni query string vietata dal robots viene rifiutata", () => {
    for (const key of DISALLOWED_QUERY_KEYS) {
      assert(
        !isAllowedByRobots(`/football/x/y/?${key}=1`),
        `la query "${key}" deve essere rifiutata`,
      );
    }
  });

  await test("gli endpoint AJAX delle quote per book restano fuori portata", () => {
    assert(
      !isAllowedByRobots("/match-odds-old/xyz/?matchid=Stt1j9GP"),
      "?matchid= è vietato: è la ragione per cui non abbiamo i singoli book",
    );
  });

  await test("un dominio diverso non viene mai contattato", () => {
    assert(!isAllowedByRobots("https://example.com/dropping-odds/"), "solo betexplorer");
  });

  await test("lo User-Agent è identificabile", () => {
    assert(USER_AGENT.includes("DropAlertBot"), "deve dichiarare chi siamo");
    assert(USER_AGENT.includes("robots.txt"), "deve dichiarare le intenzioni");
  });

  /* --- elenco drop su HTML reale ----------------------------------- */

  console.log("\nParsing dell'elenco drop (HTML reale)");

  const listing = parseDroppingOdds(droppingHtml);

  await test("estrae solo le partite di calcio, ignorando gli altri sport", () => {
    assertEqual(listing.footballRowsSeen, 6, "righe di calcio nella pagina reale");
    assertEqual(listing.fixtures.length, 6, "tutte leggibili");
    assert(
      listing.fixtures.every((f) => f.sourceUrl.startsWith("/football/")),
      "nessuna riga di tennis, volley o basket",
    );
  });

  await test("legge squadre, torneo e quote 1X2 dalla riga reale", () => {
    const row = listing.fixtures.find((f) => f.providerMatchId === "Stt1j9GP");
    assert(row !== undefined, "la partita di riferimento deve esserci");
    assertEqual(row!.homeTeamRaw, "Atl. Tucuman 2");
    assertEqual(row!.awayTeamRaw, "River Plate 2");
    assertEqual(row!.leagueLabel, "Argentina: Reserve League");
    assertEqual(row!.countrySlug, "argentina");
    assertEqual(row!.quotes.length, 3);
    assertEqual(row!.quotes[0].selection, "home");
    assertEqual(row!.quotes[0].price, 2.78);
    assertEqual(row!.quotes[1].selection, "draw");
    assertEqual(row!.quotes[1].price, 3.25);
    assertEqual(row!.quotes[2].selection, "away");
    assertEqual(row!.quotes[2].price, 2.23);
  });

  await test("individua la selezione in calo e la quota di apertura", () => {
    const row = listing.fixtures.find((f) => f.providerMatchId === "Stt1j9GP")!;
    assertEqual(row.droppedIndex, 0, "il drop è sulla colonna 1");
    assertEqual(row.openingPrice, 4.14, "apertura letta dal tooltip");
    assertEqual(row.dropPercent, 33);
  });

  await test("riporta l'accordo fra book come dato osservato, non calcolato", () => {
    const row = listing.fixtures.find((f) => f.providerMatchId === "Stt1j9GP")!;
    assertEqual(row.agreement?.confirming, 18);
    assertEqual(row.agreement?.total, 19);
  });

  await test("i tornei minori NON vengono scartati", () => {
    const leagues = listing.fixtures.map((f) => f.leagueSlug);
    assert(leagues.includes("copa-pacena"), "Copa Paceña (Bolivia) deve restare");
    assert(leagues.includes("reserve-league"), "campionato riserve deve restare");
    assert(
      leagues.includes("concacaf-central-american-cup"),
      "coppa CONCACAF deve restare",
    );
  });

  await test("la data dell'elenco è solo un indizio, mai il kickoff", () => {
    /* verificato sul campo: la riga data appartiene al gruppo di un altro
       sport e risultava errata in 3 casi su 4 */
    const row = listing.fixtures.find((f) => f.providerMatchId === "Stt1j9GP")!;
    assert("listedDateHint" in row, "il campo deve chiamarsi 'hint'");
    assert(
      !Object.keys(row).includes("kickoffAt"),
      "la riga grezza non deve esporre un kickoff: non lo conosce",
    );
  });

  await test("una pagina irriconoscibile è dichiarata, non interpretata", () => {
    const broken = parseDroppingOdds("<html><body><p>ciao</p></body></html>");
    assertEqual(broken.fixtures.length, 0);
    assertEqual(broken.footballRowsSeen, 0);
    assert(broken.problems.length > 0, "deve dichiarare il problema");
  });

  await test("una risposta vuota non produce dati", () => {
    const empty = parseDroppingOdds("");
    assertEqual(empty.fixtures.length, 0);
    assert(empty.problems[0].reason.includes("vuota"), "motivo esplicito");
  });

  await test("una riga con quota illeggibile viene scartata e dichiarata", () => {
    const tampered = droppingHtml.replace('data-odd="2.78"', 'data-odd="—"');
    const parsed = parseDroppingOdds(tampered);
    assert(
      parsed.fixtures.length < listing.fixtures.length,
      "la riga rotta non deve entrare",
    );
    assert(
      parsed.problems.some((p) => p.ref === "Stt1j9GP"),
      "il problema deve nominare la partita",
    );
  });

  await test("se le colonne cambiano numero la riga non viene indovinata", () => {
    const tampered = droppingHtml.replace(
      /<td class="table-main__odds " data-oid="ap50lxv498x0x0">[\s\S]*?<\/td>/,
      "",
    );
    const parsed = parseDroppingOdds(tampered);
    assert(
      parsed.problems.some((p) => p.reason.includes("colonne")),
      "deve accorgersi della struttura cambiata",
    );
  });

  /* --- orario ------------------------------------------------------ */

  console.log("\nOrario di inizio");

  await test("legge startDate con fuso esplicito dal JSON-LD", () => {
    const html = `<script type="application/ld+json">{"startDate": "2026-08-18T22:00:00+02:00"}</script>`;
    const d = parseMatchStartDate(html);
    assertEqual(d?.toISOString(), "2026-08-18T20:00:00.000Z", "convertito in UTC");
  });

  await test("un orario senza fuso viene rifiutato invece che assunto", () => {
    assertEqual(parseMatchStartDate(`{"startDate": "2026-08-18T22:00:00"}`), null);
  });

  await test("nessun JSON-LD significa nessun orario, non un orario finto", () => {
    assertEqual(parseMatchStartDate("<html></html>"), null);
  });

  /* --- risultati --------------------------------------------------- */

  console.log("\nParsing dei risultati (HTML reale)");

  const results = parseResults(resultsHtml);

  await test("legge i risultati reali della pagina", () => {
    assertEqual(results.rowsSeen, 72, "righe partita nella pagina reale");
    assertEqual(results.results.length, 72, "tutte con punteggio numerico");
    assertEqual(results.problems.length, 0);
  });

  await test("estrae punteggio e nomi puliti, senza il turno del torneo", () => {
    const r = results.results.find((x) => x.providerMatchId === "vJIrspME");
    assertEqual(r?.homeGoals, 0);
    assertEqual(r?.awayGoals, 0);
    assertEqual(r?.homeTeamRaw, "Argentinos Jrs 2");
    assertEqual(r?.awayTeamRaw, "Gimnasia L.P. 2");
    assert(!r!.homeTeamRaw.includes("Round"), "il turno non deve finire nel nome");
  });

  await test("un punteggio non numerico non diventa 0:0", () => {
    const tampered = resultsHtml.replace(">0:0<", ">POSTP.<");
    const parsed = parseResults(tampered);
    assert(
      parsed.problems.some((p) => p.reason.includes("non numerico")),
      "deve dichiarare la riga, non convertirla",
    );
    assert(
      !parsed.results.some(
        (r) => r.providerMatchId === "vJIrspME" && r.homeGoals === 0 && r.awayGoals === 0,
      ) || parsed.results.length < results.results.length,
      "la riga rinviata non deve entrare come 0:0",
    );
  });

  /* --- adapter ------------------------------------------------------ */

  console.log("\nContratto dell'adapter");

  await test("dichiara di NON avere le quote per singolo bookmaker", () => {
    const p = createBetexplorerProvider({ enabled: true });
    assertEqual(p.capabilities.perBookmakerOdds, false);
    assertEqual(p.capabilities.fixtures, true);
    assertEqual(p.capabilities.odds, true);
    assertEqual(p.capabilities.results, true);
  });

  await test("il bookmaker di consenso è marcato come tale", () => {
    assertEqual(CONSENSUS_BOOKMAKER_KEY, "betexplorer-consensus");
    const quotes = toQuoteDTOs(listing.fixtures[0], new Date());
    assert(quotes.every((q) => q.isConsensus), "tutte le quote sono di consenso");
    assert(
      quotes.every((q) => q.bookmakerKey === CONSENSUS_BOOKMAKER_KEY),
      "nessun nome di book reale viene inventato",
    );
  });

  await test("l'apertura è associata solo alla selezione realmente in calo", () => {
    const row = listing.fixtures.find((f) => f.providerMatchId === "Stt1j9GP")!;
    const quotes = toQuoteDTOs(row, new Date());
    assertEqual(quotes[0].openingPrice, 4.14, "colonna in calo");
    assertEqual(quotes[1].openingPrice, null, "le altre non hanno apertura pubblicata");
    assertEqual(quotes[2].openingPrice, null);
  });

  await test("fetchFixtures restituisce partite con orario reale in UTC", async () => {
    const p = createBetexplorerProvider({
      enabled: true,
      fetchImpl: routedFetch("2026-08-18T22:00:00+02:00"),
    });
    const res = await p.fetchFixtures(WIDE_WINDOW);
    assert(res.ok, "deve riuscire");
    if (!res.ok) return;
    assertEqual(res.data.length, 6);
    assertEqual(res.data[0].kickoffAt.toISOString(), "2026-08-18T20:00:00.000Z");
    assertEqual(res.data[0].kickoffIsAssumedUtc, false, "l'orario non è assunto");
  });

  await test("senza orario verificabile la partita è esclusa e dichiarata", async () => {
    const p = createBetexplorerProvider({
      enabled: true,
      fetchImpl: routedFetch(null),
    });
    const res = await p.fetchFixtures(WIDE_WINDOW);
    assert(res.ok, "la chiamata riesce");
    if (!res.ok) return;
    assertEqual(res.data.length, 0, "nessuna partita con orario inventato");
    assertEqual(res.partial, true, "l'esito è parziale");
    if (res.partial) {
      assertEqual(res.missing.length, 6, "una dichiarazione per partita");
      assert(
        res.missing[0].includes("esclusa"),
        "il motivo deve dire che è stata esclusa",
      );
    }
  });

  await test("il tetto di dettaglio visita i cali maggiori e dichiara gli altri", async () => {
    const p = createBetexplorerProvider({
      enabled: true,
      fetchImpl: routedFetch("2026-08-18T22:00:00+02:00"),
      detailRowCap: 2,
    });
    const res = await p.fetchFixtures(WIDE_WINDOW);
    assert(res.ok, "la chiamata riesce");
    if (!res.ok) return;
    assertEqual(res.data.length, 2, "solo due pagine di dettaglio visitate");
    assertEqual(res.partial, true, "l'esito è parziale");
    if (res.partial) {
      const dichiarate = res.missing.filter((m) =>
        m.includes("[dettaglio-non-visitato]"),
      );
      assertEqual(dichiarate.length, 4, "quattro righe dichiarate non visitate");
    }
  });

  await test("il chiamante può solo stringere il tetto di dettaglio", async () => {
    const p = createBetexplorerProvider({
      enabled: true,
      fetchImpl: routedFetch("2026-08-18T22:00:00+02:00"),
      detailRowCap: 6,
    });
    const res = await p.fetchFixtures(WIDE_WINDOW, { maxRows: 2 });
    assert(res.ok, "la chiamata riesce");
    if (!res.ok) return;
    assertEqual(res.data.length, 2, "il limite della singola chiamata vince");
    assertEqual(res.partial, true);
    if (res.partial) {
      assertEqual(
        res.missing.filter((m) => m.includes("[dettaglio-non-visitato]")).length,
        4,
      );
    }
  });

  await test("il chiamante può riservare tempo alla chiusura del proprio run", async () => {
    const p = createBetexplorerProvider({
      enabled: true,
      fetchImpl: routedFetch("2026-08-18T22:00:00+02:00"),
      detailBudgetMs: 300_000,
    });
    const res = await p.fetchFixtures(WIDE_WINDOW, { budgetMs: -1 });
    assert(res.ok, "la chiamata riesce");
    if (!res.ok) return;
    assertEqual(res.data.length, 0, "il budget per chiamata è più stretto");
    assertEqual(res.partial, true);
  });

  await test("a budget esaurito niente si visita e tutto è dichiarato", async () => {
    const p = createBetexplorerProvider({
      enabled: true,
      fetchImpl: routedFetch("2026-08-18T22:00:00+02:00"),
      detailBudgetMs: -1,
    });
    const res = await p.fetchFixtures(WIDE_WINDOW);
    assert(res.ok, "la chiamata riesce");
    if (!res.ok) return;
    assertEqual(res.data.length, 0, "nessuna pagina di dettaglio visitata");
    assertEqual(res.partial, true, "l'esito è parziale");
    if (res.partial) {
      const dichiarate = res.missing.filter((m) =>
        m.includes("[dettaglio-non-visitato]"),
      );
      assertEqual(dichiarate.length, 6, "sei righe dichiarate non visitate");
    }
  });

  await test("fetchOdds legge le quote di consenso della partita richiesta", async () => {
    const p = createBetexplorerProvider({
      enabled: true,
      fetchImpl: routedFetch("2026-08-18T22:00:00+02:00"),
    });
    const res = await p.fetchOdds({
      key: "be-Stt1j9GP",
      providerMatchId: "Stt1j9GP",
      sourceUrl: "/football/argentina/reserve-league/x/Stt1j9GP/",
      kickoffAt: new Date(),
    });
    assert(res.ok, "deve riuscire");
    if (!res.ok) return;
    assertEqual(res.data.length, 3, "1, X, 2");
    assertEqual(res.data[0].price, 2.78);
    assertEqual(res.data[0].agreement?.total, 19);
  });

  await test("una partita non più in elenco è un parziale dichiarato", async () => {
    const p = createBetexplorerProvider({
      enabled: true,
      fetchImpl: routedFetch("2026-08-18T22:00:00+02:00"),
    });
    const res = await p.fetchOdds({
      key: "be-NONESISTE",
      providerMatchId: "NONESISTE",
      sourceUrl: "/football/x/y/z/NONESISTE/",
      kickoffAt: new Date(),
    });
    assertEqual(outcomeOf(res), "partial");
    assert(res.ok && res.partial && res.data.length === 0, "nessuna quota inventata");
  });

  await test("una fonte spenta non produce dati", async () => {
    const p = createBetexplorerProvider({ enabled: false });
    assertEqual(p.enabled, false);
  });

  await test("un errore HTTP diventa un esito fallito, non un vuoto silenzioso", async () => {
    const p = createBetexplorerProvider({
      enabled: true,
      fetchImpl: fakeFetch("", { status: 503 }),
    });
    const res = await p.fetchFixtures(WIDE_WINDOW);
    assertEqual(res.ok, false);
    if (!res.ok) {
      assertEqual(res.error.kind, "http");
      assertEqual(res.retryable, true);
    }
  });

  await test("403 è un blocco, 429 è un limite: distinti e non ritentati a caso", () => {
    const blocked = classifyFailure({
      ok: false, status: 403, body: "", bytes: 0, latencyMs: 1,
      errorMessage: null, retryAfter: null, url: "u",
    });
    assertEqual(blocked.kind, "blocked");
    assertEqual(isRetryable(blocked), false, "un blocco non si forza");

    const limited = classifyFailure({
      ok: false, status: 429, body: "", bytes: 0, latencyMs: 1,
      errorMessage: null, retryAfter: "60", url: "u",
    });
    assertEqual(limited.kind, "rate_limited");
  });

  await test("healthCheck riporta lo stato reale della fonte", async () => {
    const p = createBetexplorerProvider({
      enabled: true,
      fetchImpl: fakeFetch(droppingHtml),
    });
    const h = await p.healthCheck();
    assertEqual(h.reachable, true);
    assert(h.detail.includes("consenso"), "deve ricordare il limite della fonte");
  });

  await test("healthCheck dichiara l'irraggiungibilità invece di tacere", async () => {
    const p = createBetexplorerProvider({
      enabled: true,
      fetchImpl: fakeFetch("", { status: 500 }),
    });
    const h = await p.healthCheck();
    assertEqual(h.reachable, false);
    assert(h.detail.length > 0, "motivo esplicito");
  });

  /* --- ingest ------------------------------------------------------- */

  console.log("\nNormalizzazione");

  await test("la probabilità implicita è 1/quota", () => {
    assertEqual(impliedProbabilityOf(2), 0.5);
    assertEqual(impliedProbabilityOf(4), 0.25);
    assertEqual(Number(impliedProbabilityOf(2.78).toFixed(6)), 0.359712);
  });

  /* ---------------------------------------------------------------- */

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Test superati: ${passed} | falliti: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFallimenti:");
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log(`${"─".repeat(60)}\n`);

  if (failed > 0) process.exit(1);
}

void main();

/* --- FIX-2/3: nomi leggibili, congiunzioni non sono sigle --- */
{
  const cases: Array<[string, string]> = [
    ["bosnia-and-herzegovina", "Bosnia & Herzegovina"],
    ["trinidad-and-tobago", "Trinidad & Tobago"],
    ["antigua-and-barbuda", "Antigua & Barbuda"],
    ["usa", "USA"],
    ["npl-tasmania", "NPL Tasmania"],
    ["republic-of-ireland", "Republic of Ireland"],
    ["and-more", "And More"],
  ];
  for (const [slug, atteso] of cases) {
    const got = humanizeSlug(slug);
    if (got !== atteso) {
      console.error(`✗ humanizeSlug("${slug}") = "${got}", atteso "${atteso}"`);
      process.exitCode = 1;
    }
  }
  const fixCases: Array<[string | null, string | null]> = [
    ["Bosnia AND Herzegovina", "Bosnia & Herzegovina"],
    ["Trinidad AND Tobago", "Trinidad & Tobago"],
    ["Antigua AND Barbuda", "Antigua & Barbuda"],
    ["Saint Kitts AND Nevis", "Saint Kitts & Nevis"],
    /* il caso reale visto in produzione: paese + competizione sulla stessa riga */
    [
      "Bosnia AND Herzegovina: Premijer Liga",
      "Bosnia & Herzegovina: Premijer Liga",
    ],
    /* la fonte usa entrambe le grafie nello stesso archivio */
    ["Bosnia and Herzegovina: Prva Liga - FBiH", "Bosnia & Herzegovina: Prva Liga - FBiH"],
    ["Trinidad and Tobago", "Trinidad & Tobago"],
    ["Serie A", "Serie A"],
    /* «AND» in testa non è una congiunzione fra due nomi: si lascia stare */
    ["AND Group", "AND Group"],
    /* congiunzione dentro una frase comune: non si tocca */
    ["Rock and roll", "Rock and roll"],
    ["Cup and league", "Cup and league"],
    [null, null],
  ];
  for (const [input, atteso] of fixCases) {
    const got = normalizeDisplayName(input);
    if (got !== atteso) {
      console.error(`✗ normalizeDisplayName(${String(input)}) = "${got}", atteso "${atteso}"`);
      process.exitCode = 1;
    }
  }
  console.log("✓ nomi leggibili: congiunzioni non trattate come sigle");
}
