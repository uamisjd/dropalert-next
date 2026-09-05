/**
 * GET /api/cron/status — la seconda gamba è viva?
 *
 * Rotta pubblica e senza segreti: dice solo QUANDO lo scheduler esterno ha
 * bussato l'ultima volta e se quella chiamata ha raccolto o è stata saltata
 * dal gate. Serve a rispondere in un colpo solo alla domanda che altrimenti
 * resta ambigua davanti a una raccolta ferma: nessuno chiama, o chiamano e
 * il gate dice di no?
 *
 * Dice anche COSA il gate sta rispettando in questo momento — l'ultimo giro
 * chiuso o l'ultimo giro tentato, il più recente dei due — e quanti minuti
 * mancano prima che una nuova raccolta sia ammessa: è la riga che distingue
 * «la seconda gamba sta premendo sulla fonte ogni quarto d'ora» da «è in
 * pausa fino al prossimo intervallo», senza dover leggere il database a mano.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { systemState } from "@/db/schema";
import {
  latestRunMoment,
  readCycleClaim,
  readLastCycle,
  readSchedulerConfig,
} from "@/lib/pipeline/scheduler";
import { EXTERNAL_PING_KEY } from "../collect/route";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const [row, closed, claim] = await Promise.all([
      db
        .select({ value: systemState.value })
        .from(systemState)
        .where(eq(systemState.key, EXTERNAL_PING_KEY))
        .limit(1),
      readLastCycle().catch(() => null),
      readCycleClaim().catch(() => null),
    ]);

    /* il momento che tiene chiusa la porta: lo stesso che usa il gate */
    const respected = latestRunMoment(
      closed === null ? null : new Date(closed.at),
      claim,
    );
    const intervalMinutes = readSchedulerConfig().intervalMinutes;
    const minutesUntilNextRun =
      respected === null
        ? 0
        : Math.max(
            0,
            Math.round(
              (intervalMinutes * 60_000 - (Date.now() - respected.getTime())) / 60_000,
            ),
          );

    if (row[0] === undefined) {
      return Response.json({
        ok: true,
        lastPingAt: null,
        note: "Nessuna chiamata dallo scheduler esterno finora.",
        gate: {
          intervalMinutes,
          lastCycleAt: closed?.at ?? null,
          lastClaimAt: claim ? claim.toISOString() : null,
          minutesUntilNextRun,
        },
      });
    }
    const v = row[0].value as { at?: string; skipped?: boolean };
    const at = typeof v.at === "string" ? v.at : null;
    const minutiFa =
      at === null
        ? null
        : Math.round((Date.now() - new Date(at).getTime()) / 60000);

    return Response.json({
      ok: true,
      lastPingAt: at,
      minutesAgo: minutiFa,
      lastPingSkipped: v.skipped ?? null,
      gate: {
        intervalMinutes,
        lastCycleAt: closed?.at ?? null,
        lastClaimAt: claim ? claim.toISOString() : null,
        minutesUntilNextRun,
        /* un giro tentato più recente dell'ultimo giro chiuso è il segnale
           che una battuta è stata interrotta prima della fine */
        lastCycleTruncated:
          claim !== null && (closed === null || claim.getTime() > Date.parse(closed.at)),
      },
    });
  } catch {
    return Response.json(
      { ok: false, reason: "registro non leggibile" },
      { status: 503 },
    );
  }
}
