import { ownedPushSubscription } from "@/lib/repo/push-store";
import { readBoundedJson } from "@/lib/security/json-body";
import { pushQuotaResponse } from "@/lib/repo/push-quota";
import { parsePushTarget, MAX_PUSH_TARGET_BYTES } from "@/lib/push/validation";
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
  const payload = await readBoundedJson(request, MAX_PUSH_TARGET_BYTES);
  if (!payload.ok) return payload.response;
  const body = payload.data;
  const sub = parsePushTarget(
    typeof body === "object" && body !== null && "subscription" in body
      ? body.subscription : null,
  );
  if (sub === null) {
    return Response.json({ ok: false, reason: "iscrizione non valida o servizio push non supportato" }, { status: 400 });
  }

  const limited = await pushQuotaResponse("test", sub.endpoint);
  if (limited) return limited;

  let verified;
  try {
    verified = await ownedPushSubscription(sub.endpoint, request.headers.get("x-push-token"));
  } catch {
    return Response.json({ ok: false, reason: "registro non disponibile" }, { status: 503 });
  }
  if (!verified) return Response.json({ ok: false, reason: "verifica prima l’iscrizione su questo browser" }, { status: 403 });

  const esito = await sendToSubscription(
    verified,
    {
      title: "DropAlert — notifica di prova",
      body: "Le notifiche funzionano. Riceverai un avviso solo per le partite in watchlist che superano la tua soglia.",
      url: `${SITE_URL}/preferite`,
    },
  );
  return Response.json(esito, { status: esito.ok ? 200 : 502 });
}
