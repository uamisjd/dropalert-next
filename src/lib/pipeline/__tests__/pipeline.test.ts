/**
 * Test della pipeline di persistenza — richiede un PostgreSQL raggiungibile.
 * Eseguire con: npm run test:pipeline
 *
 * Le fixture usano la chiave "pipetest-*" e vengono rimosse a fine corsa,
 * sia in caso di successo sia in caso di errore. Nessun dato di test resta
 * nel database e nessuna fixture è mai presentata come dato reale.
 */
import { and, eq, like, inArray } from "drizzle-orm";
import { db, sql } from "@/db/client";
import {
  bookmakers,
  closingLines,
  clvRecords,
  collectorRuns,
  dataGaps,
  dropSignals,
  leagues,
  matches,
  oddsSnapshots,
  signalEvents,
  sourceHealth,
  systemState,
  teams,
} from "@/db/schema";
import {
  classifyEvent,
  detectForMatch,
  gapsFromAnalysis,
  getSignalRow,
  nextStatus,
  recordGap,
} from "../detect";
import {
  captureClosingForMarket,
  captureClosingLine,
  computeClvForSignal,
  getClosingConsensus,
  getClosingReference,
  MIN_SAMPLE_PER_BUCKET,
  summarizeClvByScoreBucket,
} from "../closing";
import {
  readCycleClaim,
  readGateMoment,
  readLastCycle,
  readSchedulerConfig,
  runCycle,
  shouldRunNow,
  writeCycleClaim,
  writeLastCycle,
  CYCLE_CLAIM_KEY,
  LAST_CYCLE_KEY,
  type LastCycleState,
} from "../scheduler";
import {
  BLOCKED_AFTER_CONSECUTIVE_ERRORS,
  deriveSourceStatus,
  finishRun,
  recordSourcePing,
  startRun,
} from "../runs";
import { num } from "@/lib/drop/math";
import type { DropAnalysis } from "@/lib/drop/types";
import { getCoverageHistory } from "@/lib/repo/coverage-history";
import { COLLECTOR_KEY } from "@/lib/providers/betexplorer/collect";

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  ✗ ${name}\n      ${msg}`);
  }
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, label = ""): void {
  if (actual !== expected) {
    throw new Error(
      `${label ? label + ": " : ""}atteso ${String(expected)}, ottenuto ${String(actual)}`,
    );
  }
}

function group(name: string): void {
  console.log(`\n▸ ${name}`);
}

const PREFIX = "pipetest";

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

interface Fixture {
  leagueId: number;
  matchId: number;
  bookIds: number[];
  sharpId: number;
}

/** Rimuove ogni traccia delle fixture di test. */
async function cleanup(): Promise<void> {
  const m = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.key, `${PREFIX}-%`));
  const ids = m.map((r) => r.id);

  if (ids.length > 0) {
    const sigs = await db
      .select({ id: dropSignals.id })
      .from(dropSignals)
      .where(inArray(dropSignals.matchId, ids));
    const sigIds = sigs.map((s) => s.id);
    if (sigIds.length > 0) {
      await db.delete(signalEvents).where(inArray(signalEvents.signalId, sigIds));
      await db.delete(clvRecords).where(inArray(clvRecords.signalId, sigIds));
    }
    await db.delete(dataGaps).where(inArray(dataGaps.matchId, ids));
    await db.delete(closingLines).where(inArray(closingLines.matchId, ids));
    await db.delete(oddsSnapshots).where(inArray(oddsSnapshots.matchId, ids));
    await db.delete(dropSignals).where(inArray(dropSignals.matchId, ids));
    await db.delete(matches).where(inArray(matches.id, ids));
  }

  await db.delete(teams).where(like(teams.key, `${PREFIX}-%`));
  await db.delete(leagues).where(like(leagues.key, `${PREFIX}-%`));
  await db.delete(bookmakers).where(like(bookmakers.key, `${PREFIX}-%`));
  await db.delete(sourceHealth).where(like(sourceHealth.sourceKey, `${PREFIX}-%`));
  await db.delete(collectorRuns).where(like(collectorRuns.collectorKey, `${PREFIX}-%`));
  /* i giri dello scheduler avviati dai test non devono restare a registro */
  await db.delete(collectorRuns).where(eq(collectorRuns.collectorKey, "scheduler-cycle"));

  await restoreCycleState();
}

/* ------------------------------------------------------------------ */
/* Stato dello scheduler: preso in prestito, non requisito             */
/* ------------------------------------------------------------------ */

/**
 * I test del gate devono scrivere `scheduler:last_cycle`, che è lo stesso
 * record su cui si regge il runner in produzione. Senza ripristino, una
 * corsa di test lascia scritto "ultimo giro: adesso" e il primo giro
 * schedulato reale trova il gate chiuso per l'intera durata
 * dell'intervallo: la serie non avanza e sembra un difetto dello
 * scheduler. Qui lo stato viene salvato prima di toccarlo e rimesso
 * com'era alla fine.
 */
let savedLastCycle: { present: boolean; value: LastCycleState | null } | null = null;

/* Il tentativo di giro (`scheduler:cycle_claim`) va trattato come l'esito:
   è la chiave che il gate rispetta, e una corsa di test che la lasciasse
   scritta a «adesso» terrebbe chiusa la gate della produzione per un
   intervallo intero. */
let savedClaim: { present: boolean; at: Date | null } | null = null;

async function borrowCycleState(): Promise<void> {
  if (savedLastCycle === null) {
    const value = await readLastCycle();
    savedLastCycle = { present: value !== null, value };
  }
  if (savedClaim === null) {
    const at = await readCycleClaim();
    savedClaim = { present: at !== null, at };
  }
}

async function restoreCycleState(): Promise<void> {
  if (savedLastCycle !== null) {
    const saved = savedLastCycle;
    savedLastCycle = null;
    if (saved.present && saved.value !== null) {
      await writeLastCycle(saved.value);
    } else {
      await db.delete(systemState).where(eq(systemState.key, LAST_CYCLE_KEY));
    }
  }
  if (savedClaim !== null) {
    const saved = savedClaim;
    savedClaim = null;
    if (saved.present && saved.at !== null) {
      await writeCycleClaim(saved.at);
    } else {
      await db.delete(systemState).where(eq(systemState.key, CYCLE_CLAIM_KEY));
    }
  }
}

/**
 * Crea una partita con un drop coordinato e sostenuto.
 * kickoff: `hoursFromNow` ore da adesso (negativo = già iniziata).
 */
async function makeFixture(opts: {
  key: string;
  hoursFromNow: number;
  /** prezzo iniziale e finale del consenso */
  from: number;
  to: number;
  bookCount: number;
  /** durata del movimento in minuti */
  spanMinutes: number;
}): Promise<Fixture> {
  const now = Date.now();
  const kickoffAt = new Date(now + opts.hoursFromNow * 3600_000);

  const [league] = await db
    .insert(leagues)
    .values({
      key: `${PREFIX}-league`,
      name: "Lega di test",
      country: "Test",
    })
    .onConflictDoNothing()
    .returning({ id: leagues.id });

  const leagueId =
    league?.id ??
    (
      await db
        .select({ id: leagues.id })
        .from(leagues)
        .where(eq(leagues.key, `${PREFIX}-league`))
        .limit(1)
    )[0].id;

  const teamRows = await db
    .insert(teams)
    .values([
      { key: `${PREFIX}-home-${opts.key}`, name: "Test Home" },
      { key: `${PREFIX}-away-${opts.key}`, name: "Test Away" },
    ])
    .returning({ id: teams.id });

  const [match] = await db
    .insert(matches)
    .values({
      key: `${PREFIX}-${opts.key}`,
      leagueId,
      homeTeamId: teamRows[0].id,
      awayTeamId: teamRows[1].id,
      kickoffAt,
      status: opts.hoursFromNow < 0 ? "live" : "scheduled",
    })
    .returning({ id: matches.id });

  const bookValues = Array.from({ length: opts.bookCount }, (_, i) => ({
    key: `${PREFIX}-book-${i}`,
    name: `Test Book ${i}`,
    isSharp: i === 0,
    weight: i === 0 ? "2.00" : "1.00",
  }));

  await db.insert(bookmakers).values(bookValues).onConflictDoNothing();
  const bookRows = await db
    .select({ id: bookmakers.id, key: bookmakers.key })
    .from(bookmakers)
    .where(like(bookmakers.key, `${PREFIX}-book-%`));

  // serie temporale: 6 punti per book dal prezzo iniziale al finale
  const points = 6;
  const rows = [];
  for (const b of bookRows) {
    for (let p = 0; p < points; p += 1) {
      const frac = p / (points - 1);
      const price = opts.from + (opts.to - opts.from) * frac;
      /* La serie termina all'ultimo istante realmente osservabile: "adesso"
         per una partita futura, un minuto prima del fischio d'inizio per una
         già iniziata. Ancorarla al kickoff produrrebbe snapshot nel futuro. */
      const endAt = Math.min(now, kickoffAt.getTime() - 60000);
      const collectedAt = new Date(
        endAt - (1 - frac) * opts.spanMinutes * 60000,
      );
      rows.push({
        matchId: match.id,
        bookmakerId: b.id,
        market: "1x2" as const,
        selection: "home" as const,
        price: price.toFixed(3),
        impliedProb: (1 / price).toFixed(6),
        collectedAt,
        source: `${PREFIX}-fixture`,
      });
    }
  }
  await db.insert(oddsSnapshots).values(rows);

  return {
    leagueId,
    matchId: match.id,
    bookIds: bookRows.map((b) => b.id),
    sharpId: bookRows[0].id,
  };
}

/* ------------------------------------------------------------------ */
/* Test                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log("\nTest pipeline di persistenza\n" + "═".repeat(60));

  await cleanup();

  /* --- logica pura, senza DB --- */
  group("Transizioni di stato");

  const baseAnalysis = (over: Partial<DropAnalysis>): DropAnalysis =>
    ({
      matchId: 1,
      market: "1x2",
      selection: "home",
      magnitude: { isSignificant: true, deltaPp: 6 },
      persistence: { rebounded: false, isFlash: false },
      coverage: { score: 0.8, booksObserved: 6, booksExpected: 6, staleSeries: 0 },
      ...over,
    }) as DropAnalysis;

  await test("partita iniziata → closed", () => {
    const s = nextStatus(
      baseAnalysis({}),
      new Date(Date.now() - 1000),
      new Date(),
      "active",
    );
    assertEqual(s, "closed");
  });

  await test("uno stato closed non torna indietro", () => {
    const s = nextStatus(
      baseAnalysis({}),
      new Date(Date.now() + 3600_000),
      new Date(),
      "closed",
    );
    assertEqual(s, "closed");
  });

  await test("movimento rientrato → rebounded", () => {
    const s = nextStatus(
      baseAnalysis({
        persistence: { rebounded: true, isFlash: false },
      } as Partial<DropAnalysis>),
      new Date(Date.now() + 3600_000),
      new Date(),
      "active",
    );
    assertEqual(s, "rebounded");
  });

  await test("movimento flash resta forming", () => {
    const s = nextStatus(
      baseAnalysis({
        persistence: { rebounded: false, isFlash: true },
      } as Partial<DropAnalysis>),
      new Date(Date.now() + 3600_000),
      new Date(),
      null,
    );
    assertEqual(s, "forming");
  });

  await test("copertura crollata → expired", () => {
    const s = nextStatus(
      baseAnalysis({
        coverage: {
          score: 0.1,
          booksObserved: 1,
          booksExpected: 8,
          staleSeries: 0,
        },
      } as Partial<DropAnalysis>),
      new Date(Date.now() + 3600_000),
      new Date(),
      "active",
    );
    assertEqual(s, "expired");
  });

  group("Classificazione degli eventi");

  await test("primo rilevamento è 'detected'", () => {
    assertEqual(classifyEvent(null, { confidenceScore: 50, status: "active" }), "detected");
  });

  await test("rafforzamento oltre 5 punti", () => {
    assertEqual(
      classifyEvent(
        { confidenceScore: 50, status: "active" },
        { confidenceScore: 58, status: "active" },
      ),
      "strengthened",
    );
  });

  await test("indebolimento oltre 5 punti", () => {
    assertEqual(
      classifyEvent(
        { confidenceScore: 60, status: "active" },
        { confidenceScore: 52, status: "active" },
      ),
      "weakened",
    );
  });

  await test("variazione trascurabile non genera evento", () => {
    assertEqual(
      classifyEvent(
        { confidenceScore: 50, status: "active" },
        { confidenceScore: 52, status: "active" },
      ),
      null,
    );
  });

  group("Derivazione dei buchi dati");

  await test("bookmaker mancanti producono un gap", () => {
    const gaps = gapsFromAnalysis(
      baseAnalysis({
        coverage: {
          score: 0.5,
          booksObserved: 3,
          booksExpected: 8,
          staleSeries: 0,
        },
      } as Partial<DropAnalysis>),
    );
    assert(
      gaps.some((g) => g.reason === "bookmaker_missing"),
      "atteso gap bookmaker_missing",
    );
  });

  await test("copertura piena non produce gap", () => {
    const gaps = gapsFromAnalysis(
      baseAnalysis({
        coverage: {
          score: 1,
          booksObserved: 8,
          booksExpected: 8,
          staleSeries: 0,
        },
      } as Partial<DropAnalysis>),
    );
    assertEqual(gaps.length, 0);
  });

  group("Salute delle fonti");

  await test("esito ok → stato ok", () => {
    assertEqual(deriveSourceStatus("ok", 0), "ok");
  });

  await test("esito parziale → degraded", () => {
    assertEqual(deriveSourceStatus("partial", 0), "degraded");
  });

  await test("errori consecutivi oltre soglia → blocked", () => {
    assertEqual(
      deriveSourceStatus("error", BLOCKED_AFTER_CONSECUTIVE_ERRORS),
      "blocked",
    );
  });

  await test("primo errore non blocca subito la fonte", () => {
    assertEqual(deriveSourceStatus("error", 1), "degraded");
  });

  /* --- integrazione con il database --- */
  group("Persistenza dei segnali");

  const fx = await makeFixture({
    key: "drop",
    hoursFromNow: 4,
    from: 2.6,
    to: 2.05,
    bookCount: 6,
    spanMinutes: 600,
  });

  await test("il rilevamento crea il segnale", async () => {
    const { outcomes } = await detectForMatch(fx.matchId, new Date(Date.now() + 4 * 3600_000));
    const created = outcomes.filter((o) => o.action === "created");
    assert(created.length >= 1, `atteso almeno un segnale creato, ottenuti ${outcomes.length} esiti`);
  });

  await test("il segnale persistito ha prezzo congelato e delta positivo", async () => {
    const row = await getSignalRow(fx.matchId, "1x2", "home");
    assert(row !== null, "segnale non trovato a database");
    assert(num(row!.detectedPrice) !== null, "detectedPrice non valorizzato");
    assert((num(row!.deltaPp) ?? 0) > 0, "delta atteso positivo (quota in calo)");
  });

  await test("il primo rilevamento scrive un evento 'detected'", async () => {
    const row = await getSignalRow(fx.matchId, "1x2", "home");
    const events = await db
      .select()
      .from(signalEvents)
      .where(eq(signalEvents.signalId, row!.id));
    assert(
      events.some((e) => e.kind === "detected"),
      "evento 'detected' assente",
    );
  });

  await test("rieseguire il job è idempotente: nessun duplicato", async () => {
    await detectForMatch(fx.matchId, new Date(Date.now() + 4 * 3600_000));
    const rows = await db
      .select()
      .from(dropSignals)
      .where(
        and(
          eq(dropSignals.matchId, fx.matchId),
          eq(dropSignals.market, "1x2"),
          eq(dropSignals.selection, "home"),
        ),
      );
    assertEqual(rows.length, 1, "atteso un solo segnale per (partita, mercato, selezione)");
  });

  await test("il prezzo congelato non cambia dopo una riesecuzione", async () => {
    const before = await getSignalRow(fx.matchId, "1x2", "home");
    const frozen = before!.detectedPrice;
    // nuovo snapshot che sposta ancora il consenso
    const rows = fx.bookIds.map((b) => ({
      matchId: fx.matchId,
      bookmakerId: b,
      market: "1x2" as const,
      selection: "home" as const,
      price: "1.900",
      impliedProb: (1 / 1.9).toFixed(6),
      collectedAt: new Date(),
      source: `${PREFIX}-fixture`,
    }));
    await db.insert(oddsSnapshots).values(rows);
    await detectForMatch(fx.matchId, new Date(Date.now() + 4 * 3600_000));
    const after = await getSignalRow(fx.matchId, "1x2", "home");
    assertEqual(after!.detectedPrice, frozen, "detectedPrice è stato riscritto");
    assert(
      num(after!.currentPrice)! < num(before!.currentPrice)!,
      "currentPrice avrebbe dovuto aggiornarsi",
    );
  });

  group("Buchi dati");

  await test("recordGap è idempotente sullo stesso motivo aperto", async () => {
    const first = await recordGap({
      matchId: fx.matchId,
      market: "btts",
      reason: "market_not_offered",
      detail: "test",
    });
    const second = await recordGap({
      matchId: fx.matchId,
      market: "btts",
      reason: "market_not_offered",
      detail: "test",
    });
    assertEqual(first, true, "il primo gap doveva essere creato");
    assertEqual(second, false, "il secondo gap non doveva essere duplicato");
  });

  group("Closing line e CLV");

  const past = await makeFixture({
    key: "closed",
    hoursFromNow: -2,
    from: 2.5,
    to: 2.0,
    bookCount: 5,
    spanMinutes: 300,
  });
  const pastKickoff = new Date(Date.now() - 2 * 3600_000);

  await test("cattura della closing line dai prezzi precedenti al kickoff", async () => {
    await detectForMatch(past.matchId, pastKickoff, new Date(Date.now() - 3 * 3600_000));
    const outcome = await captureClosingLine(past.matchId, pastKickoff, "1x2", "home");
    assertEqual(outcome.action, "captured");
    assert(outcome.booksUsed > 0, "nessun bookmaker usato per la chiusura");
    assert(outcome.closingPrice !== null, "prezzo di chiusura nullo");
  });

  await test("la chiusura di consenso è leggibile", async () => {
    const consensus = await getClosingConsensus(past.matchId, "1x2", "home");
    assert(consensus !== null, "consenso di chiusura assente");
    assert(consensus! > 1.5 && consensus! < 2.5, `consenso fuori range: ${consensus}`);
  });

  await test("il CLV viene calcolato contro la chiusura", async () => {
    const signal = await getSignalRow(past.matchId, "1x2", "home");
    assert(signal !== null, "segnale della partita passata assente");
    const clv = await computeClvForSignal(signal!.id);
    assertEqual(clv.action, "computed");
    assert(clv.clvPp !== null, "clvPp non calcolato");
    assert(typeof clv.beatClose === "boolean", "beatClose non valorizzato");
  });

  await test("il CLV non viene ricalcolato due volte", async () => {
    const signal = await getSignalRow(past.matchId, "1x2", "home");
    const again = await computeClvForSignal(signal!.id);
    assertEqual(again.action, "already_present");
  });

  await test("senza closing line non si inventa un CLV", async () => {
    const orphan = await makeFixture({
      key: "nolines",
      hoursFromNow: 3,
      from: 2.4,
      to: 2.0,
      bookCount: 4,
      spanMinutes: 200,
    });
    await detectForMatch(orphan.matchId, new Date(Date.now() + 3 * 3600_000));
    const signal = await getSignalRow(orphan.matchId, "1x2", "home");
    const clv = await computeClvForSignal(signal!.id);
    assertEqual(clv.action, "missing_closing");
    assertEqual(clv.clvPp, null);
  });

  await test("mercato incompleto: chiusura grezza, base dichiarata", async () => {
    /* La fixture "closed" ha solo la selezione home: nessun bookmaker può
       avere il mercato 1x2 completo, quindi il fair non è calcolabile e il
       riferimento deve dichiarare la base grezza invece di fingere. */
    const ref = await getClosingReference(past.matchId, "1x2", "home");
    assert(ref !== null, "riferimento di chiusura assente");
    assertEqual(ref!.basis, "raw_consensus");
    assertEqual(ref!.margin, null);
  });

  await test("mercato incompleto: gap market_not_offered dichiarato", async () => {
    const gaps = await db
      .select()
      .from(dataGaps)
      .where(
        and(eq(dataGaps.matchId, past.matchId), eq(dataGaps.reason, "market_not_offered")),
      );
    assert(gaps.length > 0, "il mercato incompleto doveva lasciare un buco dichiarato");
  });

  group("Chiusura fair senza margine");

  /* Fixture con la terna 1X2 completa: qui il no-vig è calcolabile. */
  const fullMkt = await makeFixture({
    key: "fullmarket",
    hoursFromNow: -3,
    from: 2.2,
    to: 1.85,
    bookCount: 3,
    spanMinutes: 240,
  });
  const fullKickoff = new Date(Date.now() - 3 * 3600_000);

  await test("terna completa: la closing line include il fair no-vig", async () => {
    /* completiamo il mercato con draw e away sugli stessi bookmaker */
    const extra = [];
    for (const bookId of fullMkt.bookIds) {
      for (const [selection, price] of [
        ["draw", 3.6],
        ["away", 4.2],
      ] as const) {
        extra.push({
          matchId: fullMkt.matchId,
          bookmakerId: bookId,
          market: "1x2" as const,
          selection,
          price: price.toFixed(3),
          impliedProb: (1 / price).toFixed(6),
          collectedAt: new Date(fullKickoff.getTime() - 5 * 60000),
          source: `${PREFIX}-fixture`,
        });
      }
    }
    await db.insert(oddsSnapshots).values(extra);

    const outcomes = await captureClosingForMarket(fullMkt.matchId, fullKickoff, "1x2");
    assertEqual(outcomes.length, 3, "attese tre selezioni chiuse");
    const home = outcomes.find((o) => o.selection === "home");
    assert(home !== undefined && home.action === "captured", "home non catturata");
    assert(home!.fairClosingPrice !== null, "fair non calcolato su mercato completo");
    assert(
      home!.fairClosingPrice! > home!.closingPrice!,
      "la quota fair deve superare quella grezza",
    );
  });

  await test("le probabilità fair salvate sommano a 1", async () => {
    const rows = await db
      .select({
        selection: closingLines.selection,
        fairProb: closingLines.fairClosingProb,
        margin: closingLines.marketMargin,
      })
      .from(closingLines)
      .where(
        and(
          eq(closingLines.matchId, fullMkt.matchId),
          eq(closingLines.market, "1x2"),
          eq(closingLines.bookmakerId, fullMkt.bookIds[0]),
        ),
      );
    assertEqual(rows.length, 3);
    const sum = rows.reduce((acc, r) => acc + (num(r.fairProb) ?? 0), 0);
    assert(Math.abs(sum - 1) < 1e-4, `somma probabilità fair ${sum}, attesa 1`);
    assert((num(rows[0].margin) ?? 0) > 0, "margine non registrato");
  });

  await test("il riferimento di chiusura preferisce la base fair", async () => {
    const ref = await getClosingReference(fullMkt.matchId, "1x2", "home");
    assert(ref !== null, "riferimento assente");
    assertEqual(ref!.basis, "fair_novig");
    assert(ref!.margin !== null && ref!.margin > 0, "margine mediano non dichiarato");
  });

  await test("il CLV registra la base usata e il punteggio del segnale", async () => {
    await detectForMatch(
      fullMkt.matchId,
      fullKickoff,
      new Date(Date.now() - 4 * 3600_000),
    );
    const signal = await getSignalRow(fullMkt.matchId, "1x2", "home");
    assert(signal !== null, "segnale assente sulla fixture a mercato completo");
    const clv = await computeClvForSignal(signal!.id);
    assertEqual(clv.action, "computed");
    assertEqual(clv.basis, "fair_novig");

    const [row] = await db
      .select()
      .from(clvRecords)
      .where(eq(clvRecords.signalId, signal!.id));
    assertEqual(row.closingBasis, "fair_novig");
    assert(num(row.marketMargin) !== null, "margine non propagato al record CLV");
    assert(num(row.signalScore) !== null, "punteggio del segnale non propagato");
  });

  await test("la chiusura non si riscrive a una seconda passata", async () => {
    const outcomes = await captureClosingForMarket(fullMkt.matchId, fullKickoff, "1x2");
    assert(
      outcomes.every((o) => o.action === "already_present"),
      "una closing line già acquisita non deve essere riscritta",
    );
  });

  group("Riepilogo CLV per fascia di indice");

  await test("il riepilogo non infersce sotto la soglia di campione", async () => {
    const summary = await summarizeClvByScoreBucket();
    assertEqual(summary.buckets.length, 4, "attese quattro fasce, anche se vuote");
    for (const row of summary.buckets) {
      if (row.sampleSize < MIN_SAMPLE_PER_BUCKET) {
        assert(
          row.underpowered,
          `fascia ${row.bucket} con ${row.sampleSize} osservazioni doveva essere dichiarata insufficiente`,
        );
      }
      assert(
        row.note.length > 0 && !/consigl|scommett|punta|garant/i.test(row.note),
        `la nota della fascia ${row.bucket} non deve contenere linguaggio di consiglio`,
      );
      if (row.sampleSize === 0) {
        assertEqual(row.avgClvPp, null, "fascia vuota non deve avere una media");
        assertEqual(row.beatCloseRate, null, "fascia vuota non deve avere un tasso");
      }
    }
    assert(summary.total >= 0 && summary.unclassified >= 0, "conteggi coerenti");
  });

  group("Scheduler — giro senza rete");

  await test("il giro salta la raccolta se l'intervallo non è trascorso", async () => {
    await borrowCycleState();
    await writeLastCycle({
      at: new Date().toISOString(),
      status: "success",
      snapshotsWritten: 0,
      signalsTouched: 0,
      closingLinesCaptured: 0,
      clvComputed: 0,
    });
    const report = await runCycle({ skipCollect: true, matchIds: [fullMkt.matchId] });
    assertEqual(report.collect.executed, false);
    assert(report.status !== "failed", `giro fallito: ${report.errors.join("; ")}`);
  });

  await test("ogni giro lascia una riga in collector_runs", async () => {
    const report = await runCycle({ skipCollect: true, matchIds: [fullMkt.matchId] });
    const [row] = await db
      .select()
      .from(collectorRuns)
      .where(eq(collectorRuns.id, report.runId));
    assert(row !== undefined, "run non registrato");
    assertEqual(row.collectorKey, "scheduler-cycle");
    assert(row.finishedAt !== null, "run non chiuso");
  });

  await test("il fallback collect-only chiude il run senza fingere analisi", async () => {
    await borrowCycleState();
    let received: Record<string, unknown> = {};
    const report = await runCycle({
      mode: "collect_only",
      force: true,
      trigger: "scheduled",
      collector: async (options) => {
        received = options as unknown as Record<string, unknown>;
        return {
          status: "success",
          fixturesSeen: 3,
          matchesUpserted: 3,
          matchesCreated: 0,
          snapshotsWritten: 9,
          snapshotsSkipped: 0,
          resultsUpdated: 0,
          resultsPending: 0,
          problems: [],
          latencyMs: 10,
          payloadBytes: 100,
          trigger: "scheduled",
          retry: { attempted: 0, recovered: 0, stillMissing: 0, refs: [] },
        };
      },
    });

    assertEqual(report.mode, "collect_only");
    assertEqual(report.status, "success");
    assertEqual(report.collect.executed, true);
    assertEqual(report.detection.executed, false);
    assertEqual(report.closing.executed, false);
    assertEqual(report.notifications.executed, false);
    assertEqual(received.withResults, false);
    assertEqual(received.retryNotReached, false);
    assertEqual(
      (received.fixtureFetchLimits as { budgetMs?: number } | undefined)?.budgetMs,
      120_000,
    );

    const [row] = await db
      .select()
      .from(collectorRuns)
      .where(eq(collectorRuns.id, report.runId));
    assert(row.finishedAt !== null, "il fallback deve chiudere finished_at");
    assertEqual((row.meta as { mode?: string } | null)?.mode, "collect_only");

    const last = await readLastCycle();
    assert(last !== null, "il fallback concluso deve avanzare il gate");
    assertEqual(last!.mode, "collect_only");
    assertEqual(last!.snapshotsWritten, 9);
  });

  await test("la profondità esclude collector non conclusi", async () => {
    const coverage = { football: 1, imported: 1, lost: 0, coverage: 1 };
    const inserted = await db
      .insert(collectorRuns)
      .values([
        {
          collectorKey: COLLECTOR_KEY,
          startedAt: new Date("2099-01-01T00:00:00.000Z"),
          finishedAt: new Date("2099-01-01T00:00:01.000Z"),
          status: "success",
          meta: { trigger: "scheduled", coverage },
        },
        {
          collectorKey: COLLECTOR_KEY,
          startedAt: new Date("2099-01-01T00:01:00.000Z"),
          status: "running",
          meta: { trigger: "scheduled", coverage },
        },
      ])
      .returning({ id: collectorRuns.id, finishedAt: collectorRuns.finishedAt });
    const closedId = inserted.find((row) => row.finishedAt !== null)?.id;
    const openId = inserted.find((row) => row.finishedAt === null)?.id;
    assert(closedId !== undefined && openId !== undefined, "fixture run non create");

    try {
      const history = await getCoverageHistory(2, new Date("2099-01-01T00:02:00.000Z"));
      assert(
        history.points.some((point) => point.runId === closedId),
        "la raccolta conclusa deve entrare nella serie",
      );
      assert(
        !history.points.some((point) => point.runId === openId),
        "la raccolta ancora aperta non deve entrare nella serie",
      );
      assertEqual(history.lastScheduledRun?.runId, closedId);
    } finally {
      await db
        .delete(collectorRuns)
        .where(inArray(collectorRuns.id, inserted.map((row) => row.id)));
    }
  });

  await test("lo stato dell'ultimo giro è persistito e rileggibile", async () => {
    const last = await readLastCycle();
    assert(last !== null, "stato dell'ultimo giro assente");
    assert(
      typeof last!.at === "string" && !Number.isNaN(Date.parse(last!.at)),
      "istante dell'ultimo giro non valido",
    );
  });

  await test("un giro tentato e non chiuso tiene chiuso il gate", async () => {
    await borrowCycleState();
    const interval = readSchedulerConfig().intervalMinutes;
    const now = new Date();
    const minutiFa = (m: number) => new Date(now.getTime() - m * 60_000);
    const esito = (at: string): LastCycleState => ({
      at,
      status: "success",
      snapshotsWritten: 0,
      signalsTouched: 0,
      closingLinesCaptured: 0,
      clvComputed: 0,
    });

    /* Situazione misurata il 05/09/2026 in produzione: un giro CHIUSO 46
       minuti fa e un giro TENTATO 15 minuti fa, interrotto dal budget del
       chiamante prima di poter scrivere l'esito. Col solo registro delle
       chiusure il gate lasciava passare ogni battuta: era così che la fonte
       veniva raccolta ogni quarto d'ora invece che ogni 45 minuti. */
    await writeLastCycle(esito(minutiFa(46).toISOString()));
    await writeCycleClaim(minutiFa(15));

    const moment = await readGateMoment();
    assert(moment !== null, "il tentativo deve essere leggibile dal gate");
    assertEqual(
      Math.round((now.getTime() - moment!.getTime()) / 60_000),
      15,
      "il gate deve rispettare il tentativo, non la chiusura più vecchia",
    );
    assertEqual(shouldRunNow(moment, now, interval, false).run, false);

    /* Un giro che si chiude come si deve scrive lo stesso istante su entrambe
       le chiavi: la cadenza dichiarata non si allunga di un minuto. */
    await db.delete(systemState).where(eq(systemState.key, CYCLE_CLAIM_KEY));
    const at = minutiFa(46);
    await writeLastCycle(esito(at.toISOString()));
    await writeCycleClaim(at);
    assertEqual(shouldRunNow(await readGateMoment(), now, interval, false).run, true);
  });

  group("Tracciamento delle esecuzioni");

  await test("un run viene aperto e chiuso con durata", async () => {
    const handle = await startRun(`${PREFIX}-run`);
    await finishRun(handle, { status: "success", matchesSeen: 3, signalsTouched: 2 });
    const [row] = await db
      .select()
      .from(collectorRuns)
      .where(eq(collectorRuns.id, handle.id));
    assertEqual(row.status, "success");
    assertEqual(row.matchesSeen, 3);
    assert(row.durationMs !== null && row.durationMs >= 0, "durata non registrata");
    assert(row.finishedAt !== null, "finishedAt non registrato");
  });

  await test("recordSourcePing crea e aggiorna la salute della fonte", async () => {
    const key = `${PREFIX}-source`;
    const s1 = await recordSourcePing({
      sourceKey: key,
      label: "Fonte di test",
      outcome: "ok",
      latencyMs: 120,
    });
    assertEqual(s1, "ok");

    let last: string = s1;
    for (let i = 0; i < BLOCKED_AFTER_CONSECUTIVE_ERRORS; i += 1) {
      last = await recordSourcePing({
        sourceKey: key,
        label: "Fonte di test",
        outcome: "error",
        errorMessage: "timeout",
      });
    }
    assertEqual(last, "blocked", "dopo errori ripetuti la fonte deve risultare bloccata");

    const [row] = await db
      .select()
      .from(sourceHealth)
      .where(eq(sourceHealth.sourceKey, key));
    assertEqual(row.successCount, 1);
    assertEqual(row.errorCount, BLOCKED_AFTER_CONSECUTIVE_ERRORS);
    assert(row.lastSuccessAt !== null, "lastSuccessAt deve restare valorizzato");
  });

  await test("un successo azzera gli errori consecutivi", async () => {
    const key = `${PREFIX}-source`;
    const status = await recordSourcePing({
      sourceKey: key,
      label: "Fonte di test",
      outcome: "ok",
      latencyMs: 90,
    });
    assertEqual(status, "ok");
    const [row] = await db
      .select()
      .from(sourceHealth)
      .where(eq(sourceHealth.sourceKey, key));
    assertEqual(row.consecutiveErrors, 0);
  });

  /* --- pulizia --- */
  await cleanup();

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Test superati: ${passed} | falliti: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFallimenti:");
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log(`${"─".repeat(60)}\n`);

  await sql.end();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("Errore fatale nella suite:", err);
  try {
    await cleanup();
    await sql.end();
  } catch {
    /* la pulizia è best-effort */
  }
  process.exit(1);
});
