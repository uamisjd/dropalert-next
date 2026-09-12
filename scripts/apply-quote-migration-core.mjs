import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkedMigration } from './migration-test-guard.mjs';

export const productionConfirmation = 'APPLICA-0010-PRODUCTION';
export const approvedSnapshot = '2026-09-12T21:57:06Z';
export function checkProductionConfirmation(confirmation, snapshot) {
  if (confirmation !== productionConfirmation || snapshot !== approvedSnapshot) throw new Error('Conferma produzione o snapshot non corrispondente.');
}
export function migrationManifest() {
  const folder = new URL('../drizzle/', import.meta.url);
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', folder), 'utf8'));
  if (journal.entries.length !== 11 || journal.entries[10].tag !== '0010_quote_timestamp_origin') throw new Error('Registro migrazioni cambiato: serve revisione.');
  return journal.entries.map((entry, i) => {
    if (entry.idx !== i || !Number.isSafeInteger(entry.when)) throw new Error('Registro migrazioni non valido.');
    const text = readFileSync(new URL(`${entry.tag}.sql`, folder), 'utf8');
    return { hash: createHash('sha256').update(text).digest('hex'), when: entry.when,
      statements: i === 10 ? checkedMigration(text) : [] };
  });
}
async function schemaState(tx) {
  const [col] = await tx`select is_nullable, column_default, udt_schema, udt_name
    from information_schema.columns where table_schema = 'public' and table_name = 'odds_snapshots' and column_name = 'timestamp_origin'`;
  const labels = await tx`select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'quote_timestamp_origin'
    order by e.enumsortorder`;
  const [type] = await tx`select to_regtype('public.quote_timestamp_origin') is not null as present`;
  if (!col && !type.present) return 'absent';
  const expected = ['unknown', 'provider_market', 'provider_bookmaker', 'collection_fallback'];
  return col?.is_nullable === 'NO' && col.udt_schema === 'public' && col.udt_name === 'quote_timestamp_origin' &&
    col.column_default === "'unknown'::quote_timestamp_origin" &&
    JSON.stringify(labels.map(r => r.enumlabel)) === JSON.stringify(expected) ? 'valid' : 'inconsistent';
}
async function snapshotFingerprint(tx) {
  const [count] = await tx`select count(*)::int as n from public.odds_snapshots`;
  if (count.n > 100000) throw new Error('Archivio oltre il limite revisionato.');
  const [row] = await tx`select count(*)::int as n,
    md5(coalesce(string_agg(md5((to_jsonb(s) - 'timestamp_origin')::text), '' order by id), '')) as digest
    from public.odds_snapshots s`;
  return row;
}
/** Solo la migrazione revisionata 0010; DDL e journal nella stessa transazione.
 * Nessuna lettura di credenziali qui: il wrapper è l'unico punto di autorizzazione.
 */
export async function applyQuoteMigration(client) {
  const manifest = migrationManifest(), target = manifest[10];
  const result = await client.begin(async tx => {
    const [lock] = await tx`select pg_try_advisory_xact_lock(734210, 10) as acquired`;
    if (!lock.acquired) throw new Error('Migrazione concorrente.');
    // Non creare/riparare un journal mancante: senza storia verificata si blocca.
    await tx`lock table drizzle.__drizzle_migrations in share row exclusive mode`;
    await tx`lock table public.odds_snapshots in access exclusive mode`;
    const rows = await tx`select hash, created_at from drizzle.__drizzle_migrations order by created_at, id`;
    if (rows.length !== 10 && rows.length !== 11) throw new Error('Storia migrazioni inattesa.');
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].hash !== manifest[i].hash || Number(rows[i].created_at) !== manifest[i].when) throw new Error('Storia migrazioni non corrispondente.');
    }
    const state = await schemaState(tx);
    if (rows.length === 11) {
      if (state !== 'valid') throw new Error('Migrazione registrata ma schema incoerente.');
      return { status: 'already-applied', rows: null };
    }
    if (state !== 'absent') throw new Error('Schema modificato senza journal: nessuna riparazione automatica.');
    const before = await snapshotFingerprint(tx);
    for (const statement of target.statements) await tx.unsafe(statement);
    const after = await snapshotFingerprint(tx);
    const [legacy] = await tx`select count(*)::int as n from public.odds_snapshots where timestamp_origin <> 'unknown' or timestamp_origin is null`;
    if (before.n !== after.n || before.digest !== after.digest || legacy.n !== 0 || await schemaState(tx) !== 'valid') throw new Error('Verifica post-DDL non superata.');
    await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${target.hash}, ${target.when})`;
    return { status: 'applied', rows: before.n };
  });
  // Conferma dopo il commit. Una perdita di connessione NON è chiamata rollback.
  const [entry] = await client`select count(*)::int as n from drizzle.__drizzle_migrations where hash = ${target.hash} and created_at = ${target.when}`;
  if (entry.n !== 1 || await schemaState(client) !== 'valid') throw new Error('Commit non confermato.');
  return result;
}
