/**
 * POST /api/jobs/analyze — esegue un giro completo dell'osservatorio.
 *
 * Corpo (JSON, tutto opzionale):
 *   {
 *     "collect": true,      // raccolta dalla fonte reale (default true)
 *     "closing": true,      // chiusura + CLV (default true)
 *     "force": false,       // ignora l'intervallo minimo fra due raccolte
 *     "matchIds": [1,2]     // limita l'analisi a partite specifiche
 *   }
 *
 * È il punto di aggancio per uno scheduler esterno gratuito: un cron che
 * chiama questa rotta ottiene raccolta, analisi e chiusura in una sola
 * richiesta. Nessun processo resta vivo dopo la risposta.
 *
 * Ogni esecuzione lascia una riga in `collector_runs`, anche in caso di
 * errore. Il job è idempotente: rieseguirlo non duplica segnali e non
 * riscrive mai il prezzo congelato al rilevamento.
 *
 * In produzione va protetto da un token: `JOBS_TOKEN` nell'ambiente abilita
 * il controllo dell'header `x-jobs-token`. Se la variabile non è impostata
 * la rotta risponde solo fuori da NODE_ENV=production.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { runCycle, readSchedulerConfig } from "@/lib/pipeline/scheduler";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  matchIds: z.array(z.number().int().positive()).max(500).optional(),
  collect: z.boolean().default(true),
  closing: z.boolean().default(true),
  force: z.boolean().default(false),
});

/** Verifica l'autorizzazione del job. */
function authorize(request: Request): { ok: boolean; reason?: string } {
  const token = process.env.JOBS_TOKEN;
  if (token) {
    const provided = request.headers.get("x-jobs-token");
    if (provided !== token) {
      return { ok: false, reason: "token non valido" };
    }
    return { ok: true };
  }
  if (process.env.NODE_ENV === "production") {
    return {
      ok: false,
      reason:
        "JOBS_TOKEN non configurato: la rotta è disabilitata in produzione.",
    };
  }
  return { ok: true };
}

export async function POST(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "non autorizzato", detail: auth.reason },
      { status: 401 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const rawBody = await request.text();
    const parsed = bodySchema.safeParse(rawBody ? JSON.parse(rawBody) : {});
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "corpo della richiesta non valido",
          details: parsed.error.issues.map((i) => i.message),
        },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  const report = await runCycle({
    skipCollect: !body.collect,
    force: body.force,
    matchIds: body.matchIds,
  });

  const httpStatus = report.status === "failed" ? 500 : 200;

  return NextResponse.json(
    {
      runId: report.runId,
      status: report.status,
      scheduler: {
        intervalMinutes: report.config.intervalMinutes,
        intervalSource: report.config.source,
        gate: report.gate,
      },
      collect: report.collect,
      detection: report.detection,
      closing: body.closing ? report.closing : null,
      pendingClosings: {
        count: report.pending.length,
        next: report.pending.slice(0, 5),
      },
      errors: report.errors,
      note: "Analisi di movimenti osservati a supporto delle tue giocate. Nessuna vincita garantita.",
      generatedAt: report.startedAt,
      durationMs: report.durationMs,
    },
    { status: httpStatus },
  );
}

/** GET: nessuna esecuzione, solo la configurazione dichiarata dello scheduler. */
export async function GET() {
  const config = readSchedulerConfig();
  return NextResponse.json(
    {
      error: "metodo non consentito",
      detail: "Usare POST per eseguire un giro di raccolta e analisi.",
      scheduler: config,
      hint: "Lo scheduling è esterno: vedere docs/SCHEDULING.md. Nessun processo resta vivo fra un giro e l'altro.",
    },
    { status: 405 },
  );
}
