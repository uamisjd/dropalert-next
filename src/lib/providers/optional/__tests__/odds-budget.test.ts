/**
 * Test dei tetti di budget di The Odds API (Sprint G).
 * Funzioni pure: nessuna rete, nessuna chiave, nessun database.
 * Eseguire con: npm run test:odds-budget
 */
import {
  BUDGET_MESSAGES,
  ODDS_DAILY_HARD_CAP,
  ODDS_MONTHLY_CAP,
  dailyAllowance,
  daysLeftInMonth,
  dayKey,
  decide,
  matchKey,
  monthKey,
  readOddsApiKey,
  sharpVerdict,
} from "../odds-api-budget";
import { sportKeyFor } from "../sport-keys";
import { extractSharpPrice, findEvent } from "../odds-api-sharp";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}
function eq(name: string, a: unknown, b: unknown) {
  check(`${name} — atteso ${String(b)}, ottenuto ${String(a)}`, Object.is(a, b));
}

const primo = new Date("2026-08-01T10:00:00Z");
const meta = new Date("2026-08-15T10:00:00Z");
const ultimo = new Date("2026-08-31T10:00:00Z");

/* --- tetti dichiarati --- */
eq("tetto mensile con margine", ODDS_MONTHLY_CAP, 490);
eq("tetto giornaliero duro", ODDS_DAILY_HARD_CAP, 14);

/* --- chiavi per periodo italiano --- */
eq("chiave mensile", monthKey(meta), "odds-api:month:2026-08");
eq("chiave giornaliera", dayKey(meta), "odds-api:day:2026-08-15");
eq("chiave partita", matchKey(7, meta), "odds-api:match:2026-08-15:7");
eq(
  "mezzanotte italiana è già il giorno dopo",
  dayKey(new Date("2026-08-15T22:30:00Z")),
  "odds-api:day:2026-08-16",
);

/* --- giorni residui --- */
eq("primo del mese", daysLeftInMonth(primo), 31);
eq("a metà mese", daysLeftInMonth(meta), 17);
eq("ultimo giorno", daysLeftInMonth(ultimo), 1);

/* --- la quota non brucia il mese --- */
eq("quota del primo giorno limitata dal tetto", dailyAllowance(0, primo), 14);
check("quota mai oltre il tetto duro", dailyAllowance(0, primo) <= ODDS_DAILY_HARD_CAP);
eq("budget quasi finito: si stringe", dailyAllowance(480, meta), 10);
eq("budget finito: zero", dailyAllowance(490, meta), 0);
eq("ultimo giorno si spende il residuo fino al tetto", dailyAllowance(480, ultimo), 10);
eq("pavimento non supera il residuo", dailyAllowance(485, meta), 5);

/* la simulazione è il vero test: 31 giorni non devono sfondare il mese */
let speso = 0;
for (let g = 1; g <= 31; g++) {
  const giorno = new Date(`2026-08-${String(g).padStart(2, "0")}T10:00:00Z`);
  speso += dailyAllowance(speso, giorno);
}
check(`un mese intero resta sotto il tetto (${speso})`, speso <= ODDS_MONTHLY_CAP);
check(`i crediti coprono tutto il mese (${speso})`, speso >= 400);
check(
  "e l'ultimo giorno c'è ancora quota",
  dailyAllowance(speso - dailyAllowance(0, ultimo), ultimo) > 0,
);

/* --- decisione --- */
const base = {
  usedThisMonth: 0,
  usedToday: 0,
  matchAlreadyRead: false,
  signalActive: true,
};
check("caso buono: consentito", decide(base, meta, true).allowed);
eq("senza chiave si dichiara", decide(base, meta, false).allowed, false);
eq(
  "motivo chiave",
  (decide(base, meta, false) as { reason: string }).reason,
  "chiave_assente",
);
eq(
  "segnale non attivo: niente credito",
  (decide({ ...base, signalActive: false }, meta, true) as { reason: string }).reason,
  "segnale_non_attivo",
);
eq(
  "stessa partita due volte al giorno: no",
  (decide({ ...base, matchAlreadyRead: true }, meta, true) as { reason: string }).reason,
  "gia_letta_oggi",
);
eq(
  "quota giornaliera esaurita",
  (decide({ ...base, usedToday: 14 }, meta, true) as { reason: string }).reason,
  "tetto_giornaliero",
);
eq(
  "tetto mensile raggiunto",
  (decide({ ...base, usedThisMonth: 490 }, meta, true) as { reason: string }).reason,
  "tetto_mensile",
);
check(
  "ogni motivo ha una frase in italiano",
  Object.values(BUDGET_MESSAGES).every((m) => m.length > 10 && !m.includes("undefined")),
);

/* --- verdetto sharp --- */
eq("sharp concorde: conferma", sharpVerdict(3.0, 2.6, 2.55), "conferma");
eq("sharp discorde: smentisce", sharpVerdict(3.0, 2.6, 3.2), "smentisce");
eq("prezzo sharp assente: non osservabile", sharpVerdict(3.0, 2.6, null), "non osservabile");
eq("consenso fermo: non osservabile", sharpVerdict(3.0, 3.0, 2.5), "non osservabile");
eq("prezzi impossibili: non osservabile", sharpVerdict(0, 2.6, 2.5), "non osservabile");
check("«non osservabile» non è una smentita", sharpVerdict(3.0, 2.6, null) !== "smentisce");

/* --- mappa competizioni: prima difesa del budget --- */
eq("Serie A mappata", sportKeyFor("Italy: Serie A"), "soccer_italy_serie_a");
eq("Serie B mappata (il tag «B» è della squadra riserve, non della lega)", sportKeyFor("Italy: Serie B"), "soccer_italy_serie_b");
eq("Premier League mappata", sportKeyFor("England: Premier League"), "soccer_epl");
eq("lega minore non mappata", sportKeyFor("Scotland: Challenge Cup"), null);
eq("femminile esclusa", sportKeyFor("Germany: Bundesliga Women"), null);
eq("riserve escluse", sportKeyFor("Italy: Serie A Primavera"), null);
eq("nessuna lega: nessun credito", sportKeyFor(null), null);
/* trovato in produzione: una coppa di riserve che cita il nome del
   campionato non deve consumare un credito */
eq("coppa travestita da campionato", sportKeyFor("England: Premier League Cup"), null);
eq("coppa italiana non è la Serie A", sportKeyFor("Italy: Serie A Cup Women"), null);
eq("il campionato vero resta coperto", sportKeyFor("England: Premier League"), "soccer_epl");
eq("le coppe UEFA restano coperte", sportKeyFor("Europe: UEFA Champions League"), "soccer_uefa_champs_league");
eq("Europa League coperta", sportKeyFor("Europe: UEFA Europa League"), "soccer_uefa_europa_league");

/* --- estrazione del prezzo sharp --- */
const payload = [
  {
    home_team: "AC Milan",
    away_team: "Inter Milan",
    bookmakers: [
      {
        key: "betfair_ex_eu",
        markets: [{ key: "h2h", outcomes: [{ name: "AC Milan", price: 2.4 }] }],
      },
      {
        key: "pinnacle",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "AC Milan", price: 2.31 },
              { name: "Draw", price: 3.5 },
              { name: "Inter Milan", price: 3.1 },
            ],
          },
        ],
      },
    ],
  },
];
const ev = findEvent(payload, "Milan", "Inter");
check("evento trovato per nomi vicini", ev !== null);
eq("partita inesistente non si forza", findEvent(payload, "Roma", "Lazio"), null);
eq("prezzo casa dal book preferito", extractSharpPrice(ev, "home", "Milan", "Inter").price, 2.31);
eq("book preferito rispettato", extractSharpPrice(ev, "home", "Milan", "Inter").book, "pinnacle");
eq("pareggio letto", extractSharpPrice(ev, "draw", "Milan", "Inter").price, 3.5);
eq("senza evento nessun prezzo", extractSharpPrice(null, "home", "Milan", "Inter").price, null);

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (budget Odds API)`);

/* --- lettura della chiave: i nomi realmente usati in produzione --- */
eq("nome canonico", readOddsApiKey({ THE_ODDS_API_KEY: "abc" }), "abc");
eq("nome alternativo storico", readOddsApiKey({ ODDS_API_KEY: "abc" }), "abc");
eq("nome usato su Vercel", readOddsApiKey({ theoddsapiKey: "abc" }), "abc");
eq("nome tutto maiuscolo", readOddsApiKey({ THEODDSAPIKEY: "abc" }), "abc");
eq("nessuna chiave", readOddsApiKey({}), null);
eq("chiave vuota non vale", readOddsApiKey({ theoddsapiKey: "   " }), null);
eq("spazi rimossi", readOddsApiKey({ theoddsapiKey: " abc " }), "abc");
console.log("✓ chiave Odds API riconosciuta con i nomi in uso");
