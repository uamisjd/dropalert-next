/**
 * Backfill delle feature di forma per i segnali in archivio.
 *
 *   npm run job:shape
 *
 * Per ogni segnale legge la serie di rilevazioni (match, mercato,
 * selezione), calcola la forma con il modulo puro `lib/shape/features` e
 * la salva in `drop_signals.shape`.
 *
 * IDEMPOTENTE per costruzione:
 *  - non inserisce mai righe, aggiorna SOLO la colonna `shape`;
 *  - ricalcola soltanto i segnali la cui forma manca, è illeggibile o è
 *    più vecchia dell'ultima rilevazione (`isShapeStale`);
 *  - rieseguirlo a dati fermi non tocca nessuna riga.
 *
 * Nessuna modifica a punteggi, stati o prezzi: la forma è dato di
 * ricerca (voce 2 del backlog), non un giudizio del motore.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { dropSignals, matches, oddsSnapshots } from "@/db/schema";
import { num } from "@/lib/drop/math";
import {
  buildShapeFeatures,
  isShapeStale,
  type ShapePoint,
} from "@/lib/shape/features";

interface Counts {
  signals: number;
  written: number;
  upToDate: number;
  noData: number;
  errors: number;
}

async function main(): Promise<void> {
  const now = new Date();
  const counts: Counts = {
    signals: 0,
    written: 0,
    upToDate: 0,
    noData: 0,
    errors: 0,
  };

  const signals = await db
    .select({
      id: dropSignals.id,
      matchId: dropSignals.matchId,
      market: dropSignals.market,
      selection: dropSignals.selection,
      openingProb: dropSignals.openingProb,
      detectedAt: dropSignals.detectedAt,
      shape: dropSignals.shape,
      kickoffAt: matches.kickoffAt,
    })
    .from(dropSignals)
    .innerJoin(matches, eq(matches.id, dropSignals.matchId));

  counts.signals = signals.length;
  console.log(`Segnali in archivio: ${signals.length}`);
  if (signals.length === 0) {
    console.log("Niente da fare.");
    return;
  }

  /* tutte le rilevazioni dei match coinvolti, in pochi passaggi
     (le chiavi di inArray sono illimitate in postgres, ma si resta
     cortesi con l'archivio andando a blocchi) */
  const matchIds = [...new Set(signals.map((s) => s.matchId))];
  const pointsByKey = new Map<string, ShapePoint[]>();

  const BLOCK = 500;
  for (let i = 0; i < matchIds.length; i += BLOCK) {
    const block = matchIds.slice(i, i + BLOCK);
    const rows = await db
      .select({
        matchId: oddsSnapshots.matchId,
        market: oddsSnapshots.market,
        selection: oddsSnapshots.selection,
        impliedProb: oddsSnapshots.impliedProb,
        collectedAt: oddsSnapshots.collectedAt,
      })
      .from(oddsSnapshots)
      .where(inArray(oddsSnapshots.matchId, block));

    for (const r of rows) {
      const prob = num(r.impliedProb);
      if (prob === null) continue;
      const key = `${r.matchId}::${r.market}::${r.selection}`;
      const list = pointsByKey.get(key) ?? [];
      list.push({ at: r.collectedAt, prob });
      pointsByKey.set(key, list);
    }
  }

  for (const s of signals) {
    try {
      const key = `${s.matchId}::${s.market}::${s.selection}`;
      const points = pointsByKey.get(key) ?? [];
      const latest = points.reduce<Date | null>(
        (max, p) => (max === null || p.at > max ? p.at : max),
        null,
      );

      /* a dati fermi la riga non si tocca: questa è l'idempotenza */
      if (!isShapeStale(s.shape, latest)) {
        counts.upToDate += 1;
        continue;
      }

      const openingProb = num(s.openingProb);
      if (points.length === 0 || openingProb === null) {
        counts.noData += 1;
        continue;
      }

      const features = buildShapeFeatures({
        points,
        openingProb,
        detectedAt: s.detectedAt,
        kickoffAt: s.kickoffAt,
        now,
      });
      if (features === null) {
        counts.noData += 1;
        continue;
      }

      /* tocca SOLO la colonna shape: prezzi, stati e punteggi restano */
      await db
        .update(dropSignals)
        .set({ shape: features })
        .where(eq(dropSignals.id, s.id));
      counts.written += 1;
    } catch (err) {
      counts.errors += 1;
      console.error(
        `segnale ${s.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`Scritti : ${counts.written}`);
  console.log(`Aggiornati (già a punto): ${counts.upToDate}`);
  console.log(`Senza serie (dichiarati, non riempiti): ${counts.noData}`);
  console.log(`Errori  : ${counts.errors}`);

  if (counts.errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
