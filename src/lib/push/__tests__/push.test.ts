/**
 * Test delle regole delle notifiche push (Sprint ENH-1, Fase B).
 * Funzioni pure: nessuna rete, nessun browser, nessun database.
 * Eseguire con: npm run test:push
 */
import {
  DEDUPE_NOTE,
  MAX_NOTIFICHE_PER_PARTITA_AL_GIORNO,
  PLATFORM_NOTE,
  buildNotification,
  dedupeKey,
  parseSubscription,
  selectNotifications,
  subscriptionKey,
  thresholdCrossed,
  type LiveValue,
  type WatchedItem,
} from "../pure";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}
function eq(name: string, a: unknown, b: unknown) {
  check(`${name} — atteso ${String(b)}, ottenuto ${String(a)}`, Object.is(a, b));
}

const now = new Date("2026-08-27T18:00:00Z");
const endpoint = "https://fcm.googleapis.com/fcm/send/abcdefghijklmnopqrstuvwxyz012345";

const item = (over: Partial<WatchedItem> = {}): WatchedItem => ({
  matchKey: "alfa|beta@2026-08-27",
  matchId: 7,
  homeTeam: "Alfa",
  awayTeam: "Beta",
  thresholdKind: "indice",
  thresholdValue: 60,
  ...over,
});

/* --- limiti dichiarati --- */
eq("una notifica al giorno per partita", MAX_NOTIFICHE_PER_PARTITA_AL_GIORNO, 1);
check("il dedupe è spiegato in italiano", DEDUPE_NOTE.includes("una notifica al giorno"));
check("i limiti di piattaforma sono dichiarati", PLATFORM_NOTE.includes("Aggiungi a Home"));

/* --- soglie --- */
eq("indice sopra soglia", thresholdCrossed(item(), { score: 70, dropPct: null }), true);
eq("indice sotto soglia", thresholdCrossed(item(), { score: 40, dropPct: null }), false);
eq("indice alla soglia", thresholdCrossed(item(), { score: 60, dropPct: null }), true);
eq("indice mancante non è un no", thresholdCrossed(item(), { score: null, dropPct: -30 }), null);
eq(
  "calo oltre soglia",
  thresholdCrossed(item({ thresholdKind: "drop", thresholdValue: 15 }), { score: null, dropPct: -20 }),
  true,
);
eq(
  "quota salita non è un calo",
  thresholdCrossed(item({ thresholdKind: "drop", thresholdValue: 15 }), { score: null, dropPct: 20 }),
  false,
);
eq(
  "senza soglia non si valuta",
  thresholdCrossed(item({ thresholdKind: null, thresholdValue: null }), { score: 99, dropPct: -99 }),
  null,
);

/* --- dedupe --- */
const k1 = dedupeKey(endpoint, "alfa|beta@2026-08-27", now);
eq("stessa chiave nello stesso giorno", dedupeKey(endpoint, "alfa|beta@2026-08-27", now), k1);
check(
  "giorno diverso, chiave diversa",
  dedupeKey(endpoint, "alfa|beta@2026-08-27", new Date("2026-08-28T18:00:00Z")) !== k1,
);
check(
  "iscrizione diversa, chiave diversa",
  dedupeKey(`${endpoint}XY`, "alfa|beta@2026-08-27", now) !== k1,
);
check("la chiave non contiene l'endpoint intero", !k1.includes("fcm.googleapis.com"));

/* --- selezione --- */
const live = new Map<string, LiveValue>([
  ["alfa|beta@2026-08-27", { score: 75, dropPct: -20 }],
  ["gamma|delta@2026-08-27", { score: 90, dropPct: -30 }],
]);
const scelte = selectNotifications(
  [item(), item({ matchKey: "zeta|eta@2026-08-27", matchId: 9, thresholdValue: 50 })],
  live,
  new Set(),
  endpoint,
  now,
  "https://esempio.it",
);
eq("una sola notifica: l'altra partita non ha dato vivo", scelte.length, 1);
eq("link al dettaglio giusto", scelte[0].url, "https://esempio.it/matches/7");
check("il titolo dice che la soglia è stata raggiunta", scelte[0].title.includes("soglia raggiunta"));
check("il corpo nega il consiglio", scelte[0].body.includes("non è un consiglio"));

check(
  "mai notifiche per partite fuori watchlist",
  selectNotifications([], live, new Set(), endpoint, now, "https://esempio.it").length === 0,
);
eq(
  "già notificata oggi: si salta",
  selectNotifications([item()], live, new Set([k1]), endpoint, now, "https://esempio.it").length,
  0,
);
eq(
  "sotto soglia: niente notifica",
  selectNotifications(
    [item({ thresholdValue: 95 })],
    live,
    new Set(),
    endpoint,
    now,
    "https://esempio.it",
  ).length,
  0,
);
eq(
  "senza soglia: niente notifica",
  selectNotifications(
    [item({ thresholdKind: null, thresholdValue: null })],
    live,
    new Set(),
    endpoint,
    now,
    "https://esempio.it",
  ).length,
  0,
);

const testo = buildNotification(
  item({ thresholdKind: "drop", thresholdValue: 15 }),
  { score: null, dropPct: -22.5 },
  "https://esempio.it",
);
check("il corpo cita il calo misurato", testo.body.includes("22.5%"));
check("il corpo cita la soglia", testo.body.includes("soglia 15%"));

/* --- iscrizione --- */
const valida = parseSubscription(
  {
    subscription: { endpoint, keys: { p256dh: "chiave", auth: "auth" } },
    watchlist: [
      { matchKey: "alfa|beta@2026-08-27", matchId: 7, homeTeam: "Alfa", awayTeam: "Beta", thresholdKind: "indice", thresholdValue: 60 },
      { matchKey: "", matchId: 8 },
    ],
  },
  now,
);
check("iscrizione valida accettata", valida !== null);
eq("le voci incomplete della watchlist si scartano", valida!.watchlist.length, 1);
eq("nessun endpoint: rifiutata", parseSubscription({ subscription: { keys: { p256dh: "a", auth: "b" } } }, now), null);
eq(
  "endpoint non https: rifiutata",
  parseSubscription({ subscription: { endpoint: "http://x", keys: { p256dh: "a", auth: "b" } } }, now),
  null,
);
eq(
  "chiavi mancanti: rifiutata",
  parseSubscription({ subscription: { endpoint, keys: {} } }, now),
  null,
);
eq("payload non oggetto: rifiutata", parseSubscription(null, now), null);
check("la chiave di registro è stabile", subscriptionKey(endpoint) === subscriptionKey(endpoint));
check("la chiave di registro ha un prefisso proprio", subscriptionKey(endpoint).startsWith("push:sub:"));

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (notifiche push)`);
