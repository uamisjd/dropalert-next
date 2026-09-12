import assert from 'node:assert/strict';
import { migrationTestUrl, checkedMigration, migrationSql } from './migration-test-guard.mjs';
const url = (id, extra = '') => `postgresql://user:secret@ep-${id}.eu-central-1.aws.neon.tech/db?sslmode=require${extra}`;
assert.equal(migrationTestUrl(url('test'), url('prod')), url('test'));
for (const bad of ['', 'bad', url('prod'), url('prod-pooler'), url('test', '&host=evil'), url('test').replace('require', 'disable'), url('test').replace('neon.tech', 'example.com'), url('test') + '#fragment']) {
  assert.throws(() => migrationTestUrl(bad, url('prod')), e => !e.message.includes('secret') && !e.message.includes('postgresql://'));
}
assert.throws(() => migrationTestUrl(url('test'), ''));
assert.throws(() => migrationTestUrl(url('prod-pooler'), url('prod').replace('/db?', '/other?')));
assert.equal(checkedMigration(migrationSql).length, 2);
assert.throws(() => checkedMigration(migrationSql + '\nDROP TABLE matches;'));
console.log('✓ 13 controlli prova migrazione: isolamento endpoint, TLS, input e SQL limitato');
