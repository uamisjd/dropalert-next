/**
 * Un giro dell'osservatorio, da riga di comando.
 *
 *   npm run job:collect                # raccolta + analisi + chiusura
 *   npm run job:collect -- --force     # ignora l'intervallo minimo
 *   npm run job:collect -- --collect-only
 *   npm run job:collect -- --no-collect
 *   npm run job:collect -- --scheduled  # giro automatico: conta per la serie N/10
 *
 * Non è un demone: parte, fa un giro, stampa cosa ha trovato e termina
 * chiudendo la connessione. La ripetizione nel tempo è compito di uno
 * scheduler esterno, che può chiamare questo script o
 * `POST /api/jobs/analyze` (vedi docs/SCHEDULING.md).
 */
import { sql } from "@/db/client";
import { collectBetexplorer } from "@/lib/providers/betexplorer/collect";
import { runCycle, readSchedulerConfig } from "@/lib/pipeline/scheduler";

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function fmtRome(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** Solo raccolta, senza analisi: percorso diagnostico dell'adapter. */
async function collectOnly(): Promise<void> {
  const maxRaw = arg("--max");
  const horizonRaw = arg("--horizon");
  const report = await collectBetexplorer({
    withResults: !process.argv.includes("--no-results"),
    maxFixtures: maxRaw ? Number(maxRaw) : undefined,
    horizonHours: horizonRaw ? Number(horizonRaw) : undefined,
  });

  console.log("\n=== RACCOLTA BETEXPLORER ===");
  console.log(`esito                  : ${report.status}`);
  console.log(`partite in elenco      : ${report.fixturesSeen}`);
  console.log(`partite salvate        : ${report.matchesUpserted} (nuove: ${report.matchesCreated})`);
  console.log(`quote scritte          : ${report.snapshotsWritten} (duplicati ignorati: ${report.snapshotsSkipped})`);
  console.log(`risultati aggiornati   : ${report.resultsUpdated}`);
  console.log(`latenza totale         : ${report.latencyMs} ms`);
  console.log(`payload                : ${(report.payloadBytes / 1024).toFixed(1)} KB`);

  if (report.problems.length > 0) {
    console.log(`\nDATI PARZIALI — ${report.problems.length} punti dichiarati:`);
    for (const p of report.problems.slice(0, 15)) console.log(`  - ${p}`);
    if (report.problems.length > 15) {
      console.log(`  … e altri ${report.problems.length - 15}`);
    }
  }
}

/** Giro completo. */
async function fullCycle(): Promise<void> {
  const config = readSchedulerConfig();
  console.log("\n=== GIRO DELL'OSSERVATORIO ===");
  console.log(
    `intervallo minimo      : ${config.intervalMinutes} min (${config.source === "env" ? "da COLLECT_INTERVAL_MINUTES" : "valore predefinito"})`,
  );

  // `--scheduled` marca il giro come automatico: è l'UNICO valore che
  // `triggerOfRun` conta nella profondità della serie (N/10). Senza questo
  // flag il giro resta "manual" e la serie non avanza, anche se a chiamare
  // è un cron. Lo passa il workflow di GitHub Actions.
  const report = await runCycle({
    force: process.argv.includes("--force"),
    skipCollect: process.argv.includes("--no-collect"),
    trigger: process.argv.includes("--scheduled") ? "scheduled" : "manual",
  });

  console.log(`esito                  : ${report.status}`);
  console.log(`run id                 : ${report.runId}`);
  console.log(`durata                 : ${report.durationMs} ms`);
  console.log(`gate                   : ${report.gate.reason}`);

  console.log("\nRaccolta");
  if (!report.collect.executed) {
    console.log("  non eseguita in questo giro");
  } else {
    console.log(`  esito                ${report.collect.status}`);
    console.log(`  partite in elenco    ${report.collect.fixturesSeen}`);
    console.log(`  quote scritte        ${report.collect.snapshotsWritten}`);
    console.log(`  risultati aggiornati ${report.collect.resultsUpdated}`);
    if (report.collect.problems.length > 0) {
      console.log(`  DATI PARZIALI — ${report.collect.problems.length} punti dichiarati`);
      for (const p of report.collect.problems.slice(0, 8)) console.log(`    - ${p}`);
    }
  }

  console.log("\nRilevamento");
  console.log(`  partite analizzate   ${report.detection.matchesProcessed}`);
  console.log(`  mercati valutati     ${report.detection.marketsAnalyzed}`);
  console.log(`  segnali creati       ${report.detection.created}`);
  console.log(`  segnali aggiornati   ${report.detection.updated}`);
  console.log(`  buchi dati           ${report.detection.gapsRecorded}`);

  console.log("\nChiusura e CLV");
  console.log(`  partite chiuse       ${report.closing.matchesProcessed}`);
  console.log(`  linee di chiusura    ${report.closing.linesCaptured}`);
  console.log(`  di cui fair no-vig   ${report.closing.fairLinesCaptured}`);
  console.log(`  record CLV           ${report.closing.clvComputed}`);

  /* Le notifiche sono una fase del giro, non un pensiero: se non partono il
     perché deve essere scritto qui, non scoperto da chi aspetta un avviso. */
  console.log("\nNotifiche");
  if (!report.notifications.configured) {
    console.log(
      "  chiavi VAPID non configurate: nessun avviso può partire (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)",
    );
  } else if (!report.notifications.executed) {
    console.log("  fase non eseguita in questo giro (dato vivo non leggibile)");
  } else {
    console.log(`  iscrizioni a registro ${report.notifications.subscriptions}`);
    console.log(`  avvisi inviati       ${report.notifications.sent}`);
    console.log(`  invii non riusciti   ${report.notifications.skipped}`);
    console.log(`  iscrizioni rimosse   ${report.notifications.removed} (endpoint morti)`);
  }

  console.log(`\nIn attesa di chiusura : ${report.pending.length} partite monitorate`);
  for (const p of report.pending.slice(0, 10)) {
    console.log(`  - ${p.key} → kickoff ${fmtRome(p.kickoffAt)} (Europe/Rome)`);
  }
  if (report.pending.length > 10) {
    console.log(`  … e altre ${report.pending.length - 10}`);
  }

  if (report.errors.length > 0) {
    console.log(`\nErrori dichiarati (${report.errors.length}):`);
    for (const e of report.errors.slice(0, 10)) console.log(`  - ${e}`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--collect-only")) {
    await collectOnly();
  } else {
    await fullCycle();
  }

  console.log(
    "\nNota: questa fonte pubblica solo la quota di consenso. Coordinazione fra",
  );
  console.log(
    "bookmaker e conferma della linea sharp NON sono calcolabili e restano",
  );
  console.log("dichiarate mancanti in data_gaps.");
  console.log(
    "Osservatorio statistico: nessun contenuto è un consiglio di scommessa.\n",
  );
}

main()
  .then(async () => {
    await sql.end({ timeout: 5 });
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Giro fallito:", err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
