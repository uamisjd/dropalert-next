/**
 * Test della ricerca localizzata (Sprint ricerca locale).
 * Funzioni pure: nessuna rete, nessuna chiave.
 * Eseguire con: npm run test:locale
 */
import {
  DEFAULT_PROFILE,
  JUNK_DOMAINS,
  LOCALE_PROFILES,
  crisisTerms,
  hasLocaleProfile,
  localQueries,
  logisticsTerms,
  profileFor,
  statsQuery,
} from "../locale-search";
import {
  isWomensFixture,
  matchesFixtureScope,
} from "../match-scope";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}
function eq(name: string, a: unknown, b: unknown) {
  check(`${name} — atteso ${String(b)}, ottenuto ${String(a)}`, Object.is(a, b));
}

/* --- il caso che ha motivato tutto: Paraguay --- */
const py = profileFor("Paraguay", "Paraguay: Division Intermedia");
eq("Paraguay parla spagnolo", py.lang, "es");
check("parole d'uso reale, non traduzioni", py.assenze.includes("bajas") && py.assenze.includes("lesionados"));
check("testate nazionali dichiarate", py.testate.includes("abc.com.py") && py.testate.includes("ultimahora.com"));

/* il paese si ricava anche dal nome della competizione */
eq("paese dedotto dalla lega", profileFor(null, "Paraguay: Division Intermedia").lang, "es");
eq("paese esplicito ha la precedenza", profileFor("Sweden", "Paraguay: X").lang, "sv");

/* --- ripiego dichiarato --- */
eq("paese ignoto: inglese di riserva", profileFor("Atlantide", null).lang, "en");
eq("nessun paese: inglese", profileFor(null, null), DEFAULT_PROFILE);
eq("profilo dichiarato riconosciuto", hasLocaleProfile("Paraguay"), true);
eq("profilo mancante riconosciuto", hasLocaleProfile("Atlantide"), false);

/* --- le quattro domande --- */
const q = localQueries("General Caballero", "Dep. Capiata", "Paraguay", null);
eq("quattro query per partita", q.length, 4);
check("1: assenze in lingua locale", q[0].query.includes("bajas"));
check("1: mira alle testate nazionali", q[0].query.includes("site:abc.com.py"));
check("2: canali ufficiali", /site:(x\.com|twitter\.com|facebook\.com|instagram\.com)/.test(q[1].query));
check("2: cita le squadre fra virgolette", q[1].query.includes('"General Caballero"'));
check("3: logistica in spagnolo", q[2].query.includes("estadio") || q[2].query.includes("cancha"));
check("4: crisi societaria", q[3].query.includes("sueldos") || q[3].query.includes("crisis"));
check("tutte le query citano le squadre", q.every((x) => x.query.includes("Caballero")));
check("ogni query dichiara il suo scopo", q.every((x) => x.scopo.length > 10));

/* --- identità femminile: «Pumas W» non deve recuperare la prima squadra --- */
const qWomen = localQueries(
  "UNAM Pumas W",
  "Club America W",
  "Mexico",
  "Liga MX Women",
);
check(
  "partita femminile riconosciuta",
  isWomensFixture("UNAM Pumas W", "Club America W", "Liga MX Women"),
);
check(
  "ogni query specifica il calcio femminile",
  qWomen.every((x) => /femenil|femenino/.test(x.query)),
);
check(
  "articolo della prima squadra maschile scartato",
  !matchesFixtureScope(
    "Pumas y América preparan el Clásico Capitalino de Liga MX",
    "UNAM Pumas W",
    "Club America W",
    "Liga MX Women",
  ),
);
check(
  "articolo Liga MX Femenil accettato",
  matchesFixtureScope(
    "Pumas recibe al América en la Liga MX Femenil",
    "UNAM Pumas W",
    "Club America W",
    "Liga MX Women",
  ),
);
check(
  "una partita maschile non subisce il filtro femminile",
  matchesFixtureScope(
    "Pumas y América preparan el Clásico Capitalino",
    "UNAM Pumas",
    "Club America",
    "Liga MX",
  ),
);

/* --- altre lingue: campione di controllo --- */
const casi: Array<[string, string, string]> = [
  ["Sweden", "sv", "skador"],
  ["Turkey", "tr", "sakatlık"],
  ["Brazil", "pt", "desfalques"],
  ["Germany", "de", "verletzte"],
  ["Japan", "ja", "負傷者"],
  ["Egypt", "ar", "إصابات"],
  ["Georgia", "ka", "ტრავმები"],
];
for (const [paese, lang, parola] of casi) {
  const p = profileFor(paese, null);
  eq(`${paese}: lingua`, p.lang, lang);
  check(`${paese}: cerca le assenze in lingua`, p.assenze.includes(parola));
}

/* --- termini specializzati --- */
check("logistica spagnola parla di sede e porte chiuse",
  logisticsTerms("es").includes("sede") && logisticsTerms("es").includes("puertas cerradas"));
check("logistica italiana parla di campo neutro",
  logisticsTerms("it").includes("campo neutro"));
check("logistica ha un ripiego inglese",
  logisticsTerms("xx").includes("postponed"));
check("crisi spagnola parla di stipendi",
  crisisTerms("es").includes("sueldos") || crisisTerms("es").includes("impagos"));
check("crisi italiana parla di stipendi non pagati",
  crisisTerms("it").includes("stipendi non pagati"));

/* --- aggregatori esclusi: erano il problema osservato --- */
for (const d of ["wincomparator.com", "aiscore.com", "forebet.com"]) {
  check(`${d} è nella lista di esclusione`, JUNK_DOMAINS.includes(d));
}
check("la lista non esclude testate vere",
  !JUNK_DOMAINS.some((d) => ["abc.com.py", "gazzetta.it", "bbc.co.uk", "marca.com"].includes(d)));

/* --- query statistica: resta, ma è l'ultima --- */
const st = statsQuery("Alfa", "Beta", "Paraguay: Division Intermedia", "Paraguay");
check("statistica in lingua locale", st.includes("historial") || st.includes("posiciones"));
check("statistica cita la lega", st.includes("Division Intermedia"));

/* --- copertura: i paesi del nostro archivio ci sono --- */
for (const paese of ["paraguay", "japan", "georgia", "bolivia", "ecuador", "united arab emirates", "sweden", "egypt"]) {
  check(`profilo presente per ${paese}`, LOCALE_PROFILES[paese] !== undefined);
}

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (ricerca nella lingua del posto)`);
