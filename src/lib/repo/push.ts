import { parsePushTarget } from "@/lib/push/validation";
/**
 * Iscrizioni push e invio (Sprint ENH-1, Fase B).
 *
 * Le iscrizioni vivono in `system_state`, come gli altri stati del
 * progetto: nessuna migrazione, nessun account. Endpoint e chiavi sono
 * identificativi tecnici pseudonimi; conserviamo anche watchlist e soglie
 * necessarie a selezionare gli avvisi — nessuna email.
 *
 * L'invio è deliberatamente semplice: nessuna coda, nessun ritentativo in
 * loop. Se un endpoint è morto (410/404) l'iscrizione si cancella, perché
 * tenere un indirizzo che non riceve più è solo rumore.
 */
import { selectNotifications, type LiveValue } from "@/lib/push/pure";
import { SITE_URL } from "@/lib/site";
import {
  cleanupPushState, readVerifiedSubscriptions, claimPushDelivery,
  finishPushDelivery, removeGoneSubscription, type PushSender,
} from "./push-store";

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
/* Invio                                                               */
/* ------------------------------------------------------------------ */

/**
 * Timeout di un singolo invio push. Un endpoint che resta appeso non deve
 * poter impiccare il giro di raccolta: il job ha un killer a 10 minuti e
 * tre giri sono già morti così (set-2026) senza lasciare diagnosi.
 */
const PUSH_SEND_TIMEOUT_MS = 15_000;

/**
 * Vince la prima fra la promessa e il tempo massimo. La perdente lenta non
 * diventa un rejection non gestito se fallisce dopo: la si neutralizza.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guardia = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: timeout dopo ${ms} ms`)),
      ms,
    );
  });
  p.catch(() => undefined);
  return Promise.race([p, guardia]).finally(() => clearTimeout(timer));
}

/** Invia un messaggio a una singola iscrizione. Nessuna eccezione esce. */
export async function sendToSubscription(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: { title: string; body: string; url: string },
): Promise<{ ok: boolean; gone: boolean; reason?: string }> {
  if (parsePushTarget(sub) === null) {
    return { ok: false, gone: false, reason: "destinazione push non valida o non supportata" };
  }
  if (!pushConfigured()) {
    return { ok: false, gone: false, reason: "chiavi VAPID non configurate" };
  }
  try {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT?.trim() || SITE_URL,
      vapidPublicKey()!,
      vapidPrivateKey()!,
    );
    await withTimeout(
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload),
        { timeout: PUSH_SEND_TIMEOUT_MS },
      ),
      PUSH_SEND_TIMEOUT_MS,
      `push verso ${sub.endpoint.slice(0, 60)}`,
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
  send: PushSender = sendToSubscription,
): Promise<DispatchReport> {
  const report: DispatchReport = {
    subscriptions: 0,
    sent: 0,
    skipped: 0,
    removed: 0,
    configured: pushConfigured(),
  };
  if (!report.configured) return report;

  await cleanupPushState();
  const subs = await readVerifiedSubscriptions(); // guasto DB: propagato, non lista vuota
  report.subscriptions = subs.length;

  for (const sub of subs) {
    const due = selectNotifications(sub.watchlist, live, new Set(), sub.endpoint, now, SITE_URL);
    for (const notification of due) {
      const claim = await claimPushDelivery(sub, notification.matchKey, now);
      if (!claim) { report.skipped++; continue; }
      const result = await send(sub, notification);
      await finishPushDelivery(claim, result.ok ? "sent" : "failed");
      if (result.ok) report.sent++;
      else if (result.gone) {
        await removeGoneSubscription(sub);
        report.removed++;
        break;
      } else report.skipped++;
    }
  }
  return report;
}
