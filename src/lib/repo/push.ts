/**
 * Iscrizioni push e invio (Sprint ENH-1, Fase B).
 *
 * Le iscrizioni vivono in `system_state`, come gli altri stati del
 * progetto: nessuna migrazione, nessun account, nessun dato personale.
 * Di chi si iscrive conserviamo solo l'endpoint del browser e le chiavi
 * necessarie a cifrare il messaggio — nessuna email, nessun profilo.
 *
 * L'invio è deliberatamente semplice: nessuna coda, nessun ritentativo in
 * loop. Se un endpoint è morto (410/404) l'iscrizione si cancella, perché
 * tenere un indirizzo che non riceve più è solo rumore.
 */
import { eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { systemState } from "@/db/schema";
import {
  dedupeKey,
  parseSubscription,
  selectNotifications,
  subscriptionKey,
  type LiveValue,
  type NotificaDaInviare,
  type PushSubscriptionRecord,
} from "@/lib/push/pure";
import { SITE_URL } from "@/lib/site";

/** Chiave pubblica VAPID, esposta al browser (non è un segreto). */
export function vapidPublicKey(): string | null {
  const k = process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  return k !== undefined && k.trim() !== "" ? k.trim() : null;
}

function vapidPrivateKey(): string | null {
  const k = process.env.VAPID_PRIVATE_KEY;
  return k !== undefined && k.trim() !== "" ? k.trim() : null;
}

/** true quando il server può davvero inviare: chiavi presenti. */
export function pushConfigured(): boolean {
  return vapidPublicKey() !== null && vapidPrivateKey() !== null;
}

/* ------------------------------------------------------------------ */
/* Registro delle iscrizioni                                           */
/* ------------------------------------------------------------------ */

export async function saveSubscription(
  payload: unknown,
  now: Date = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  const record = parseSubscription(payload, now);
  if (record === null) {
    return { ok: false, reason: "iscrizione incompleta: non viene salvata" };
  }
  const key = subscriptionKey(record.endpoint);
  await db
    .insert(systemState)
    .values({ key, value: record, updatedAt: now })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value: record, updatedAt: now },
    });
  return { ok: true };
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await db.delete(systemState).where(eq(systemState.key, subscriptionKey(endpoint)));
}

export async function listSubscriptions(): Promise<PushSubscriptionRecord[]> {
  const rows = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(like(systemState.key, "push:sub:%"));
  const out: PushSubscriptionRecord[] = [];
  for (const r of rows) {
    const v = r.value as Partial<PushSubscriptionRecord>;
    if (typeof v.endpoint === "string" && v.keys !== undefined) {
      out.push(v as PushSubscriptionRecord);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Dedupe: una notifica per partita al giorno                          */
/* ------------------------------------------------------------------ */

async function alreadySentKeys(
  endpoint: string,
  matchKeys: string[],
  now: Date,
): Promise<Set<string>> {
  if (matchKeys.length === 0) return new Set();
  const wanted = matchKeys.map((m) => dedupeKey(endpoint, m, now));
  const rows = await db
    .select({ key: systemState.key })
    .from(systemState)
    .where(like(systemState.key, "push:sent:%"));
  const presenti = new Set(rows.map((r) => r.key));
  return new Set(wanted.filter((w) => presenti.has(w)));
}

async function markSent(
  endpoint: string,
  matchKey: string,
  now: Date,
): Promise<void> {
  const key = dedupeKey(endpoint, matchKey, now);
  await db
    .insert(systemState)
    .values({ key, value: { at: now.toISOString() }, updatedAt: now })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value: { at: now.toISOString() }, updatedAt: now },
    });
}

/* ------------------------------------------------------------------ */
/* Invio                                                               */
/* ------------------------------------------------------------------ */

/** Invia un messaggio a una singola iscrizione. Nessuna eccezione esce. */
export async function sendToSubscription(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: { title: string; body: string; url: string },
): Promise<{ ok: boolean; gone: boolean; reason?: string }> {
  if (!pushConfigured()) {
    return { ok: false, gone: false, reason: "chiavi VAPID non configurate" };
  }
  try {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(
      `mailto:notifiche@${new URL(SITE_URL).hostname}`,
      vapidPublicKey()!,
      vapidPrivateKey()!,
    );
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(payload),
    );
    return { ok: true, gone: false };
  } catch (err) {
    const status =
      typeof err === "object" && err !== null && "statusCode" in err
        ? Number((err as { statusCode: unknown }).statusCode)
        : 0;
    /* 404/410 = iscrizione morta: si cancella invece di riprovare per sempre */
    return {
      ok: false,
      gone: status === 404 || status === 410,
      reason: `invio non riuscito (HTTP ${status || "?"})`,
    };
  }
}

export interface DispatchReport {
  subscriptions: number;
  sent: number;
  skipped: number;
  removed: number;
  configured: boolean;
}

/**
 * Passa in rassegna le iscrizioni e invia SOLO ciò che ha superato la
 * soglia e non è già stato notificato oggi.
 *
 * `live` associa la chiave partita al dato vivo: chi chiama la costruisce
 * dai segnali a registro. Una partita senza dato non produce notifiche.
 */
export async function dispatchNotifications(
  live: Map<string, LiveValue>,
  now: Date = new Date(),
): Promise<DispatchReport> {
  const report: DispatchReport = {
    subscriptions: 0,
    sent: 0,
    skipped: 0,
    removed: 0,
    configured: pushConfigured(),
  };
  if (!report.configured) return report;

  const subs = await listSubscriptions().catch(() => []);
  report.subscriptions = subs.length;

  for (const sub of subs) {
    const giaInviate = await alreadySentKeys(
      sub.endpoint,
      sub.watchlist.map((w) => w.matchKey),
      now,
    ).catch(() => new Set<string>());

    const daInviare: NotificaDaInviare[] = selectNotifications(
      sub.watchlist,
      live,
      giaInviate,
      sub.endpoint,
      now,
      SITE_URL,
    );

    for (const n of daInviare) {
      const esito = await sendToSubscription(sub, {
        title: n.title,
        body: n.body,
        url: n.url,
      });
      if (esito.ok) {
        report.sent += 1;
        await markSent(sub.endpoint, n.matchKey, now).catch(() => undefined);
      } else if (esito.gone) {
        report.removed += 1;
        await deleteSubscription(sub.endpoint).catch(() => undefined);
        break;
      } else {
        report.skipped += 1;
      }
    }
  }
  return report;
}
