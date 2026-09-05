/**
 * Misura della copertura — Sprint 6A.
 *
 * Confronta ciò che la fonte pubblica adesso con ciò che è arrivato nel
 * database, e attribuisce una causa a ogni buco aperto.
 *
 * Questo strumento MISURA e basta:
 *   • non modifica alcun record esistente;
 *   • non tocca il parser né gli adapter;
 *   • non completa, non stima e non interpola nessun valore;
 *   • quando una causa non è verificabile, la dichiara non verificata.
 *
 * Uso:
 *   npx tsx --env-file=.env src/scripts/run-coverage.ts
 *   npx tsx --env-file=.env src/scripts/run-coverage.ts --probe=10
 *   npx tsx --env-file=.env src/scripts/run-coverage.ts --json
 *   npx tsx --env-file=.env src/scripts/run-coverage.ts --no-save
 *
 * Argomenti:
 *   --probe=N    apre fino a N pagine partita per verificare le righe non
 *                importate (default 0: nessuna verifica, cause dichiarate
 *                NOT_VERIFIED). Ogni apertura rispetta il rate limiter.
 *   --horizon=H  finestra in avanti usata per il confronto, in ore
 *                (default 72, come il collector).
 *   --json       stampa il report come JSON invece che come tabelle.
 *   --no-save    non salva il file del report.
 *   --out=DIR    cartella di destinazione (default docs/cov).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inArray, sql as raw } from "drizzle-orm";

import { db, sql, schema } from "@/db/client";
import {
  aggregateByCompetition,
  classifyDataGap,
  classifySourceRow,
  compressFragment,
  countCauses,
  COMPETITION_TABLE_HEADERS,
  competitionTableRows,
  emptyCauseCounts,
  GAP_CAUSES,
  GAP_CAUSE_LABELS,
  isRealFixtureKey,
  recommendationFor,
  renderTable,
  scanSourceRows,
  type GapCause,
  type GapClassification,
  type ProbeOutcome,
  type SourceRowVerdict,
} from "@/lib/cov/scan";
import {
  DROPPING_ODDS_PATH,
  fetchPage,
} from "@/lib/providers/betexplorer/http";
import {
  humanizeSlug,
  matchKeyFor,
  parseDroppingOdds,
  parseMatchStartDate,
} from "@/lib/providers/betexplorer/parse";
import { initProviders } from "@/lib/providers";
import { perBookmakerOddsUnavailable } from "@/lib/providers/registry";
import { RateLimiter } from "@/lib/providers/rate-limiter";

/* ------------------------------------------------------------------ */
/* Argomenti e formattazione                                           */
/* ------------------------------------------------------------------ */

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function intArg(name: string, fallback: number): number {
  const value = arg(name);
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const ROME = "Europe/Rome";

function fmtRome(date: Date): string {
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: ROME,
  }).format(date);
}

/** Timestamp compatto per il nome del file: 2026-08-18T2035Z. */
function fileStamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 13)}${iso.slice(14, 16)}Z`;
}

function section(title: string): void {
  console.log(`\n=== ${title} ===\n`);
}

function pct(part: number, total: number): string {
  if (total === 0) return "n/d";
  return `${((part / total) * 100).toFixed(1)}%`;
}

/* ------------------------------------------------------------------ */
/* Misura                                                              */
/* ------------------------------------------------------------------ */

interface GapReportRow {
  id: number;
  matchKey: string | null;
  reason: string;
  market: string | null;
  observedFrom: string;
  classification: GapClassification;
}

interface CoverageReport {
  generatedAt: string;
  generatedAtRome: string;
  horizonHours: number;
  probeLimit: number;
  source: {
    url: string;
    status: number;
    bytes: number;
    latencyMs: number;
    totalRows: number;
    fixtureRows: number;
    footballRows: number;
    unlinkedRows: number;
    unlinkedSamples: string[];
    parsedFixtures: number;
    parseProblems: number;
  };
  database: {
    matchesTotal: number;
    matchesReal: number;
    matchesNonReal: number;
    openGaps: number;
  };
  competitions: ReturnType<typeof aggregateByCompetition>;
  rowVerdicts: SourceRowVerdict[];
  rowCauseCounts: Record<GapCause, number>;
  gapRows: GapReportRow[];
  gapCauseCounts: Record<GapCause, number>;
  combinedCauseCounts: Record<GapCause, number>;
  recommendation: { headline: string; rationale: string };
  notes: string[];
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const horizonHours = intArg("horizon", 72);
  const probeLimit = intArg("probe", 0);
  const asJson = flag("json");
  const save = !flag("no-save");
  const outDir = arg("out") ?? "docs/cov";

  initProviders();
  const perBookUnavailable = perBookmakerOddsUnavailable();
  const notes: string[] = [];

  /* ---------------- 1. Fonte: una sola richiesta ---------------- */

  const fetched = await fetchPage(DROPPING_ODDS_PATH);
  if (!fetched.ok) {
    console.error(
      `\nFONTE NON RAGGIUNGIBILE — status ${fetched.status}. ${fetched.errorMessage ?? ""}`,
    );
    console.error(
      "Nessuna misura prodotta: senza il conteggio lato fonte il confronto sarebbe inventato.\n",
    );
    process.exitCode = 1;
    return;
  }

  const scan = scanSourceRows(fetched.body);
  /* il parser reale viene invocato in sola lettura, per sapere quali
     righe accetterebbe: non ne modifichiamo il comportamento */
  const parsed = parseDroppingOdds(fetched.body);
  const parsedIds = new Set(parsed.fixtures.map((f) => f.providerMatchId));
  const problemById = new Map(parsed.problems.map((p) => [p.ref, p.reason]));

  /* ---------------- 2. Database: inventario ---------------- */

  const allMatches = await db
    .select({
      id: schema.matches.id,
      key: schema.matches.key,
      kickoffAt: schema.matches.kickoffAt,
    })
    .from(schema.matches);

  const realMatches = allMatches.filter((m) => isRealFixtureKey(m.key));
  const byKey = new Map(realMatches.map((m) => [m.key, m]));

  const snapshotCounts = new Map<number, number>();
  if (realMatches.length > 0) {
    const rows = await db
      .select({
        matchId: schema.oddsSnapshots.matchId,
        n: raw<number>`count(*)::int`,
      })
      .from(schema.oddsSnapshots)
      .where(
        inArray(
          schema.oddsSnapshots.matchId,
          realMatches.map((m) => m.id),
        ),
      )
      .groupBy(schema.oddsSnapshots.matchId);
    for (const r of rows) snapshotCounts.set(r.matchId, Number(r.n));
  }

  /* ---------------- 3. Verifica facoltativa delle righe perse ------- */

  const now = new Date();
  const window = {
    from: new Date(now.getTime() - 6 * 3_600_000),
    to: new Date(now.getTime() + horizonHours * 3_600_000),
  };

  const candidates = scan.rows.filter((row) => {
    const m = byKey.get(matchKeyFor(row.providerMatchId));
    return !m && parsedIds.has(row.providerMatchId);
  });

  const probes = new Map<string, ProbeOutcome>();
  if (probeLimit > 0 && candidates.length > 0) {
    const limiter = new RateLimiter({
      requestsPerMinute: 12,
      minIntervalMs: 4_000,
    });
    const toProbe = candidates.slice(0, probeLimit);
    console.log(
      `Verifica di ${toProbe.length} pagine partita su ${candidates.length} candidate (rate limit rispettato, ~4s l'una)…`,
    );
    for (const row of toProbe) {
      await limiter.acquire();
      const page = await fetchPage(row.sourceUrl);
      if (!page.ok) {
        probes.set(row.providerMatchId, {
          kind: "page_unreachable",
          message: `status ${page.status}${page.errorMessage ? ` — ${page.errorMessage}` : ""}`,
        });
        continue;
      }
      const kickoff = parseMatchStartDate(page.body);
      probes.set(
        row.providerMatchId,
        kickoff
          ? { kind: "kickoff_read", kickoffAt: kickoff }
          : { kind: "kickoff_missing" },
      );
    }
    if (candidates.length > toProbe.length) {
      notes.push(
        `Verificate ${toProbe.length} pagine partita su ${candidates.length} candidate: le restanti restano NOT_VERIFIED per scelta di cortesia verso la fonte.`,
      );
    }
  } else if (candidates.length > 0) {
    notes.push(
      `${candidates.length} righe leggibili e non importate non sono state verificate (--probe=0): la loro causa è dichiarata NOT_VERIFIED, non attribuita.`,
    );
  }

  /* ---------------- 4. Verdetto riga per riga ---------------- */

  const verdicts: SourceRowVerdict[] = scan.rows.map((row) => {
    const match = byKey.get(matchKeyFor(row.providerMatchId));
    return classifySourceRow({
      row,
      parsed: parsedIds.has(row.providerMatchId),
      parseProblem: problemById.get(row.providerMatchId) ?? null,
      inDb: Boolean(match),
      snapshots: match ? (snapshotCounts.get(match.id) ?? 0) : 0,
      probe: probes.get(row.providerMatchId) ?? { kind: "not_probed" },
      window,
    });
  });

  const labels = new Map<string, string>();
  for (const row of scan.rows) {
    labels.set(
      row.leaguePath,
      `${humanizeSlug(row.countrySlug)} · ${humanizeSlug(row.leagueSlug)}`,
    );
  }

  const competitions = aggregateByCompetition(verdicts, labels);
  const rowCauseCounts = countCauses(verdicts.map((v) => v.classification));

  /* ---------------- 5. Buchi già registrati ---------------- */

  const openGaps = await db
    .select({
      id: schema.dataGaps.id,
      reason: schema.dataGaps.reason,
      detail: schema.dataGaps.detail,
      market: schema.dataGaps.market,
      observedFrom: schema.dataGaps.observedFrom,
      matchKey: schema.matches.key,
    })
    .from(schema.dataGaps)
    .leftJoin(schema.matches, raw`${schema.matches.id} = ${schema.dataGaps.matchId}`)
    .where(raw`${schema.dataGaps.resolved} = false`)
    .orderBy(schema.dataGaps.id);

  const gapRows: GapReportRow[] = openGaps.map((g) => ({
    id: g.id,
    matchKey: g.matchKey,
    reason: g.reason,
    market: g.market,
    observedFrom: g.observedFrom.toISOString(),
    classification: classifyDataGap({
      id: g.id,
      reason: g.reason,
      detail: g.detail,
      matchKey: g.matchKey,
      market: g.market,
      perBookmakerUnavailable: perBookUnavailable,
    }),
  }));

  const gapCauseCounts = countCauses(gapRows.map((g) => g.classification));
  const combined = emptyCauseCounts();
  for (const c of GAP_CAUSES) combined[c] = rowCauseCounts[c] + gapCauseCounts[c];

  const report: CoverageReport = {
    generatedAt: startedAt.toISOString(),
    generatedAtRome: fmtRome(startedAt),
    horizonHours,
    probeLimit,
    source: {
      url: fetched.url,
      status: fetched.status,
      bytes: fetched.bytes,
      latencyMs: fetched.latencyMs,
      totalRows: scan.totalRows,
      fixtureRows: scan.fixtureRows,
      footballRows: scan.footballRows,
      unlinkedRows: scan.unlinkedRows,
      unlinkedSamples: scan.unlinkedSamples,
      parsedFixtures: parsed.fixtures.length,
      parseProblems: parsed.problems.length,
    },
    database: {
      matchesTotal: allMatches.length,
      matchesReal: realMatches.length,
      matchesNonReal: allMatches.length - realMatches.length,
      openGaps: openGaps.length,
    },
    competitions,
    rowVerdicts: verdicts,
    rowCauseCounts,
    gapRows,
    gapCauseCounts,
    combinedCauseCounts: combined,
    recommendation: recommendationFor(combined),
    notes,
  };

  /* ---------------- 6. Stampa ---------------- */

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  /* ---------------- 7. Salvataggio ---------------- */

  if (save) {
    const stamp = fileStamp(startedAt);
    const jsonPath = resolve(join(outDir, `coverage-${stamp}.json`));
    const textPath = resolve(join(outDir, `coverage-${stamp}.txt`));
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    writeFileSync(textPath, `${renderReport(report)}\n`, "utf8");
    console.log(`\nReport salvato:\n  ${jsonPath}\n  ${textPath}`);
  }
}

/* ------------------------------------------------------------------ */
/* Resa testuale                                                       */
/* ------------------------------------------------------------------ */

function renderReport(r: CoverageReport): string {
  const out: string[] = [];
  const push = (s = ""): void => void out.push(s);

  push("MISURA DELLA COPERTURA — DropAlert");
  push(`Generato: ${r.generatedAtRome} (${r.generatedAt})`);
  push(`Finestra: −6h → +${r.horizonHours}h · verifiche pagina partita: ${r.probeLimit}`);
  push();

  push("--- FONTE ---");
  push(`URL:                    ${r.source.url}`);
  push(`Esito:                  HTTP ${r.source.status}, ${r.source.bytes} byte, ${r.source.latencyMs} ms`);
  push(`Righe totali:           ${r.source.totalRows}`);
  push(`Righe partita:          ${r.source.fixtureRows}`);
  push(`Righe di calcio:        ${r.source.footballRows}`);
  push(`Righe senza link calcio:${String(r.source.unlinkedRows).padStart(4)}  (altri sport oppure markup cambiato: non distinguibile da qui)`);
  push(`Accettate dal parser:   ${r.source.parsedFixtures}`);
  push(`Scartate dal parser:    ${r.source.parseProblems}`);
  push();

  push("--- DATABASE ---");
  push(`Partite totali:         ${r.database.matchesTotal}`);
  push(`Di cui dato reale:      ${r.database.matchesReal}`);
  push(`Dimostrative o di test: ${r.database.matchesNonReal}  (escluse dalla misura di copertura)`);
  push(`Buchi aperti:           ${r.database.openGaps}`);
  push();

  push("--- COPERTURA PER COMPETIZIONE ---");
  push(renderTable(COMPETITION_TABLE_HEADERS, competitionTableRows(r.competitions)));
  const onSource = r.competitions.reduce((a, c) => a + c.onSource, 0);
  const imported = r.competitions.reduce((a, c) => a + c.imported, 0);
  const withSeries = r.competitions.reduce((a, c) => a + c.importedWithSeries, 0);
  push();
  push(`TOTALE: ${onSource} sulla fonte · ${imported} importate (${pct(imported, onSource)}) · ${withSeries} con serie (${pct(withSeries, onSource)}) · ${onSource - imported} perse`);
  push();

  push("--- CAUSE, RIGHE DELLA FONTE NON COPERTE ---");
  push(causeTable(r.rowCauseCounts));
  push();

  push("--- CAUSE, BUCHI GIÀ REGISTRATI ---");
  push(causeTable(r.gapCauseCounts));
  push();

  push("--- DETTAGLIO DEI BUCHI APERTI ---");
  const grouped = new Map<string, GapReportRow[]>();
  for (const g of r.gapRows) {
    const k = `${g.classification.cause} / ${g.classification.code}`;
    const list = grouped.get(k);
    if (list) list.push(g);
    else grouped.set(k, [g]);
  }
  for (const [key, list] of grouped) {
    push(`${key} — ${list.length} casi`);
    push(`  ${list[0].classification.detail}`);
    const shown = list.slice(0, 8);
    for (const g of shown) {
      push(`  · gap #${g.id} · ${g.matchKey ?? "senza partita"} · motivo ${g.reason}${g.market ? ` · mercato ${g.market}` : ""}`);
      if (g.classification.evidence) {
        push(`      frammento: ${g.classification.evidence}`);
      }
    }
    if (list.length > shown.length) {
      push(`  … e altri ${list.length - shown.length}`);
    }
    push();
  }

  const missedRows = r.rowVerdicts.filter((v) => v.classification !== null);
  if (missedRows.length > 0) {
    push("--- DETTAGLIO DELLE RIGHE NON COPERTE ---");
    for (const v of missedRows.slice(0, 15)) {
      push(`· ${v.providerMatchId} · ${v.leaguePath} · ${v.classification!.cause}/${v.classification!.code}`);
      push(`    ${v.classification!.detail}`);
      if (v.classification!.evidence) {
        push(`    frammento: ${compressFragment(v.classification!.evidence, 200)}`);
      }
    }
    if (missedRows.length > 15) push(`… e altre ${missedRows.length - 15}`);
    push();
  }

  if (r.source.unlinkedSamples.length > 0) {
    push("--- RIGHE SENZA LINK DI CALCIO (campione grezzo) ---");
    for (const s of r.source.unlinkedSamples) push(`· ${s}`);
    push();
  }

  push("--- QUADRO COMPLESSIVO ---");
  push(causeTable(r.combinedCauseCounts));
  push();
  push(`Lettura: ${r.recommendation.headline}`);
  push(`Motivo:  ${r.recommendation.rationale}`);
  push();

  if (r.notes.length > 0) {
    push("--- LIMITI DICHIARATI DI QUESTA MISURA ---");
    for (const n of r.notes) push(`· ${n}`);
    push();
  }

  push(
    "Nota: DropAlert è un terminale quantitativo per scommesse. Questa misura descrive la copertura dei dati, non una garanzia sui segnali.",
  );
  return out.join("\n");
}

function causeTable(counts: Record<GapCause, number>): string {
  const total = GAP_CAUSES.reduce((a, c) => a + counts[c], 0);
  const rows = GAP_CAUSES.map((c) => [
    c,
    String(counts[c]),
    pct(counts[c], total),
    GAP_CAUSE_LABELS[c],
  ]);
  rows.push(["TOTALE", String(total), total === 0 ? "n/d" : "100.0%", ""]);
  return renderTable(["Causa", "N", "Quota", "Significato"], rows);
}

function printReport(r: CoverageReport): void {
  section("MISURA DELLA COPERTURA");
  console.log(renderReport(r));
}

main()
  .then(async () => {
    await sql.end({ timeout: 5 });
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (error) => {
    console.error("\nMisura interrotta:", error);
    try {
      await sql.end({ timeout: 5 });
    } catch {
      /* la chiusura del pool non deve mascherare l'errore vero */
    }
    process.exit(1);
  });
