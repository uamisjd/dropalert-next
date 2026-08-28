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
 * CADENZA, limite dichiarato: il piano Hobby di Vercel accetta SOLO cron
 * giornalieri — una schedule più fitta fa fallire il deploy con «Hobby
 * accounts are limited to daily Cron Jobs», ed è esattamente ciò che è
 * successo provando una schedule ogni due ore il 27/08/2026: il deploy è stato
 * rifiutato e la produzione ha continuato a servire la versione precedente.
 * Quindi qui la rete di sicurezza è una sola rete al giorno (05:17 UTC, con
 * la precisione oraria che Hobby garantisce). Per una copertura più fitta
 * servirebbe uno scheduler esterno che chiami questa stessa rotta con
 * `x-jobs-token`: la rotta è già pronta, non cambia una riga.
 *
 * Autorizzazione, tre forme accettate:
 *  - header `x-jobs-token` (come gli altri job del progetto);
 *  - header `Authorization: Bearer $CRON_SECRET`, che Vercel invia ai suoi cron;
 *  - parametro `?token=` nell'URL, per gli scheduler gratuiti che non
 *    permettono di impostare intestazioni personalizzate.
 *
 * Il parametro in query è meno elegante dell'header e finisce nei log del
 * servizio che chiama: è ammesso perché il segreto protegge una rotta che
 * non espone dati e al massimo fa partire una raccolta già limitata dal
 * gate. Se un giorno lo scheduler dovesse cambiare, resta l'header.
 */
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { systemState } from "@/db/schema";
import {
  readLastCycle,
  readSchedulerConfig,
  runCycle,
  shouldRunNow,
} from "@/lib/pipeline/scheduler";

export const dynamic = "force-dynamic";
/**
 * Tetto di durata, misurato sul campo: con 60 secondi la chiamata è andata
 * in `FUNCTION_INVOCATION_TIMEOUT` (28/08/2026). Un giro completo — raccolta,
 * analisi, chiusure — impiega di più, e il piano Hobby concede fino a 300
 * secondi: tanto vale dichiararli, invece di far fallire il giro a metà.
 */
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const jobs = process.env.JOBS_TOKEN;
  if (jobs !== undefined && jobs.trim() !== "") {
    if (request.headers.get("x-jobs-token") === jobs) return true;
    /* stesso segreto, passato in query da chi non può mandare header */
    const fromQuery = new URL(request.url).searchParams.get("token");
    if (fromQuery !== null && fromQuery === jobs) return true;
  }
  const cron = process.env.CRON_SECRET;
  if (cron !== undefined && cron.trim() !== "") {
    if (request.headers.get("authorization") === `Bearer ${cron}`) return true;
  }
  /* Vercel marca le proprie invocazioni cron; fuori produzione si passa */
  if (request.headers.get("x-vercel-cron") !== null) return true;
  return process.env.NODE_ENV !== "production";
}

/**
 * Traccia dell'ultima bussata dello scheduler esterno.
 *
 * Senza questa riga una raccolta ferma è ambigua: non si distingue «lo
 * scheduler non chiama» da «chiama, ma il gate dice di no». Costa un upsert
 * su una riga sola e rende la seconda gamba osservabile invece che sperata.
 */
export const EXTERNAL_PING_KEY = "cron:external:last_ping";

async function tracePing(skipped: boolean, now: Date): Promise<void> {
  const value = { at: now.toISOString(), skipped };
  await db
    .insert(systemState)
    .values({ key: EXTERNAL_PING_KEY, value, updatedAt: now })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value, updatedAt: now },
    })
    .catch(() => undefined);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, reason: "non autorizzato" },
      { status: 401 },
    );
  }
  try {
    /* USCITA ANTICIPATA, questione di budget non di eleganza: `runCycle`
       rispetta il gate sulla raccolta ma prosegue comunque con analisi e
       chiusure, e misurato in produzione costa oltre 200 secondi anche
       quando non raccoglie nulla. Con uno scheduler esterno che bussa ogni
       quarto d'ora quel lavoro inutile divorerebbe le 4 CPU-ore mensili del
       piano. Qui si legge soltanto l'istante dell'ultimo giro e, se è
       recente, si risponde in pochi millisecondi. */
    const gate = shouldRunNow(
      await readLastCycle().then((l) => (l ? new Date(l.at) : null)),
      new Date(),
      readSchedulerConfig().intervalMinutes,
      false,
    );
    if (!gate.run) {
      await tracePing(true, new Date());
      return NextResponse.json({
        ok: true,
        runner: "vercel-cron",
        skipped: true,
        reason: gate.reason,
        waitedMinutes: gate.waitedMinutes,
      });
    }

    /* stesso ciclo di Actions: raccolta, analisi, chiusura. `force` mai:
       la spaziatura minima resta l'autorità, anche quando il cron insiste */
    await tracePing(false, new Date());
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
