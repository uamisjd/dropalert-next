/**
 * Test della misura di copertura (Sprint 6A, ricostruito e ampliato in 6B).
 * Eseguire con: npm run test:coverage
 *
 * Funzioni pure soltanto: nessuna rete, nessun database, nessun orologio
 * reale. Il markup usato è finto ma riproduce la struttura osservata sulla
 * fonte.
 */
import {
  aggregateByCompetition,
  classifyDataGap,
  classifySourceRow,
  compressFragment,
  countCauses,
  competitionTableRows,
  dominantCause,
  emptyCauseCounts,
  isRealFixtureKey,
  recommendationFor,
  renderTable,
  scanSourceRows,
  COMPETITION_TABLE_HEADERS,
  GAP_CAUSES,
  GAP_CAUSE_LABELS,
  type ProbeOutcome,
  type SourceRowScan,
  type SourceRowVerdict,
} from "../scan";
import {
  buildRunCoverage,
  coverageOfRun,
  coverageSeriesStats,
  describeSeriesDepth,
  emptyReasonCounts,
  reasonForCode,
  selectRetryTargets,
  triggerOfRun,
  EXCLUSION_LABELS,
  EXCLUSION_REASONS,
  MIN_RUNS_FOR_TREND,
  type CoveragePoint,
  type RunTrigger,
  type ExclusionNote,
  type RunCoverageInput,
} from "../instrument";
import {
  EXCLUSION_CODES,
  parseExclusion,
  taggedExclusion,
} from "@/lib/providers/exclusion-codes";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  ✗ ${name}\n      ${msg}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label = ""): void {
  if (actual !== expected) {
    throw new Error(
      `${label ? label + ": " : ""}atteso ${String(expected)}, ottenuto ${String(actual)}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Markup di prova                                                     */
/* ------------------------------------------------------------------ */

function footballRow(
  country: string,
  league: string,
  id: string,
  teams = "Alfa - Beta",
): string {
  return `<tr class="table-main__tt"><td><a href="/football/${country}/${league}/alfa-beta/${id}/">${teams}</a></td><td class="table-main__time">18:30</td></tr>`;
}

function otherSportRow(id: string): string {
  return `<tr class="table-main__tt"><td><a href="/tennis/atp/match/${id}/">Tizio - Caio</a></td></tr>`;
}

const LISTING = `<table>
<tr><th>Drop</th></tr>
<tr><td class="table-main__date">18.08.2026</td></tr>
${footballRow("slovakia", "slovak-cup", "aaa11111")}
${footballRow("slovakia", "slovak-cup", "bbb22222")}
${footballRow("japan", "emperor-cup", "ccc33333")}
${otherSportRow("ddd44444")}
${otherSportRow("eee55555")}
</table>`;

const WINDOW = {
  from: new Date("2026-08-18T00:00:00Z"),
  to: new Date("2026-08-21T00:00:00Z"),
};

function rowOf(id: string, leaguePath = "slovakia/slovak-cup"): SourceRowScan {
  const [countrySlug, leagueSlug] = leaguePath.split("/");
  return {
    providerMatchId: id,
    sourceUrl: `/football/${leaguePath}/alfa-beta/${id}/`,
    countrySlug,
    leagueSlug,
    leaguePath,
    rawFragment: `Alfa - Beta 18:30 (${id})`,
  };
}

function main(): void {
  console.log("\n=== Misura della copertura ===\n");

  /* ---------------- scanSourceRows ---------------- */

  test("conta le righe di calcio separandole dagli altri sport", () => {
    const scan = scanSourceRows(LISTING);
    assertEqual(scan.footballRows, 3, "righe di calcio");
    assertEqual(scan.unlinkedRows, 2, "altri sport");
    assertEqual(scan.fixtureRows, 5, "righe partita totali");
  });

  test("estrae paese, lega e identificativo dalla riga", () => {
    const scan = scanSourceRows(LISTING);
    const first = scan.rows[0];
    assertEqual(first.providerMatchId, "aaa11111");
    assertEqual(first.countrySlug, "slovakia");
    assertEqual(first.leagueSlug, "slovak-cup");
    assertEqual(first.leaguePath, "slovakia/slovak-cup");
  });

  test("conserva un frammento grezzo per ogni riga", () => {
    const scan = scanSourceRows(LISTING);
    assert(scan.rows[0].rawFragment.includes("Alfa"), "frammento presente");
  });

  test("conserva campioni delle righe di altri sport", () => {
    const scan = scanSourceRows(LISTING);
    assert(scan.unlinkedSamples.length > 0, "almeno un campione");
    assert(
      scan.unlinkedSamples[0].includes("Tizio"),
      "il campione è il testo osservato",
    );
  });

  test("documento vuoto: nessuna riga, nessuna eccezione", () => {
    const scan = scanSourceRows("");
    assertEqual(scan.totalRows, 0);
    assertEqual(scan.footballRows, 0);
  });

  test("documento senza tabelle: zero righe", () => {
    const scan = scanSourceRows("<html><body>niente</body></html>");
    assertEqual(scan.fixtureRows, 0);
  });

  test("conta le righe totali del documento, non solo le partite", () => {
    const scan = scanSourceRows(LISTING);
    assert(scan.totalRows > scan.fixtureRows, "ci sono anche intestazioni");
  });

  /* ---------------- compressFragment ---------------- */

  test("comprime gli spazi senza riscrivere il testo", () => {
    assertEqual(compressFragment("  a\n\n  b  "), "a b");
  });

  test("taglia i frammenti troppo lunghi con un segno visibile", () => {
    const out = compressFragment("x".repeat(500), 50);
    assertEqual(out?.length, 50);
    assert(out!.endsWith("…"), "il taglio è dichiarato");
  });

  test("frammento vuoto o assente diventa null, non stringa vuota", () => {
    assertEqual(compressFragment("   "), null);
    assertEqual(compressFragment(null), null);
    assertEqual(compressFragment(undefined), null);
  });

  /* ---------------- isRealFixtureKey ---------------- */

  test("riconosce le partite reali dal prefisso be-", () => {
    assert(isRealFixtureKey("be-aaa11111"), "reale");
    assert(!isRealFixtureKey("demo-1"), "dimostrativa");
    assert(!isRealFixtureKey("pipetest-1"), "di test");
    assert(!isRealFixtureKey(null), "assente");
  });

  /* ---------------- classifyDataGap ---------------- */

  test("per-book non pubblicato: la fonte non ce l'ha, non è colpa nostra", () => {
    const c = classifyDataGap({
      id: 1,
      reason: "bookmaker_missing",
      detail: "solo consenso",
      matchKey: "be-x",
      market: "1x2",
      perBookmakerUnavailable: true,
    });
    assertEqual(c.cause, "SOURCE_MISSING");
    assertEqual(c.code, "PER_BOOK_NOT_PUBLISHED");
  });

  test("bookmaker mancante con fonte che lo pubblica: causa non attribuita", () => {
    const c = classifyDataGap({
      id: 1,
      reason: "bookmaker_missing",
      detail: null,
      matchKey: "be-x",
      market: "1x2",
      perBookmakerUnavailable: false,
    });
    assertEqual(c.cause, "OTHER");
  });

  test("fixture dimostrativa: esclusa dal conteggio utile e dichiarata", () => {
    const c = classifyDataGap({
      id: 2,
      reason: "bookmaker_missing",
      detail: null,
      matchKey: "demo-1",
      market: "1x2",
      perBookmakerUnavailable: true,
    });
    assertEqual(c.cause, "OTHER");
    assertEqual(c.code, "NON_REAL_FIXTURE");
  });

  test("errore di lettura: MATCH_FAILED con il frammento allegato", () => {
    const c = classifyDataGap({
      id: 3,
      reason: "parse_error",
      detail: "<td>rotto</td>",
      matchKey: "be-x",
      market: null,
      perBookmakerUnavailable: true,
    });
    assertEqual(c.cause, "MATCH_FAILED");
    assert(c.evidence !== null, "il frammento grezzo è allegato");
  });

  test("fonte non disponibile e rate limit: perdita del nostro giro", () => {
    for (const reason of ["provider_unavailable", "rate_limited"]) {
      const c = classifyDataGap({
        id: 4,
        reason,
        detail: null,
        matchKey: "be-x",
        market: null,
        perBookmakerUnavailable: true,
      });
      assertEqual(c.cause, "ENTRY_MISSED", reason);
    }
  });

  test("mercato non offerto: la fonte non lo pubblica", () => {
    const c = classifyDataGap({
      id: 5,
      reason: "market_not_offered",
      detail: null,
      matchKey: "be-x",
      market: "btts",
      perBookmakerUnavailable: true,
    });
    assertEqual(c.cause, "SOURCE_MISSING");
  });

  test("motivo sconosciuto: dichiarato, mai indovinato", () => {
    const c = classifyDataGap({
      id: 6,
      reason: "motivo_mai_visto",
      detail: null,
      matchKey: "be-x",
      market: null,
      perBookmakerUnavailable: true,
    });
    assertEqual(c.cause, "OTHER");
    assertEqual(c.code, "UNKNOWN_REASON");
  });

  /* ---------------- classifySourceRow ---------------- */

  const notProbed: ProbeOutcome = { kind: "not_probed" };

  test("importata con serie: nulla da spiegare", () => {
    const v = classifySourceRow({
      row: rowOf("a"),
      parsed: true,
      parseProblem: null,
      inDb: true,
      snapshots: 4,
      probe: notProbed,
      window: WINDOW,
    });
    assertEqual(v.classification, null);
    assert(v.imported && v.hasSeries, "importata e con serie");
  });

  test("in archivio senza quote: la riga non ne esponeva", () => {
    const v = classifySourceRow({
      row: rowOf("a"),
      parsed: true,
      parseProblem: null,
      inDb: true,
      snapshots: 0,
      probe: notProbed,
      window: WINDOW,
    });
    assertEqual(v.classification?.cause, "SOURCE_MISSING");
    assertEqual(v.classification?.code, "NO_QUOTES_ON_ROW");
  });

  test("scartata dal parser: lettura fallita, con il motivo dichiarato", () => {
    const v = classifySourceRow({
      row: rowOf("a"),
      parsed: false,
      parseProblem: "Nomi squadre non separabili.",
      inDb: false,
      snapshots: 0,
      probe: notProbed,
      window: WINDOW,
    });
    assertEqual(v.classification?.cause, "MATCH_FAILED");
    assert(
      v.classification!.detail.includes("Nomi squadre"),
      "riporta il motivo del parser",
    );
  });

  test("senza verifica la causa resta NON verificata", () => {
    const v = classifySourceRow({
      row: rowOf("a"),
      parsed: true,
      parseProblem: null,
      inDb: false,
      snapshots: 0,
      probe: notProbed,
      window: WINDOW,
    });
    assertEqual(v.classification?.cause, "OTHER");
    assertEqual(v.classification?.code, "NOT_VERIFIED");
  });

  test("pagina irraggiungibile: la fonte non ce l'ha data", () => {
    const v = classifySourceRow({
      row: rowOf("a"),
      parsed: true,
      parseProblem: null,
      inDb: false,
      snapshots: 0,
      probe: { kind: "page_unreachable", message: "status 404" },
      window: WINDOW,
    });
    assertEqual(v.classification?.cause, "SOURCE_MISSING");
    assert(v.classification!.detail.includes("404"), "riporta lo status");
  });

  test("orario illeggibile: nessun orario viene dedotto", () => {
    const v = classifySourceRow({
      row: rowOf("a"),
      parsed: true,
      parseProblem: null,
      inDb: false,
      snapshots: 0,
      probe: { kind: "kickoff_missing" },
      window: WINDOW,
    });
    assertEqual(v.classification?.cause, "MATCH_FAILED");
    assertEqual(v.classification?.code, "KICKOFF_UNREADABLE");
  });

  test("fuori finestra: correttamente non raccolta, non è una perdita", () => {
    const v = classifySourceRow({
      row: rowOf("a"),
      parsed: true,
      parseProblem: null,
      inDb: false,
      snapshots: 0,
      probe: { kind: "kickoff_read", kickoffAt: new Date("2026-09-01T12:00:00Z") },
      window: WINDOW,
    });
    assertEqual(v.classification?.cause, "OTHER");
    assertEqual(v.classification?.code, "OUT_OF_WINDOW");
  });

  test("dentro la finestra e non presa: è la perdita che conta", () => {
    const v = classifySourceRow({
      row: rowOf("a"),
      parsed: true,
      parseProblem: null,
      inDb: false,
      snapshots: 0,
      probe: { kind: "kickoff_read", kickoffAt: new Date("2026-08-19T12:00:00Z") },
      window: WINDOW,
    });
    assertEqual(v.classification?.cause, "ENTRY_MISSED");
    assertEqual(v.classification?.code, "NOT_REACHED");
  });

  /* ---------------- aggregazione ---------------- */

  function verdict(
    id: string,
    leaguePath: string,
    imported: boolean,
    hasSeries: boolean,
  ): SourceRowVerdict {
    return {
      providerMatchId: id,
      leaguePath,
      imported,
      hasSeries,
      classification: imported
        ? null
        : {
            cause: "ENTRY_MISSED",
            code: "NOT_REACHED",
            detail: "",
            evidence: null,
          },
    };
  }

  test("aggrega per competizione contando viste, importate e perse", () => {
    const rows = aggregateByCompetition(
      [
        verdict("a", "slovakia/slovak-cup", true, true),
        verdict("b", "slovakia/slovak-cup", false, false),
        verdict("c", "japan/emperor-cup", true, true),
      ],
      new Map([["slovakia/slovak-cup", "Slovakia · Slovak Cup"]]),
    );
    const slovak = rows.find((r) => r.leaguePath === "slovakia/slovak-cup")!;
    assertEqual(slovak.onSource, 2);
    assertEqual(slovak.imported, 1);
    assertEqual(slovak.missed, 1);
    assertEqual(slovak.delta, -1);
    assertEqual(slovak.label, "Slovakia · Slovak Cup");
  });

  test("in cima le competizioni dove perdiamo di più", () => {
    const rows = aggregateByCompetition(
      [
        verdict("a", "japan/emperor-cup", true, true),
        verdict("b", "slovakia/slovak-cup", false, false),
      ],
      new Map(),
    );
    assertEqual(rows[0].leaguePath, "slovakia/slovak-cup");
  });

  test("competizione senza etichetta: si usa il percorso, non un inventato", () => {
    const rows = aggregateByCompetition(
      [verdict("a", "bolivia/copa-pacena", false, false)],
      new Map(),
    );
    assertEqual(rows[0].label, "bolivia/copa-pacena");
  });

  test("importata ma senza serie non conta come importedWithSeries", () => {
    const rows = aggregateByCompetition(
      [verdict("a", "x/y", true, false)],
      new Map(),
    );
    assertEqual(rows[0].imported, 1);
    assertEqual(rows[0].importedWithSeries, 0);
  });

  /* ---------------- conteggi e lettura ---------------- */

  test("conta le cause ignorando le righe senza classificazione", () => {
    const counts = countCauses([
      { cause: "SOURCE_MISSING", code: "", detail: "", evidence: null },
      { cause: "SOURCE_MISSING", code: "", detail: "", evidence: null },
      null,
    ]);
    assertEqual(counts.SOURCE_MISSING, 2);
    assertEqual(counts.OTHER, 0);
  });

  test("il conteggio vuoto ha tutte e quattro le cause a zero", () => {
    const counts = emptyCauseCounts();
    for (const c of GAP_CAUSES) assertEqual(counts[c], 0, c);
  });

  test("causa dominante: nessuna a pari merito", () => {
    const counts = emptyCauseCounts();
    counts.SOURCE_MISSING = 3;
    counts.ENTRY_MISSED = 3;
    assertEqual(dominantCause(counts), null);
  });

  test("causa dominante riconosciuta quando prevale", () => {
    const counts = emptyCauseCounts();
    counts.SOURCE_MISSING = 24;
    counts.ENTRY_MISSED = 2;
    assertEqual(dominantCause(counts), "SOURCE_MISSING");
  });

  test("senza dati non c'è causa dominante", () => {
    assertEqual(dominantCause(emptyCauseCounts()), null);
  });

  test("ogni causa ha un'etichetta leggibile", () => {
    for (const c of GAP_CAUSES) {
      assert(GAP_CAUSE_LABELS[c].length > 0, `etichetta di ${c}`);
    }
  });

  test("nessun buco: nessun intervento proposto", () => {
    const r = recommendationFor(emptyCauseCounts());
    assert(r.headline.includes("Nessun buco"), "lo dichiara");
  });

  test("prevale SOURCE_MISSING: si dichiara, non si corregge il collector", () => {
    const counts = emptyCauseCounts();
    counts.SOURCE_MISSING = 24;
    const r = recommendationFor(counts);
    assert(
      r.rationale.includes("non pubblica") || r.rationale.includes("dichiarato"),
      "spiega che non dipende dal nostro codice",
    );
  });

  test("prevale ENTRY_MISSED: si guarda il giro di raccolta", () => {
    const counts = emptyCauseCounts();
    counts.ENTRY_MISSED = 5;
    const r = recommendationFor(counts);
    assert(r.headline.includes("giro di raccolta"), "indica il punto giusto");
  });

  test("cause pari merito: nessuna proposta, serve un'altra misura", () => {
    const counts = emptyCauseCounts();
    counts.SOURCE_MISSING = 2;
    counts.MATCH_FAILED = 2;
    const r = recommendationFor(counts);
    assert(r.headline.includes("Nessuna causa prevale"), "non sceglie a caso");
  });

  /* ---------------- tabelle ---------------- */

  test("la tabella allinea le colonne e ha un separatore", () => {
    const out = renderTable(["A", "B"], [["1", "2"]]);
    const lines = out.split("\n");
    assertEqual(lines.length, 3);
    assert(lines[1].includes("─"), "separatore presente");
  });

  test("il delta usa il segno meno tipografico", () => {
    const rows = competitionTableRows([
      {
        leaguePath: "x/y",
        label: "X",
        onSource: 2,
        imported: 1,
        importedWithSeries: 1,
        missed: 1,
        delta: -1,
      },
    ]);
    assertEqual(rows[0][5], "−1");
  });

  test("le intestazioni della tabella competizioni sono sei", () => {
    assertEqual(COMPETITION_TABLE_HEADERS.length, 6);
  });

  /* ================================================================ */
  /* Sprint 6B — strumentazione del giro                              */
  /* ================================================================ */

  console.log("\n=== Strumentazione del giro (6B) ===\n");

  /* ---------------- codici di esclusione ---------------- */

  test("un messaggio marcato si rilegge con il suo codice", () => {
    const msg = taggedExclusion("abc", EXCLUSION_CODES.OUT_OF_WINDOW, "fuori.");
    const parsed = parseExclusion(msg);
    assertEqual(parsed.ref, "abc");
    assertEqual(parsed.code, EXCLUSION_CODES.OUT_OF_WINDOW);
    assertEqual(parsed.explanation, "fuori.");
  });

  test("un messaggio non marcato non riceve un codice inventato", () => {
    const parsed = parseExclusion("abc: qualcosa è andato storto");
    assertEqual(parsed.ref, "abc");
    assertEqual(parsed.code, null);
  });

  test("un codice sconosciuto non viene accettato come valido", () => {
    const parsed = parseExclusion("abc: [codice-mai-visto] testo");
    assertEqual(parsed.code, null);
  });

  test("ogni motivo di esclusione ha un'etichetta", () => {
    for (const r of EXCLUSION_REASONS) {
      assert(EXCLUSION_LABELS[r].length > 0, `etichetta di ${r}`);
    }
  });

  test("codice assente diventa 'altro', non un motivo plausibile", () => {
    assertEqual(reasonForCode(null), "altro");
  });

  test("pagina irraggiungibile è una riga non raggiunta", () => {
    assertEqual(reasonForCode(EXCLUSION_CODES.PAGE_UNREACHABLE), "not_reached");
  });

  test("fuori finestra e tetto per giro sono una nostra scelta, non perdite", () => {
    assertEqual(reasonForCode(EXCLUSION_CODES.OUT_OF_WINDOW), "our_choice");
    assertEqual(reasonForCode(EXCLUSION_CODES.RUN_CAP), "our_choice");
  });

  test("'altro' resta solo per l'esclusione senza codice dichiarato", () => {
    assertEqual(reasonForCode(null), "altro");
  });

  /* ---------------- buildRunCoverage ---------------- */

  function inputWith(over: Partial<RunCoverageInput> = {}): RunCoverageInput {
    return {
      scan: scanSourceRows(LISTING),
      parsedIds: new Set(["aaa11111", "bbb22222", "ccc33333"]),
      problemsByRef: new Map<string, ExclusionNote>(),
      importedIds: new Set(["aaa11111", "bbb22222", "ccc33333"]),
      withOddsIds: new Set(["aaa11111", "bbb22222", "ccc33333"]),
      perBookmakerUnavailable: true,
      nonRealMatches: 0,
      measuredAt: new Date("2026-08-18T20:44:00Z"),
      ...over,
    };
  }

  test("giro completo: visti, lavorati e importati coincidono", () => {
    const c = buildRunCoverage(inputWith());
    assertEqual(c.football, 3, "righe di calcio");
    assertEqual(c.imported, 3, "importate");
    assertEqual(c.lost, 0, "perse");
    assertEqual(c.coverage, 1, "copertura piena");
  });

  test("le righe di altri sport sono contate come 'sport', non perse", () => {
    const c = buildRunCoverage(inputWith());
    assertEqual(c.byReason.sport, 2);
    assertEqual(c.lost, 0, "gli altri sport non sono una perdita");
  });

  test("una riga non importata e senza motivo dichiarato è NOT_REACHED", () => {
    const c = buildRunCoverage(
      inputWith({
        importedIds: new Set(["aaa11111", "ccc33333"]),
        withOddsIds: new Set(["aaa11111", "ccc33333"]),
      }),
    );
    assertEqual(c.lost, 1);
    assertEqual(c.byReason.not_reached, 1);
    const e = c.exclusions.find((x) => x.ref === "bbb22222")!;
    assertEqual(e.reason, "not_reached");
    assert(e.evidence !== null, "il frammento grezzo è allegato");
  });

  test("la perdita etichettata NOT_REACHED non viene corretta, solo dichiarata", () => {
    const c = buildRunCoverage(
      inputWith({
        importedIds: new Set(["aaa11111", "ccc33333"]),
        withOddsIds: new Set(["aaa11111", "ccc33333"]),
      }),
    );
    const e = c.exclusions.find((x) => x.ref === "bbb22222")!;
    assert(
      e.detail.includes("non ancora determinata"),
      "dichiara che la causa non è nota",
    );
  });

  test("il motivo dichiarato dall'adapter vince sull'ipotesi", () => {
    const c = buildRunCoverage(
      inputWith({
        importedIds: new Set(["aaa11111", "ccc33333"]),
        withOddsIds: new Set(["aaa11111", "ccc33333"]),
        problemsByRef: new Map([
          [
            "bbb22222",
            {
              code: EXCLUSION_CODES.OUT_OF_WINDOW,
              explanation: "inizio fuori dalla finestra.",
            },
          ],
        ]),
      }),
    );
    assertEqual(c.byReason.not_reached, 0, "non è una perdita");
    assertEqual(c.byReason.our_choice, 1, "esclusa da una nostra scelta");
    assertEqual(c.byReason.altro, 0, "non è un motivo ignoto");
  });

  test("importata ma senza quote: contata come no_odds", () => {
    const c = buildRunCoverage(
      inputWith({ withOddsIds: new Set(["aaa11111", "ccc33333"]) }),
    );
    assertEqual(c.byReason.no_odds, 1);
    assertEqual(c.lost, 1);
  });

  test("il limite del per-book è dichiarato, non contato come perdita", () => {
    const c = buildRunCoverage(inputWith());
    assertEqual(c.byReason.robots, 3, "una per partita importata");
    assertEqual(c.lost, 0, "non toglie nulla alla copertura");
  });

  test("le fixture dimostrative restano fuori dal conteggio utile", () => {
    const c = buildRunCoverage(inputWith({ nonRealMatches: 6 }));
    assertEqual(c.byReason.demo, 6);
    assert(
      c.notes.some((n) => n.includes("dimostrative")),
      "lo dichiara nelle note",
    );
  });

  test("il conto torna sempre: football = imported + lost", () => {
    const c = buildRunCoverage(
      inputWith({
        importedIds: new Set(["aaa11111"]),
        withOddsIds: new Set(["aaa11111"]),
      }),
    );
    assertEqual(c.football, c.imported + c.lost);
  });

  test("il campione piccolo viene sempre dichiarato", () => {
    const c = buildRunCoverage(inputWith());
    assert(
      c.notes.some((n) => n.includes("Campione piccolo")),
      "la nota è presente",
    );
  });

  test("copertura per competizione, con le perdite in cima", () => {
    const c = buildRunCoverage(
      inputWith({
        importedIds: new Set(["aaa11111", "ccc33333"]),
        withOddsIds: new Set(["aaa11111", "ccc33333"]),
      }),
    );
    assertEqual(c.byCompetition[0].competition, "slovakia/slovak-cup");
    assertEqual(c.byCompetition[0].lost, 1);
    assertEqual(c.byCompetition[0].seen, 2);
  });

  test("elenco vuoto: copertura non calcolabile, non zero", () => {
    const c = buildRunCoverage(
      inputWith({
        scan: scanSourceRows("<table></table>"),
        parsedIds: new Set(),
        importedIds: new Set(),
        withOddsIds: new Set(),
      }),
    );
    assertEqual(c.football, 0);
    assertEqual(c.coverage, null, "null, non 0");
  });

  test("il bilancio dichiara la propria versione di formato", () => {
    assertEqual(buildRunCoverage(inputWith()).version, 1);
  });

  /* ---------------- serie storica ---------------- */

  test("un run senza sezione coverage non è una copertura zero", () => {
    assertEqual(coverageOfRun(1, new Date(), "success", null), null);
    assertEqual(coverageOfRun(1, new Date(), "success", {}), null);
    assertEqual(
      coverageOfRun(1, new Date(), "success", { coverage: { football: "x" } }),
      null,
    );
  });

  test("un run strumentato diventa un punto della serie", () => {
    const meta = { coverage: buildRunCoverage(inputWith()) };
    const p = coverageOfRun(7, new Date("2026-08-18T20:00:00Z"), "success", meta);
    assert(p !== null, "punto letto");
    assertEqual(p!.runId, 7);
    assertEqual(p!.football, 3);
    assertEqual(p!.coverage, 1);
  });

  /* i punti di prova sono giri schedulati salvo indicazione contraria:
     è la profondità della serie che questi test misurano */
  function point(
    id: number,
    hours: number,
    football: number,
    imported: number,
    trigger: RunTrigger = "scheduled",
  ): CoveragePoint {
    return {
      runId: id,
      startedAt: new Date(
        Date.UTC(2026, 7, 18, hours, 0, 0),
      ).toISOString(),
      status: "success",
      football,
      imported,
      lost: football - imported,
      coverage: football === 0 ? null : imported / football,
      byReason: emptyReasonCounts(),
      trigger,
    };
  }

  test("serie vuota: nessun numero inventato", () => {
    const s = coverageSeriesStats([]);
    assertEqual(s.points, 0);
    assertEqual(s.meanCoverage, null);
    assertEqual(s.pooledCoverage, null);
    assert(s.inconclusive, "non concludente");
  });

  test("la copertura complessiva non è la media delle medie", () => {
    const s = coverageSeriesStats([point(1, 10, 10, 5), point(2, 11, 2, 2)]);
    assertEqual(s.totalFootball, 12);
    assertEqual(s.totalImported, 7);
    assertEqual(s.pooledCoverage, 7 / 12);
    assertEqual(s.meanCoverage, (0.5 + 1) / 2);
  });

  test("minimo e massimo della copertura osservata", () => {
    const s = coverageSeriesStats([
      point(1, 10, 10, 5),
      point(2, 11, 10, 9),
      point(3, 12, 10, 7),
    ]);
    assertEqual(s.minCoverage, 0.5);
    assertEqual(s.maxCoverage, 0.9);
  });

  test("sotto la soglia la serie resta non concludente", () => {
    const s = coverageSeriesStats([point(1, 10, 9, 7), point(2, 11, 9, 7)]);
    assert(s.inconclusive, `sotto ${MIN_RUNS_FOR_TREND} giri`);
  });

  test("raggiunta la soglia la serie diventa leggibile", () => {
    const pts = Array.from({ length: MIN_RUNS_FOR_TREND }, (_, i) =>
      point(i, i, 9, 7),
    );
    assert(!coverageSeriesStats(pts).inconclusive, "abbastanza punti");
  });

  test("la durata dell'osservazione è calcolata, non stimata", () => {
    const s = coverageSeriesStats([point(1, 10, 9, 7), point(2, 13, 9, 7)]);
    assertEqual(s.spanHours, 3);
  });

  test("un solo punto: nessuna durata", () => {
    assertEqual(coverageSeriesStats([point(1, 10, 9, 7)]).spanHours, null);
  });

  test("nessun giro: lo dichiara senza fingere una serie", () => {
    const d = describeSeriesDepth(coverageSeriesStats([]));
    assert(d.includes("Nessun giro"), d);
  });

  test("un solo giro è una fotografia, non una serie", () => {
    const d = describeSeriesDepth(coverageSeriesStats([point(1, 10, 9, 7)]));
    assert(d.includes("fotografia"), d);
  });

  test("serie corta: dichiara da quante ore si osserva", () => {
    const d = describeSeriesDepth(
      coverageSeriesStats([point(1, 10, 9, 7), point(2, 13, 9, 7)]),
    );
    assert(d.includes("3.0 ore"), d);
    assert(d.includes("non va letta come tendenza"), d);
  });

  test("i punti senza copertura non falsano la media", () => {
    const s = coverageSeriesStats([point(1, 10, 0, 0), point(2, 11, 10, 5)]);
    assertEqual(s.meanCoverage, 0.5, "il punto senza misura è escluso");
  });


  /* ---------------- secondo tentativo e origine del giro ---------- */

  console.log("\n-- Secondo tentativo e origine del giro --\n");

  test("si ritenta solo la riga che uscirebbe non raggiunta", () => {
    const t = selectRetryTargets(
      inputWith({
        importedIds: new Set(["aaa11111", "ccc33333"]),
        withOddsIds: new Set(["aaa11111", "ccc33333"]),
      }),
    );
    assertEqual(t.length, 1);
    assertEqual(t[0], "bbb22222");
  });

  test("giro pieno: non c'è niente da ritentare", () => {
    assertEqual(selectRetryTargets(inputWith()).length, 0);
  });

  test("una riga senza quote pubblicate non si ritenta", () => {
    /* importata ma senza quota: la fonte non la pubblicava. Insistere
       sarebbe accanirsi su un'assenza dichiarata dalla fonte. */
    const t = selectRetryTargets(
      inputWith({ withOddsIds: new Set(["aaa11111", "ccc33333"]) }),
    );
    assertEqual(t.length, 0);
  });

  test("una riga con motivo già dichiarato non si ritenta", () => {
    const t = selectRetryTargets(
      inputWith({
        importedIds: new Set(["aaa11111", "ccc33333"]),
        withOddsIds: new Set(["aaa11111", "ccc33333"]),
        problemsByRef: new Map<string, ExclusionNote>([
          ["bbb22222", { code: EXCLUSION_CODES.RUN_CAP, explanation: "tetto" }],
        ]),
      }),
    );
    assertEqual(t.length, 0, "il tetto del giro la spiega già");
  });

  test("una riga che il parser non legge non si ritenta", () => {
    const t = selectRetryTargets(
      inputWith({
        parsedIds: new Set(["aaa11111", "ccc33333"]),
        importedIds: new Set(["aaa11111", "ccc33333"]),
        withOddsIds: new Set(["aaa11111", "ccc33333"]),
      }),
    );
    assertEqual(t.length, 0, "lettura fallita: altro problema, non un retry");
  });

  test("i bersagli del retry sono esattamente le righe etichettate NOT_REACHED", () => {
    /* se le due logiche divergessero, il giro ritenterebbe righe diverse
       da quelle che poi dichiara perse */
    const variants: Partial<RunCoverageInput>[] = [
      {},
      {
        importedIds: new Set(["aaa11111"]),
        withOddsIds: new Set(["aaa11111"]),
      },
      {
        importedIds: new Set<string>(),
        withOddsIds: new Set<string>(),
      },
      {
        parsedIds: new Set(["aaa11111"]),
        importedIds: new Set(["aaa11111"]),
        withOddsIds: new Set(["aaa11111"]),
      },
    ];

    for (const over of variants) {
      const input = inputWith(over);
      const labelled = buildRunCoverage(input)
        .exclusions.filter((e) => e.reason === "not_reached")
        .map((e) => e.ref)
        .sort();
      const targets = [...selectRetryTargets(input)].sort();
      assertEqual(
        targets.join(","),
        labelled.join(","),
        `bersagli e etichette devono coincidere (${JSON.stringify(over)})`,
      );
    }
  });

  test("la riga ritentata e ancora mancante lo dichiara", () => {
    const c = buildRunCoverage(
      inputWith({
        importedIds: new Set(["aaa11111", "ccc33333"]),
        withOddsIds: new Set(["aaa11111", "ccc33333"]),
        retriedRefs: new Set(["bbb22222"]),
      }),
    );
    const e = c.exclusions.find((x) => x.ref === "bbb22222")!;
    assertEqual(e.reason, "not_reached", "resta una perdita nostra");
    assert(e.detail.includes("ritentata una volta"), e.detail);
    assert(e.detail.includes("60 secondi"), e.detail);
  });

  test("senza retry il dettaglio resta quello di prima", () => {
    const c = buildRunCoverage(
      inputWith({
        importedIds: new Set(["aaa11111", "ccc33333"]),
        withOddsIds: new Set(["aaa11111", "ccc33333"]),
      }),
    );
    const e = c.exclusions.find((x) => x.ref === "bbb22222")!;
    assert(!e.detail.includes("ritentata"), e.detail);
  });

  test("un giro che non dichiara l'origine è manuale", () => {
    assertEqual(triggerOfRun(null), "manual");
    assertEqual(triggerOfRun({}), "manual");
    assertEqual(triggerOfRun({ trigger: "boh" }), "manual");
    assertEqual(triggerOfRun({ trigger: "scheduled" }), "scheduled");
  });

  test("i giri vecchi non diventano schedulati per sbaglio", () => {
    /* i run precedenti a questo sprint erano tutti manuali: promuoverli
       gonfierebbe la profondità con osservazioni mai avvenute */
    const meta = { coverage: buildRunCoverage(inputWith()) };
    const p = coverageOfRun(9, new Date("2026-08-18T20:00:00Z"), "success", meta);
    assertEqual(p!.trigger, "manual");
  });

  test("solo i giri schedulati fanno profondità", () => {
    const points = [
      ...Array.from({ length: 9 }, (_, i) => point(i + 1, i, 10, 10)),
      point(10, 10, 10, 10, "manual"),
    ];
    const s = coverageSeriesStats(points);
    assertEqual(s.points, 10, "i punti totali restano dieci");
    assertEqual(s.scheduledPoints, 9);
    assertEqual(s.manualPoints, 1);
    assert(s.inconclusive, "nove giri schedulati non bastano");
  });

  test("dieci giri schedulati sbloccano la tendenza", () => {
    const s = coverageSeriesStats(
      Array.from({ length: 10 }, (_, i) => point(i + 1, i, 10, 9)),
    );
    assertEqual(s.scheduledPoints, 10);
    assert(!s.inconclusive, "la soglia è raggiunta");
  });

  test("i giri manuali restano nei totali della misura", () => {
    const s = coverageSeriesStats([
      point(1, 10, 10, 10),
      point(2, 11, 10, 8, "manual"),
    ]);
    assertEqual(s.totalFootball, 20, "la misura conta tutti i giri");
    assertEqual(s.totalImported, 18);
    assertEqual(s.pooledCoverage, 0.9);
  });

  test("la profondità distingue schedulati e manuali", () => {
    const d = describeSeriesDepth(
      coverageSeriesStats([
        point(1, 10, 9, 9),
        point(2, 13, 9, 9, "manual"),
      ]),
    );
    assert(d.includes("1 schedulati"), d);
    assert(d.includes("1 chiesti a mano"), d);
    assert(d.includes("giri schedulati la copertura non va letta"), d);
  });

  /* ---------------------------------------------------------------- */

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Test superati: ${passed} | falliti: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFallimenti:");
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log(`${"─".repeat(60)}\n`);

  if (failed > 0) process.exit(1);
}

main();
