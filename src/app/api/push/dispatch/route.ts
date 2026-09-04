/**
 * POST /api/push/dispatch — invia le notifiche dovute.
 *
 * Lo chiama lo stesso scheduler che fa girare il ciclo del collector: la
 * rotta legge i segnali già a registro e notifica solo le partite in
 * watchlist che hanno superato la soglia, una volta al giorno ciascuna.
 *
 * Protetta come gli altri job: con `JOBS_TOKEN` impostato serve l'header
 * `x-jobs-token`.
 */
import { dispatchNotifications } from "@/lib/repo/push";
import { readLiveValues } from "@/lib/push/live";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const token = process.env.JOBS_TOKEN;
  if (token === undefined || token.trim() === "") {
    return process.env.NODE_ENV !== "production";
  }
  return request.headers.get("x-jobs-token") === token;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ ok: false, reason: "non autorizzato" }, { status: 401 });
  }
  const now = new Date();
  /* il dato vivo per partita: indice e calo, gli stessi numeri che la lista
     mostra. Nessun ricalcolo, nessuna metrica nuova — la stessa costruzione
     che usa il ciclo di osservazione, in `lib/push/live`. */
  const live = await readLiveValues(now);
  if (live === null) {
    return Response.json({ ok: false, reason: "registro non leggibile" }, { status: 503 });
  }

  const report = await dispatchNotifications(live, now).catch(() => null);
  if (report === null) {
    return Response.json({ ok: false, reason: "invio non riuscito" }, { status: 500 });
  }
  return Response.json({ ok: true, ...report });
}
