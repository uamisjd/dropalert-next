/**
 * Misura della copertura — funzioni PURE (Sprint 6A, ricostruito in 6B).
 *
 * Confronta ciò che la fonte pubblica con ciò che è arrivato in archivio e
 * attribuisce una causa a ogni buco. Qui non si fa I/O: né rete, né database,
 * né orologio. Tutto ciò che serve arriva dagli argomenti, così la misura è
 * verificabile con test deterministici.
 *
 * Regola che governa tutto il file: **nessuna causa viene dedotta**. Se un
 * fatto non è stato constatato, la classificazione lo dichiara non verificato
 * invece di scegliere la spiegazione più probabile.
 *
 * NOTA DI COLLOCAZIONE: questo modulo viveva in `src/lib/coverage/`. Le
 * directory chiamate `coverage` sono escluse dagli snapshot dell'ambiente
 * (nome riservato ai report di copertura dei test) e il file è andato perso.
 * Da qui in avanti sta in `src/lib/cov/`.
 */

/* ------------------------------------------------------------------ */
/* Cause                                                               */
/* ------------------------------------------------------------------ */

/** Le quattro cause possibili. L'elenco è chiuso per scelta. */
export const GAP_CAUSES = [
  "SOURCE_MISSING",
  "ENTRY_MISSED",
  "MATCH_FAILED",
  "OTHER",
] as const;

export type GapCause = (typeof GAP_CAUSES)[number];

export const GAP_CAUSE_LABELS: Record<GapCause, string> = {
  SOURCE_MISSING: "La fonte non pubblica il dato",
  ENTRY_MISSED: "La fonte lo pubblica, il nostro giro non lo ha preso",
  MATCH_FAILED: "Letto ma non agganciato: lettura o aggancio fallito",
  OTHER: "Dichiarato: non attribuibile con i fatti disponibili",
};

/** Esito della classificazione di un singolo elemento. */
export interface GapClassification {
  cause: GapCause;
  /** sotto-motivo constatato, in maiuscolo */
  code: string;
  detail: string;
  /** prova grezza osservata; `null` quando non ne esiste una */
  evidence: string | null;
}

/* ------------------------------------------------------------------ */
/* Utilità                                                             */
/* ------------------------------------------------------------------ */

/**
 * Riduce un frammento grezzo a una riga leggibile, senza riscriverlo.
 * Comprime gli spazi e taglia in coda: il testo resta quello osservato.
 */
export function compressFragment(
  input: string | null | undefined,
  maxLength = 300,
): string | null {
  if (typeof input !== "string") return null;
  const compact = input.replace(/\s+/g, " ").trim();
  if (compact === "") return null;
  return compact.length <= maxLength
    ? compact
    : `${compact.slice(0, Math.max(0, maxLength - 1))}…`;
}

/**
 * Distingue una partita reale da una dimostrativa o di test.
 * La convenzione è quella del progetto: reale = `be-<providerMatchId>`.
 */
export function isRealFixtureKey(key: string | null | undefined): boolean {
  return typeof key === "string" && key.startsWith("be-");
}

/* ------------------------------------------------------------------ */
/* Conteggio grezzo delle righe della fonte                            */
/* ------------------------------------------------------------------ */

export interface SourceRowScan {
  providerMatchId: string;
  sourceUrl: string;
  countrySlug: string;
  leagueSlug: string;
  /** "paese/lega": chiave di raggruppamento per competizione */
  leaguePath: string;
  /** la riga come è arrivata, compressa. Serve da prova. */
  rawFragment: string;
}

export interface SourceScan {
  rows: SourceRowScan[];
  /** tutte le <tr> del documento, comprese intestazioni e date */
  totalRows: number;
  /** righe che rappresentano una partita, di qualunque sport */
  fixtureRows: number;
  /** righe partita che sono di calcio */
  footballRows: number;
  /** righe partita senza link di calcio: altro sport, oppure markup cambiato */
  unlinkedRows: number;
  /** campioni grezzi delle righe senza link, per ispezione umana */
  unlinkedSamples: string[];
}

/** Quanti campioni di righe non riconosciute conservare. */
const UNLINKED_SAMPLE_LIMIT = 6;

/**
 * Riconta le righe dell'elenco drop in modo grezzo.
 *
 * È una lettura **deliberatamente più permissiva** di quella dell'adapter:
 * il parser di produzione scarta le righe che non riesce a usare, e quelle
 * righe sono esattamente ciò che questa misura deve contare. Le due letture
 * restano separate apposta — se un giorno divergono, il confronto fra
 * `footballRows` e le fixture accettate lo rende visibile invece di
 * nasconderlo.
 */
export function scanSourceRows(html: string): SourceScan {
  const empty: SourceScan = {
    rows: [],
    totalRows: 0,
    fixtureRows: 0,
    footballRows: 0,
    unlinkedRows: 0,
    unlinkedSamples: [],
  };

  if (typeof html !== "string" || html.trim() === "") return empty;

  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g);
  if (!trs || trs.length === 0) return empty;

  const rows: SourceRowScan[] = [];
  const unlinkedSamples: string[] = [];
  let fixtureRows = 0;
  let unlinkedRows = 0;

  for (const tr of trs) {
    /* `table-main__tt` marca la riga di una partita, in ogni sport */
    if (!tr.includes("table-main__tt")) continue;
    fixtureRows += 1;

    const link =
      /<a href="(\/football\/([^/"]+)\/([^/"]+)\/([^/"]+)\/([^/"]+)\/)"/.exec(tr);

    if (!link) {
      unlinkedRows += 1;
      if (unlinkedSamples.length < UNLINKED_SAMPLE_LIMIT) {
        const sample = compressFragment(stripMarkup(tr), 200);
        if (sample) unlinkedSamples.push(sample);
      }
      continue;
    }

    const [, url, countrySlug, leagueSlug, , providerMatchId] = link;
    rows.push({
      providerMatchId,
      sourceUrl: url,
      countrySlug,
      leagueSlug,
      leaguePath: `${countrySlug}/${leagueSlug}`,
      rawFragment: compressFragment(stripMarkup(tr), 300) ?? "",
    });
  }

  return {
    rows,
    totalRows: trs.length,
    fixtureRows,
    footballRows: rows.length,
    unlinkedRows,
    unlinkedSamples,
  };
}

/** Toglie i tag lasciando il testo: serve solo a rendere leggibile la prova. */
function stripMarkup(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/* ------------------------------------------------------------------ */
/* Classificazione di un buco già registrato                           */
/* ------------------------------------------------------------------ */

export interface DataGapInput {
  id: number;
  reason: string;
  detail: string | null;
  matchKey: string | null;
  market: string | null;
  /** true se nessuna fonte attiva pubblica le quote per singolo bookmaker */
  perBookmakerUnavailable: boolean;
}

/**
 * Attribuisce una causa a un buco già salvato in archivio.
 *
 * Si basa solo su due fatti constatabili: il motivo registrato al momento
 * dell'apertura, e le capacità dichiarate dalle fonti attive. Quando questi
 * due non bastano, l'esito è `OTHER` — mai una supposizione travestita da
 * classificazione.
 */
export function classifyDataGap(gap: DataGapInput): GapClassification {
  const evidence = compressFragment(gap.detail);

  /* i buchi delle fixture dimostrative non misurano la copertura */
  if (gap.matchKey !== null && !isRealFixtureKey(gap.matchKey)) {
    return {
      cause: "OTHER",
      code: "NON_REAL_FIXTURE",
      detail:
        "Buco appartenente a una fixture dimostrativa o di test: escluso dal conteggio utile, non nascosto.",
      evidence,
    };
  }

  switch (gap.reason) {
    case "bookmaker_missing":
      return gap.perBookmakerUnavailable
        ? {
            cause: "SOURCE_MISSING",
            code: "PER_BOOK_NOT_PUBLISHED",
            detail:
              "Nessuna fonte attiva pubblica le quote per singolo bookmaker: il dato non è mai stato disponibile da prendere.",
            evidence,
          }
        : {
            cause: "OTHER",
            code: "BOOKMAKER_MISSING_UNEXPLAINED",
            detail:
              "Manca un bookmaker mentre una fonte attiva dichiara di pubblicare il per-book: la causa non è constatabile da qui.",
            evidence,
          };

    case "market_not_offered":
      return {
        cause: "SOURCE_MISSING",
        code: "MARKET_NOT_OFFERED",
        detail: "La fonte non offre questo mercato per questa partita.",
        evidence,
      };

    case "provider_unavailable":
      return {
        cause: "ENTRY_MISSED",
        code: "PROVIDER_UNAVAILABLE",
        detail:
          "La fonte non ha risposto durante il giro: il dato poteva esserci e non è stato preso.",
        evidence,
      };

    case "rate_limited":
      return {
        cause: "ENTRY_MISSED",
        code: "RATE_LIMITED",
        detail:
          "Giro rallentato dal limite di richieste: dato non raggiunto in tempo, per nostra scelta di cortesia.",
        evidence,
      };

    case "parse_error":
      return {
        cause: "MATCH_FAILED",
        code: "PARSE_ERROR",
        detail:
          "Contenuto letto ma non interpretabile: nessun valore è stato dedotto al suo posto.",
        evidence,
      };

    case "stale_snapshot":
      return {
        cause: "OTHER",
        code: "STALE_SNAPSHOT",
        detail:
          "Ultima quota troppo vecchia per essere considerata attuale: non è una riga persa, è un dato invecchiato.",
        evidence,
      };

    default:
      return {
        cause: "OTHER",
        code: "UNKNOWN_REASON",
        detail: `Motivo registrato non previsto dalla classificazione: "${gap.reason}".`,
        evidence,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Classificazione di una riga vista sulla fonte                       */
/* ------------------------------------------------------------------ */

/**
 * Esito dell'apertura facoltativa della pagina partita.
 * `not_probed` è il valore predefinito: senza verifica non si conclude nulla.
 */
export type ProbeOutcome =
  | { kind: "not_probed" }
  | { kind: "page_unreachable"; message: string }
  | { kind: "kickoff_missing" }
  | { kind: "kickoff_read"; kickoffAt: Date };

export interface SourceRowVerdict {
  providerMatchId: string;
  leaguePath: string;
  /** presente in archivio come partita reale */
  imported: boolean;
  /** ha almeno una quota registrata */
  hasSeries: boolean;
  /** `null` quando la riga è coperta: nessuna causa da attribuire */
  classification: GapClassification | null;
}

export interface ClassifySourceRowInput {
  row: SourceRowScan;
  /** il parser di produzione ha accettato questa riga */
  parsed: boolean;
  /** motivo dichiarato dal parser, se l'ha scartata */
  parseProblem: string | null;
  inDb: boolean;
  snapshots: number;
  probe: ProbeOutcome;
  /** finestra temporale interrogata dal giro di raccolta */
  window: { from: Date; to: Date };
}

/**
 * Stabilisce che fine ha fatto una riga vista sulla fonte.
 *
 * L'ordine dei controlli non è casuale: prima i fatti che spiegano da soli
 * l'assenza (parser che scarta, pagina irraggiungibile, orario illeggibile,
 * partita fuori finestra), poi — solo se nessuno di questi si applica — la
 * constatazione che la riga era prendibile e non è stata presa.
 */
export function classifySourceRow(
  input: ClassifySourceRowInput,
): SourceRowVerdict {
  const { row, probe } = input;
  const base = {
    providerMatchId: row.providerMatchId,
    leaguePath: row.leaguePath,
    imported: input.inDb,
    hasSeries: input.snapshots > 0,
  };

  /* importata e con serie: nulla da spiegare */
  if (input.inDb && input.snapshots > 0) {
    return { ...base, classification: null };
  }

  /* in anagrafica ma senza nemmeno una quota */
  if (input.inDb) {
    return {
      ...base,
      classification: {
        cause: "SOURCE_MISSING",
        code: "NO_QUOTES_ON_ROW",
        detail:
          "Partita presente in archivio ma senza alcuna quota: la riga della fonte non ne esponeva di leggibili.",
        evidence: row.rawFragment,
      },
    };
  }

  /* scartata dal parser, con motivo dichiarato: è lettura fallita */
  if (!input.parsed) {
    return {
      ...base,
      classification: {
        cause: "MATCH_FAILED",
        code: "PARSER_REJECTED",
        detail:
          input.parseProblem ??
          "Riga scartata dal parser senza motivo registrato.",
        evidence: row.rawFragment,
      },
    };
  }

  /* da qui in poi: riga che il parser accetterebbe, e che non è arrivata */

  switch (probe.kind) {
    case "page_unreachable":
      return {
        ...base,
        classification: {
          cause: "SOURCE_MISSING",
          code: "PAGE_UNREACHABLE",
          detail: `Pagina della partita non raggiungibile in verifica: ${probe.message}.`,
          evidence: row.rawFragment,
        },
      };

    case "kickoff_missing":
      return {
        ...base,
        classification: {
          cause: "MATCH_FAILED",
          code: "KICKOFF_UNREADABLE",
          detail:
            "Pagina raggiunta ma orario di inizio assente o senza fuso: nessun orario è stato dedotto.",
          evidence: row.rawFragment,
        },
      };

    case "kickoff_read": {
      const t = probe.kickoffAt.getTime();
      if (t < input.window.from.getTime() || t > input.window.to.getTime()) {
        return {
          ...base,
          classification: {
            cause: "OTHER",
            code: "OUT_OF_WINDOW",
            detail:
              "Partita fuori dalla finestra interrogata: correttamente non raccolta.",
            evidence: row.rawFragment,
          },
        };
      }
      return {
        ...base,
        classification: {
          cause: "ENTRY_MISSED",
          code: "NOT_REACHED",
          detail:
            "Riga leggibile, orario valido e dentro la finestra: la fonte la mostra, il nostro giro non l'ha presa.",
          evidence: row.rawFragment,
        },
      };
    }

    case "not_probed":
    default:
      return {
        ...base,
        classification: {
          cause: "OTHER",
          code: "NOT_VERIFIED",
          detail:
            "Riga leggibile e non importata, causa non verificata: la pagina della partita non è stata aperta.",
          evidence: row.rawFragment,
        },
      };
  }
}

/* ------------------------------------------------------------------ */
/* Aggregazione per competizione                                       */
/* ------------------------------------------------------------------ */

export interface CompetitionRow {
  leaguePath: string;
  label: string;
  onSource: number;
  imported: number;
  importedWithSeries: number;
  missed: number;
  /** importate meno viste: negativo quando perdiamo righe */
  delta: number;
}

/**
 * Raggruppa i verdetti per competizione.
 * Ordina per perdita decrescente: in cima ciò su cui si può intervenire.
 */
export function aggregateByCompetition(
  verdicts: SourceRowVerdict[],
  labels: Map<string, string>,
): CompetitionRow[] {
  const byPath = new Map<string, CompetitionRow>();

  for (const v of verdicts) {
    let row = byPath.get(v.leaguePath);
    if (!row) {
      row = {
        leaguePath: v.leaguePath,
        label: labels.get(v.leaguePath) ?? v.leaguePath,
        onSource: 0,
        imported: 0,
        importedWithSeries: 0,
        missed: 0,
        delta: 0,
      };
      byPath.set(v.leaguePath, row);
    }
    row.onSource += 1;
    if (v.imported) row.imported += 1;
    if (v.imported && v.hasSeries) row.importedWithSeries += 1;
    if (!v.imported) row.missed += 1;
  }

  const rows = [...byPath.values()];
  for (const r of rows) r.delta = r.imported - r.onSource;

  return rows.sort(
    (a, b) =>
      b.missed - a.missed ||
      b.onSource - a.onSource ||
      a.label.localeCompare(b.label),
  );
}

/* ------------------------------------------------------------------ */
/* Conteggi                                                            */
/* ------------------------------------------------------------------ */

export function emptyCauseCounts(): Record<GapCause, number> {
  return { SOURCE_MISSING: 0, ENTRY_MISSED: 0, MATCH_FAILED: 0, OTHER: 0 };
}

/** Conta le cause, ignorando gli elementi senza classificazione. */
export function countCauses(
  items: (GapClassification | null)[],
): Record<GapCause, number> {
  const counts = emptyCauseCounts();
  for (const item of items) {
    if (item) counts[item.cause] += 1;
  }
  return counts;
}

/** Causa più frequente, `null` a pari merito o senza dati. */
export function dominantCause(
  counts: Record<GapCause, number>,
): GapCause | null {
  let best: GapCause | null = null;
  let bestValue = 0;
  let tied = false;

  for (const cause of GAP_CAUSES) {
    const value = counts[cause];
    if (value > bestValue) {
      best = cause;
      bestValue = value;
      tied = false;
    } else if (value === bestValue && value > 0) {
      tied = true;
    }
  }

  return tied || bestValue === 0 ? null : best;
}

/**
 * Traduce la causa dominante nell'unica conseguenza che i numeri sostengono.
 * Non propone mai un lavoro che i dati non giustificano.
 */
export function recommendationFor(counts: Record<GapCause, number>): {
  headline: string;
  rationale: string;
} {
  const total = GAP_CAUSES.reduce((a, c) => a + counts[c], 0);
  if (total === 0) {
    return {
      headline: "Nessun buco classificato.",
      rationale:
        "Non ci sono elementi da spiegare in questa misura. Nessun intervento è giustificato dai numeri.",
    };
  }

  const dominant = dominantCause(counts);
  if (dominant === null) {
    return {
      headline: "Nessuna causa prevale.",
      rationale:
        "Le cause si equivalgono: scegliere adesso un intervento significherebbe seguire una preferenza, non i dati. Serve una misura ripetuta.",
    };
  }

  switch (dominant) {
    case "SOURCE_MISSING":
      return {
        headline: "Il grosso dei buchi non dipende dal nostro codice.",
        rationale:
          "La causa prevalente è il dato che la fonte non pubblica. Va dichiarato, non tappato: nessuna correzione al collector lo recupererebbe.",
      };
    case "ENTRY_MISSED":
      return {
        headline: "La perdita è nel nostro giro di raccolta.",
        rationale:
          "La causa prevalente sono righe pubblicate dalla fonte e non prese. È l'unica perdita recuperabile: va istruito il giro prima di correggerlo.",
      };
    case "MATCH_FAILED":
      return {
        headline: "La perdita è nella lettura del contenuto.",
        rationale:
          "La causa prevalente è contenuto letto e non interpretato. I frammenti grezzi allegati indicano dove intervenire.",
      };
    case "OTHER":
    default:
      return {
        headline: "Le cause non sono ancora attribuite.",
        rationale:
          "Prevalgono gli elementi dichiarati non verificabili con i fatti raccolti. Serve una verifica mirata prima di qualunque intervento.",
      };
  }
}

/* ------------------------------------------------------------------ */
/* Resa testuale                                                       */
/* ------------------------------------------------------------------ */

export const COMPETITION_TABLE_HEADERS = [
  "Competizione",
  "Fonte",
  "Importate",
  "Con serie",
  "Perse",
  "Delta",
];

export function competitionTableRows(rows: CompetitionRow[]): string[][] {
  return rows.map((r) => [
    r.label,
    String(r.onSource),
    String(r.imported),
    String(r.importedWithSeries),
    String(r.missed),
    r.delta === 0 ? "0" : `−${Math.abs(r.delta)}`,
  ]);
}

/** Tabella a larghezza fissa. La prima colonna a sinistra, le altre a destra. */
export function renderTable(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) =>
    all.reduce((max, row) => Math.max(max, (row[i] ?? "").length), 0),
  );

  const line = (row: string[]): string =>
    row
      .map((cell, i) =>
        i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]),
      )
      .join("  ")
      .trimEnd();

  const separator = widths.map((w) => "─".repeat(w)).join("  ");
  return [line(headers), separator, ...rows.map(line)].join("\n");
}
