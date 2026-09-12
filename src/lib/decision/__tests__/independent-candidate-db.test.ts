import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseOddsResponse } from "@/lib/providers/optional/the-odds-api-odds";
import { writeProviderSnapshots } from "@/lib/providers/ingest-snapshots";
import { sql } from "@/db/client";
import { readIndependentCandidate } from "@/lib/repo/independent-candidates";
const url = new URL(process.env.DATABASE_URL ?? "postgres://dropalert@127.0.0.1:5433/dropalert");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Fixture solo su DB locale");
const key = `candidate-test-${randomUUID()}`;
const now = new Date(); const earlier = new Date(now.getTime() - 10 * 60_000);
let matchId: number | undefined, leagueId: number | undefined;
const teamIds: number[] = [], bookIds: number[] = [];
async function main() {
  try {
    const [league] = await sql`insert into leagues (key, name) values (${key}, 'Test') returning id`; leagueId = league.id;
    for (const side of ["home", "away"]) { const [t] = await sql`insert into teams (key, name) values (${key + side}, ${side}) returning id`; teamIds.push(t.id); }
    const [match] = await sql`insert into matches (key, league_id, home_team_id, away_team_id, kickoff_at)
      values (${key}, ${leagueId!}, ${teamIds[0]}, ${teamIds[1]}, ${new Date(now.getTime() + 3600_000).toISOString()}) returning id`; matchId = match.id;
    for (const book of [key, "pinnacle"]) {
      const created = await sql`insert into bookmakers (key, name) values (${book}, ${book}) on conflict (key) do nothing returning id`;
      bookIds.push(...created.map(r => r.id));
      const [b] = await sql`select id from bookmakers where key = ${book}`;
      for (const [at, home] of [[earlier, book === key ? 2.5 : 2.1], [now, book === key ? 2.4 : 2]] as const) {
        for (const [selection, price] of [["home", home], ["draw", 3.5], ["away", 4]] as const) {
          await sql`insert into odds_snapshots (match_id, bookmaker_id, market, selection, price, implied_prob, collected_at, source)
            values (${matchId!}, ${b.id}, '1x2', ${selection}, ${price}, ${1 / price}, ${at.toISOString()}, 'the-odds-api')`;
        }
      }
    }
    await sql`insert into drop_signals (match_id, market, selection, opening_price, current_price, opening_prob, current_prob,
      delta_pp, magnitude_class, books_total, books_confirming, coordination_score, first_move_at, last_move_at,
      confidence_score, confidence_band, explanation, engine_version, status)
      values (${matchId!}, '1x2', 'home', 2.5, 2.4, 0.4, 0.416667, 1.67, 'noise', 1, 1, 1, ${earlier.toISOString()}, ${now.toISOString()}, 60, 'medium', '{}', 'test', 'active')`;
    const params = { matchId: matchId!, bookmaker: key, selection: "home" as const };
    const before = await sql`select * from odds_snapshots where match_id = ${matchId!} order by id`;
    const observed = await readIndependentCandidate(params, now);
    assert.equal(observed.snapshotsRead, 12);
    assert.equal(observed.result.decision.state, "NON_AZIONABILE", "senza conferma reale, nessun BET");
    const confirmed = await readIndependentCandidate({ ...params, execution: { matchId: matchId!, bookmaker: key, market: "1x2", selection: "home", price: 2.4, checkedAt: now } }, now);
    assert.equal(confirmed.result.decision.state, "NON_AZIONABILE");
    assert.ok(confirmed.result.blockers.some(b => b.includes("timestamp provider")));
    assert.deepEqual(await sql`select * from odds_snapshots where match_id = ${matchId!} order by id`, before, "lettura senza scritture");
    // Lo storico senza provenienza non viene promosso da un conflitto di dedupe.
    async function persist(at: Date, source = "the-odds-api") {
      const parsed = parseOddsResponse({ id: "test", sport_key: "soccer_italy_serie_a", commence_time: new Date(now.getTime() + 3600_000).toISOString(), home_team: "Home", away_team: "Away",
        bookmakers: [key, "pinnacle"].map(book => ({ key: book, title: book, last_update: at.toISOString(), markets: [{ key: "h2h", outcomes: [
          { name: "Home", price: book === key ? (at === now ? 2.4 : 2.5) : (at === now ? 2 : 2.1) },
          { name: "Draw", price: 3.5 }, { name: "Away", price: 4 },
        ] }] })),
      }, { fixtureKey: key, observedAt: now });
      return writeProviderSnapshots(matchId!, parsed.quotes, null, source);
    }
    assert.equal((await persist(now)).written, 0);
    assert.ok((await readIndependentCandidate(params, now)).result.blockers.some(b => b.includes("timestamp provider")));
    await sql`delete from odds_snapshots where match_id = ${matchId!}`;
    await persist(earlier); await persist(now);
    const verified = await readIndependentCandidate({ ...params, execution: { matchId: matchId!, bookmaker: key, market: "1x2", selection: "home", price: 2.4, checkedAt: now } }, now);
    assert.equal(verified.result.decision.state, "CANDIDATA", "parser → persistenza → scanner con timestamp provider e conferma esplicita");
    assert.equal((await readIndependentCandidate(params, now)).result.decision.state, "NON_AZIONABILE", "origine nota non inventa accesso all’offerta");
    await sql`update odds_snapshots set timestamp_origin = 'collection_fallback' where match_id = ${matchId!}`;
    assert.ok((await readIndependentCandidate(params, now)).result.blockers.some(b => b.includes("timestamp provider")));
    await sql`update odds_snapshots set source = 'the-odds-api-wire-smoke' where match_id = ${matchId!}`;
    assert.equal((await readIndependentCandidate(params, now)).snapshotsRead, 0, "smoke escluso");
    await assert.rejects(readIndependentCandidate({ ...params, matchId: -1 }, now));
    console.log("✓ 12 controlli DB scanner: parser/persistenza, provenienza, legacy/dedupe, fallback, accessibilità, immutabilità e smoke");
  } finally {
    if (matchId) await sql`delete from matches where id = ${matchId}`;
    if (leagueId) await sql`delete from leagues where id = ${leagueId}`;
    for (const id of teamIds) await sql`delete from teams where id = ${id}`;
    for (const id of bookIds) await sql`delete from bookmakers where id = ${id}`;
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await sql.end(); });
