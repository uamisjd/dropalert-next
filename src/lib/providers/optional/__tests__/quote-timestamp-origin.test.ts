import assert from "node:assert/strict";
import { quoteTimestamp, parseOddsResponse, type TheOddsApiEvent } from "../the-odds-api-odds";
import { toProviderSnapshotRecords } from "../../ingest-snapshots";
const fallback = new Date("2026-09-12T20:00:00Z");
const market = "2026-09-12T19:59:00Z", book = "2026-09-12T19:58:00Z";
assert.deepEqual(quoteTimestamp(market, book, fallback), { at: new Date(market), origin: "provider_market" });
assert.equal(quoteTimestamp(undefined, book, fallback).origin, "provider_bookmaker");
assert.equal(quoteTimestamp(undefined, undefined, fallback).origin, "collection_fallback");
for (const bad of ["", "invalid", "2026", "2026-02-30T20:00:00Z", "2026-09-12T24:00:00Z", "2026-09-12T20:00:00"]) {
  assert.equal(quoteTimestamp(bad, book, fallback).origin, "collection_fallback", bad);
}
assert.equal(quoteTimestamp("2026-09-12T21:59:00+02:00", book, fallback).at.toISOString(), market.replace("00Z", "00.000Z"));
// Timestamp futuro: non riscritto a "ora"; lo scanner respinge il futuro.
assert.equal(quoteTimestamp("2026-09-13T20:00:00Z", book, fallback).origin, "provider_market");
const event: TheOddsApiEvent = { id: "test", sport_key: "soccer_italy_serie_a", commence_time: "2026-09-13T20:00:00Z", home_team: "Home", away_team: "Away", bookmakers: [{ key: "pinnacle", last_update: book, markets: [{ key: "h2h", last_update: market, outcomes: [{ name: "Home", price: 2 }, { name: "Draw", price: 3.5 }, { name: "Away", price: 4 }] }] }] };
const parsed = parseOddsResponse(event, { fixtureKey: "test", observedAt: fallback });
assert.equal(parsed.quotes.length, 3);
assert.ok(parsed.quotes.every(q => q.timestampOrigin === "provider_market" && q.observedAt.toISOString() === new Date(market).toISOString()));
assert.ok(toProviderSnapshotRecords(1, parsed.quotes, null, "the-odds-api").every(r => r.timestampOrigin === "provider_market"));
assert.equal(toProviderSnapshotRecords(1, [{ ...parsed.quotes[0], timestampOrigin: undefined }], null, "the-odds-api")[0].timestampOrigin, "unknown");
assert.equal(toProviderSnapshotRecords(1, [{ ...parsed.quotes[0], timestampOrigin: "collection_fallback" }], null, "the-odds-api")[0].timestampOrigin, "collection_fallback");
console.log("✓ 16 controlli origine timestamp: precedenza, fallback, date invalide, offset, futuro e DTO/persistenza");
