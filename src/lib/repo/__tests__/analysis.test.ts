/**
 * Test della cache «Analisi 360° completa» — richiede un PostgreSQL
 * raggiungibile. Eseguire con: npm run test:repo-analysis
 *
 * Due comportamenti sotto esame:
 *  1. a partita iniziata l'analisi non si serve né si rigenera (il racconto
 *     pre-gara parlerebbe al futuro di un incontro già cominciato);
 *  2. `invalidateAnalysis` cancella davvero la riga di cache della partita.
 *
 * Le fixture usano una chiave di sistema dedicata e un matchId fittizio, e
 * vengono rimosse a fine corsa sia in caso di successo sia di errore.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { systemState } from "@/db/schema";
import {
  ANALYSIS_FORMAT_VERSION,
  getDeepAnalysis,
  invalidateAnalysis,
} from "@/lib/repo/analysis";
import type { AnalysisFacts } from "@/lib/context/analysis";

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

const MATCH_ID = 999_001; // fittizio: nessuna partita reale ha questo id
const CACHE_KEY = `analysis360:v${ANALYSIS_FORMAT_VERSION}:${MATCH_ID}`;

function factsWithKickoff(kickoffAt: string): AnalysisFacts {
  return {
    homeTeam: "Test Home",
    awayTeam: "Test Away",
    league: "Serie Test",
    country: "Italia",
    kickoffAt,
    fase: null,
    stadio: null,
    citta: null,
    fields: [],
    docs: [],
    movimento: {
      selezione: "Casa",
      apertura: 2.1,
      corrente: 1.95,
      oreAlKickoff: 5,
      sostenutoMinuti: 40,
      flash: false,
      rimbalzato: false,
      bookConfermano: 4,
      bookTotali: 6,
      scesa: true,
    },
  };
}

async function cleanup(): Promise<void> {
  await db.delete(systemState).where(eq(systemState.key, CACHE_KEY));
}

async function main() {
  console.log("\n▸ Analisi 360° — cache e partita iniziata");

  await test("a partita iniziata non si serve analisi corrente", async () => {
    const now = new Date("2026-09-04T20:00:00.000Z");
    const kickoffPast = "2026-09-04T18:00:00.000Z"; // due ore prima di now
    const view = await getDeepAnalysis(
      MATCH_ID,
      factsWithKickoff(kickoffPast),
      now,
    );
    assert(view.analysis === null, "nessun contenuto deve essere servito");
    assert(
      view.unavailableReason !== null &&
        view.unavailableReason.includes("già iniziata"),
      `il motivo deve dichiarare la partita iniziata, ottenuto: ${view.unavailableReason}`,
    );
  });

  await test("il motivo «già iniziata» prova che il modello non è chiamato", async () => {
    /* Senza chiave del modello, se il codice arrivasse alla generazione il
       motivo sarebbe «chiave del modello non configurata». Il fatto che esca
       «già iniziata» dimostra che ci si ferma prima, senza spendere budget. */
    const now = new Date("2026-09-04T20:00:00.000Z");
    const view = await getDeepAnalysis(
      MATCH_ID,
      factsWithKickoff("2026-09-04T19:59:00.000Z"), // un minuto prima
      now,
    );
    assert(
      view.unavailableReason?.includes("già iniziata") === true,
      "nessuna chiamata al modello a partita iniziata",
    );
  });

  await test("invalidateAnalysis cancella la riga di cache", async () => {
    const now = new Date();
    await db
      .insert(systemState)
      .values({
        key: CACHE_KEY,
        value: {
          expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
          analysis: { headline: "prova" },
        },
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: systemState.key,
        set: { value: { probe: true }, updatedAt: now },
      });

    const before = await db
      .select({ key: systemState.key })
      .from(systemState)
      .where(eq(systemState.key, CACHE_KEY))
      .limit(1);
    assert(before.length === 1, "la riga di prova deve esistere");

    await invalidateAnalysis(MATCH_ID);

    const after = await db
      .select({ key: systemState.key })
      .from(systemState)
      .where(eq(systemState.key, CACHE_KEY))
      .limit(1);
    assert(after.length === 0, "dopo l'invalidazione la riga non deve esserci");
  });

  await cleanup();

  console.log(
    `\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`,
  );
  if (failed > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  void cleanup().finally(() => process.exit(1));
});
