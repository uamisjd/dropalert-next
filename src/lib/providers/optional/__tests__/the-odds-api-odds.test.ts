/**
 * Test del parsing di The Odds API — fixture JSON congelata, nessuna rete.
 * Eseguire con: npm run test:odds-adapter
 *
 * La fixture è la forma reale della risposta `GET /v4/sports/{key}/odds`
 * (bookmakers → markets → outcomes). I test bloccano le regole di onestà:
 * ogni book è una serie reale, i nomi non risolvibili si contano e non si
 * indovinano, i mercati non gestiti non producono quote.
 */
import {
  bookSpread,
  countSeries,
  extractBookLines,
  isSharpBookmaker,
  parseOddsResponse,
  type TheOddsApiEvent,
} from "../the-odds-api-odds";
import { fetchSharpLine, normalizeSharpSnapshot } from "../odds-api-sharp";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(
    `${name} — atteso ${String(expected)}, ottenuto ${String(actual)}`,
    Object.is(actual, expected),
  );
}

const now = new Date("2026-09-05T18:00:00Z");

/* risposta reale tipica: due book, h2h completo, Pinnacle sharp */
const event: TheOddsApiEvent = {
  id: "abc123",
  sport_key: "soccer_epl",
  commence_time: "2026-09-06T14:00:00Z",
  home_team: "Arsenal",
  away_team: "Chelsea",
  bookmakers: [
    {
      key: "pinnacle",
      title: "Pinnacle",
      last_update: "2026-09-05T17:50:00Z",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Arsenal", price: 2.1 },
            { name: "Chelsea", price: 3.6 },
            { name: "Draw", price: 3.4 },
          ],
        },
      ],
    },
    {
      key: "bet365",
      title: "Bet365",
      last_update: "2026-09-05T17:51:00Z",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Arsenal", price: 2.05 },
            { name: "Chelsea", price: 3.7 },
            { name: "Draw", price: 3.5 },
          ],
        },
        {
          key: "totals",
          point: 2.5,
          outcomes: [
            { name: "Over", price: 1.9 },
            { name: "Under", price: 1.95 },
          ],
        },
      ],
    },
  ],
};

const r = parseOddsResponse(event, { fixtureKey: "be-x1", observedAt: now });

eq("due book visti", r.bookmakersSeen, 2);
eq("due book usati", r.bookmakersUsed, 2);
eq("nessun esito saltato", r.skippedOutcomes, 0);
/* pinnacle 3 (1x2) + bet365 3 (1x2) + bet365 2 (ou) = 8 */
eq("otto quote tradotte", r.quotes.length, 8);

const homePinnacle = r.quotes.find(
  (q) => q.bookmakerKey === "pinnacle" && q.selection === "home",
);
check("pinnacle casa presente", homePinnacle !== undefined);
eq("prezzo pinnacle casa", homePinnacle?.price, 2.1);
eq("non è un consenso", homePinnacle?.isConsensus, false);
eq("mercato 1x2", homePinnacle?.market, "1x2");
eq("istante dalla fonte", homePinnacle?.observedAt.toISOString(), "2026-09-05T17:50:00.000Z");

const over = r.quotes.find((q) => q.market === "ou_2_5" && q.selection === "over");
check("over 2.5 tradotto", over !== undefined);
eq("prezzo over", over?.price, 1.9);

/* tre book distinti sul 1x2 → la coordinazione diventa misurabile */
const books1x2 = new Set(
  r.quotes.filter((q) => q.market === "1x2").map((q) => q.bookmakerKey),
);
eq("due book sul 1x2", books1x2.size, 2);
eq("serie distinte = 3 (2x 1x2 + 1x ou)", countSeries(r), 3);

/* --- i nomi non risolvibili si contano, non si indovinano --- */
const strano: TheOddsApiEvent = {
  ...event,
  bookmakers: [
    {
      key: "bet365",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Arsenal", price: 2.05 },
            { name: "Squadra Sconosciuta", price: 3.0 },
            { name: "Draw", price: 3.5 },
          ],
        },
      ],
    },
  ],
};
const rs = parseOddsResponse(strano, { fixtureKey: "be-x1", observedAt: now });
eq("esito non risolvibile contato", rs.skippedOutcomes, 1);
eq("le quote risolvibili restano", rs.quotes.length, 2);
check(
  "nessuna quota attribuita a squadra sconosciuta",
  rs.quotes.every((q) => q.selection !== "away" || q.price !== 3.0),
);

/* --- prezzi non validi scartati --- */
const invalido: TheOddsApiEvent = {
  ...event,
  bookmakers: [
    {
      key: "bet365",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Arsenal", price: 1 }, // quota 1 = non valida
            { name: "Chelsea", price: 3.7 },
            { name: "Draw", price: 3.5 },
          ],
        },
      ],
    },
  ],
};
const ri = parseOddsResponse(invalido, { fixtureKey: "be-x1", observedAt: now });
eq("prezzo non valido contato", ri.skippedOutcomes, 1);
eq("le quote valide restano", ri.quotes.length, 2);

/* --- mercati non gestiti ignorati e contati come book visto ma non usato --- */
const soloProps: TheOddsApiEvent = {
  ...event,
  bookmakers: [
    { key: "draftkings", markets: [{ key: "player_specials", outcomes: [] }] },
  ],
};
const rp = parseOddsResponse(soloProps, { fixtureKey: "be-x1", observedAt: now });
eq("book visto", rp.bookmakersSeen, 1);
eq("book non usato", rp.bookmakersUsed, 0);
eq("nessuna quota", rp.quotes.length, 0);

/* --- risposta vuota non produce nulla ma non lancia --- */
const vuota = parseOddsResponse({ id: "x" }, { fixtureKey: "be-x1", observedAt: now });
eq("evento vuoto: zero quote", vuota.quotes.length, 0);
eq("evento vuoto: zero book", vuota.bookmakersSeen, 0);

/* --- classificazione sharp --- */
eq("pinnacle è sharp", isSharpBookmaker("pinnacle"), true);
eq("betfair_ex_eu è sharp", isSharpBookmaker("betfair_ex_eu"), true);
eq("bet365 non è sharp", isSharpBookmaker("bet365"), false);
eq("chiave vuota non è sharp", isSharpBookmaker(""), false);


/* ------------------------------------------------------------------ */
/* dispersione fra book: misurata, non stimata                         */
/* ------------------------------------------------------------------ */

const lines = extractBookLines(event, now).lines;
eq("righe per book estratte", lines.length, 8);
eq("pinnacle marcato sharp", lines.find((l) => l.bookmakerKey === "pinnacle")?.isSharp, true);
eq("bet365 non sharp", lines.find((l) => l.bookmakerKey === "bet365")?.isSharp, false);

const spreadHome = bookSpread(lines, "home");
check("dispersione su 'home' esiste (2 prezzi)", spreadHome !== null);
eq("due prezzi su home", spreadHome?.count, 2);
eq("minimo casa", spreadHome?.min, 2.05);
eq("massimo casa", spreadHome?.max, 2.1);
eq("differenza 0.05", spreadHome?.spread, 0.05);

/* con un solo prezzo la dispersione non esiste: null, non 0 */
eq(
  "nessuna dispersione con un solo prezzo",
  bookSpread(lines.filter((l) => l.bookmakerKey === "pinnacle"), "home"),
  null,
);
eq("nessuna dispersione su selezione assente", bookSpread([], "draw"), null);

/* ------------------------------------------------------------------ */
/* una sola chiamata restituisce tutti i book sharp (test asincroni)    */
/* ------------------------------------------------------------------ */

async function sharpTests() {
/* ------------------------------------------------------------------ */
/* una sola chiamata restituisce tutti i book sharp                    */
/* ------------------------------------------------------------------ */

const threeSharp: TheOddsApiEvent = {
  id: "ev1",
  home_team: "Arsenal",
  away_team: "Chelsea",
  bookmakers: [
    { key: "pinnacle", last_update: "2026-09-05T17:50:00Z",
      markets: [{ key: "h2h", outcomes: [
        { name: "Arsenal", price: 2.10 }, { name: "Chelsea", price: 3.60 }, { name: "Draw", price: 3.40 }]}]},
    { key: "betfair_ex_eu", last_update: "2026-09-05T17:50:00Z",
      markets: [{ key: "h2h", outcomes: [
        { name: "Arsenal", price: 2.05 }, { name: "Chelsea", price: 3.70 }, { name: "Draw", price: 3.45 }]}]},
    { key: "smarkets", last_update: "2026-09-05T17:50:00Z",
      markets: [{ key: "h2h", outcomes: [
        { name: "Arsenal", price: 2.15 }, { name: "Chelsea", price: 3.65 }, { name: "Draw", price: 3.42 }]}]},
  ],
};

const fakeFetch = async () =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => "488" },
    json: async () => [threeSharp],
  }) as unknown as Response;

const out = await fetchSharpLine(
  {
    sportKey: "soccer_epl",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    selection: "home",
    consensusOpening: 2.30,
    consensusCurrent: 2.10,
  },
  { apiKey: "chiave-di-prova", fetchImpl: fakeFetch as unknown as typeof fetch, now },
);

check("lettura riuscita", out.ok === true);
if (out.ok) {
  eq("un solo credito speso", out.creditsUsed, 1);
  eq("tre book nella fotografia", out.snapshot.books.length, 3);
  eq("verdetto dalla linea scelta", out.snapshot.verdict, "conferma");
  check("dispersione presente sui tre book", out.snapshot.spread !== null);
  eq("tre prezzi nella dispersione", out.snapshot.spread?.count, 3);
  eq("minimo dei tre", out.snapshot.spread?.min, 2.05);
  eq("massimo dei tre", out.snapshot.spread?.max, 2.15);
  check(
    "tutti i book riportati sono sharp",
    out.snapshot.books.every((b) => b.isSharp),
  );
  /* nessuna duplicazione fra il prezzo del verdetto e le righe parsate */
  eq(
    "nessun book duplicato",
    new Set(out.snapshot.books.map((b) => b.key)).size,
    out.snapshot.books.length,
  );
}

/* evento non trovato: la fotografia resta vuota, non inventata */
const vuoto = async () =>
  ({ ok: true, status: 200, headers: { get: () => null }, json: async () => [] }) as unknown as Response;
const out2 = await fetchSharpLine(
  {
    sportKey: "soccer_epl",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    selection: "home",
    consensusOpening: 2.30,
    consensusCurrent: 2.10,
  },
  { apiKey: "chiave-di-prova", fetchImpl: vuoto as unknown as typeof fetch, now },
);
check("evento assente: lettura comunque conclusa", out2.ok === true);
if (out2.ok) {
  eq("nessun book", out2.snapshot.books.length, 0);
  eq("nessuna dispersione", out2.snapshot.spread, null);
  eq("verdetto non osservabile", out2.snapshot.verdict, "non osservabile");
}



/* ------------------------------------------------------------------ */
/* dispersione del mercato e dei book sharp sono due cose diverse       */
/* ------------------------------------------------------------------ */

const mixed: TheOddsApiEvent = {
  id: "ev2",
  home_team: "Inter",
  away_team: "Milan",
  bookmakers: [
    { key: "pinnacle",
      markets: [{ key: "h2h", outcomes: [
        { name: "Inter", price: 2.00 }, { name: "Milan", price: 4.00 }, { name: "Draw", price: 3.40 }]}]},
    { key: "smarkets",
      markets: [{ key: "h2h", outcomes: [
        { name: "Inter", price: 2.02 }, { name: "Milan", price: 3.95 }, { name: "Draw", price: 3.42 }]}]},
    { key: "bet365",
      markets: [{ key: "h2h", outcomes: [
        { name: "Inter", price: 2.20 }, { name: "Milan", price: 3.60 }, { name: "Draw", price: 3.30 }]}]},
    { key: "unibet",
      markets: [{ key: "h2h", outcomes: [
        { name: "Inter", price: 1.85 }, { name: "Milan", price: 4.30 }, { name: "Draw", price: 3.50 }]}]},
  ],
};

let urlVista = "";
const mixedFetch = async (url: string | URL | Request) => {
  urlVista = String(url);
  return {
    ok: true,
    status: 200,
    headers: { get: () => "495" },
    json: async () => [mixed],
  } as unknown as Response;
};

const out3 = await fetchSharpLine(
  {
    sportKey: "soccer_italy_serie_a",
    homeTeam: "Inter",
    awayTeam: "Milan",
    selection: "home",
    consensusOpening: 2.30,
    consensusCurrent: 2.10,
  },
  { apiKey: "chiave-di-prova", fetchImpl: mixedFetch as unknown as typeof fetch, now },
);

check("lettura su risposta mista riuscita", out3.ok === true);
check(
  "la richiesta non filtra i bookmaker (tutti i book allo stesso credito)",
  !urlVista.includes("bookmakers="),
);
check(
  "la richiesta resta su un mercato e una regione",
  urlVista.includes("markets=h2h") && urlVista.includes("regions=eu"),
);
if (out3.ok) {
  eq("quattro book letti", out3.snapshot.books.length, 4);
  eq(
    "dispersione sharp sui soli 2 sharp",
    out3.snapshot.spread?.count,
    2,
  );
  eq("min sharp", out3.snapshot.spread?.min, 2.0);
  eq("max sharp", out3.snapshot.spread?.max, 2.02);
  eq("dispersione sharp 0.02", out3.snapshot.spread?.spread, 0.02);
  eq("dispersione di mercato sui 4 book", out3.snapshot.marketSpread?.count, 4);
  eq("min di mercato", out3.snapshot.marketSpread?.min, 1.85);
  eq("max di mercato", out3.snapshot.marketSpread?.max, 2.2);
  eq("dispersione di mercato 0.35", out3.snapshot.marketSpread?.spread, 0.35);
  check(
    "le due dispersioni sono distinte (il mercato è più largo degli sharp)",
    (out3.snapshot.marketSpread?.spread ?? 0) > (out3.snapshot.spread?.spread ?? 0),
  );
  eq(
    "due book marcati sharp su quattro",
    out3.snapshot.books.filter((b) => b.isSharp).length,
    2,
  );
}

/* ------------------------------------------------------------------ */
/* una fotografia scritta ieri non fa schiantare la pagina oggi         */
/* ------------------------------------------------------------------ */

const vecchiaForma = {
  book: "pinnacle",
  price: 2.1,
  verdict: "conferma",
  remainingFromProvider: 488,
  readAt: "2026-09-04T18:00:00.000Z",
};
const norm = normalizeSharpSnapshot(vecchiaForma);
check("fotografia vecchia normalizzata", norm !== null);
eq("prezzo conservato", norm?.price, 2.1);
eq("verdetto conservato", norm?.verdict, "conferma");
eq("books assenti → lista vuota", norm?.books.length, 0);
eq("spread assente → non misurabile", norm?.spread, null);
eq("marketSpread assente → non misurabile", norm?.marketSpread, null);

eq("non è un oggetto → null", normalizeSharpSnapshot(null), null);
eq("stringa → null", normalizeSharpSnapshot("no"), null);
eq("verdetto sconosciuto → non osservabile", normalizeSharpSnapshot({ verdict: "boh" })?.verdict, "non osservabile");
eq(
  "spread malformato → null",
  normalizeSharpSnapshot({ spread: { count: 3 } })?.spread,
  null,
);
eq(
  "books malformati → scartati",
  normalizeSharpSnapshot({ books: [{ key: "x" }, null, { key: "y", price: 2 }] })?.books.length,
  1,
);

}

void sharpTests().then(() => {
if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (adapter The Odds API)`);
});
