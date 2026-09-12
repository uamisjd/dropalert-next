/** Solo PostgreSQL locale: concorrenza e rotte, senza inviare push reali. */
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { sql } from "@/db/client";
import { consumePushQuota, pushQuotaKey, PUSH_QUOTAS, pushQuotaResponse } from "@/lib/repo/push-quota";
import { POST as testPush } from "@/app/api/push/test/route";
import { POST as subscribe, DELETE as unsubscribe } from "@/app/api/push/subscribe/route";
import { verifiedSubscriptionKey as subscriptionKey, beginPushVerification, confirmPushVerification } from "@/lib/repo/push-store";
import { parseSubscription } from "@/lib/push/pure";

const endpoint = `https://fcm.googleapis.com/test-${randomBytes(24).toString("hex")}`;
const keys = { p256dh: createECDH("prime256v1").generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url") };
let managementToken = "";
const request = (body: unknown) => new Request("https://example.com/api/push/test", { method: "POST", headers: { "content-type": "application/json", "x-push-token": managementToken }, body: JSON.stringify(body) });
const connection = new URL(process.env.DATABASE_URL ?? "postgres://dropalert@127.0.0.1:5433/dropalert");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(connection.hostname), "Questa suite richiede un database locale isolato, non produzione.");

async function clear() { await sql`delete from system_state where key like 'push:quota:v1:%'`; }
async function main() {
  const saved = await sql`select * from system_state where key like 'push:quota:v1:%'`;
  const oldPublic = process.env.VAPID_PUBLIC_KEY;
  const oldPrivate = process.env.VAPID_PRIVATE_KEY;
  let checks = 0;
  try {
    await clear();
    let link = "";
    await beginPushVerification(parseSubscription({ subscription: { endpoint, keys }, watchlist: [] }, new Date())!, "https://example.com", async (_sub, payload) => { link = payload.url; return { ok: true, gone: false }; });
    const [id, code] = new URL(link).hash.replace("#push-verify=", "").split(".");
    managementToken = (await confirmPushVerification(id, code))!.token;
    const attempts = await Promise.all(Array.from({ length: 20 }, () => consumePushQuota("test", endpoint)));
    assert.equal(attempts.filter((r) => r.allowed).length, 3, "aggiornamenti concorrenti atomici"); checks++;
    const [global] = await sql`select value from system_state where key = ${pushQuotaKey("test")}`;
    assert.equal(global.value.count, 3, "i rifiuti per endpoint non consumano la quota globale"); checks++;
    const limited = await pushQuotaResponse("test", endpoint);
    assert.equal(limited?.status, 429);
    assert.ok(Number(limited?.headers.get("Retry-After")) >= 1);
    assert.equal(limited?.headers.get("Cache-Control"), "no-store"); checks++;
    const quotaRows = await sql`select key, value from system_state where key like 'push:quota:v1:%'`;
    assert.ok(!JSON.stringify(quotaRows).includes(endpoint)); checks++;
    assert.notEqual(pushQuotaKey("test", endpoint), pushQuotaKey("test", "https://web.push.apple.com/" + endpoint.slice(-64)));
    assert.ok((await consumePushQuota("subscribe", endpoint)).allowed, "prove e registrazioni indipendenti"); checks++;

    process.env.VAPID_PUBLIC_KEY = "configured-for-test";
    process.env.VAPID_PRIVATE_KEY = "configured-for-test";
    const blockedTest = await testPush(request({ subscription: { endpoint, keys } }));
    assert.equal(blockedTest.status, 429, "la rotta blocca prima di inviare"); checks++;

    // Scadenza col tempo del DB: una richiesta può aprire una nuova finestra.
    await sql`update system_state set value = jsonb_set(value, '{resetAt}', '0') where key = ${pushQuotaKey("test", endpoint)}`;
    assert.ok((await consumePushQuota("test", endpoint)).allowed); checks++;
    const [renewed] = await sql`select value from system_state where key = ${pushQuotaKey("test", endpoint)}`;
    assert.equal(renewed.value.count, 1); checks++;

    // Rotare endpoint non aggira il tetto complessivo.
    await sql`update system_state set value = jsonb_set(value, '{count}', ${JSON.stringify(PUSH_QUOTAS.test.global)}::jsonb) where key = ${pushQuotaKey("test")}`;
    const other = endpoint + "-other";
    assert.equal((await consumePushQuota("test", other)).allowed, false);
    assert.equal((await sql`select key from system_state where key = ${pushQuotaKey("test", other)}`).length, 0); checks++;

    // Pulizia opportunistica limitata ai contatori quota, non agli altri stati.
    const stale = "push:quota:v1:test:stale-fixture";
    const sentinel = "push-quota-test-sentinel";
    await sql`insert into system_state (key, value, updated_at) values
      (${stale}, '{"count":1,"resetAt":0}', now() - interval '2 days'),
      (${sentinel}, '{}', now() - interval '2 days')`;
    try {
      await consumePushQuota("subscribe", endpoint);
      assert.equal((await sql`select key from system_state where key = ${stale}`).length, 0);
      assert.equal((await sql`select key from system_state where key = ${sentinel}`).length, 1); checks++;
    } finally { await sql`delete from system_state where key = ${sentinel}`; }

    // Registrazione riuscita, successivo 429 senza riscrittura, DELETE sempre possibile.
    assert.equal((await subscribe(request({ subscription: { endpoint, keys }, watchlist: [] }))).status, 200);
    const [before] = await sql`select value from system_state where key = ${subscriptionKey(endpoint)}`;
    await sql`update system_state set value = jsonb_set(value, '{count}', '30') where key = ${pushQuotaKey("subscribe", endpoint)}`;
    assert.equal((await subscribe(request({ subscription: { endpoint, keys }, watchlist: [] }))).status, 429);
    const [after] = await sql`select value from system_state where key = ${subscriptionKey(endpoint)}`;
    assert.deepEqual(after.value, before.value); checks++;
    assert.equal((await unsubscribe(request({ endpoint }))).status, 200);
    assert.equal((await sql`select key from system_state where key = ${subscriptionKey(endpoint)}`).length, 0); checks++;
    assert.equal((await unsubscribe(request(null))).status, 400); checks++;

    // Registro quota corrotto = guasto DB, non permesso implicito di inviare.
    await sql`update system_state set value = '{"count":1,"resetAt":"invalid"}' where key = ${pushQuotaKey("test")}`;
    assert.equal((await testPush(request({ subscription: { endpoint, keys } }))).status, 503); checks++;
    console.log(`✓ ${checks} verifiche quota PostgreSQL e rotte push, nessun invio reale`);
  } finally {
    await clear();
    for (const row of saved) await sql`insert into system_state (key, value, updated_at) values (${row.key}, ${JSON.stringify(row.value)}::jsonb, ${row.updated_at})`;
    await sql`delete from system_state where key = ${subscriptionKey(endpoint)}`;
    if (oldPublic === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = oldPublic;
    if (oldPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = oldPrivate;
    await sql.end();
  }
}
main().catch(async (error) => { console.error(error); await sql.end(); process.exitCode = 1; });
