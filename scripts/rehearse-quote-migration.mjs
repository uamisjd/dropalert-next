import postgres from 'postgres';
import { appendFileSync } from 'node:fs';
import { migrationTestUrl } from './migration-test-guard.mjs';


import { rehearseQuoteMigration } from './quote-migration-rehearsal.mjs';
let client;
try {
  // La URL di produzione è soltanto confrontata in memoria. Nessun client la usa.
  const url = migrationTestUrl(process.env.MIGRATION_TEST_DATABASE_URL, process.env.PRODUCTION_DATABASE_URL);
  client = postgres(url, { max: 1, connect_timeout: 15, idle_timeout: 5,
    connection: { statement_timeout: 30000, lock_timeout: 2000, application_name: 'dropalert-migration-rehearsal' },
    onnotice: () => {} });
  const report = await rehearseQuoteMigration(client);
  const summary = `## Prova migrazione 0010 — ROLLBACK confermato\n\n` +
    `- Connessione di test distinta dall’endpoint configurato per produzione.\n` +
    `- Snapshot verificati: **${report.rows}**. Contenuto preesistente invariato durante la prova.\n` +
    `- Tutte le righe storiche restano unknown; default e NOT NULL verificati.\n` +
    `- DDL annullato: colonna ed enum assenti dopo il rollback.\n` +
    `- Nessuna migrazione persistente, app, raccolta o notifica eseguita.\n` +
    `- Non è un backup né un’autorizzazione a migrare produzione. Endpoint diversi non provano da soli l’identità del branch Neon.\n`;
  console.log(summary);
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::notice title=Prova migrazione 0010::ROLLBACK confermato; snapshot verificati: ${report.rows}; storico invariato e unknown; nessuna migrazione persistente.`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
} catch {
  // Mai pubblicare eccezioni driver, URL, credenziali, nomi DB o contenuto righe.
  const message = 'Prova migrazione non completata. Controllare secret di test/produzione, TLS, endpoint distinti e schema di partenza. Nessun successo dichiarato; ogni DDL usa una transazione senza percorso di commit.';
  console.error(message);
  if (process.env.GITHUB_ACTIONS === 'true') console.error(`::error title=Prova migrazione 0010::${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Prova migrazione — NON COMPLETATA\n\n${message}\n`);
  process.exitCode = 1;
} finally { if (client) await client.end({ timeout: 5 }); }
