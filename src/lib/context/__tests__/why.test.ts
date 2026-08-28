/**
 * Test della lettura «Perché il mercato si muove» e delle notizie Tavily.
 * Funzioni pure, nessuna rete e nessun database.
 * Eseguire con: npm run test:why
 */
import {
  EARLY_HOURS,
  WHY_CLOSING,
  WHY_NO_CAUSE,
  buildWhyReading,
  driversFromProfile,
  driversFromSources,
  isProfileNeutral,
  type MovementProfile,
  type SourcedField,
} from "../why";
import {
  tavilyBudgetLine,
  TAVILY_DAILY_LIMIT,
  TAVILY_MAX_PER_MATCH,
  TAVILY_MAX_CONTEXT_PER_MATCH,
  TAVILY_MAX_NEWS_PER_MATCH,
} from "../tavily";
import {
  NEWS_MAX_AGE_HOURS,
  dedupeByUrl,
  filterRelevantNews,
  isFreshNews,
  mentionsBothTeams,
  teamTokens,
  domainOf,
  newsQueryEnglish,
  newsQueriesFor,
  toNewsItems,
} from "@/lib/news/tavily-news";
import { CONTEXT_FIELD_KEYS, CONTEXT_RETRIEVAL_VERSION } from "../pure";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}
function eq(name: string, a: unknown, b: unknown) {
  check(`${name} — atteso ${String(b)}, ottenuto ${String(a)}`, Object.is(a, b));
}

const neutral: MovementProfile = {
  hoursToKickoff: 12,
  sustainedMinutes: 30,
  isFlash: false,
  rebounded: false,
  booksConfirming: 3,
  booksTotal: 6,
  falling: true,
  magnitudeClass: "medium",
};

/* --- budget condiviso --- */
eq("tetto giornaliero dichiarato", TAVILY_DAILY_LIMIT, 30);
/* fix 3: un solo numero, una sola formulazione */
const linea = tavilyBudgetLine(12);
eq("formulazione unica del budget", linea, "Ricerca web (Contesto 360° + Notizie): 12/30 query oggi, massimo 4 per partita.");
check("il tetto nella frase è quello dichiarato", linea.includes(`/${TAVILY_DAILY_LIMIT} `));
check("nessun secondo tetto nella frase", (linea.match(/\d+\/\d+/g) ?? []).length === 1);
eq("massimo per partita", TAVILY_MAX_PER_MATCH, 4);
eq("le due quote sommano al tetto per partita",
  TAVILY_MAX_CONTEXT_PER_MATCH + TAVILY_MAX_NEWS_PER_MATCH, TAVILY_MAX_PER_MATCH);

/* --- campi nuovi del contesto --- */
check("campo forma_recente_5 presente", CONTEXT_FIELD_KEYS.includes("forma_recente_5"));
check("campo assenze_note presente", CONTEXT_FIELD_KEYS.includes("assenze_note"));
eq("cache invalidata dal bump", CONTEXT_RETRIEVAL_VERSION, 5);

/* --- driver da fonte --- */
const fields: SourcedField[] = [
  { key: "assenze_note", valore: "out il portiere titolare", fonteUrl: "https://x.it/a", fonteTitolo: "X" },
  { key: "posta_in_palo", valore: "spareggio salvezza", fonteUrl: null, fonteTitolo: null },
  { key: "forma_recente_5", valore: "casa 4V 1N", fonteUrl: "https://y.it/b", fonteTitolo: null },
  { key: "anomalia_campo", valore: "non noto", fonteUrl: "https://z.it/c", fonteTitolo: null },
  { key: "accordo_col_drop", valore: "sostiene", fonteUrl: "https://z.it/d", fonteTitolo: null },
];
const sourced = driversFromSources(fields);
eq("solo i campi con fonte entrano", sourced.length, 2);
check("tutti taggati da fonte", sourced.every((d) => d.tag === "da fonte" && d.url !== null));
check("campo senza fonte escluso", !sourced.some((d) => d.text.includes("spareggio")));
check("«non noto» escluso", !sourced.some((d) => d.text.includes("non noto")));
check("accordo escluso dalla lettura", !sourced.some((d) => d.text.includes("sostiene")));
check("assenze in lingua piana", sourced[0].text.startsWith("le assenze dichiarate:"));

/* --- driver dal profilo --- */
const early = driversFromProfile({ ...neutral, hoursToKickoff: EARLY_HOURS + 1 });
check("movimento precoce riconosciuto", early.some((d) => d.text.includes("precoce")));
check("tag ipotesi sul profilo", early.every((d) => d.tag === "ipotesi dal profilo del movimento" && d.url === null));
const late = driversFromProfile({ ...neutral, hoursToKickoff: 3 });
check("movimento tardivo riconosciuto", late.some((d) => d.text.includes("tardivo")));
const flash = driversFromProfile({ ...neutral, isFlash: true });
check("flash riconosciuto", flash.some((d) => d.text.includes("flash")));
const sustained = driversFromProfile({ ...neutral, sustainedMinutes: 240 });
check("sostenuto riconosciuto", sustained.some((d) => d.text.includes("4 ore")));
const bounced = driversFromProfile({ ...neutral, rebounded: true });
check("rimbalzo riconosciuto", bounced.some((d) => d.text.includes("rientrata")));
const single = driversFromProfile({ ...neutral, booksTotal: 1, booksConfirming: 1 });
check("un solo book dichiarato", single.some((d) => d.text.includes("una sola linea di consenso")));
const consensus = driversFromProfile({ ...neutral, booksTotal: 6, booksConfirming: 6 });
check("consenso riconosciuto", consensus.some((d) => d.text.includes("6 bookmaker su 6")));
check("profilo neutro riconosciuto", isProfileNeutral(neutral));

/* --- lettura completa --- */
const reading = buildWhyReading(fields, { ...neutral, hoursToKickoff: 48 });
check("chiusura fissa presente", reading.paragraph.endsWith(WHY_CLOSING));
const frasi = reading.paragraph.split(/(?<=\.)\s+/).filter((x) => x.trim().length > 0);
check(`fra 3 e 6 frasi (${frasi.length})`, frasi.length >= 3 && frasi.length <= 6);
check("cita le fonti recuperate", reading.paragraph.includes("Dalle fonti recuperate"));
check("driver misti", reading.drivers.some((d) => d.tag === "da fonte") &&
  reading.drivers.some((d) => d.tag === "ipotesi dal profilo del movimento"));
check(
  "nessun pronostico nel corpo (la chiusura nega il consiglio, e resta)",
  !/vincer|più probabile|dovrebbe/i.test(
    reading.paragraph.replace(WHY_CLOSING, ""),
  ),
);
eq("non vuota", reading.empty, false);

const vuota = buildWhyReading([], neutral);
eq("nessuna causa: dichiarata", vuota.empty, true);
check("frase dichiarata usata", vuota.paragraph.startsWith(WHY_NO_CAUSE));
check("chiusura anche nel caso vuoto", vuota.paragraph.endsWith(WHY_CLOSING));
eq("nessun driver", vuota.drivers.length, 0);

/* --- notizie Tavily --- */
/* le query ora nascono nella lingua del paese: per il Paraguay in spagnolo
   e sulle testate locali, non in italiano su aggregatori di quote */
const qPy = newsQueriesFor("General Caballero", "Dep. Capiata", "Paraguay", "Paraguay: Division Intermedia");
eq("quattro domande per partita", qPy.length, 4);
eq("lingua del paese", qPy[0].lang, "es");
check("cerca le assenze in spagnolo", qPy[0].query.includes("bajas") && qPy[0].query.includes("lesionados"));
check("mira alle testate nazionali", qPy[0].query.includes("abc.com.py"));
check("una query sui canali ufficiali", qPy[1].query.includes("site:x.com") || qPy[1].query.includes("twitter.com"));
check("una query su campo e logistica", qPy[2].query.includes("estadio"));
const qSe = newsQueriesFor("Uppsala", "Eskilstuna", "Sweden", null);
check("svedese per la Svezia", qSe[0].query.includes("skador") && qSe[0].lang === "sv");
check("query inglese di fallback", newsQueryEnglish("Alfa", "Beta").includes("injuries suspensions lineup"));
eq("dominio estratto", domainOf("https://www.corriere.it/sport/x"), "corriere.it");
eq("dominio assente", domainOf("non-un-url"), null);

const items = toNewsItems([
  { title: "T", url: "https://a.it/1", content: "c", publishedDate: "2026-08-25T10:00:00Z" },
  { title: "U", url: "https://b.it/2", content: "c" },
]);
eq("data letta quando c'è", items[0].publishedAt?.toISOString(), "2026-08-25T10:00:00.000Z");
eq("data assente resta assente", items[1].publishedAt, null);
eq("testata dal dominio", items[0].source, "a.it");

const dd = dedupeByUrl([
  { link: "https://www.a.it/x/" },
  { link: "http://a.it/x" },
  { link: "https://b.it/y" },
]);
eq("dedupe per URL normalizzato", dd.length, 2);



/* --- fix 1: freschezza 72h --- */
const oggi = new Date("2026-08-25T18:00:00Z");
eq("finestra dichiarata", NEWS_MAX_AGE_HOURS, 72);
eq("notizia di due giorni fa passa", isFreshNews("2026-08-23T18:00:00Z", oggi), true);
eq("notizia di 71 ore passa", isFreshNews(new Date(oggi.getTime() - 71 * 3600000), oggi), true);
eq("notizia di 73 ore scartata", isFreshNews(new Date(oggi.getTime() - 73 * 3600000), oggi), false);
eq("articolo del 22/03 scartato", isFreshNews("2026-03-22T10:00:00Z", oggi), false);
eq("articolo dell'11/10 scartato", isFreshNews("2025-10-11T10:00:00Z", oggi), false);
eq("data assente scartata", isFreshNews(null, oggi), false);
eq("data impossibile scartata", isFreshNews("non-una-data", oggi), false);

/* --- fix 2: pertinenza, servono entrambe le squadre --- */
eq("token identificanti senza rumore", teamTokens("Cove Rangers FC").join(","), "cove,rangers");
check("entrambe citate: passa", mentionsBothTeams("Cove Rangers - Dundee United B, match sheet", "Cove Rangers FC", "Dundee United B"));
check("una sola citata: scartata", !mentionsBothTeams("Clyde - Rangers B live score", "Cove Rangers FC", "Dundee United B"));
check("altra partita con nome comune: scartata", !mentionsBothTeams("Bonnyrigg Rose FC - Rangers FC B", "Cove Rangers FC", "Dundee United B"));
check("accenti e maiuscole non contano", mentionsBothTeams("HÄCKEN batte l'Utsiktens", "BK Häcken", "Utsiktens BK"));
check("citazione nello snippet vale", mentionsBothTeams("Anteprima Cove Rangers", "Cove Rangers FC", "Dundee United B") === false);

const filtrate = filterRelevantNews(
  [
    { title: "Cove Rangers - Dundee United B, match sheet", publishedAt: new Date(oggi.getTime() - 5 * 3600000), snippet: "" },
    { title: "Clyde - Rangers B live score", publishedAt: new Date(oggi.getTime() - 5 * 3600000), snippet: "" },
    { title: "Cove Rangers - Dundee United B, precedenti", publishedAt: new Date("2026-03-22T10:00:00Z"), snippet: "" },
    { title: "Anteprima", publishedAt: new Date(oggi.getTime() - 2 * 3600000), snippet: "Cove Rangers ospita il Dundee United B" },
  ],
  "Cove Rangers FC",
  "Dundee United B",
  oggi,
);
eq("restano solo le pertinenti e recenti", filtrate.length, 2);
check("il vecchio è fuori", !filtrate.some((f) => f.title.includes("precedenti")));
check("l'altra partita è fuori", !filtrate.some((f) => f.title.includes("Clyde")));
check("lo snippet salva la pertinente", filtrate.some((f) => f.title === "Anteprima"));

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (perché si muove + notizie Tavily)`);
