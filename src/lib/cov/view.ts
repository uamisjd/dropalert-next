/**
 * Preparazione dei dati di copertura per la pagina (Sprint 6C).
 *
 * Funzioni pure: nessun accesso al database, nessuna rete, nessun orologio
 * implicito. Ricevono ciò che il repository ha letto e restituiscono una
 * struttura già pronta da stampare, in modo che il componente non debba
 * prendere nessuna decisione sul significato dei numeri.
 *
 * Regola che governa tutto il file: **la misura assente non è uno zero.**
 * Quando la copertura non è stata misurata lo si dichiara, e non si
 * riempie il buco con un numero che sembrerebbe un dato.
 */
import {
  EXCLUSION_LABELS,
  MIN_RUNS_FOR_TREND,
  type CoverageSeriesStats,
  type ExclusionReason,
  type RunCoverage,
} from "./instrument";
import {
  buildActionsView,
  type ActionsView,
  type ScheduledRun,
} from "./actions";

/** Come va trattato un motivo di esclusione quando si legge un giro. */
export type ReasonKind =
  | "fuori_perimetro"
  | "limite_fonte"
  | "nostra_scelta"
  | "perdita"
  | "non_classificato";

/**
 * Natura di ciascun motivo.
 *
 * Non è una sfumatura estetica: `sport` e `demo` sono righe che non ci
 * competono, `robots` è un dato che la fonte non pubblica dove ci è
 * consentito guardare, e solo `no_odds` e `not_reached` sono righe che
 * avremmo dovuto prendere e non abbiamo preso. Mescolarli produrrebbe un
 * numero grosso e privo di significato.
 *
 * `our_choice` sta fra il limite della fonte e la perdita: la riga era
 * raggiungibile, l'abbiamo lasciata fuori noi (finestra temporale o tetto
 * per giro). Non è un difetto e non va colorata come tale, ma nemmeno
 * nascosta: cambiare quei due parametri la recupererebbe.
 *
 * `altro` resta a parte: è il motivo che il collector non ha saputo
 * attribuire. Dichiararlo fuori perimetro sarebbe una deduzione senza
 * prova, contarlo fra le perdite pure. Sta in una riga sua, e finché è a
 * zero non c'è niente da decidere; se sale, va guardato prima di leggere
 * la copertura.
 */
export const REASON_KIND: Record<ExclusionReason, ReasonKind> = {
  sport: "fuori_perimetro",
  demo: "fuori_perimetro",
  robots: "limite_fonte",
  our_choice: "nostra_scelta",
  no_odds: "perdita",
  not_reached: "perdita",
  altro: "non_classificato",
};

/** Etichetta breve, per la colonna di sinistra della tabella. */
export const REASON_SHORT: Record<ExclusionReason, string> = {
  sport: "Altro sport",
  demo: "Dimostrative",
  robots: "Non pubblicato (robots)",
  our_choice: "Esclusa da nostra scelta",
  no_odds: "Senza quote",
  not_reached: "Non raggiunte",
  altro: "Motivo non attribuito",
};

export const KIND_LABELS: Record<ReasonKind, string> = {
  fuori_perimetro: "Fuori perimetro",
  limite_fonte: "Limite della fonte",
  nostra_scelta: "Nostra scelta",
  perdita: "Perdita del monitor",
  non_classificato: "Non classificato",
};

export interface ReasonRow {
  reason: ExclusionReason;
  label: string;
  description: string;
  count: number;
  kind: ReasonKind;
}

export interface CoverageView {
  /** true quando nessun giro strumentato è disponibile */
  measured: boolean;
  /** frase da mostrare quando non c'è misura */
  notMeasuredLabel: string;
  runId: number | null;
  measuredAt: string | null;
  /** righe partita viste sull'elenco, tutti gli sport */
  seen: number;
  /** righe di calcio: il denominatore di cui rispondiamo */
  football: number;
  imported: number;
  /** numero assoluto: più onesto della percentuale su campioni piccoli */
  lost: number;
  /** percentuale, `null` se non calcolabile */
  coverage: number | null;
  reasons: ReasonRow[];
  /** somma dei soli motivi che sono perdite nostre */
  lossesDeclared: number;
  competitions: { competition: string; seen: number; imported: number; lost: number }[];
  notes: string[];
  /* --- profondità della serie --- */
  /** giri SCHEDULATI misurati: sono questi a fare tendenza */
  runs: number;
  /** giri chiesti a mano: contati e dichiarati, ma fuori dalla soglia */
  manualRuns: number;
  runsNeeded: number;
  seriesInsufficient: boolean;
  seriesLabel: string;
  depth: string;
  runsWithoutMeasure: number;
  /* --- runner schedulato --- */
  /** minuti al prossimo giro, `null` se il runner non è attivo o non è credibile */
  nextRunMinutes: number | null;
  /** true quando lo stato salvato non è confermato da un processo vivo */
  schedulerUncertain: boolean;
  /** stato del runner in-process in una riga; `null` se non se ne sa nulla */
  schedulerLabel: string | null;
  /* --- raccolta automatica via GitHub Actions --- */
  /**
   * Chi fa avanzare la serie quando il runner in-process è spento, letta
   * dall'archivio: cron, ora ed esito dell'ultimo giro schedulato, avviso
   * se il silenzio supera i 90 minuti. `null` solo se l'archivio non ha
   * saputo dirlo.
   */
  actions: ActionsView | null;
}

/** Frase fissa sulla serie corta. Non è un avviso, è una premessa. */
export const SERIES_INSUFFICIENT_TEXT =
  "Serie insufficiente, niente tendenza.";

const NOT_MEASURED_TEXT =
  "Non misurato: nessun giro di raccolta ha ancora registrato la copertura. Non è una copertura zero.";

/**
 * Traduce la storia della copertura in una struttura da stampare.
 *
 * @param latest bilancio dell'ultimo giro strumentato, `null` se assente
 * @param stats  statistiche della serie
 */
export function buildCoverageView(input: {
  latest: RunCoverage | null;
  latestRunId: number | null;
  latestStartedAt: string | null;
  stats: CoverageSeriesStats;
  depth: string;
  runsWithoutMeasure: number;
  /** stato del runner schedulato, se leggibile */
  scheduler?: {
    running: boolean;
    intervalMinutes: number;
    nextRunMinutes: number | null;
    /** giudizio sulla riga di stato; assente = si guarda `running` */
    health?: "running" | "off" | "uncertain";
    silentMinutes?: number | null;
  } | null;
  /**
   * Giri schedulati letti dall'archivio: l'input della riga GitHub
   * Actions. Assente o `null` = la riga non viene costruita.
   */
  actions?: { lastScheduledRun: ScheduledRun | null; now: Date } | null;
}): CoverageView {
  const { latest, stats } = input;

  const reasons: ReasonRow[] =
    latest === null
      ? []
      : (Object.keys(REASON_KIND) as ExclusionReason[]).map((reason) => ({
          reason,
          label: REASON_SHORT[reason],
          description: EXCLUSION_LABELS[reason],
          count: latest.byReason[reason],
          kind: REASON_KIND[reason],
        }));

  const lossesDeclared = reasons
    .filter((r) => r.kind === "perdita")
    .reduce((sum, r) => sum + r.count, 0);

  /* la soglia guarda i soli giri schedulati: dieci raccolte lanciate a
     mano in mezz'ora sono la stessa fotografia ripetuta, non una serie */
  const runs = stats.scheduledPoints;
  const seriesInsufficient = runs < MIN_RUNS_FOR_TREND;

  const scheduler = input.scheduler ?? null;
  /* stati vecchi senza giudizio: si ricade sul flag, come prima */
  const health =
    scheduler === null
      ? null
      : (scheduler.health ?? (scheduler.running ? "running" : "off"));
  const schedulerLabel = buildSchedulerLabel(scheduler, health);

  const actions =
    input.actions !== undefined && input.actions !== null
      ? buildActionsView(input.actions)
      : null;

  return {
    measured: latest !== null,
    notMeasuredLabel: NOT_MEASURED_TEXT,
    runId: input.latestRunId,
    measuredAt: input.latestStartedAt,
    seen: latest?.seen ?? 0,
    football: latest?.football ?? 0,
    imported: latest?.imported ?? 0,
    lost: latest?.lost ?? 0,
    coverage: latest?.coverage ?? null,
    reasons,
    lossesDeclared,
    competitions:
      latest?.byCompetition.map((c) => ({
        competition: c.competition,
        seen: c.seen,
        imported: c.imported,
        lost: c.lost,
      })) ?? [],
    notes: latest?.notes ?? [],
    runs,
    manualRuns: stats.manualPoints,
    runsNeeded: MIN_RUNS_FOR_TREND,
    seriesInsufficient,
    /* Finché la serie si costruisce si mostra il progresso verso la soglia
       (N/10). Superata la soglia il numeratore non ha senso come frazione:
       «39/10 giri» sembra una divisione sbagliata, si dice quanti giri ci sono. */
    seriesLabel: seriesInsufficient
      ? `${runs}/${MIN_RUNS_FOR_TREND} giri`
      : `${runs} giri schedulati`,
    depth: input.depth,
    runsWithoutMeasure: input.runsWithoutMeasure,
    /* un orario si dichiara solo se il runner è vivo e credibile */
    nextRunMinutes:
      health === "running" && scheduler !== null ? scheduler.nextRunMinutes : null,
    schedulerUncertain: health === "uncertain",
    schedulerLabel,
    actions,
  };
}

/**
 * La riga che descrive il runner in-process, in italiano e senza promesse
 * false.
 *
 * Dallo Sprint 9 gli stati sono due, non tre: quando il runner è spento
 * la riga non dice più «Raccolta automatica non attiva: la serie non
 * avanza da sola», perché con la raccolta delegata a GitHub Actions
 * quella frase è falsa — la serie avanza lo stesso. Spento il processo
 * locale, chi avanza la serie è descritto da `buildActionsView`
 * (`view.actions`): cron, ultimo giro schedulato letto dall'archivio,
 * avviso se tace da oltre 90 minuti.
 *
 * Restano due frasi, entrambe vere solo finché un processo vivo le
 * sostiene: il conto alla rovescia del runner acceso, e lo stato incerto
 * — quando la riga salvata non è più credibile non si scrive né un
 * orario né un rassicurante «non attiva», perché nessuna delle due è
 * verificata.
 */
function buildSchedulerLabel(
  scheduler: {
    intervalMinutes: number;
    nextRunMinutes: number | null;
    silentMinutes?: number | null;
  } | null,
  health: "running" | "off" | "uncertain" | null,
): string | null {
  if (scheduler === null || health === null) return null;

  /* runner spento: nessuna riga del processo locale. La raccolta
     automatica si racconta con i fatti dell'archivio (view.actions),
     non con lo stato interno di questo processo */
  if (health === "off") return null;

  if (health === "uncertain") {
    const silent =
      typeof scheduler.silentMinutes === "number"
        ? ` Nessun segno di vita da ${formatSilence(scheduler.silentMinutes)}.`
        : "";
    return `Stato incerto: l'ultimo stato salvato dice raccolta attiva ogni ${scheduler.intervalMinutes} minuti, ma non è confermato da questo processo.${silent} Riavviare per ripartire con certezza.`;
  }

  if (scheduler.nextRunMinutes === null) {
    return `Raccolta automatica attiva ogni ${scheduler.intervalMinutes} minuti.`;
  }
  if (scheduler.nextRunMinutes === 0) {
    return `Raccolta automatica ogni ${scheduler.intervalMinutes} minuti: prossimo giro a momenti.`;
  }
  return `Raccolta automatica ogni ${scheduler.intervalMinutes} minuti: prossimo giro fra ${scheduler.nextRunMinutes} min.`;
}

/** Silenzio in forma leggibile: minuti sotto l'ora, poi ore. */
function formatSilence(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} g`;
}

/**
 * Percentuale di copertura come testo.
 *
 * Restituisce la dicitura di assenza quando non c'è misura: il chiamante
 * non deve poter stampare "0%" per sbaglio.
 */
export function coverageLabel(coverage: number | null): string {
  if (coverage === null) return "non misurato";
  return `${(coverage * 100).toFixed(1)}%`;
}
