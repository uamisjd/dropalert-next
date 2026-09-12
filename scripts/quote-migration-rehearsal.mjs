import { readFileSync } from 'node:fs';
import { checkedMigration } from './migration-test-guard.mjs';

const ROLLBACK = new Error('EXPECTED_REHEARSAL_ROLLBACK');
async function fingerprint(tx) {
  const [count] = await tx`select count(*)::int as n from public.odds_snapshots`;
  if (count.n > 100000) throw new Error('Campione oltre il limite della prova.');
  const [row] = await tx`select count(*)::int as n,
    md5(coalesce(string_agg(md5((to_jsonb(s) - 'timestamp_origin')::text), '' order by s.id), '')) as digest
    from public.odds_snapshots s`;
  return row;
}
async function schemaAbsent(tx) {
  const [row] = await tx`select
    exists(select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'odds_snapshots' and column_name = 'timestamp_origin') as col,
    to_regtype('public.quote_timestamp_origin') is not null as typ`;
  return !row.col && !row.typ;
}

export async function rehearseQuoteMigration(client) {
  let report;
  const statements = checkedMigration(readFileSync(new URL('../drizzle/0010_quote_timestamp_origin.sql', import.meta.url), 'utf8'));
  try {
    await client.begin('isolation level repeatable read', async tx => {
      if (!await schemaAbsent(tx)) throw new Error('Schema già modificato: questa prova richiede la copia precedente alla migrazione.');
      // Congela scritture concorrenti sul test, con lock_timeout breve.
      await tx`lock table public.odds_snapshots in access exclusive mode`;
      const before = await fingerprint(tx);
      for (const statement of statements) await tx.unsafe(statement);
      const after = await fingerprint(tx);
      const [legacy] = await tx`select count(*)::int as n from public.odds_snapshots where timestamp_origin <> 'unknown' or timestamp_origin is null`;
      const [column] = await tx`select column_default, is_nullable, udt_name from information_schema.columns
        where table_schema = 'public' and table_name = 'odds_snapshots' and column_name = 'timestamp_origin'`;
      if (before.n !== after.n || before.digest !== after.digest || legacy.n !== 0 ||
          column?.is_nullable !== 'NO' || column.udt_name !== 'quote_timestamp_origin' ||
          !column.column_default?.startsWith("'unknown'::")) throw new Error('Verifica migrazione non superata.');
      report = { rows: before.n };
      throw ROLLBACK; // Non esiste un percorso COMMIT della migrazione.
    });
  } catch (error) { if (error !== ROLLBACK) throw error; }
  if (!report || !await schemaAbsent(client)) throw new Error('Rollback non confermato.');
  return report;
}
