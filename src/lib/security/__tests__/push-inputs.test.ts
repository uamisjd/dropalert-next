import assert from "node:assert/strict";
import { readBoundedJson } from "../json-body";
import { parsePushWatchlist } from "../../push/validation";
import { parseSubscription } from "../../push/pure";

const valid = { matchKey: "alfa-beta", matchId: 1, homeTeam: "Alfa", awayTeam: "Beta", thresholdKind: "indice", thresholdValue: 60 };
let checks = 0;
function reject(value: unknown) { assert.equal(parsePushWatchlist(value), null); checks++; }

async function main() {
  assert.deepEqual(parsePushWatchlist([valid]), [valid]);
  assert.deepEqual(parsePushWatchlist(undefined), []);
  assert.deepEqual(parsePushWatchlist([]), []);
  assert.ok(parsePushWatchlist([{ ...valid, thresholdKind: null, thresholdValue: null }]));
  const hundred = Array.from({ length: 100 }, (_, i) => ({ ...valid, matchKey: `match-${i}`, matchId: i + 1 }));
  assert.equal(parsePushWatchlist(hundred)?.length, 100);
  reject([...hundred, { ...valid, matchKey: "extra", matchId: 101 }]);
  reject([valid, valid]);
  reject([valid, { ...valid, matchId: 2 }]);
  reject([valid, { ...valid, matchKey: "other" }]);
  for (const matchId of [0, -1, 1.5, Infinity, 2147483648, "1"]) reject([{ ...valid, matchId }]);
  for (const thresholdValue of [-1, 101, NaN, Infinity, "60", null]) reject([{ ...valid, thresholdValue }]);
  for (const value of [null, {}, "list", [null], [{}]]) reject(value);
  reject([{ ...valid, homeTeam: "x".repeat(121) }]);
  reject([{ ...valid, matchKey: "x".repeat(257) }]);
  reject([{ ...valid, thresholdKind: null }]);
  reject([{ ...valid, thresholdKind: "unknown" }]);
  const payload = { subscription: { endpoint: "https://fcm.googleapis.com/token", keys: { p256dh: "B" + "a".repeat(86), auth: "a".repeat(22) } }, watchlist: [valid, {}] };
  assert.equal(parseSubscription(payload, new Date()), null, "nessun salvataggio parziale della lista");

  async function read(body: string, limit = 16, headers: Record<string, string> = {}) {
    return readBoundedJson(new Request("https://example.com", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }), limit);
  }
  async function status(result: Awaited<ReturnType<typeof read>>, expected: number) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, expected);
    checks++;
  }
  const success = await read('{"ok":true}');
  assert.ok(success.ok);
  assert.deepEqual(success.data, { ok: true });
  await status(await read("{broken"), 400);
  await status(await read("{}", 16, { "content-type": "text/plain" }), 415);
  await status(await read("{}", 16, { "content-encoding": "gzip" }), 415);
  await status(await read("{}", 16, { "content-length": "17" }), 413);
  await status(await read('"' + "x".repeat(20) + '"', 16, { "content-length": "1" }), 413);
  await status(await read('"😀😀😀😀"', 16), 413); // byte UTF-8, non lunghezza JS
  assert.ok((await read('"' + "x".repeat(14) + '"')).ok, "limite esatto accettato");
  assert.ok((await read("{}", 16, { "content-type": "application/json; charset=utf-8" })).ok);

  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(8).fill(32)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://example.com", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  await status(await readBoundedJson(request, 16), 413);
  assert.equal(cancelled, true, "stream interrotto al superamento della soglia");
  assert.ok(pulls <= 4, "non legge indefinitamente il corpo");
  console.log(`✓ ${checks} casi rifiutati e controlli positivi: limiti push e JSON in streaming`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
