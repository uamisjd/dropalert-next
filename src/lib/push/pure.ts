import { parsePushTarget, parsePushWatchlist } from "./validation";

/**
 * Notifiche push — regole pure (Sprint ENH-1, Fase B).
 *
 * Qui non si invia nulla: si decide soltanto SE una notifica ha diritto di
 * partire, e con quale testo. Tutto è puro e testabile senza rete, senza
 * database e senza browser.
 *
 * Le tre regole che governano l'invio, dichiarate anche in interfaccia:
 *  1. si notifica SOLO ciò che sta nella watchlist di chi ha attivato le
 *     notifiche: mai una partita che nessuno ha chiesto di seguire;
 *  2. si notifica solo quando la soglia personale è stata SUPERATA, con il
 *     dato vivo a registro: senza dato non si notifica, invece di indovinare;
 *  3. una sola notifica per partita al giorno, per iscrizione: il dedupe è
 *     una promessa scritta in UI, non un dettaglio tecnico.
 */

/** Massimo notifiche per partita e per iscrizione in una giornata. */
export const MAX_NOTIFICHE_PER_PARTITA_AL_GIORNO = 1;

/** Testo unico del limite, mostrato in interfaccia. */
export const DEDUPE_NOTE =
  "Massimo un tentativo di notifica automatica al giorno per partita: in caso di consegna incerta non ritentiamo, per evitare duplicati.";

/** Limiti di piattaforma, dichiarati invece che scoperti dall'utente. */
export const PLATFORM_NOTE =
  "Su iPhone e iPad le notifiche web funzionano solo dopo «Aggiungi a Home» dal menù di condivisione di Safari. Se il browser non le supporta il pulsante resta disattivato e il sito continua a funzionare.";

const ROME = "Europe/Rome";
const romeDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: ROME,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Chiave di dedupe: iscrizione + partita + giornata civile italiana. */
export function dedupeKey(
  endpoint: string,
  matchKey: string,
  now: Date,
): string {
  /* l'endpoint è lungo e contiene un token: se ne tiene la coda, che è
     comunque univoca, senza scrivere l'indirizzo intero in una chiave */
  const corto = endpoint.slice(-32);
  return `push:sent:${romeDay.format(now)}:${corto}:${matchKey}`;
}

export type ThresholdKind = "indice" | "drop";

/** Una voce di watchlist come arriva dal browser. */
export interface WatchedItem {
  matchKey: string;
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  thresholdKind: ThresholdKind | null;
  thresholdValue: number | null;
}

/** Il dato vivo con cui confrontare la soglia. */
export interface LiveValue {
  score: number | null;
  dropPct: number | null;
}

/**
 * La soglia è stata superata?
 *
 * `null` = non valutabile (manca il dato o manca la soglia): non è un «no»,
 * e soprattutto non è un motivo per notificare.
 */
export function thresholdCrossed(
  item: Pick<WatchedItem, "thresholdKind" | "thresholdValue">,
  live: LiveValue,
): boolean | null {
  if (item.thresholdKind === null || item.thresholdValue === null) return null;
  if (item.thresholdKind === "indice") {
    if (live.score === null) return null;
    return live.score >= item.thresholdValue;
  }
  if (live.dropPct === null) return null;
  /* dropPct negativo = quota scesa; la soglia è sull'entità del calo */
  return -live.dropPct >= item.thresholdValue;
}

export interface NotificaDaInviare {
  matchKey: string;
  matchId: number;
  title: string;
  body: string;
  url: string;
}

/** Titolo e corpo: fatti, mai consigli. */
export function buildNotification(
  item: WatchedItem,
  live: LiveValue,
  siteUrl: string,
): NotificaDaInviare {
  const partita = `${item.homeTeam} – ${item.awayTeam}`;
  const dettaglio =
    item.thresholdKind === "indice"
      ? `indice ${live.score ?? "n/d"} (soglia ${item.thresholdValue})`
      : `calo ${live.dropPct === null ? "n/d" : Math.abs(live.dropPct).toFixed(1)}% (soglia ${item.thresholdValue}%)`;
  return {
    matchKey: item.matchKey,
    matchId: item.matchId,
    title: `${partita}: soglia raggiunta`,
    body: `${dettaglio}. Il monitor descrive il mercato, non l'esito: nessuna vincita garantita.`,
    url: `${siteUrl}/matches/${item.matchId}`,
  };
}

/**
 * Che cosa inviare a una singola iscrizione.
 *
 * `giaInviate` sono le chiavi di dedupe già usate oggi: chi chiama le legge
 * dal registro e le passa qui, così la decisione resta pura.
 */
export function selectNotifications(
  watchlist: WatchedItem[],
  live: Map<string, LiveValue>,
  giaInviate: Set<string>,
  endpoint: string,
  now: Date,
  siteUrl: string,
): NotificaDaInviare[] {
  const out: NotificaDaInviare[] = [];
  for (const item of watchlist) {
    const valore = live.get(item.matchKey);
    if (valore === undefined) continue; /* fuori lista o senza dato: niente */
    if (thresholdCrossed(item, valore) !== true) continue;
    if (giaInviate.has(dedupeKey(endpoint, item.matchKey, now))) continue;
    out.push(buildNotification(item, valore, siteUrl));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Validazione dell'iscrizione                                         */
/* ------------------------------------------------------------------ */

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  watchlist: WatchedItem[];
  updatedAt: string;
}

/**
 * Accetta un'iscrizione solo se è completa: senza endpoint o senza chiavi
 * non si può inviare nulla, e conservarla darebbe l'illusione che le
 * notifiche siano attive.
 */
export function parseSubscription(
  payload: unknown,
  now: Date,
): PushSubscriptionRecord | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const sub = parsePushTarget(p.subscription);
  if (sub === null) return null;
  const { endpoint, keys: { p256dh, auth } } = sub;

  const watchlist = parsePushWatchlist(p.watchlist);
  if (watchlist === null) return null;

  return {
    endpoint,
    keys: { p256dh, auth },
    watchlist,
    updatedAt: now.toISOString(),
  };
}

/** Chiave legacy: solo compatibilità/rimozione. Le nuove iscrizioni usano un hash completo lato server. */
export function subscriptionKey(endpoint: string): string {
  return `push:sub:${endpoint.slice(-64)}`;
}
