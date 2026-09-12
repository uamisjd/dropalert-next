import { readBoundedJson } from "@/lib/security/json-body";
import { confirmPushVerification, validPushSecret } from "@/lib/repo/push-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const payload = await readBoundedJson(request, 1024);
  if (!payload.ok) return payload.response;
  const body = payload.data;
  if (typeof body !== "object" || body === null || !("id" in body) || !("code" in body) || !validPushSecret(body.id) || !validPushSecret(body.code)) {
    return Response.json({ ok: false, reason: "conferma non valida" }, { status: 400 });
  }
  try {
    const result = await confirmPushVerification(body.id, body.code);
    return Response.json(result ? { ok: true, ...result } : { ok: false, reason: "conferma scaduta, non valida o già utilizzata: richiedi una nuova verifica" }, {
      status: result ? 200 : 403,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch {
    return Response.json({ ok: false, reason: "conferma non disponibile: riprovare" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
