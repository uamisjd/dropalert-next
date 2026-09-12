import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PushControls } from "../PushControls";
import { PUSH_OWNER_KEY, readPushToken, verificationFromHash } from "@/lib/push/client";

async function main() {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.com/preferite" });
  const endpoint = "https://fcm.googleapis.com/verified-browser";
  const token = "a".repeat(64);
  const sub = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "test", auth: "test" } }) };
  const reg = { pushManager: { getSubscription: async () => sub } };
  Object.defineProperty(dom.window.navigator, "serviceWorker", { value: {
    getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg),
  } });
  Object.assign(dom.window, { PushManager: class {}, Notification: { permission: "granted", requestPermission: async () => "granted" } });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Notification: dom.window.Notification, IS_REACT_ACT_ENVIRONMENT: true });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/confirm")) return Response.json({ ok: true, endpoint, token });
    if (init?.method === "POST") {
      return new Headers(init.headers).get("x-push-token") === token
        ? Response.json({ ok: true }) : Response.json({ ok: false, pending: true }, { status: 202 });
    }
    return Response.json({ configured: true, publicKey: "test-key" });
  };
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const button = (text: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.startsWith(text))!;
  await act(async () => root.render(<PushControls />));
  assert.ok(button("Attiva notifiche"), "una vecchia subscription browser senza capacità non è verificata");
  await act(async () => button("Attiva notifiche").click());
  assert.match(container.textContent!, /non è ancora attiva/);
  assert.equal(dom.window.localStorage.getItem(PUSH_OWNER_KEY), null);
  assert.equal(button("Test notifica").disabled, true);
  const id = "b".repeat(64), code = "c".repeat(64);
  await act(async () => {
    dom.window.history.replaceState(null, "", `#push-verify=${id}.${code}`);
    dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
  });
  assert.equal(dom.window.location.hash, "", "prova rimossa dalla barra e dalla cronologia corrente");
  assert.equal(readPushToken(endpoint), token);
  assert.equal(readPushToken(endpoint + "other"), null);
  assert.match(container.textContent!, /Notifiche verificate e attive/);
  assert.equal(calls.filter((c) => c.url.endsWith("/confirm")).length, 1);
  await act(async () => dom.window.dispatchEvent(new dom.window.Event("dropalert:watchlist")));
  assert.ok(button("Aggiorna lista (modificata)"));
  await act(async () => button("Aggiorna lista").click());
  assert.equal(new Headers(calls.at(-1)?.init?.headers).get("x-push-token"), token);
  assert.ok(button("Aggiorna lista"));
  await act(async () => button("Verifica di nuovo").click());
  assert.equal(new Headers(calls.at(-1)?.init?.headers).get("x-push-token"), null);
  assert.equal(readPushToken(endpoint), token, "la chiave corrente si conserva fino alla nuova conferma");
  for (const hash of ["", "#push-verify=abc.def", `#push-verify=${id}.${code}&extra=1`]) assert.equal(verificationFromHash(hash), null);
  await act(async () => root.unmount());
  dom.window.close();
  console.log("✓ Browser push: attesa → prova monouso → gestione autenticata → aggiornamento lista");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
