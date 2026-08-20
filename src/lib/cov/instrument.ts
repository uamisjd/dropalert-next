/**
 * Strumentazione della copertura per singolo giro di raccolta (Sprint 6B).
 *
 * Funzioni PURE: ricevono ciò che il giro ha visto e ciò che ha scritto,
 * e restituiscono il bilancio da salvare in `collector_runs.meta`.
 *
 * Il punto di questo modulo è chiudere il conto. Finora sapevamo quante
 * partite erano state importate, ma non quante ne erano passate davanti:
 * la differenza fra "visto" e "importato" si poteva ricostruire solo
 * dall'esterno. Da qui in avanti ogni riga dell'elenco esce dal giro con
 * un'etichetta, e la somma delle etichette deve tornare.
 *
 * Regole, identiche a quelle di 6A:
 *   • nessun valore viene dedotto: se una riga non rientra in un motivo
 *     noto, il motivo è `altro` e resta dichiarato;
 *   • il frammento grezzo accompagna ogni esclusione, quando esiste;
 *   • le fixture dimostrative non entrano nel conteggio utile e non
 *     vengono nemmeno nascoste: hanno una voce propria.
 */
import { compressFragment, type SourceScan } from "./scan";
import {
  EXCLUSION_CODES,
  type ExclusionCode,
} from "@/lib/providers/exclusion-codes";

/* ------------------------------------------------------------------ */
/* Motivi di esclusione                                                */
/* ------------------------------------------------------------------ */

/**
 * Perché una riga vista non è diventata un dato utile.
 * L'elenco è chiuso: aggiungerne uno è una decisione, non un dettaglio.
 */
export const EXCLUSION_REASONS = [
  "sport",
  "demo",
  "no_odds",
  "not_reached",
  "robots",
  "our_choice",
  "altro",
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  sport: "Riga di un altro sport: fuori dal perimetro del monitor",
  demo: "Fixture dimostrativa o di test: esclusa dal conteggio utile",
  no_odds: "Riga di calcio senza quote leggibili",
  not_reached: "Leggibile e non raggiunta dal giro di raccolta",
  robots: "Dato non pubblicato entro il robots.txt della fonte",
  our_choice:
    "Esclusa da una nostra scelta di configurazione: fuori finestra o oltre il tetto per giro",
  altro: "Dichiarato: non riconducibile ai motivi previsti",
};

/* ------------------------------------------------------------------ */
/* Origine del giro                                                    */
/* ------------------------------------------------------------------ */

/**
 * Chi ha chiesto il giro.
 *
 * Serve a una cosa sola: contare la profondità della serie sui soli giri
 * **schedulati**. Dieci raccolte lanciate a mano nel giro di mezz'ora non
 * sono dieci osservazioni: sono la stessa fotografia ripetuta. La soglia
 * di leggibilità vale sui giri che il sistema ha fatto da solo, a
 * intervallo regolare.
 */
export const RUN_TRIGGERS = ["scheduled", "manual"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/**
 * Legge l'origine dichiarata da un run salvato.
 *
 * Un run che non dichiara nulla NON viene promosso a schedulato: i giri
 * precedenti a questo sprint erano manuali, e assumere il contrario
 * gonfierebbe la profondità della serie con osservazioni che non ci sono
 * state. Assenza di dichiarazione = `manual`.
 */
export function triggerOfRun(meta: unknown): RunTrigger {
  if (typeof meta !== "object" || meta === null) return "manual";
  const raw = (meta as { trigger?: unknown }).trigger;
  return raw === "scheduled" ? "scheduled" : "manual";
}

/** Una riga esclusa, con il motivo e la prova. */
export interface ExclusionEntry {
  /** identificativo della riga sulla fonte, `null` se non pertinente */
  ref: string | null;
  reason: ExclusionReason;
  /** competizione come "paese/lega", oppure `null` se non ricavabile */
  competition: string | null;
  detail: string;
  /** frammento grezzo osservato. Mai ricostruito. */
  evidence: string | null;
}

/* ------------------------------------------------------------------ */
/* Bilancio del giro                                                   */
/* ------------------------------------------------------------------ */

/** Conteggi per competizione all'interno di un singolo giro. */
export interface CompetitionTally {
  competition: string;
  seen: number;
  worked: number;
  imported: number;
  lost: number;
}

export interface RunCoverage {
  /** versione del formato: i consumatori devono poterlo riconoscere */
  version: 1;
  measuredAt: string;
  /** righe partita viste sulla fonte, tutti gli sport compresi */
  seen: number;
  /** righe di calcio: la popolazione di cui siamo responsabili */
  football: number;
  /** righe di calcio che il giro ha effettivamente lavorato */
  worked: number;
  /** partite scritte o aggiornate in anagrafica */
  imported: number;
  /** righe di calcio non diventate dato utile */
  lost: number;
  /** copertura sul calcio, `null` se non c'è nulla da coprire */
  coverage: number | null;
  byReason: Record<ExclusionReason, number>;
  byCompetition: CompetitionTally[];
  exclusions: ExclusionEntry[];
  /** limiti dichiarati di questa misura */
  notes: string[];
}

export interface RunCoverageInput {
  /** conteggio grezzo delle righe dell'elenco */
  scan: SourceScan;
  /** id delle righe che il parser dell'adapter ha accettato */
  parsedIds: Set<string>;
  /** motivo dichiarato dal parser o dall'adapter, per riga scartata */
  problemsByRef: Map<string, ExclusionNote>;
  /** id delle partite che il giro ha lavorato (upsert riuscito) */
  importedIds: Set<string>;
  /** id delle partite per cui è stata scritta almeno una quota */
  withOddsIds: Set<string>;
  /**
   * true se nessuna fonte attiva pubblica le quote per singolo bookmaker.
   * Non è una deduzione: è la capacità dichiarata dagli adapter accesi.
   */
  perBookmakerUnavailable: boolean;
  /** partite dimostrative o di test presenti in archivio, escluse dal conteggio */
  nonRealMatches: number;
  measuredAt: Date;
  /**
   * Righe per cui il giro ha già fatto il secondo e ultimo tentativo.
   * Non cambia il conteggio: cambia solo ciò che l'esclusione dichiara di
   * sé. Una riga ritentata e ancora mancante è un fatto diverso da una
   * riga vista una volta sola, e va detto.
   */
  retriedRefs?: Set<string>;
}

/** Motivo dichiarato da chi ha scartato la riga. */
export interface ExclusionNote {
  /** `null` quando il messaggio non era marcato con un codice */
  code: ExclusionCode | null;
  explanation: string;
}

/**
 * Traduce il codice dichiarato dall'adapter nel motivo di esclusione.
 *
 * Un codice assente NON diventa un motivo plausibile: diventa `altro`.
 * È la differenza fra registrare un fatto e riempire una casella.
 */
export function reasonForCode(code: ExclusionCode | null): ExclusionReason {
  switch (code) {
    case EXCLUSION_CODES.PAGE_UNREACHABLE:
      return "not_reached";
    case EXCLUSION_CODES.KICKOFF_MISSING:
      return "no_odds";
    case EXCLUSION_CODES.UNREADABLE_ROW:
      return "no_odds";
    /* Fuori finestra e tetto per giro non sono difetti né limiti della
       fonte: sono due nostre impostazioni (COLLECT_HORIZON_HOURS e
       COLLECT_MAX_FIXTURES) che funzionano come previsto. Contarle fra le
       cause ignote gonfiava "altro" e faceva sembrare cieco un giro che
       invece stava obbedendo alla configurazione. */
    case EXCLUSION_CODES.OUT_OF_WINDOW:
      return "our_choice";
    case EXCLUSION_CODES.RUN_CAP:
      return "our_choice";
    /* `null` = nessun codice dichiarato. Resta "altro": è l'unico caso in
       cui davvero non sappiamo, e va continuato a dichiarare come tale. */
    default:
      return "altro";
  }
}

/** Conteggio vuoto dei motivi, per non dover ricordare le sei chiavi. */
export function emptyReasonCounts(): Record<ExclusionReason, number> {
  return {
    sport: 0,
    demo: 0,
    no_odds: 0,
    not_reached: 0,
    robots: 0,
    our_choice: 0,
    altro: 0,
  };
}

/**
 * Chiude il conto di un giro di raccolta.
 *
 * Invariante che questa funzione garantisce:
 *   football = imported + lost
 * e ogni unità di `lost` ha una riga in `exclusions`. Se il conto non
 * torna, il residuo finisce in `altro` con la differenza dichiarata:
 * meglio un residuo visibile che un totale che quadra per costruzione.
 */
export function buildRunCoverage(input: RunCoverageInput): RunCoverage {
  const exclusions: ExclusionEntry[] = [];
  const byReason = emptyReasonCounts();
  const notes: string[] = [];

  const add = (entry: ExclusionEntry): void => {
    exclusions.push(entry);
    byReason[entry.reason] += 1;
  };

  /* --- righe di altri sport: viste, fuori perimetro ---------------- */
  const otherSports = input.scan.unlinkedRows;
  if (otherSports > 0) {
    byReason.sport += otherSports;
    /* si conservano solo i campioni già raccolti: non si inventa una
       riga per ognuna, si dichiara quante sono */
    for (const sample of input.scan.unlinkedSamples) {
      exclusions.push({
        ref: null,
        reason: "sport",
        competition: null,
        detail: "Riga di un altro sport nell'elenco drop.",
        evidence: compressFragment(sample, 200),
      });
    }
    notes.push(
      `${otherSports} righe di altri sport viste nell'elenco; ne sono conservati ${input.scan.unlinkedSamples.length} frammenti come campione.`,
    );
  }

  /* --- righe di calcio: una per una -------------------------------- */
  const tallies = new Map<string, CompetitionTally>();
  const tallyOf = (competition: string): CompetitionTally => {
    let t = tallies.get(competition);
    if (!t) {
      t = { competition, seen: 0, worked: 0, imported: 0, lost: 0 };
      tallies.set(competition, t);
    }
    return t;
  };

  let imported = 0;
  let worked = 0;

  for (const row of input.scan.rows) {
    const tally = tallyOf(row.leaguePath);
    tally.seen += 1;

    const wasParsed = input.parsedIds.has(row.providerMatchId);
    const wasImported = input.importedIds.has(row.providerMatchId);
    const hasOdds = input.withOddsIds.has(row.providerMatchId);

    if (wasParsed) {
      worked += 1;
      tally.worked += 1;
    }

    if (wasImported && hasOdds) {
      imported += 1;
      tally.imported += 1;
      continue;
    }

    tally.lost += 1;

    if (wasImported) {
      add({
        ref: row.providerMatchId,
        reason: "no_odds",
        competition: row.leaguePath,
        detail:
          "Partita scritta in anagrafica ma senza alcuna quota registrata in questo giro.",
        evidence: row.rawFragment,
      });
      continue;
    }

    /* la riga è uscita: il motivo lo dichiara chi l'ha scartata, non lo
       indoviniamo qui */
    const note = input.problemsByRef.get(row.providerMatchId) ?? null;

    if (note !== null) {
      add({
        ref: row.providerMatchId,
        reason: reasonForCode(note.code),
        competition: row.leaguePath,
        detail: note.explanation,
        evidence: row.rawFragment,
      });
      continue;
    }

    if (!wasParsed) {
      add({
        ref: row.providerMatchId,
        reason: "altro",
        competition: row.leaguePath,
        detail:
          "Riga presente nell'elenco e scartata prima dell'ingestione, senza motivo registrato. Dichiarata, non attribuita.",
        evidence: row.rawFragment,
      });
      continue;
    }

    /* letta, valida, nessuno ha dichiarato di averla scartata, e comunque
       non è arrivata: è la perdita che interessa davvero. Resta
       etichettata, non corretta. */
    const retried = input.retriedRefs?.has(row.providerMatchId) ?? false;
    add({
      ref: row.providerMatchId,
      reason: "not_reached",
      competition: row.leaguePath,
      detail: retried
        ? "Riga leggibile e non raggiunta, ritentata una volta dopo 60 secondi e ancora mancante. Etichetta finale del giro: causa non determinata, nessuna correzione applicata."
        : "Riga leggibile e non raggiunta dal giro di raccolta, senza motivo dichiarato da nessuna fase. Causa non ancora determinata: etichettata, non corretta.",
      evidence: row.rawFragment,
    });
  }

  /* --- limiti strutturali, non perdite del giro -------------------- */
  if (input.perBookmakerUnavailable && imported > 0) {
    byReason.robots += imported;
    notes.push(
      `Per tutte le ${imported} partite importate manca la quota per singolo bookmaker: non è pubblicata entro il robots.txt della fonte. È un limite dichiarato, non una perdita del giro.`,
    );
  }

  if (input.nonRealMatches > 0) {
    byReason.demo += input.nonRealMatches;
    notes.push(
      `${input.nonRealMatches} partite dimostrative o di test presenti in archivio restano fuori dal conteggio utile.`,
    );
  }

  /* --- quadratura ------------------------------------------------- */
  const football = input.scan.footballRows;
  const lost = football - imported;
  /* ogni riga di calcio non importata produce esattamente una voce
     riferita alla riga stessa (`ref` valorizzato), qualunque sia il
     motivo: se i due numeri non coincidono manca una spiegazione */
  const labelled = exclusions.filter((e) => e.ref !== null).length;

  if (lost !== labelled) {
    const residual = lost - labelled;
    byReason.altro += Math.abs(residual);
    exclusions.push({
      ref: null,
      reason: "altro",
      competition: null,
      detail: `Il conto non torna: ${football} righe di calcio, ${imported} importate, ${labelled} esclusioni etichettate. Residuo dichiarato: ${residual}.`,
      evidence: null,
    });
    notes.push(
      "Residuo non attribuito presente: la somma delle etichette non copre la differenza fra viste e importate.",
    );
  }

  if (football < 20) {
    notes.push(
      `Campione piccolo: ${football} righe di calcio in questo giro. Le percentuali sono fragili e non vanno lette come tendenza.`,
    );
  }

  const byCompetition = [...tallies.values()].sort(
    (a, b) => b.lost - a.lost || b.seen - a.seen || a.competition.localeCompare(b.competition),
  );

  return {
    version: 1,
    measuredAt: input.measuredAt.toISOString(),
    seen: input.scan.fixtureRows,
    football,
    worked,
    imported,
    lost,
    coverage: football === 0 ? null : imported / football,
    byReason,
    byCompetition,
    exclusions,
    notes,
  };
}

/* ------------------------------------------------------------------ */
/* Selezione delle righe da ritentare                                  */
/* ------------------------------------------------------------------ */

/**
 * Righe che, se il giro finisse adesso, uscirebbero come `not_reached`.
 *
 * Riproduce **esattamente** le condizioni del ramo `not_reached` di
 * `buildRunCoverage`: letta dal parser, non importata, e nessuna fase ha
 * dichiarato di averla scartata. Se le due logiche divergessero, il giro
 * ritenterebbe righe diverse da quelle che poi etichetta — per questo un
 * test le confronta riga per riga.
 *
 * Non include `no_odds`: quella riga è stata raggiunta, la fonte non
 * pubblicava la quota. Ritentarla sarebbe insistere su un'assenza
 * dichiarata dalla fonte, non recuperare una nostra mancanza.
 */
export function selectRetryTargets(input: {
  scan: SourceScan;
  parsedIds: Set<string>;
  problemsByRef: Map<string, ExclusionNote>;
  importedIds: Set<string>;
  withOddsIds: Set<string>;
}): string[] {
  const targets: string[] = [];

  for (const row of input.scan.rows) {
    const ref = row.providerMatchId;
    if (input.importedIds.has(ref) && input.withOddsIds.has(ref)) continue;
    if (input.importedIds.has(ref)) continue; /* → no_odds */
    if (input.problemsByRef.has(ref)) continue; /* motivo già dichiarato */
    if (!input.parsedIds.has(ref)) continue; /* → altro */
    targets.push(ref);
  }

  return targets;
}

/* ------------------------------------------------------------------ */
/* Lettura della serie storica                                         */
/* ------------------------------------------------------------------ */

/** Soglia sotto la quale la copertura non va letta come tendenza. */
export const MIN_RUNS_FOR_TREND = 10;

/** Un punto della serie storica, ricavato da un run salvato. */
export interface CoveragePoint {
  runId: number;
  startedAt: string;
  status: string;
  football: number;
  imported: number;
  lost: number;
  coverage: number | null;
  byReason: Record<ExclusionReason, number>;
  /** chi ha chiesto il giro: solo gli schedulati fanno profondità */
  trigger: RunTrigger;
}

/**
 * Estrae il bilancio da un `meta` salvato.
 * Restituisce `null` se il run non è strumentato: i run precedenti a
 * questo sprint non hanno la sezione, e vanno mostrati come non misurati
 * invece che come copertura zero.
 */
export function coverageOfRun(
  runId: number,
  startedAt: Date,
  status: string,
  meta: unknown,
): CoveragePoint | null {
  if (typeof meta !== "object" || meta === null) return null;
  const coverage = (meta as { coverage?: unknown }).coverage;
  if (typeof coverage !== "object" || coverage === null) return null;

  const c = coverage as Partial<RunCoverage>;
  if (typeof c.football !== "number" || typeof c.imported !== "number") {
    return null;
  }

  return {
    runId,
    startedAt: startedAt.toISOString(),
    status,
    football: c.football,
    imported: c.imported,
    lost: typeof c.lost === "number" ? c.lost : c.football - c.imported,
    coverage: typeof c.coverage === "number" ? c.coverage : null,
    byReason: { ...emptyReasonCounts(), ...(c.byReason ?? {}) },
    trigger: triggerOfRun(meta),
  };
}

export interface CoverageSeriesStats {
  points: number;
  /** punti prodotti da giri schedulati: sono questi a fare profondità */
  scheduledPoints: number;
  /** punti prodotti da giri chiesti a mano: contati, ma non fanno serie */
  manualPoints: number;
  /** media semplice delle coperture misurate */
  meanCoverage: number | null;
  minCoverage: number | null;
  maxCoverage: number | null;
  totalFootball: number;
  totalImported: number;
  totalLost: number;
  /** copertura complessiva sul totale delle righe, non media di medie */
  pooledCoverage: number | null;
  byReason: Record<ExclusionReason, number>;
  /**
   * true finché i giri **schedulati** sono meno di `MIN_RUNS_FOR_TREND`.
   * I giri manuali restano nei totali ma non sbloccano la tendenza.
   */
  inconclusive: boolean;
  firstAt: string | null;
  lastAt: string | null;
  /** durata dell'osservazione in ore, `null` con meno di due punti */
  spanHours: number | null;
}

/**
 * Statistiche della serie storica.
 *
 * Volutamente conservativa: sotto `MIN_RUNS_FOR_TREND` punti la serie è
 * marcata come non concludente. Una copertura del 78% misurata due volte
 * non è una tendenza, è un aneddoto con una percentuale davanti.
 */
export function coverageSeriesStats(points: CoveragePoint[]): CoverageSeriesStats {
  const byReason = emptyReasonCounts();
  const empty: CoverageSeriesStats = {
    points: 0,
    scheduledPoints: 0,
    manualPoints: 0,
    meanCoverage: null,
    minCoverage: null,
    maxCoverage: null,
    totalFootball: 0,
    totalImported: 0,
    totalLost: 0,
    pooledCoverage: null,
    byReason,
    inconclusive: true,
    firstAt: null,
    lastAt: null,
    spanHours: null,
  };

  if (points.length === 0) return empty;

  const sorted = [...points].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const measured = sorted.filter((p) => p.coverage !== null);

  let totalFootball = 0;
  let totalImported = 0;
  let totalLost = 0;
  for (const p of sorted) {
    totalFootball += p.football;
    totalImported += p.imported;
    totalLost += p.lost;
    for (const r of EXCLUSION_REASONS) byReason[r] += p.byReason[r] ?? 0;
  }

  const values = measured.map((p) => p.coverage as number);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const spanMs =
    sorted.length < 2
      ? null
      : new Date(last.startedAt).getTime() - new Date(first.startedAt).getTime();

  const scheduledPoints = sorted.filter((p) => p.trigger === "scheduled").length;

  return {
    points: sorted.length,
    scheduledPoints,
    manualPoints: sorted.length - scheduledPoints,
    meanCoverage:
      values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length,
    minCoverage: values.length === 0 ? null : Math.min(...values),
    maxCoverage: values.length === 0 ? null : Math.max(...values),
    totalFootball,
    totalImported,
    totalLost,
    pooledCoverage: totalFootball === 0 ? null : totalImported / totalFootball,
    byReason,
    /* la soglia si conta sui giri schedulati, non sul totale */
    inconclusive: scheduledPoints < MIN_RUNS_FOR_TREND,
    firstAt: first.startedAt,
    lastAt: last.startedAt,
    spanHours: spanMs === null ? null : spanMs / 3_600_000,
  };
}

/** Frase che dichiara la profondità dell'osservazione, senza gonfiarla. */
export function describeSeriesDepth(stats: CoverageSeriesStats): string {
  if (stats.points === 0) {
    return "Nessun giro strumentato finora: la serie storica inizia dal prossimo.";
  }
  if (stats.points === 1) {
    return "Un solo giro strumentato: è una fotografia, non una serie.";
  }
  const hours =
    stats.spanHours === null
      ? "un intervallo non calcolabile"
      : stats.spanHours < 1
        ? `${Math.round(stats.spanHours * 60)} minuti`
        : `${stats.spanHours.toFixed(1)} ore`;

  const base = `Osservazione iniziata da ${hours}, su ${stats.points} giri`;
  const split =
    stats.manualPoints === 0
      ? "."
      : ` (${stats.scheduledPoints} schedulati, ${stats.manualPoints} chiesti a mano).`;

  return stats.inconclusive
    ? `${base}${split} Sotto i ${MIN_RUNS_FOR_TREND} giri schedulati la copertura non va letta come tendenza.`
    : `${base}${split}`;
}
