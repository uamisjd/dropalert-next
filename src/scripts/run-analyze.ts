/**
 * Esecuzione della pipeline da riga di comando, senza passare dalle API.
 * Utile per cron e diagnostica.
 *
 *   npx tsx --env-file=.env src/scripts/run-analyze.ts [--no-closing] [--match <id>]
 *
 * Ogni esecuzione lascia una riga in `collector_runs`, come la rotta HTTP.
 */
import { sql } from "@/db/client";
import { detectAll } from "@/lib/pipeline/detect";
import { runClosingJob } from "@/lib/pipeline/closing";
import { finishRun, startRun } from "@/lib/pipeline/runs";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const withClosing = !argv.includes("--no-closing");
  const matchFlag = argv.indexOf("--match");
  const matchIds =
    matchFlag >= 0 && argv[matchFlag + 1]
      ? [Number(argv[matchFlag + 1])]
      : undefined;

  const now = new Date();
  const handle = await startRun("analyze-cli");

  console.log(`\nEsecuzione pipeline — ${now.toISOString()}`);
  console.log("═".repeat(64));

  try {
    const detection = await detectAll(now, { matchIds });

    console.log("\nRilevamento");
    console.log(`  partite analizzate     ${detection.matchesProcessed}`);
    console.log(`  mercati valutati       ${detection.marketsAnalyzed}`);
    console.log(`  segnali creati         ${detection.created}`);
    console.log(`  segnali aggiornati     ${detection.updated}`);
    console.log(`  invariati              ${detection.unchanged}`);
    console.log(`  scartati (sotto soglia) ${detection.skipped}`);
    console.log(`  buchi dati registrati  ${detection.gapsRecorded}`);

    let closing = null;
    if (withClosing) {
      closing = await runClosingJob(now);
      console.log("\nChiusura e CLV");
      console.log(`  partite trattate       ${closing.matchesProcessed}`);
      console.log(`  closing line acquisite ${closing.linesCaptured}`);
      console.log(`  CLV calcolati          ${closing.clvComputed}`);
      console.log(`  saltate (dati assenti) ${closing.skipped}`);
    }

    const errors = [...detection.errors, ...(closing?.errors ?? [])];
    if (errors.length > 0) {
      console.log("\nErrori");
      for (const e of errors) console.log(`  • partita ${e.matchId}: ${e.message}`);
    }

    await finishRun(handle, {
      status: errors.length > 0 ? "partial" : "success",
      matchesSeen: detection.matchesProcessed,
      signalsTouched: detection.created + detection.updated,
      errors,
      meta: {
        marketsAnalyzed: detection.marketsAnalyzed,
        clvComputed: closing?.clvComputed ?? 0,
      },
    });

    console.log(`\n${"═".repeat(64)}`);
    console.log(`Run #${handle.id} completato.\n`);
  } catch (err) {
    await finishRun(handle, {
      status: "failed",
      errors: [err instanceof Error ? err.message : String(err)],
    });
    console.error("\nEsecuzione fallita:", err);
    await sql.end();
    process.exit(1);
  }

  await sql.end();
}

main();
