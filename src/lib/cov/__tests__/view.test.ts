/**
 * Test della vista di copertura (Sprint 6C).
 * Eseguire con: npm run test:cov-view
 *
 * Funzioni pure: nessun database, nessuna rete. Qui si verifica una cosa
 * sola ma decisiva — che la pagina non possa mostrare uno zero dove non
 * c'è misura, né sommare fra loro cose di natura diversa.
 */
import {
  buildCoverageView,
  coverageLabel,
  REASON_KIND,
  REASON_SHORT,
  SERIES_INSUFFICIENT_TEXT,
} from "../view";
import {
  coverageSeriesStats,
  describeSeriesDepth,
  emptyReasonCounts,
  EXCLUSION_REASONS,
  MIN_RUNS_FOR_TREND,
  type CoveragePoint,
  type ExclusionReason,
  type RunCoverage,
  type RunTrigger,
} from "../instrument";

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

function coverageOf(over: Partial<RunCoverage> = {}): RunCoverage {
  const byReason = emptyReasonCounts();
  byReason.sport = 13;
  byReason.robots = 11;
  return {
    version: 1,
    measuredAt: "2026-08-18T21:30:09.742Z",
    seen: 24,
    football: 11,
    worked: 11,
    imported: 11,
    lost: 0,
    coverage: 1,
    byReason,
    byCompetition: [
      { competition: "slovakia/slovak-cup", seen: 2, worked: 2, imported: 2, lost: 0 },
    ],
    exclusions: [],
    notes: ["Campione piccolo: 11 righe di calcio in questo giro."],
    ...over,
  };
}

/* punti schedulati salvo indicazione contraria: sono quelli che fanno serie */
function point(
  id: number,
  hours: number,
  football: number,
  imported: number,
  trigger: RunTrigger = "scheduled",
): CoveragePoint {
  return {
    runId: id,
    startedAt: new Date(Date.UTC(2026, 7, 18, hours)).toISOString(),
    status: "success",
    football,
    imported,
    lost: football - imported,
    coverage: football === 0 ? null : imported / football,
    byReason: emptyReasonCounts(),
    trigger,
  };
}

function viewOf(
  latest: RunCoverage | null,
  points: CoveragePoint[],
  scheduler?: {
    running: boolean;
    intervalMinutes: number;
    nextRunMinutes: number | null;
    health?: "running" | "off" | "uncertain";
    silentMinutes?: number | null;
  } | null,
) {
  const stats = coverageSeriesStats(points);
  return buildCoverageView({
    latest,
    latestRunId: latest === null ? null : 114,
    latestStartedAt: latest === null ? null : "2026-08-18T21:30:08.965Z",
    stats,
    depth: describeSeriesDepth(stats),
    runsWithoutMeasure: 4,
    scheduler,
  });
}

function main(): void {
  console.log("\n=== Vista della copertura ===\n");

  /* ---------------- assenza di misura ---------------- */

  test("senza giri strumentati la vista dichiara: non misurato", () => {
    const v = viewOf(null, []);
    assert(!v.measured, "non misurata");
    assert(v.notMeasuredLabel.includes("Non è una copertura zero"), v.notMeasuredLabel);
  });

  test("senza misura la copertura resta null, mai 0", () => {
    const v = viewOf(null, []);
    assertEqual(v.coverage, null);
  });

  test("l'etichetta della copertura assente non è una percentuale", () => {
    assertEqual(coverageLabel(null), "non misurato");
  });

  test("la copertura misurata è stampata con un decimale", () => {
    assertEqual(coverageLabel(1), "100.0%");
    assertEqual(coverageLabel(7 / 9), "77.8%");
  });

  test("copertura zero misurata è diversa da copertura assente", () => {
    assertEqual(coverageLabel(0), "0.0%");
  });

  test("senza misura non si inventano righe di motivi", () => {
    assertEqual(viewOf(null, []).reasons.length, 0);
  });

  /* ---------------- ultimo giro ---------------- */

  test("riporta i numeri dell'ultimo giro senza rielaborarli", () => {
    const v = viewOf(coverageOf(), [point(1, 21, 11, 11)]);
    assertEqual(v.seen, 24);
    assertEqual(v.football, 11);
    assertEqual(v.imported, 11);
    assertEqual(v.lost, 0);
    assertEqual(v.runId, 114);
  });

  test("le perse sono esposte come numero assoluto", () => {
    const c = coverageOf({ imported: 9, lost: 2, coverage: 9 / 11 });
    const v = viewOf(c, [point(1, 21, 11, 9)]);
    assertEqual(v.lost, 2, "numero, non percentuale");
  });

  test("ogni motivo previsto ha una riga, anche a zero", () => {
    const v = viewOf(coverageOf(), [point(1, 21, 11, 11)]);
    assertEqual(v.reasons.length, EXCLUSION_REASONS.length);
    for (const r of EXCLUSION_REASONS) {
      assert(v.reasons.some((x) => x.reason === r), `manca ${r}`);
    }
  });

  test("i conteggi dei motivi vengono dal giro, non ricalcolati", () => {
    const v = viewOf(coverageOf(), [point(1, 21, 11, 11)]);
    assertEqual(v.reasons.find((r) => r.reason === "sport")!.count, 13);
    assertEqual(v.reasons.find((r) => r.reason === "robots")!.count, 11);
  });

  /* ---------------- natura dei motivi ---------------- */

  test("solo senza-quote e non-raggiunte sono perdite del monitor", () => {
    assertEqual(REASON_KIND.no_odds, "perdita");
    assertEqual(REASON_KIND.not_reached, "perdita");
  });

  test("altri sport e dimostrative sono fuori perimetro", () => {
    assertEqual(REASON_KIND.sport, "fuori_perimetro");
    assertEqual(REASON_KIND.demo, "fuori_perimetro");
  });

  test("il per-book non pubblicato è un limite della fonte", () => {
    assertEqual(REASON_KIND.robots, "limite_fonte");
  });

  test("il motivo non attribuito resta in una categoria sua", () => {
    assertEqual(REASON_KIND.altro, "non_classificato");
  });

  test("finestra e tetto per giro sono una nostra scelta, non un'ignota", () => {
    assertEqual(REASON_KIND.our_choice, "nostra_scelta");
    assertEqual(
      REASON_KIND.our_choice === "perdita",
      false,
      "non va colorata come perdita",
    );
  });

  test("le righe non attribuite non entrano nelle perdite dichiarate", () => {
    const byReason = emptyReasonCounts();
    byReason.altro = 4;
    byReason.no_odds = 1;
    const v = viewOf(coverageOf({ byReason }), [point(1, 21, 11, 8)]);
    assertEqual(v.lossesDeclared, 1, "solo la riga senza quote è una perdita");
    const row = v.reasons.find((r) => r.reason === "altro");
    assertEqual(row?.count, 4);
    assertEqual(row?.kind, "non_classificato");
  });

  test("le perdite dichiarate sommano solo le perdite vere", () => {
    const byReason = emptyReasonCounts();
    byReason.sport = 13;
    byReason.robots = 11;
    byReason.demo = 6;
    byReason.no_odds = 1;
    byReason.not_reached = 2;
    const v = viewOf(coverageOf({ byReason }), [point(1, 21, 11, 8)]);
    assertEqual(v.lossesDeclared, 3, "1 senza quote + 2 non raggiunte");
  });

  test("robots e sport non gonfiano il conto delle perdite", () => {
    const v = viewOf(coverageOf(), [point(1, 21, 11, 11)]);
    assertEqual(v.lossesDeclared, 0, "24 righe escluse, zero perdite nostre");
  });

  test("ogni motivo ha un'etichetta breve", () => {
    for (const r of EXCLUSION_REASONS) {
      assert(REASON_SHORT[r as ExclusionReason].length > 0, `etichetta di ${r}`);
    }
  });

  /* ---------------- profondità della serie ---------------- */

  test("un solo giro: serie insufficiente, dichiarata 1/10", () => {
    const v = viewOf(coverageOf(), [point(1, 21, 11, 11)]);
    assertEqual(v.runs, 1);
    assertEqual(v.runsNeeded, MIN_RUNS_FOR_TREND);
    assertEqual(v.seriesLabel, "1/10 giri");
    assert(v.seriesInsufficient, "insufficiente");
  });

  test("la frase sulla serie corta è quella concordata", () => {
    assertEqual(SERIES_INSUFFICIENT_TEXT, "Serie insufficiente, niente tendenza.");
  });

  test("nessun giro: serie 0/10, comunque insufficiente", () => {
    const v = viewOf(null, []);
    assertEqual(v.seriesLabel, "0/10 giri");
    assert(v.seriesInsufficient, "insufficiente");
  });

  test("raggiunti i dieci giri la serie non è più insufficiente", () => {
    const pts = Array.from({ length: MIN_RUNS_FOR_TREND }, (_, i) => point(i, i, 11, 9));
    const v = viewOf(coverageOf(), pts);
    assert(!v.seriesInsufficient, "abbastanza punti");
    assertEqual(v.seriesLabel, "10/10 giri");
  });

  test("la frase di profondità arriva dalla misura, non dalla vista", () => {
    const v = viewOf(coverageOf(), [point(1, 21, 11, 11)]);
    assert(v.depth.includes("fotografia"), v.depth);
  });

  test("i giri senza misura restano contati a parte", () => {
    assertEqual(viewOf(coverageOf(), [point(1, 21, 11, 11)]).runsWithoutMeasure, 4);
  });

  /* ---------------- competizioni e note ---------------- */

  test("le competizioni sono riportate con viste, importate e perse", () => {
    const v = viewOf(coverageOf(), [point(1, 21, 11, 11)]);
    assertEqual(v.competitions.length, 1);
    assertEqual(v.competitions[0].competition, "slovakia/slovak-cup");
    assertEqual(v.competitions[0].seen, 2);
  });

  test("le note del giro arrivano intatte alla pagina", () => {
    const v = viewOf(coverageOf(), [point(1, 21, 11, 11)]);
    assert(v.notes.some((n) => n.includes("Campione piccolo")), "nota presente");
  });

  test("elenco senza calcio: copertura non calcolabile, non zero", () => {
    const c = coverageOf({ football: 0, imported: 0, lost: 0, coverage: null });
    const v = viewOf(c, [point(1, 21, 0, 0)]);
    assertEqual(v.coverage, null);
    assertEqual(coverageLabel(v.coverage), "non misurato");
  });


  /* ---------------- runner schedulato ---------------- */

  console.log("\n-- Runner schedulato --\n");

  test("senza notizie del runner non si scrive niente", () => {
    const v = viewOf(coverageOf(), [point(1, 10, 11, 11)]);
    assertEqual(v.schedulerLabel, null);
    assertEqual(v.nextRunMinutes, null);
  });

  test("runner attivo: dichiara intervallo e prossimo giro", () => {
    const v = viewOf(coverageOf(), [point(1, 10, 11, 11)], {
      running: true,
      intervalMinutes: 45,
      nextRunMinutes: 12,
    });
    assertEqual(v.nextRunMinutes, 12);
    assert(v.schedulerLabel!.includes("ogni 45 minuti"), v.schedulerLabel!);
    assert(v.schedulerLabel!.includes("fra 12 min"), v.schedulerLabel!);
  });

  test("giro imminente: si dice a momenti, non fra 0 minuti", () => {
    const v = viewOf(coverageOf(), [point(1, 10, 11, 11)], {
      running: true,
      intervalMinutes: 45,
      nextRunMinutes: 0,
    });
    assert(v.schedulerLabel!.includes("a momenti"), v.schedulerLabel!);
  });

  test("runner spento: si dichiara che la serie non avanza da sola", () => {
    const v = viewOf(coverageOf(), [point(1, 10, 11, 11)], {
      running: false,
      intervalMinutes: 45,
      nextRunMinutes: null,
    });
    assertEqual(v.nextRunMinutes, null);
    assert(v.schedulerLabel!.includes("non attiva"), v.schedulerLabel!);
    assertEqual(v.schedulerUncertain, false);
  });

  test("stato incerto: nessun orario, si dichiara l'incertezza", () => {
    const v = viewOf(coverageOf(), [point(1, 10, 11, 11)], {
      running: false,
      intervalMinutes: 45,
      nextRunMinutes: null,
      health: "uncertain",
      silentMinutes: 120,
    });
    assertEqual(v.nextRunMinutes, null);
    assertEqual(v.schedulerUncertain, true);
    assert(v.schedulerLabel!.includes("Stato incerto"), v.schedulerLabel!);
    assert(!v.schedulerLabel!.includes("prossimo giro"), v.schedulerLabel!);
  });

  test("stato incerto: il silenzio lungo si dice in ore", () => {
    const v = viewOf(coverageOf(), [point(1, 10, 11, 11)], {
      running: false,
      intervalMinutes: 45,
      nextRunMinutes: null,
      health: "uncertain",
      silentMinutes: 300,
    });
    assert(v.schedulerLabel!.includes("5 h"), v.schedulerLabel!);
  });

  test("stato incerto senza durata: si dichiara comunque", () => {
    const v = viewOf(coverageOf(), [point(1, 10, 11, 11)], {
      running: false,
      intervalMinutes: 45,
      nextRunMinutes: null,
      health: "uncertain",
      silentMinutes: null,
    });
    assertEqual(v.schedulerUncertain, true);
    assert(v.schedulerLabel!.includes("Stato incerto"), v.schedulerLabel!);
  });

  test("health assente: si ricade sul flag, come prima", () => {
    const v = viewOf(coverageOf(), [point(1, 10, 11, 11)], {
      running: true,
      intervalMinutes: 45,
      nextRunMinutes: 12,
    });
    assertEqual(v.schedulerUncertain, false);
    assert(v.schedulerLabel!.includes("fra 12 min"), v.schedulerLabel!);
  });

  test("la soglia conta i soli giri schedulati", () => {
    const points = [
      ...Array.from({ length: 9 }, (_, i) => point(i + 1, i, 10, 10)),
      point(10, 10, 10, 10, "manual"),
    ];
    const v = viewOf(coverageOf(), points);
    assertEqual(v.runs, 9, "i manuali non fanno profondità");
    assertEqual(v.manualRuns, 1);
    assertEqual(v.seriesLabel, `9/${MIN_RUNS_FOR_TREND} giri`);
    assert(v.seriesInsufficient, "nove schedulati non bastano");
  });

  test("dieci giri schedulati: la serie diventa leggibile", () => {
    const v = viewOf(
      coverageOf(),
      Array.from({ length: 10 }, (_, i) => point(i + 1, i, 10, 10)),
    );
    assertEqual(v.runs, 10);
    assertEqual(v.manualRuns, 0);
    assert(!v.seriesInsufficient, "dieci schedulati bastano");
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
