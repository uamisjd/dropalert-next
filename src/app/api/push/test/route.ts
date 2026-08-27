/**
 * POST /api/push/test — invia UNA notifica di prova all'iscrizione indicata.
 *
 * Serve a chi attiva le notifiche per sapere subito se funzionano, invece di
 * scoprirlo (o non scoprirlo) al primo segnale. Non tocca il dedupe delle
 * notifiche vere: è una prova, e si dichiara come tale nel testo.
 */
import { pushConfigured, sendToSubscription } from "@/lib/repo/push";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!pushConfigured()) {
    return Response.json(
      { ok: false, reason: "notifiche non configurate sul server" },
      { status: 503 },
    );
  }
  let body: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, reason: "corpo non leggibile" }, { status: 400 });
  }
  const sub = body.subscription;
  if (
    sub?.endpoint === undefined ||
    sub.keys?.p256dh === undefined ||
    sub.keys?.auth === undefined
  ) {
    return Response.json({ ok: false, reason: "iscrizione incompleta" }, { status: 400 });
  }

  const esito = await sendToSubscription(
    { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    {
      title: "DropAlert — notifica di prova",
      body: "Le notifiche funzionano. Riceverai un avviso solo per le partite in watchlist che superano la tua soglia.",
      url: `${SITE_URL}/preferite`,
    },
  );
  return Response.json(esito, { status: esito.ok ? 200 : 502 });
}
