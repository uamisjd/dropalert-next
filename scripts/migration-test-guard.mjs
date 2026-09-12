/** Restituisce soltanto la URL di test; nessuna connessione alla produzione. */
export function migrationTestUrl(testValue, productionValue) {
  function parse(value) {
    if (!value) throw new Error('Configurazione database assente.');
    let u;
    try { u = new URL(value); } catch { throw new Error('Configurazione database non valida.'); }
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.username || !u.password ||
        !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(u.hostname) ||
        (u.port && u.port !== '5432') || u.hash || u.pathname === '/' ||
        !['require', 'verify-full'].includes(u.searchParams.get('sslmode')) ||
        [...u.searchParams.keys()].some(k => !['sslmode', 'channel_binding'].includes(k))) {
      throw new Error('Serve una connessione Neon PostgreSQL con TLS, senza parametri alternativi.');
    }
    return u;
  }
  const test = parse(testValue), production = parse(productionValue);
  const endpoint = u => u.hostname.split('.')[0].replace(/-pooler$/, '');
  // Anche porta/utente/password/database diversi NON rendono sicuro lo stesso endpoint.
  if (endpoint(test) === endpoint(production)) throw new Error('Endpoint di prova uguale alla produzione: operazione bloccata.');
  return test.toString();
}

export const migrationSql = `CREATE TYPE "public"."quote_timestamp_origin" AS ENUM('unknown', 'provider_market', 'provider_bookmaker', 'collection_fallback');--> statement-breakpoint
ALTER TABLE "odds_snapshots" ADD COLUMN "timestamp_origin" "quote_timestamp_origin" DEFAULT 'unknown' NOT NULL;`;
export function checkedMigration(text) {
  if (text.trim() !== migrationSql) throw new Error('La migrazione è cambiata: occorre revisionare la prova.');
  return text.trim().split('--> statement-breakpoint');
}
