import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const events = new Map();
const displayed = [];
const opened = [];
const self = {
  location: { origin: "https://example.com" },
  addEventListener: (name, fn) => events.set(name, fn),
  registration: { showNotification: async (title, options) => displayed.push({ title, options }) },
  clients: { matchAll: async () => [], openWindow: async (url) => opened.push(url) },
};
vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL });
async function fire(name, data) {
  let done;
  events.get(name)({ ...data, waitUntil: (promise) => { done = promise; } });
  await done;
}
await fire("push", { data: { json: () => null } });
assert.equal(displayed.at(-1).title, "DropAlert");
assert.equal(displayed.at(-1).options.data.url, "https://example.com/preferite");
for (const url of ["https://evil.example/", "javascript:alert(1)", "https://user:pass@example.com/private"]) {
  await fire("notificationclick", { notification: { close() {}, data: { url } } });
  assert.equal(opened.at(-1), "https://example.com/preferite");
}
const proofUrl = `https://example.com/preferite#push-verify=${"a".repeat(64)}.${"b".repeat(64)}`;
await fire("push", { data: { json: () => ({ title: "Conferma", url: proofUrl }) } });
await fire("notificationclick", { notification: { close() {}, data: displayed.at(-1).options.data } });
assert.equal(opened.at(-1), proofUrl);
console.log("✓ Service worker: payload null, navigazione same-origin, frammento di verifica conservato");
