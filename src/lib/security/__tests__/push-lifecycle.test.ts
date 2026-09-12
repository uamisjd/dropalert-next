import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { sql } from "@/db/client";
import { parseSubscription, subscriptionKey, dedupeKey } from "@/lib/push/pure";
import { beginPushVerification, confirmPushVerification, ownedPushSubscription, updateOwnedSubscription,
  deleteOwnedSubscription, readVerifiedSubscriptions, claimPushDelivery, cleanupPushState,
  verifiedSubscriptionKey, verificationKey } from "@/lib/repo/push-store";
import { dispatchNotifications } from "@/lib/repo/push";
import { POST as confirmRoute } from "@/app/api/push/confirm/route";
import { POST as testRoute } from "@/app/api/push/test/route";
import { DELETE as deleteRoute } from "@/app/api/push/subscribe/route";

const database = new URL(process.env.DATABASE_URL ?? "postgres://dropalert@127.0.0.1:5433/dropalert");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname), "Solo DB di test locale.");
const endpoint = `https://fcm.googleapis.com/lifecycle-${randomBytes(32).toString("hex")}`;
const secondEndpoint = `https://web.push.apple.com/${endpoint.slice(-64)}`;
const keys = { p256dh: createECDH("prime256v1").generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url") };
const now = new Date();
const item = { matchKey: `lifecycle-${randomBytes(8).toString("hex")}`, matchId: 1, homeTeam: "A", awayTeam: "B", thresholdKind: "indice", thresholdValue: 60 };
const record = parseSubscription({ subscription: { endpoint, keys }, watchlist: [item] }, now)!;
const requests = (body: unknown, token?: string) => new Request("https://example.com/api/push", { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-push-token": token } : {}) }, body: JSON.stringify(body) });
const createdKeys: string[] = [];
let checks = 0;
async function proof(ep = endpoint) {
  let link = "";
  assert.equal(await beginPushVerification({ ...record, endpoint: ep }, "https://example.com", async (_sub, payload) => { link = payload.url; return { ok: true, gone: false }; }), true);
  const [id, code] = new URL(link).hash.replace("#push-verify=", "").split(".");
  createdKeys.push(verificationKey(id), verifiedSubscriptionKey(ep));
  return { id, code };
}

async function main() {
  const priorQuota = await sql`select * from system_state where key = 'push:quota:v1:test:global'`;
  const priorPublic = process.env.VAPID_PUBLIC_KEY;
  const priorPrivate = process.env.VAPID_PRIVATE_KEY;
  try {
    assert.equal((await readVerifiedSubscriptions()).length, 0, "Serve un database di test senza iscrizioni reali.");
    process.env.VAPID_PUBLIC_KEY = "fake";
    process.env.VAPID_PRIVATE_KEY = "fake";
    const first = await proof();
    assert.equal((await readVerifiedSubscriptions()).length, 0, "pending non è un’iscrizione attiva"); checks++;
    const [pending] = await sql`select value from system_state where key = ${verificationKey(first.id)}`;
    assert.ok(!JSON.stringify(pending.value).includes(first.code), "codice monouso conservato solo come hash"); checks++;
    assert.equal(await confirmPushVerification(first.id, "f".repeat(64)), null); checks++;
    const confirmations = await Promise.all(Array.from({ length: 8 }, () => confirmPushVerification(first.id, first.code)));
    assert.equal(confirmations.filter(Boolean).length, 1, "consumo atomico anche concorrente"); checks++;
    const owner = confirmations.find(Boolean)!;
    assert.equal(owner.endpoint, endpoint);
    assert.equal(await confirmPushVerification(first.id, first.code), null, "replay bloccato"); checks++;
    const [stored] = await sql`select value from system_state where key = ${verifiedSubscriptionKey(endpoint)}`;
    assert.ok(!JSON.stringify(stored.value).includes(owner.token), "token di gestione solo come hash"); checks++;
    assert.equal(await ownedPushSubscription(endpoint, "0".repeat(64)), null);
    assert.ok(await ownedPushSubscription(endpoint, owner.token)); checks++;
    assert.equal(await updateOwnedSubscription(record, "0".repeat(64)), false);
    assert.equal(await deleteOwnedSubscription(endpoint, "0".repeat(64)), false); checks++;
    assert.equal((await deleteRoute(requests({ endpoint }))).status, 403);
    assert.equal((await testRoute(requests({ subscription: { endpoint, keys } }))).status, 403); checks++;

    const expired = await proof();
    await sql`update system_state set updated_at = now() - interval '6 minutes' where key = ${verificationKey(expired.id)}`;
    assert.equal(await confirmPushVerification(expired.id, expired.code), null); checks++;
    const apiProof = await proof();
    const apiResponse = await confirmRoute(requests(apiProof));
    assert.equal(apiResponse.status, 200);
    assert.equal(apiResponse.headers.get("Cache-Control"), "no-store");
    const newOwner = await apiResponse.json();
    assert.equal(await ownedPushSubscription(endpoint, owner.token), null, "riverifica ruota la capacità"); checks++;
    const current = (await ownedPushSubscription(endpoint, newOwner.token))!;

    // Due endpoint con la stessa coda non sono più la stessa iscrizione.
    const second = await proof(secondEndpoint);
    const secondOwner = (await confirmPushVerification(second.id, second.code))!;
    assert.notEqual(verifiedSubscriptionKey(endpoint), verifiedSubscriptionKey(secondEndpoint));
    assert.equal((await readVerifiedSubscriptions()).length, 2); checks++;
    await deleteOwnedSubscription(secondEndpoint, secondOwner.token);

    let sends = 0;
    const live = new Map([[item.matchKey, { score: 75, dropPct: -10 }]]);
    const beforeClaims = await sql`select key from system_state where key like 'push:sent:%'`;
    const reports = await Promise.all(Array.from({ length: 10 }, () => dispatchNotifications(live, now, async () => {
      sends++; return { ok: true, gone: false };
    })));
    assert.equal(sends, 1, "un solo invio fra dieci dispatcher concorrenti");
    assert.equal(reports.reduce((n, r) => n + r.sent, 0), 1); checks++;
    const afterClaims = await sql`select key from system_state where key like 'push:sent:%'`;
    createdKeys.push(...afterClaims.filter((r) => !beforeClaims.some((b) => b.key === r.key)).map((r) => r.key));

    const failedKey = item.matchKey + "-failed";
    assert.equal(await updateOwnedSubscription({ ...record, watchlist: [{ ...record.watchlist[0], matchKey: failedKey }] }, newOwner.token), true);
    const failedLive = new Map([[failedKey, { score: 75, dropPct: -10 }]]);
    let failedAttempts = 0;
    await dispatchNotifications(failedLive, now, async () => { failedAttempts++; return { ok: false, gone: false }; });
    await dispatchNotifications(failedLive, now, async () => { failedAttempts++; return { ok: true, gone: false }; });
    assert.equal(failedAttempts, 1, "consegna incerta non ritentata nello stesso giorno"); checks++;
    const allClaims = await sql`select key from system_state where key like 'push:sent:%'`;
    createdKeys.push(...allClaims.filter((r) => !beforeClaims.some((b) => b.key === r.key)).map((r) => r.key));

    // Compatibilità con i marcatori vecchi: niente doppio invio il giorno del rilascio.
    const legacy = dedupeKey(endpoint, item.matchKey + "-legacy", now);
    createdKeys.push(legacy);
    await sql`insert into system_state (key, value) values (${legacy}, '{}')`;
    assert.equal(await claimPushDelivery(current, item.matchKey + "-legacy", now), null); checks++;

    await deleteOwnedSubscription(endpoint, newOwner.token);
    assert.equal(await claimPushDelivery(current, item.matchKey + "-after-delete", now), null, "lista letta prima della cancellazione non autorizza nuovi claim"); checks++;
    assert.equal((await readVerifiedSubscriptions()).length, 0);

    const legacySub = subscriptionKey(endpoint);
    createdKeys.push(legacySub);
    await sql`insert into system_state (key, value, updated_at) values (${legacySub}, ${JSON.stringify(record)}::jsonb, now() - interval '91 days')`;
    assert.equal((await readVerifiedSubscriptions()).length, 0, "legacy non verificati mai inviati");
    await cleanupPushState();
    assert.equal((await sql`select key from system_state where key = ${legacySub}`).length, 0); checks++;
    console.log(`✓ ${checks} verifiche lifecycle push: possesso, replay, scadenze, concorrenza e retention`);
  } finally {
    if (createdKeys.length) await sql`delete from system_state where key in ${sql([...new Set(createdKeys)])}`;
    const { pushQuotaKey } = await import("@/lib/repo/push-quota");
    await sql`delete from system_state where key = ${pushQuotaKey("test", endpoint)}`;
    await sql`delete from system_state where key = 'push:quota:v1:test:global'`;
    for (const row of priorQuota) await sql`insert into system_state (key, value, updated_at) values (${row.key}, ${JSON.stringify(row.value)}::jsonb, ${row.updated_at})`;
    if (priorPublic === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = priorPublic;
    if (priorPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = priorPrivate;
    await sql.end();
  }
}
main().catch(async (error) => { console.error(error); await sql.end(); process.exitCode = 1; });
