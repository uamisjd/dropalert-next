/** Quote persistenti per gli endpoint push pubblici.
 * PostgreSQL serializza gli aggiornamenti: nessun contatore in memoria e
 * nessuna fiducia in X-Forwarded-For inviato dal client. Una quota globale
 * limita anche la rotazione degli endpoint; una quota per endpoint limita
 * i tentativi sulla stessa iscrizione. Non è una prova di possesso né un WAF.
 */
import { createHash } from "node:crypto";
import { sql } from "@/db/client";

export const PUSH_QUOTAS = {
  subscribe: { global: 300, endpoint: 30, seconds: 900 },
  test: { global: 60, endpoint: 3, seconds: 900 },
  verify: { global: 60, endpoint: 3, seconds: 900 },
} as const;
export type PushQuotaAction = keyof typeof PUSH_QUOTAS;
export const PUSH_QUOTA_PREFIX = "push:quota:v1:";

export function pushQuotaKey(action: PushQuotaAction, endpoint?: string): string {
  return `${PUSH_QUOTA_PREFIX}${action}:${endpoint === undefined ? "global" : createHash("sha256").update(endpoint).digest("hex")}`;
}

class QuotaExceeded extends Error {
  constructor(readonly retryAfter: number) { super("push quota exceeded"); }
}

/** Prenota un tentativo prima della scrittura/invio, anche se poi fallisce.
 * Se la quota endpoint è esaurita la transazione annulla anche la prenotazione
 * globale. I rifiuti non prolungano la finestra. Orologio del database.
 */
export async function consumePushQuota(action: PushQuotaAction, endpoint: string): Promise<
  { allowed: true } | { allowed: false; retryAfter: number }
> {
  const policy = PUSH_QUOTAS[action];
  try {
    await sql.begin(async (tx) => {
      // Timeout breve: in caso di guasto la rotta fallisce chiusa con 503.
      await tx`set local statement_timeout = '5s'`;
      for (const [key, limit] of [
        [pushQuotaKey(action), policy.global],
        [pushQuotaKey(action, endpoint), policy.endpoint],
      ] as const) {
        const rows = await tx`
          insert into system_state (key, value, updated_at)
          values (${key}, jsonb_build_object('count', 1, 'resetAt',
            floor(extract(epoch from now()))::bigint + ${policy.seconds}::int), now())
          on conflict (key) do update set
            value = case when (system_state.value->>'resetAt')::bigint <= extract(epoch from now())
              then excluded.value
              else jsonb_set(system_state.value, '{count}', to_jsonb((system_state.value->>'count')::int + 1)) end,
            updated_at = now()
          where (system_state.value->>'resetAt')::bigint <= extract(epoch from now())
             or (system_state.value->>'count')::int < ${limit}
          returning key`;
        if (rows.length === 0) {
          const [row] = await tx`
            select greatest(1, ceil((value->>'resetAt')::bigint - extract(epoch from now())))::int as retry
            from system_state where key = ${key}`;
          throw new QuotaExceeded(row?.retry ?? policy.seconds);
        }
      }
      // Pulizia opportunistica e limitata ai soli contatori quota inattivi.
      // Non tocca iscrizioni, dedupe notifiche o stati degli altri job.
      await tx`
        delete from system_state where key in (
          select key from system_state
          where key like 'push:quota:v1:%' and updated_at < now() - interval '24 hours'
          order by updated_at limit 100
          for update skip locked
        )`;
    });
    return { allowed: true };
  } catch (error) {
    if (error instanceof QuotaExceeded) return { allowed: false, retryAfter: error.retryAfter };
    throw error;
  }
}

/** Limite esaurito = 429; registro non raggiungibile = 503, mai invio libero. */
export async function pushQuotaResponse(action: PushQuotaAction, endpoint: string): Promise<Response | null> {
  try {
    const result = await consumePushQuota(action, endpoint);
    if (result.allowed) return null;
    return Response.json(
      { ok: false, reason: `limite temporaneo raggiunto: riprova tra ${result.retryAfter} secondi`, retryAfter: result.retryAfter },
      { status: 429, headers: { "Retry-After": String(result.retryAfter), "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, reason: "protezione notifiche non disponibile: riprovare più tardi" },
      { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }
}
