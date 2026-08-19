/**
 * Runner schedulato: il pezzo che fa passare il tempo.
 *
 * Fino a qui il sistema sapeva compiere UN giro quando qualcuno glielo
 * chiedeva. Questo modulo è l'unica parte che decide DA SOLA quando
 * chiederlo: un timer in-process che sveglia `runCycle` a intervallo fisso,
 * finché l'applicazione resta viva.
 *
 * Tre scelte che vale la pena dichiarare.
 *
 * 1. **Il timer non decide, propone.** Ogni sveglia chiama `runCycle`, che
 *    rilegge il gate dell'intervallo minimo dal database. Se due processi
 *    partissero per errore, o se un giro manuale fosse appena avvenuto, il
 *    gate salta la raccolta. Il timer non ha l'ultima parola sulla fonte.
 *
 * 2. **Un giro alla volta.** Se un giro dura più dell'intervallo, la
 *    sveglia successiva non ne apre un secondo in parallelo: la salta e
 *    dichiara il salto. Due giri sovrapposti raddoppierebbero il carico
 *    sulla fonte proprio quando la fonte è già lenta.
 *
 * 3. **Un errore non spegne il runner.** Un giro che esplode viene scritto
 *    nello stato e nei log, e il timer riprende alla sveglia dopo. Uno
 *    scheduler che muore al primo errore di rete è peggio di nessuno
 *    scheduler, perché smette di misurare senza dirlo.
 *
 * Non è un sostituto di un supervisore di processo: se il processo Node
 * muore, muore anche il timer. È esattamente ciò che serve qui — la
 * raccolta vive quanto vive l'applicazione che la mostra.
 */
import {
  readSchedulerConfig,
  runCycle,
  readLoopState,
  writeLoopState,
  type LoopState,
} from "./scheduler";

/* ------------------------------------------------------------------ */
/* Interruttore                                                        */
/* ------------------------------------------------------------------ */

/**
 * Il runner parte solo se richiesto esplicitamente.
 *
 * Il default è spento apposta: `next build` esegue il codice di avvio per
 * generare le pagine, e uno scheduler che parte durante una build si
 * metterebbe a bussare alla fonte da un contesto che non è un server.
 * Acceso da `SCHEDULER_ENABLED=true`.
 */
export function schedulerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env.SCHEDULER_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * Attesa prima del primo giro, in millisecondi.
 *
 * Non si parte nell'istante dell'avvio: il server deve prima essere in
 * grado di rispondere. Il primo giro arriva poco dopo, non a intervallo
 * pieno, così l'accensione produce subito un'osservazione.
 */
export const FIRST_RUN_DELAY_MS = 30_000;

/* ------------------------------------------------------------------ */
/* Stato in memoria                                                    */
/* ------------------------------------------------------------------ */

interface LoopHandle {
  timer: NodeJS.Timeout | null;
  running: boolean;
  busy: boolean;
  intervalMs: number;
  startedAt: Date;
  cyclesCompleted: number;
}

/**
 * Un solo runner per processo.
 *
 * Sta su `globalThis` per la stessa ragione del pool del database: in
 * sviluppo il modulo viene ricaricato a caldo, e senza questo aggancio
 * ogni ricarica lascerebbe dietro di sé un timer orfano che continua a
 * bussare alla fonte.
 */
const globalForLoop = globalThis as unknown as {
  __dropalertLoop?: LoopHandle;
};

/** Stato corrente del runner in questo processo, se acceso. */
export function currentLoop(): LoopHandle | null {
  return globalForLoop.__dropalertLoop ?? null;
}

/* ------------------------------------------------------------------ */
/* Avvio                                                               */
/* ------------------------------------------------------------------ */

export interface StartLoopResult {
  started: boolean;
  reason: string;
  intervalMinutes: number;
}

/**
 * Accende il runner schedulato.
 *
 * Idempotente: chiamarla due volte non crea due timer. Restituisce sempre
 * un motivo leggibile, anche quando non parte, perché "lo scheduler non
 * gira" senza spiegazione è il tipo di silenzio che fa perdere ore.
 */
export function startCollectLoop(): StartLoopResult {
  const config = readSchedulerConfig();

  if (!schedulerEnabled()) {
    /* la riga di stato appartiene al processo vivo: se questo processo non
       accende nessun timer, deve dirlo subito, prima che qualcuno legga il
       conto alla rovescia lasciato da un processo precedente */
    void claimStateAsOff(config.intervalMinutes);
    return {
      started: false,
      reason:
        "runner schedulato spento: SCHEDULER_ENABLED non vale \"true\". La raccolta resta disponibile a mano.",
      intervalMinutes: config.intervalMinutes,
    };
  }

  const existing = currentLoop();
  if (existing?.running) {
    return {
      started: false,
      reason: "runner schedulato già attivo in questo processo.",
      intervalMinutes: Math.round(existing.intervalMs / 60000),
    };
  }

  const intervalMs = config.intervalMinutes * 60_000;
  const handle: LoopHandle = {
    timer: null,
    running: true,
    busy: false,
    intervalMs,
    startedAt: new Date(),
    cyclesCompleted: 0,
  };
  globalForLoop.__dropalertLoop = handle;

  const tick = async (): Promise<void> => {
    if (!handle.running) return;

    /* giro precedente ancora in corso: si salta, non si accavalla */
    if (handle.busy) {
      log(
        "giro precedente ancora in corso: sveglia saltata per non sovrapporre due raccolte.",
      );
      await persist(handle, { lastStatus: "skipped_busy" });
      return;
    }

    handle.busy = true;
    try {
      const report = await runCycle({ trigger: "scheduled" });
      handle.cyclesCompleted += 1;
      log(
        `giro ${report.status}: ${report.collect.snapshotsWritten} quote scritte, ${report.detection.matchesProcessed} partite analizzate.`,
      );
      await persist(handle, { lastStatus: report.status });
    } catch (err) {
      /* un giro fallito non spegne il runner: si dichiara e si riprova */
      const message = err instanceof Error ? err.message : String(err);
      log(`giro interrotto: ${message}. Il runner resta attivo.`);
      await persist(handle, { lastStatus: "failed" }).catch(() => undefined);
    } finally {
      handle.busy = false;
    }
  };

  /* prima di tutto la riga di stato: chi legge il pannello nei trenta
     secondi che precedono il primo tick deve vedere QUESTO processo, non
     l'ultima cosa scritta da quello di ieri */
  void persist(handle, { lastStatus: null, firstDelayMs: FIRST_RUN_DELAY_MS });

  /* primo giro poco dopo l'avvio, poi a intervallo pieno */
  setTimeout(() => {
    void tick();
    handle.timer = setInterval(() => void tick(), intervalMs);
    /* il timer non deve tenere vivo il processo da solo */
    handle.timer.unref?.();
  }, FIRST_RUN_DELAY_MS).unref?.();

  log(
    `runner schedulato acceso: un giro ogni ${config.intervalMinutes} minuti (intervallo da ${config.source === "env" ? "COLLECT_INTERVAL_MINUTES" : "valore predefinito"}), primo giro fra ${Math.round(FIRST_RUN_DELAY_MS / 1000)} secondi.`,
  );

  return {
    started: true,
    reason: `runner schedulato attivo: un giro ogni ${config.intervalMinutes} minuti.`,
    intervalMinutes: config.intervalMinutes,
  };
}

/** Spegne il runner. Serve ai test e a uno spegnimento pulito. */
export async function stopCollectLoop(): Promise<void> {
  const handle = currentLoop();
  if (!handle) return;
  handle.running = false;
  if (handle.timer) clearInterval(handle.timer);
  handle.timer = null;
  globalForLoop.__dropalertLoop = undefined;

  const previous = await readLoopState().catch(() => null);
  if (previous) {
    await writeLoopState({ ...previous, running: false, nextRunAt: null }).catch(
      () => undefined,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Persistenza dello stato                                             */
/* ------------------------------------------------------------------ */

/**
 * Dichiara spento il runner, a nome del processo che sta partendo ora.
 *
 * Serve per il caso che ha prodotto la bugia: un processo si spegne senza
 * poter chiudere la propria riga, quello dopo parte con lo scheduler
 * disattivato e la riga vecchia continua a raccontare un timer acceso con
 * tanto di conto alla rovescia. Riscrivendola all'avvio, l'archivio
 * descrive sempre il processo vivo.
 *
 * `cyclesCompleted` riparte da zero perché è, e resta, un contatore di
 * processo. Non ha alcun rapporto con la profondità della serie, che si
 * conta dai run salvati in archivio.
 */
async function claimStateAsOff(intervalMinutes: number): Promise<void> {
  const now = new Date();
  try {
    await writeLoopState({
      running: false,
      intervalMinutes,
      startedAt: now.toISOString(),
      lastTickAt: null,
      nextRunAt: null,
      cyclesCompleted: 0,
      lastStatus: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`stato del runner non aggiornato all'avvio: ${message}.`);
  }
}

/**
 * Scrive dove è arrivato il runner e quando busserà di nuovo.
 *
 * Non fa mai fallire un giro: se l'archivio non risponde, la raccolta è
 * comunque avvenuta e l'unica cosa persa è la scritta "prossimo giro fra
 * X minuti". Un contatore non deve poter fermare una misura.
 */
async function persist(
  handle: LoopHandle,
  extra: { lastStatus: string | null; firstDelayMs?: number },
): Promise<void> {
  const now = new Date();
  const delay = extra.firstDelayMs ?? handle.intervalMs;
  const state: LoopState = {
    running: handle.running,
    intervalMinutes: Math.round(handle.intervalMs / 60000),
    startedAt: handle.startedAt.toISOString(),
    lastTickAt: extra.firstDelayMs === undefined ? now.toISOString() : null,
    nextRunAt: new Date(now.getTime() + delay).toISOString(),
    cyclesCompleted: handle.cyclesCompleted,
    lastStatus: extra.lastStatus,
  };

  try {
    await writeLoopState(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`stato del runner non salvato: ${message}. Il giro resta valido.`);
  }
}

function log(message: string): void {
  console.info(`[scheduler] ${message}`);
}
