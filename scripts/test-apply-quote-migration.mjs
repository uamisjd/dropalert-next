import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { applyQuoteMigration, migrationManifest, checkProductionConfirmation, productionConfirmation, approvedSnapshot } from './apply-quote-migration-core.mjs';
checkProductionConfirmation(productionConfirmation, approvedSnapshot);
assert.throws(() => checkProductionConfirmation('', approvedSnapshot));
assert.throws(() => checkProductionConfirmation(productionConfirmation, '2026-09-12'));
const url = new URL(process.env.DATABASE_URL ?? 'postgres://dropalert@127.0.0.1:5433/dropalert');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Solo DB di test locale');
const name = `apply_migration_${randomBytes(6).toString('hex')}`;
const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
let client, created = false;
try {
  await admin.unsafe(`create database "${name}"`); created = true;
  url.pathname = '/' + name;
  client = postgres(url.toString(), { max: 1, onnotice: () => {}, connection: { statement_timeout: 30000, lock_timeout: 2000 } });
  const entries = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')).entries;
  const manifest = migrationManifest();
  await client`create schema drizzle`;
  await client`create table drizzle.__drizzle_migrations(id serial primary key, hash text not null, created_at bigint)`;
  for (let i = 0; i < 10; i++) {
    for (const statement of readFileSync(new URL(`../drizzle/${entries[i].tag}.sql`, import.meta.url), 'utf8').split('--> statement-breakpoint')) if (statement.trim()) await client.unsafe(statement);
    await client`insert into drizzle.__drizzle_migrations(hash, created_at) values (${manifest[i].hash}, ${manifest[i].when})`;
  }
  const [league] = await client`insert into leagues(key,name) values('test','Test') returning id`;
  const [home] = await client`insert into teams(key,name) values('home','Home') returning id`;
  const [away] = await client`insert into teams(key,name) values('away','Away') returning id`;
  const [match] = await client`insert into matches(key,league_id,home_team_id,away_team_id,kickoff_at)
    values('fixture',${league.id},${home.id},${away.id},now()) returning id`;
  const [book] = await client`insert into bookmakers(key,name) values('fixture','Fixture') returning id`;
  await client`insert into odds_snapshots(match_id,bookmaker_id,market,selection,price,implied_prob,collected_at,source)
    values(${match.id},${book.id},'1x2','home',2.5,0.4,now(),'historical-fixture')`;
  const before = await client`select to_jsonb(s) as row from odds_snapshots s`;
  await client`update drizzle.__drizzle_migrations set hash = 'unexpected' where created_at = ${manifest[0].when}`;
  await assert.rejects(applyQuoteMigration(client), /Storia migrazioni/);
  await client`update drizzle.__drizzle_migrations set hash = ${manifest[0].hash} where created_at = ${manifest[0].when}`;
  // Un errore al journal dopo il DDL deve annullare anche enum e colonna.
  await client.unsafe(`create function reject_journal() returns trigger language plpgsql as $$ begin raise exception 'test journal failure'; end; $$`);
  await client`create trigger reject_journal before insert on drizzle.__drizzle_migrations for each row execute function reject_journal()`;
  await assert.rejects(applyQuoteMigration(client));
  const [rolled] = await client`select to_regtype('public.quote_timestamp_origin') as typ`;
  assert.equal(rolled.typ, null);
  assert.equal((await client`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n, 10);
  await client`drop trigger reject_journal on drizzle.__drizzle_migrations`;
  const applied = await applyQuoteMigration(client);
  assert.deepEqual(applied, { status: 'applied', rows: 1 });
  assert.deepEqual(await client`select to_jsonb(s) - 'timestamp_origin' as row from odds_snapshots s`, before);
  assert.equal((await client`select timestamp_origin from odds_snapshots`)[0].timestamp_origin, 'unknown');
  assert.deepEqual(await applyQuoteMigration(client), { status: 'already-applied', rows: null });
  assert.equal((await client`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n, 11);
  // Il migratore Drizzle ordinario riconosce il journal scritto dal percorso mirato.
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
  assert.equal((await client`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n, 11);
  await client`alter table odds_snapshots alter column timestamp_origin drop not null`;
  await assert.rejects(applyQuoteMigration(client), /schema incoerente/);
  console.log('✓ Applicazione locale: conferme, baseline reale 0000–0009, hash, rollback errore journal, commit, dati unknown invariati, idempotenza, compatibilità Drizzle e drift schema');
} finally {
  if (client) await client.end();
  if (created) await admin.unsafe(`drop database "${name}"`);
  await admin.end();
}
