/**
 * La raccolta automatica raccontata per come avviene davvero (Sprint 9).
 *
 * Fino a questo sprint il pannello di copertura descriveva solo il runner
 * in-process: spento quello, stampava «Raccolta automatica non attiva: la
 * serie non avanza da sola». Con la raccolta delegata a GitHub Actions
 * quella frase è diventata falsa — la serie avanza lo stesso, la raccoglie
 * il cron del workflow, non il processo che serve la pagina.
 *
 * Questo modulo descrive la verità osservabile: l'autorità non è la riga
 * di stato di un processo, è l'archivio. L'ultimo giro **schedulato** si
 * legge da `collector_runs` (`meta.trigger = "scheduled"`), e un cron che
 * non si presenta si dichiara con un avviso, non con un silenzio.
 *
 * Funzioni PURE: nessun database, nessuna rete, nessun orologio implicito.
 */

/**
 * Cron del workflow `.github/workflows/collect.yml`.
 *
 * Non è un «ogni 45» scritto col passo sul campo minuti: quel campo si
 * azzera a ogni ora e produrrebbe 45 e 15 minuti alternati. Due voci
 * esplicite a distanza reale di 45 e 75 minuti sono il compromesso più
 * onesto possibile — per questo l'intervallo si dichiara «circa».
 */
export const ACTIONS_CRON = "7,52 * * * *";

/** Intervallo nominale fra due giri del cron, in minuti. */
export const ACTIONS_INTERVAL_MINUTES = 45;

/**
 * Oltre questo silenzio la raccolta si dichiara in allarme.
 *
 * 90 = 2 × 45: la stessa regola del runner in-process
 * (`STALE_INTERVAL_MULTIPLIER`). GitHub Actions non garantisce puntualità
 * e un ritardo di qualche decina di minuti è normale; due intervalli
 * interi senza un giro sono invece il segnale che qualcosa si è fermato.
 */
export const ACTIONS_STALLED_AFTER_MINUTES = 90;

/** Un giro schedulato letto dall'archivio: quando, e com'è finito. */
export interface ScheduledRun {
  runId: number;
  /** istante di inizio, ISO */
  startedAt: string;
  /** `success` | `partial` | `failed` | `running`, come `run_status` */
  status: string;
}

/** Esiti di un run in italiano, per la riga del pannello. */
export const RUN_STATUS_LABELS: Record<string, string> = {
  success: "riuscito",
  partial: "parziale",
  failed: "fallito",
  running: "in corso",
};

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status;
}

/** La riga di raccolta automatica pronta da stampare. */
export interface ActionsView {
  cron: string;
  intervalMinutes: number;
  stalledAfterMinutes: number;
  /** ultimo giro schedulato letto dall'archivio, `null` se non ce n'è */
  lastRun: ScheduledRun | null;
  lastRunStatusLabel: string | null;
  /** minuti dall'ultimo giro schedulato, `null` se non ce n'è */
  minutesSinceLastRun: number | null;
  /** true quando il silenzio supera la soglia dichiarata */
  stalled: boolean;
  /** frase che dichiara chi raccoglie e ogni quanto */
  label: string;
  /** frase sull'ultimo giro schedulato: c'era, o non c'è mai stato */
  lastRunLine: string;
  /** avviso ambra quando la raccolta sembra essersi fermata */
  warning: string | null;
}

/**
 * Minuti fra due istanti, arrotondati, mai negativi.
 *
 * Un giro «in ritardo» rispetto all'orologio di chi legge resta 0: non ha
 * senso dichiarare un ritardo negativo quando l'istante è nel futuro.
 */
export function minutesBetween(later: Date, earlier: Date): number {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 60000));
}

/**
 * Durata in forma leggibile: minuti sotto l'ora, poi ore e minuti, poi
 * giorni e ore. È la durata del silenzio, e il silenzio lungo si legge
 * meglio in ore che in centinaia di minuti.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} g` : `${days} g ${restHours} h`;
}

/**
 * Compone la descrizione della raccolta automatica.
 *
 * Tre frasi possibili, in tre campi separati: chi raccoglie (`label`),
 * com'è andato l'ultimo giro (`lastRunLine` — l'orario lo formatta la
 * pagina, che conosce il fuso di chi legge) e, solo quando c'è motivo di
 * allarmarsi, l'avviso (`warning`). Un avviso che compare sempre non
 * avverte più di niente.
 */
export function buildActionsView(input: {
  lastScheduledRun: ScheduledRun | null;
  now: Date;
}): ActionsView {
  const last = input.lastScheduledRun;
  const minutesSince =
    last === null ? null : minutesBetween(input.now, new Date(last.startedAt));

  /* soglia oltre, non oltre-o-uguale: a 90 minuti esatti il ritardo è
     ancora dentro due intervalli, non è un fermo */
  const stalled =
    minutesSince !== null && minutesSince > ACTIONS_STALLED_AFTER_MINUTES;

  const label = `Raccolta automatica via GitHub Actions: cron «${ACTIONS_CRON}», circa un giro ogni ${ACTIONS_INTERVAL_MINUTES} minuti.`;

  const lastRunLine =
    last === null
      ? "Nessun giro schedulato registrato finora: la serie storica non è ancora avanzata da sola."
      : `Ultimo giro schedulato (run ${last.runId}): esito ${runStatusLabel(last.status)}.`;

  const warning =
    stalled && minutesSince !== null
      ? `Nessun giro schedulato da ${formatDuration(minutesSince)}: oltre i ${ACTIONS_STALLED_AFTER_MINUTES} minuti attesi, la raccolta automatica potrebbe essersi fermata.`
      : null;

  return {
    cron: ACTIONS_CRON,
    intervalMinutes: ACTIONS_INTERVAL_MINUTES,
    stalledAfterMinutes: ACTIONS_STALLED_AFTER_MINUTES,
    lastRun: last,
    lastRunStatusLabel: last === null ? null : runStatusLabel(last.status),
    minutesSinceLastRun: minutesSince,
    stalled,
    label,
    lastRunLine,
    warning,
  };
}
