import assert from 'node:assert/strict';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';
import { rehearseQuoteMigration } from './quote-migration-rehearsal.mjs';
const url = new URL(process.env.DATABASE_URL ?? 'postgres://dropalert@127.0.0.1:5433/dropalert');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Solo DB locale di test');
const name = `migration_rehearsal_${randomBytes(6).toString('hex')}`;
const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
let client, created = false;
try {
  await admin.unsafe(`create database "${name}"`); created = true;
  url.pathname = '/' + name;
  client = postgres(url.toString(), { max: 1, connection: { statement_timeout: 30000, lock_timeout: 2000 } });
  await client`create table odds_snapshots (id int primary key, price numeric, payload jsonb)`;
  await client`insert into odds_snapshots values (1, 2.4, '{"source":"historical"}'), (2, 1.9, '{"unknown":true}')`;
  const before = await client`select * from odds_snapshots order by id`;
  assert.equal((await rehearseQuoteMigration(client)).rows, 2);
  assert.deepEqual(await client`select * from odds_snapshots order by id`, before);
  // Una seconda prova deve funzionare: né enum né colonna sono rimasti.
  assert.equal((await rehearseQuoteMigration(client)).rows, 2);
  await client`alter table odds_snapshots add column timestamp_origin text`;
  await assert.rejects(rehearseQuoteMigration(client), /Schema già modificato/);
  console.log('✓ 4 controlli PostgreSQL: DDL reale annullato, contenuto invariato, ripetibilità e schema incompatibile');
} finally {
  if (client) await client.end();
  if (created) await admin.unsafe(`drop database "${name}"`);
  await admin.end();
}
