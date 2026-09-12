import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { isAllowedPushEndpoint, parsePushTarget } from "../../push/validation";
import { parseSubscription } from "../../push/pure";
import { sendToSubscription } from "../../repo/push";
import { collectNow } from "../../../app/cov/actions";
import { POST as testPush } from "../../../app/api/push/test/route";

async function main() {
  const keys = {
    p256dh: createECDH("prime256v1").generateKeys().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
  for (const host of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "updates-autopush.push.services.mozilla.com", "web.push.apple.com", "wns2.notify.windows.com"]) {
    assert.ok(parsePushTarget({ endpoint: `https://${host}/token`, keys }), host);
  }
  for (const endpoint of ["https://127.0.0.1/a", "https://[::1]/a", "https://169.254.169.254/a", "https://localhost/a", "https://example.com/a", "http://fcm.googleapis.com/a", "https://fcm.googleapis.com.evil.test/a", "https://fcm.googleapis.com@evil.test/a", "https://evil@fcm.googleapis.com/a", "https://fcm.googleapis.com:8443/a", "https://fcm.googleapis.com/a#secret", "https://fcm.googleapis.com/" + "a".repeat(4096)]) {
    assert.equal(isAllowedPushEndpoint(endpoint), false, endpoint);
    assert.equal(parseSubscription({ subscription: { endpoint, keys } }, new Date()), null);
    assert.equal((await sendToSubscription({ endpoint, keys }, { title: "test", body: "test", url: "https://example.com" })).ok, false);
  }
  for (const value of [null, [], 42, {}, { endpoint: "https://fcm.googleapis.com/a", keys: { p256dh: 3, auth: false } }]) {
    assert.equal(parsePushTarget(value), null);
  }

  const old = { node: process.env.NODE_ENV, public: process.env.VAPID_PUBLIC_KEY, private: process.env.VAPID_PRIVATE_KEY };
  try {
    process.env.VAPID_PUBLIC_KEY = "configured-for-validation";
    process.env.VAPID_PRIVATE_KEY = "configured-for-validation";
    for (const body of [null, [], {}, { subscription: { endpoint: "https://127.0.0.1/a", keys } }]) {
      const response = await testPush(new Request("https://example.com/api/push/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      assert.equal(response.status, 400);
    }
    const malformed = await testPush(new Request("https://example.com/api/push/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
    assert.equal(malformed.status, 400);
    // Nessun database o collector deve essere raggiunto dai client in produzione.
    for (const env of ["production", "test"]) {
      Object.assign(process.env, { NODE_ENV: env });
      const result = await collectNow();
      assert.equal(result.ok, false);
      assert.match(result.message, /solo in sviluppo/);
    }
  } finally {
    for (const [key, value] of Object.entries({ NODE_ENV: old.node, VAPID_PUBLIC_KEY: old.public, VAPID_PRIVATE_KEY: old.private })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  console.log("✓ Sicurezza: destinazioni push, input ostili, invio e raccolta protetti");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
