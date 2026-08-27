/**
 * POST /api/push/subscribe — registra o aggiorna un'iscrizione push.
 * DELETE — la cancella.
 *
 * Nessun account: l'iscrizione è anonima e viaggia con la watchlist che il
 * browser invia. Di chi si iscrive conserviamo solo l'endpoint del servizio
 * push e le chiavi di cifratura, che senza il browser non identificano
 * nessuno.
 */
import {
  deleteSubscription,
  pushConfigured,
  saveSubscription,
  vapidPublicKey,
} from "@/lib/repo/push";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({
    configured: pushConfigured(),
    publicKey: vapidPublicKey(),
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!pushConfigured()) {
    return Response.json(
      { ok: false, reason: "notifiche non configurate sul server" },
      { status: 503 },
    );
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "corpo non leggibile" }, { status: 400 });
  }
  const esito = await saveSubscription(payload, new Date()).catch(() => ({
    ok: false as const,
    reason: "registro non scrivibile",
  }));
  return Response.json(esito, { status: esito.ok ? 200 : 400 });
}

export async function DELETE(request: Request): Promise<Response> {
  let endpoint = "";
  try {
    const body = (await request.json()) as { endpoint?: unknown };
    endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  } catch {
    endpoint = "";
  }
  if (endpoint === "") {
    return Response.json({ ok: false, reason: "endpoint mancante" }, { status: 400 });
  }
  await deleteSubscription(endpoint).catch(() => undefined);
  return Response.json({ ok: true });
}
