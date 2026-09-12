/** Lettura unica per grafico, riepilogo e fasce del CLV pubblico.
 * La separazione delle basi è una proiezione in lettura: nessuna scrittura.
 */
import { asc, eq, notLike } from "drizzle-orm";
import { db } from "@/db/client";
import { clvRecords, matches } from "@/db/schema";
import { buildPerformanceView, type PerformanceView } from "@/lib/view/clv-performance";
export type { PerformanceView, ClvDayPoint } from "@/lib/view/clv-performance";

export async function getPerformanceView(now: Date = new Date()): Promise<PerformanceView> {
  const rows = await db
    .select({
      clvPp: clvRecords.clvPp,
      beatClose: clvRecords.beatClose,
      at: matches.kickoffAt,
      closingBasis: clvRecords.closingBasis,
      signalScore: clvRecords.signalScore,
    })
    .from(clvRecords)
    .innerJoin(matches, eq(clvRecords.matchId, matches.id))
    .where(notLike(matches.key, "demo-%"))
    .orderBy(asc(matches.kickoffAt));
  return buildPerformanceView(rows, now);
}
