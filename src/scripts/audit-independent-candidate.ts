import { readIndependentCandidate } from "@/lib/repo/independent-candidates";
import { sql } from "@/db/client";
import type { Outcome } from "@/lib/decision/independent-candidate";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3 || !/^[1-9][0-9]{0,9}$/.test(args[0]) ||
      !/^[a-z0-9_-]{1,80}$/.test(args[1]) || !["home", "draw", "away"].includes(args[2])) {
    console.error("Uso: npm run audit:candidate -- <match-id> <bookmaker-key> <home|draw|away>");
    process.exitCode = 2; return;
  }
  // Nessun flag che finga l'accessibilità dell'offerta. Il CLI resta diagnostico.
  const report = await readIndependentCandidate({ matchId: Number(args[0]), bookmaker: args[1], selection: args[2] as Outcome });
  console.log("SCANNER INDIPENDENTE — sola lettura, 0 crediti, nessun sizing");
  console.log(JSON.stringify(report, null, 2));
  console.log("Fair di riferimento, non probabilità vera validata. Nessuna offerta confermata dal CLI; nessuna raccomandazione BET.");
}
main().catch(() => {
  console.error("Scanner non eseguito: errore nei parametri o lettura DB fallita. Non equivale a zero candidate.");
  process.exitCode = 1;
}).finally(async () => { await sql.end({ timeout: 5 }); });
