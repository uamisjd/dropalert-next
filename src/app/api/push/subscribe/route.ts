/** Iscrizione push: aggiornamento autenticato oppure verifica via notifica. */
import { readBoundedJson } from "@/lib/security/json-body";
import { parseSubscription } from "@/lib/push/pure";
import { MAX_PUSH_BODY_BYTES, MAX_PUSH_TARGET_BYTES } from "@/lib/push/validation";
import { pushQuotaResponse } from "@/lib/repo/push-quota";
import { pushConfigured, vapidPublicKey, sendToSubscription } from "@/lib/repo/push";
import { beginPushVerification, updateOwnedSubscription, deleteOwnedSubscription } from "@/lib/repo/push-store";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  return Response.json({ configured: pushConfigured(), publicKey: vapidPublicKey() }, { headers: privateHeaders });
}

export async function POST(request: Request): Promise<Response> {
  if (!pushConfigured()) return Response.json({ ok: false, reason: "notifiche non configurate sul server" }, { status: 503 });
  const body = await readBoundedJson(request, MAX_PUSH_BODY_BYTES);
  if (!body.ok) return body.response;
  const record = parseSubscription(body.data, new Date());
  if (!record) return Response.json({ ok: false, reason: "iscrizione o lista non valida: massimo 100 partite uniche con soglie tra 0 e 100" }, { status: 400 });
  const limited = await pushQuotaResponse("subscribe", record.endpoint);
  if (limited) return limited;
  try {
    const token = request.headers.get("x-push-token");
    if (token !== null) {
      const updated = await updateOwnedSubscription(record, token);
      return Response.json({ ok: updated, reason: updated ? undefined : "iscrizione da verificare nuovamente" }, { status: updated ? 200 : 403, headers: privateHeaders });
    }
    const verificationLimit = await pushQuotaResponse("verify", record.endpoint);
    if (verificationLimit) return verificationLimit;
    const sent = await beginPushVerification(record, SITE_URL, sendToSubscription);
    return Response.json({ ok: false, pending: sent, reason: sent ? "Apri la notifica di conferma entro 5 minuti. L’iscrizione non è ancora attiva." : "notifica di conferma non inviata: riprovare" }, { status: sent ? 202 : 502, headers: privateHeaders });
  } catch {
    return Response.json({ ok: false, reason: "registro non disponibile" }, { status: 503, headers: privateHeaders });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const payload = await readBoundedJson(request, MAX_PUSH_TARGET_BYTES);
  if (!payload.ok) return payload.response;
  const body = payload.data;
  const endpoint = typeof body === "object" && body !== null && "endpoint" in body ? body.endpoint : null;
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 4096) return Response.json({ ok: false, reason: "endpoint non valido" }, { status: 400 });
  try {
    // Fuori quota, ma non fuori autorizzazione. URL noti da soli non bastano.
    const removed = await deleteOwnedSubscription(endpoint, request.headers.get("x-push-token"));
    return Response.json({ ok: removed, reason: removed ? undefined : "iscrizione assente o autorizzazione non valida: verifica questo browser" }, { status: removed ? 200 : 403, headers: privateHeaders });
  } catch {
    return Response.json({ ok: false, reason: "registro non scrivibile: riprovare la cancellazione" }, { status: 503 });
  }
}
