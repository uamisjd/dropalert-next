/** Registro push verificato. Tutte le chiavi nuove usano l'endpoint intero.
 * Il segreto di gestione nasce solo dopo una prova ricevuta via Web Push.
 * I record legacy non verificati non vengono più usati per invii automatici.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "@/db/client";
import { parseSubscription, dedupeKey, subscriptionKey, type PushSubscriptionRecord } from "@/lib/push/pure";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const validPushSecret = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const verifiedSubscriptionKey = (endpoint: string) => `push:sub:v2:${hash(endpoint)}`;
export const verificationKey = (id: string) => `push:verify:v1:${id}`;
export interface VerifiedSubscription extends PushSubscriptionRecord { ownerHash: string; }
export type PushSender = (
  sub: Pick<PushSubscriptionRecord, "endpoint" | "keys">,
  payload: { title: string; body: string; url: string },
) => Promise<{ ok: boolean; gone: boolean; reason?: string }>;

export async function cleanupPushState(): Promise<void> {
  await sql`delete from system_state where key in (
    select key from system_state where
      (key like 'push:verify:v1:%' and updated_at < now() - interval '10 minutes') or
      (key like 'push:sent:%' and updated_at < now() - interval '7 days') or
      (key like 'push:sub:%' and updated_at < now() - interval '90 days')
    order by updated_at limit 200 for update skip locked
  )`;
}

/** Il token monouso è trasmesso SOLO nella notifica cifrata, non al richiedente HTTP. */
export async function beginPushVerification(record: PushSubscriptionRecord, origin: string, send: PushSender): Promise<boolean> {
  await cleanupPushState();
  const id = randomBytes(32).toString("hex");
  const code = randomBytes(32).toString("hex");
  await sql`insert into system_state (key, value) values (${verificationKey(id)}, ${JSON.stringify({ record, codeHash: hash(code) })}::jsonb)`;
  try {
    const result = await send(record, {
      title: "DropAlert — conferma le notifiche",
      body: "Apri questa notifica entro 5 minuti per confermare l’attivazione su questo browser. Se non l’hai richiesta, ignorala.",
      // Il frammento non viene inviato al server di pagina né nei referrer HTTP.
      url: `${origin}/preferite#push-verify=${id}.${code}`,
    });
    if (result.ok) return true;
  } catch { /* un trasporto interrotto non lascia attiva una verifica fantasma */ }
  await sql`delete from system_state where key = ${verificationKey(id)}`;
  return false;
}

export async function confirmPushVerification(id: string, code: string): Promise<{ endpoint: string; token: string } | null> {
  if (!validPushSecret(id) || !validPushSecret(code)) return null;
  return sql.begin(async (tx) => {
    // Consumo atomico: una prova non può attivare due volte o essere riprodotta.
    const [pending] = await tx`delete from system_state
      where key = ${verificationKey(id)} and value->>'codeHash' = ${hash(code)}
        and updated_at > now() - interval '5 minutes' returning value`;
    if (!pending) return null;
    const candidate = pending.value.record;
    const record = parseSubscription({ subscription: candidate, watchlist: candidate?.watchlist }, new Date());
    if (!record) return null;
    const token = randomBytes(32).toString("hex");
    const value = { ...record, ownerHash: hash(token) };
    await tx`insert into system_state (key, value, updated_at)
      values (${verifiedSubscriptionKey(record.endpoint)}, ${JSON.stringify(value)}::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
    // La coda legacy non è un'identità: prima di eliminarla confronta tutto l'URL.
    await tx`delete from system_state where key = ${subscriptionKey(record.endpoint)} and value->>'endpoint' = ${record.endpoint}`;
    return { endpoint: record.endpoint, token };
  });
}

export async function ownedPushSubscription(endpoint: string, token: unknown): Promise<VerifiedSubscription | null> {
  if (!validPushSecret(token)) return null;
  const [row] = await sql`select value from system_state
    where key = ${verifiedSubscriptionKey(endpoint)} and value->>'ownerHash' = ${hash(token)}
      and updated_at > now() - interval '90 days'`;
  if (!row) return null;
  const record = parseSubscription({ subscription: row.value, watchlist: row.value?.watchlist }, new Date());
  return record ? { ...record, ownerHash: hash(token) } : null;
}

export async function updateOwnedSubscription(record: PushSubscriptionRecord, token: string): Promise<boolean> {
  if (!validPushSecret(token)) return false;
  const value = { ...record, ownerHash: hash(token) };
  const rows = await sql`update system_state set value = ${JSON.stringify(value)}::jsonb, updated_at = now()
    where key = ${verifiedSubscriptionKey(record.endpoint)} and value->>'ownerHash' = ${hash(token)}
      and updated_at > now() - interval '90 days' returning key`;
  return rows.length === 1;
}

/** Nessuna quota: eliminazione sempre possibile con la capacità di gestione. */
export async function deleteOwnedSubscription(endpoint: string, token: unknown): Promise<boolean> {
  if (!validPushSecret(token)) return false;
  const rows = await sql`delete from system_state where key = ${verifiedSubscriptionKey(endpoint)}
    and value->>'ownerHash' = ${hash(token)} returning key`;
  return rows.length === 1;
}

export async function readVerifiedSubscriptions(): Promise<VerifiedSubscription[]> {
  const rows = await sql`select value from system_state where key like 'push:sub:v2:%'
    and updated_at > now() - interval '90 days'`;
  return rows.flatMap(({ value }) => {
    if (!validPushSecret(value?.ownerHash)) return [];
    const record = parseSubscription({ subscription: value, watchlist: value?.watchlist }, new Date());
    return record ? [{ ...record, ownerHash: value.ownerHash }] : [];
  });
}

/** Prenotazione PRIMA della rete: al massimo un tentativo automatico al giorno.
 * Anche timeout/crash mantengono il claim: una consegna incerta non si ritenta.
 */
export async function claimPushDelivery(sub: VerifiedSubscription, matchKey: string, now: Date): Promise<string | null> {
  const legacy = dedupeKey(sub.endpoint, matchKey, now);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const key = `push:sent:v2:${hash(JSON.stringify([sub.endpoint, matchKey, day]))}`;
  // L'esistenza del proprietario viene verificata di nuovo: le liste già lette
  // non autorizzano una nuova prenotazione dopo cancellazione o riverifica.
  const rows = await sql`insert into system_state (key, value, updated_at)
    select ${key}, ${JSON.stringify({ state: "attempted", at: now.toISOString() })}::jsonb, now()
    where exists (select 1 from system_state where key = ${verifiedSubscriptionKey(sub.endpoint)}
      and value->>'ownerHash' = ${sub.ownerHash} and updated_at > now() - interval '90 days')
      and not exists (select 1 from system_state where key = ${legacy})
    on conflict (key) do nothing returning key`;
  return rows.length ? key : null;
}

export async function finishPushDelivery(key: string, state: "sent" | "failed"): Promise<void> {
  await sql`update system_state set value = jsonb_set(value, '{state}', ${JSON.stringify(state)}::jsonb) where key = ${key}`;
}

/** Un endpoint morto non deve cancellare una iscrizione rinnovata nel frattempo. */
export async function removeGoneSubscription(sub: VerifiedSubscription): Promise<void> {
  await sql`delete from system_state where key = ${verifiedSubscriptionKey(sub.endpoint)} and value->>'ownerHash' = ${sub.ownerHash}`;
}
