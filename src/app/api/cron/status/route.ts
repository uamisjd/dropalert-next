/**
 * GET /api/cron/status — la seconda gamba è viva?
 *
 * Rotta pubblica e senza segreti: dice solo QUANDO lo scheduler esterno ha
 * bussato l'ultima volta e se quella chiamata ha raccolto o è stata saltata
 * dal gate. Serve a rispondere in un colpo solo alla domanda che altrimenti
 * resta ambigua davanti a una raccolta ferma: nessuno chiama, o chiamano e
 * il gate dice di no?
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { systemState } from "@/db/schema";
import { EXTERNAL_PING_KEY } from "../collect/route";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const [row] = await db
      .select({ value: systemState.value })
      .from(systemState)
      .where(eq(systemState.key, EXTERNAL_PING_KEY))
      .limit(1);

    if (row === undefined) {
      return Response.json({
        ok: true,
        lastPingAt: null,
        note: "Nessuna chiamata dallo scheduler esterno finora.",
      });
    }
    const v = row.value as { at?: string; skipped?: boolean };
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
    });
  } catch {
    return Response.json(
      { ok: false, reason: "registro non leggibile" },
      { status: 503 },
    );
  }
}
