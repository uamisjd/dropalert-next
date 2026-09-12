import postgres from 'postgres';
import { appendFileSync } from 'node:fs';
import { migrationTestUrl } from './migration-test-guard.mjs';
import { checkProductionConfirmation, applyQuoteMigration } from './apply-quote-migration-core.mjs';
let client;
function report(title, message, level) {
  console.log(`${title}: ${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${title}\n\n${message}\n`);
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::${level} title=${title}::${message}`);
}
try {
  checkProductionConfirmation(process.env.MIGRATION_CONFIRMATION, process.env.MIGRATION_SNAPSHOT);
  // Valida entrambe le URL/TLS e blocca il caso copia e produzione sullo stesso endpoint.
  migrationTestUrl(process.env.MIGRATION_TEST_DATABASE_URL, process.env.PRODUCTION_DATABASE_URL);
  client = postgres(process.env.PRODUCTION_DATABASE_URL, { max: 1, connect_timeout: 15, idle_timeout: 5,
    connection: { statement_timeout: 30000, lock_timeout: 2000, application_name: 'dropalert-migration-0010' }, onnotice: () => {} });
  const result = await applyQuoteMigration(client);
  report('Migrazione produzione 0010', result.status === 'applied'
    ? `COMMIT confermato; snapshot verificati: ${result.rows}; dati preesistenti invariati, origine unknown; journal Drizzle aggiornato. Nessun deploy, raccolta o invio avviato da questo workflow.`
    : 'GIÀ APPLICATA: schema e journal verificati; nessuna nuova migrazione eseguita.', 'notice');
} catch {
  process.exitCode = 1;
  report('Migrazione produzione 0010', 'ESITO NON CONFERMATO. Non eseguire deploy o ripristino automatico. Verificare conferma, connessioni e journal. DDL e journal sono transazionali; un errore di connessione non prova un rollback. La riesecuzione verifica la migrazione già applicata senza riapplicarla.', 'error');
} finally { if (client) await client.end({ timeout: 5 }); }
