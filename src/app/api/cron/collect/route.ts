/**
 * GET /api/cron/collect — rete di sicurezza dello scheduling (Sprint OPS-1).
 *
 * PERCHÉ ESISTE: la raccolta gira su GitHub Actions, ma lo scheduler di
 * Actions è best-effort. Il 27/08/2026 ha saltato le esecuzioni per quasi
 * nove ore con il workflow attivo e nessun run in coda. Una seconda gamba,
 * su un'infrastruttura diversa, evita che un solo scheduler distratto fermi
 * l'osservatorio.
 *
 * Non duplica la raccolta: usa lo stesso gate e la stessa fase di raccolta
 * del ciclo, ma con il profilo serverless `collect_only`. Se l'ultimo giro è
 * recente questa rotta esce senza toccare la fonte; se parte, termina prima
 * delle fasi locali che non entrano nel budget della funzione.
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
  readGateMoment,
  readSchedulerConfig,
  runCycle,
  shouldRunNow,
} from "@/lib/pipeline/scheduler";

export const dynamic = "force-dynamic";
/**
 * Tetto della piattaforma. Il profilo usato sotto riserva metà di questo
 * tempo alla finalizzazione: la fase di dettaglio ha un budget di 120 s e
 * un tetto di 15 righe; non partono le fasi lunghe del giro completo.
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
    /* USCITA ANTICIPATA, questione di budget non di eleganza: con uno
       scheduler esterno che bussa ogni quarto d'ora non ha senso aprire e
       chiudere un run solo per scoprire che il gate nega la raccolta. Qui si
       legge soltanto l'istante dell'ultimo giro — chiuso *o
       tentato*, `readGateMoment`: un giro troncato a metà dal budget della
       funzione conta come lavoro fatto, altrimenti ogni battuta del
       chiamante tornerebbe a premere sulla fonte ogni quarto d'ora invece
       che ogni 45 minuti — e se è recente si risponde in pochi
       millisecondi. */
    const gate = shouldRunNow(
      await readGateMoment(),
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

    /* La seconda gamba ha un budget di 300 s, mentre il giro completo ne ha
       misurati ~430. Qui si esegue quindi il profilo `collect_only`: niente
       risultati, retry da 60 s, analisi, chiusure o notifiche. Quelle fasi
       restano ad Actions; questa rotta chiude invece il proprio run e scrive
       `scheduler:last_collection`. Il claim tiene chiuso il gate della fonte,
       mentre `scheduler:last_cycle` resta l'heartbeat del ciclo completo e non
       viene avanzato dal fallback: altrimenti Actions potrebbe non partire più.
       `force` mai: la spaziatura minima resta l'autorità. */
    await tracePing(false, new Date());
    const result = await runCycle({
      mode: "collect_only",
      force: false,
      /* La raccolta completata è un punto valido della serie di copertura:
         misura ciò che la fonte ha mostrato, non l'esecuzione dell'analisi. */
      trigger: "scheduled",
    });
    /* Difesa dalla gara fra i due runner: il secondo controllo dentro
       runCycle può trovare un claim scritto dopo l'uscita anticipata. */
    if (result.status === "skipped") await tracePing(true, new Date());
    return NextResponse.json({ ok: true, runner: "vercel-cron", result });
  } catch (error) {
    /* rotta protetta da segreto, ma il principio è lo stesso delle altre:
       il dettaglio resta nei log, fuori c'è solo l'esito */
    console.error(
      "[api/cron/collect] giro fallito:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        ok: false,
        runner: "vercel-cron",
        error: "Giro non completato. Il dettaglio è registrato nei log del server.",
      },
      { status: 500 },
    );
  }
}
