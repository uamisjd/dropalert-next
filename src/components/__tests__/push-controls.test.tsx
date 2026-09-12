import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PUSH_OWNER_KEY } from "@/lib/push/client";
import { PushControls } from "../PushControls";

async function main() {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.com" });
  let unsubscribed = 0;
  let deleteStatus = 503;
  const sub = {
    endpoint: "https://fcm.googleapis.com/token",
    toJSON: () => ({ endpoint: "https://fcm.googleapis.com/token", keys: { p256dh: "test", auth: "test" } }),
    unsubscribe: async () => { unsubscribed++; return true; },
  };
  const reg = { pushManager: { getSubscription: async () => sub } };
  Object.defineProperty(dom.window.navigator, "serviceWorker", { value: {
    getRegistration: async () => reg,
    register: async () => reg,
    ready: Promise.resolve(reg),
  } });
  Object.assign(dom.window, { PushManager: class {}, Notification: { permission: "granted", requestPermission: async () => "granted" } });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Notification: dom.window.Notification, IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.fetch = async (_url, init) => init?.method === "DELETE"
    ? Response.json({ ok: deleteStatus === 200 }, { status: deleteStatus })
    : init?.method === "POST"
      ? Response.json({ ok: false, reason: "limite temporaneo raggiunto: riprova tra 60 secondi" }, { status: 429, headers: { "Retry-After": "60" } })
      : Response.json({ configured: true, publicKey: "test-key" });
  dom.window.localStorage.setItem(PUSH_OWNER_KEY, JSON.stringify({ endpoint: sub.endpoint, token: "a".repeat(64) }));
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => { root.render(<PushControls />); });
  const prove = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Test notifica")!;
  await act(async () => { prove().click(); });
  assert.match(container.textContent!, /riprova tra 60 secondi/);
  assert.equal(container.querySelector('[role="status"]')?.getAttribute("aria-live"), "polite");
  const disable = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Disattiva notifiche")!;
  await act(async () => { disable().click(); });
  assert.match(container.textContent!, /Disattivazione non completata/);
  assert.equal(unsubscribed, 0, "conserva endpoint e possibilità di riprovare dopo un errore server");
  deleteStatus = 200;
  await act(async () => { disable().click(); });
  assert.match(container.textContent!, /Notifiche disattivate su questo browser/);
  assert.equal(unsubscribed, 1);
  const enable = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Attiva notifiche")!;
  await act(async () => { enable().click(); });
  assert.match(container.textContent!, /Attivazione non completata: limite temporaneo raggiunto: riprova tra 60 secondi/);
  assert.ok(enable(), "un 429 non viene dichiarato come attivazione riuscita");
  await act(async () => root.unmount());
  dom.window.close();
  console.log("✓ PushControls: limiti 429 visibili, cancellazione indipendente e ritentativo riuscito");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
