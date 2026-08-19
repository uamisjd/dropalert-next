/**
 * Verifica end-to-end: legge le serie dal database e controlla che il motore
 * classifichi ogni scenario dimostrativo come atteso.
 * Uso: npx tsx --env-file=.env src/scripts/verify-scenarios.ts
 */
import { like } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { matches } from "@/db/schema";
import { analyzeDrop } from "@/lib/drop/engine";
import { getExpectedBookmakerCount, getSeriesForMatch, parseMarketKey } from "@/lib/repo/odds";

async function main(): Promise<void> {
  const rows = await db
    .select({ id: matches.id, key: matches.key, kickoffAt: matches.kickoffAt })
    .from(matches)
    .where(like(matches.key, "demo-%"));

  const now = new Date();
  console.log(`\nVerifica di ${rows.length} scenari dimostrativi\n${"─".repeat(78)}`);

  for (const m of rows) {
    const grouped = await getSeriesForMatch(m.id);
    for (const [key, series] of grouped) {
      const { market, selection } = parseMarketKey(key);
      const expected = await getExpectedBookmakerCount(market);
      const a = analyzeDrop({
        matchId: m.id,
        market,
        selection,
        kickoffAt: m.kickoffAt,
        now,
        series,
        expectedBookmakers: expected,
      });

      console.log(`\n▸ ${m.key}  [${market}/${selection}]`);
      console.log(
        `  ampiezza    ${a.magnitude.deltaPp >= 0 ? "+" : ""}${a.magnitude.deltaPp} pp  (${a.magnitude.magnitudeClass})  ${a.magnitude.openingPrice} → ${a.magnitude.currentPrice}`,
      );
      console.log(
        `  book        ${a.coordination.booksConfirming}/${a.coordination.booksTotal} confermano  score ${a.coordination.coordinationScore}`,
      );
      console.log(
        `  sharp       ${a.sharp.available ? (a.sharp.confirms ? `conferma (${a.sharp.deltaPp} pp)${a.sharp.leadsMarket ? " e guida" : ""}` : `non conferma (${a.sharp.deltaPp} pp)`) : "non disponibile"}`,
      );
      console.log(
        `  tenuta      ${a.persistence.sustainedMinutes} min${a.persistence.isFlash ? " · FLASH" : ""}${a.persistence.rebounded ? ` · RIMBALZATO (${Math.round(a.persistence.retracementRatio * 100)}%)` : ""}`,
      );
      console.log(
        `  copertura   ${a.coverage.score} (${a.coverage.booksObserved}/${a.coverage.booksExpected} book, ${a.coverage.historyDepthMinutes} min storico)`,
      );
      console.log(
        `  FIDUCIA     ${a.confidenceScore}/100 → ${a.confidenceBand}   ${a.qualifiesAsSignal ? "SEGNALE" : `scartato: ${a.rejectionReason}`}`,
      );
      if (a.explanation.missingData.length > 0) {
        console.log(`  mancante    ${a.explanation.missingData.join(" | ")}`);
      }
      console.log(`  sintesi     ${a.explanation.summary}`);
    }
  }

  console.log(`\n${"─".repeat(78)}\n`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
