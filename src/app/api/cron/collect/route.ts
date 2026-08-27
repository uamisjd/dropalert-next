/**
 * GET /api/cron/collect — rete di sicurezza dello scheduling (Sprint OPS-1).
 *
 * PERCHÉ ESISTE: la raccolta gira su GitHub Actions, ma lo scheduler di
 * Actions è best-effort. Il 27/08/2026 ha saltato le esecuzioni per quasi
 * nove ore con il workflow attivo e nessun run in coda. Una seconda gamba,
 * su un'infrastruttura diversa, evita che un solo scheduler distratto fermi
 * l'osservatorio.
 *
 * Non duplica la raccolta: chiama lo stesso ciclo, e il gate interno
 * `COLLECT_INTERVAL_MINUTES` decide se c'è davvero qualcosa da fare. Se
 * l'ultimo giro è recente questa rotta esce senza toccare la fonte.
 *
 * Autorizzazione: header `x-jobs-token` (come gli altri job) oppure
 * l'header `Authorization: Bearer $CRON_SECRET` che Vercel invia ai suoi
 * cron. Senza nessuno dei due, in produzione non si esegue.
 */
import { NextResponse } from "next/server";
import { runCycle } from "@/lib/pipeline/scheduler";

export const dynamic = "force-dynamic";
/* la raccolta può superare i pochi secondi di default */
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const jobs = process.env.JOBS_TOKEN;
  if (jobs !== undefined && jobs.trim() !== "") {
    if (request.headers.get("x-jobs-token") === jobs) return true;
  }
  const cron = process.env.CRON_SECRET;
  if (cron !== undefined && cron.trim() !== "") {
    if (request.headers.get("authorization") === `Bearer ${cron}`) return true;
  }
  /* Vercel marca le proprie invocazioni cron; fuori produzione si passa */
  if (request.headers.get("x-vercel-cron") !== null) return true;
  return process.env.NODE_ENV !== "production";
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, reason: "non autorizzato" },
      { status: 401 },
    );
  }
  try {
    /* stesso ciclo di Actions: raccolta, analisi, chiusura. `force` mai:
       la spaziatura minima resta l'autorità, anche quando il cron insiste */
    const result = await runCycle({
      force: false,
      /* «scheduled» è ciò che fa avanzare la profondità della serie: un giro
         marcato manuale non conterebbe come osservazione programmata */
      trigger: "scheduled",
    });
    return NextResponse.json({ ok: true, runner: "vercel-cron", result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        runner: "vercel-cron",
        error: error instanceof Error ? error.message : "errore non identificato",
      },
      { status: 500 },
    );
  }
}
