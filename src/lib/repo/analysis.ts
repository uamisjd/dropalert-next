/**
 * «Analisi 360° completa»: generazione on-demand e cache (Sprint analisi).
 *
 * Regole dichiarate:
 *  - si genera SOLO alla prima apertura del dettaglio di una partita con
 *    segnale: nessun job la precalcola, così una partita mai aperta non
 *    consuma un centesimo di budget;
 *  - cache 24 ore in `system_state` (nessuna migrazione richiesta), chiave
 *    per partita e per versione del formato;
 *  - budget: lo stesso tetto giornaliero del Contesto 360° (chiamate al
 *    modello). Esaurito, si dichiara «analisi non disponibile per budget»;
 *  - i fatti sono quelli GIÀ recuperati (campi di contesto con fonte,
 *    documenti, profilo del movimento): questa analisi non fa ricerche
 *    nuove e non consuma query Tavily;
 *  - nulla di tutto ciò entra nel punteggio.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { systemState } from "@/db/schema";
import {
  ANALYSIS_BUDGET_MESSAGE,
  ANALYSIS_CACHE_HOURS,
  assembleAnalysis,
  isAnalysisStale,
  parseAnalysisProse,
  withLiveValues,
  type AnalysisFacts,
  type DeepAnalysis,
} from "@/lib/context/analysis";
import { generateDeepAnalysis } from "@/lib/context/analysis-llm";
import {
  CONTEXT_DAILY_LIMIT,
  dailyUsageKey,
  isDailyBudgetExhausted,
} from "@/lib/context/pure";

/** Bump = tutte le analisi in cache si rigenerano al primo accesso. */
export const ANALYSIS_FORMAT_VERSION = 6;

export interface AnalysisView {
  analysis: DeepAnalysis | null;
  /** motivo in italiano quando l'analisi non c'è */
  unavailableReason: string | null;
  usage: { used: number; limit: number };
}

function cacheKey(matchId: number): string {
  return `analysis360:v${ANALYSIS_FORMAT_VERSION}:${matchId}`;
}

interface CacheEnvelope {
  expiresAt: string;
  analysis: DeepAnalysis;
}

async function readUsedToday(now: Date): Promise<number> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, dailyUsageKey(now)))
    .limit(1);
  return row !== undefined &&
    typeof (row.value as { used?: unknown }).used === "number"
    ? (row.value as { used: number }).used
    : 0;
}

async function bumpUsage(now: Date): Promise<void> {
  const key = dailyUsageKey(now);
  const value = { used: (await readUsedToday(now)) + 1 };
  await db
    .insert(systemState)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: now } });
}

async function readCache(
  matchId: number,
  now: Date,
): Promise<DeepAnalysis | null> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, cacheKey(matchId)))
    .limit(1);
  if (row === undefined) return null;
  const env = row.value as Partial<CacheEnvelope>;
  if (typeof env.expiresAt !== "string" || env.analysis === undefined) return null;
  const exp = new Date(env.expiresAt).getTime();
  if (!Number.isFinite(exp) || exp <= now.getTime()) return null;
  return env.analysis as DeepAnalysis;
}

async function writeCache(
  matchId: number,
  analysis: DeepAnalysis,
  now: Date,
): Promise<void> {
  const value: CacheEnvelope = {
    expiresAt: new Date(
      now.getTime() + ANALYSIS_CACHE_HOURS * 3_600_000,
    ).toISOString(),
    analysis,
  };
  await db
    .insert(systemState)
    .values({ key: cacheKey(matchId), value, updatedAt: now })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value, updatedAt: now },
    });
}

/**
 * L'analisi di una partita: cache se fresca, altrimenti UNA chiamata al
 * modello sui fatti già recuperati. Nessuna eccezione attraversa il confine:
 * al peggio l'analisi «non è disponibile», e il motivo si legge in pagina.
 */
export async function getDeepAnalysis(
  matchId: number,
  facts: AnalysisFacts,
  now: Date = new Date(),
): Promise<AnalysisView> {
  const used = await readUsedToday(now);
  const usage = { used, limit: CONTEXT_DAILY_LIMIT };

  const live = {
    apertura: facts.movimento.apertura,
    corrente: facts.movimento.corrente,
  };

  const cached = await readCache(matchId, now).catch(() => null);
  if (cached !== null) {
    /* deriva temporale: se i numeri veri si sono spostati oltre soglia (o è
       passata più di un'ora) il racconto non descrive più questa partita e
       si rigenera; se lo scarto è piccolo si reiniettano i valori vivi, così
       testo e dati in pagina non si contraddicono mai */
    if (!isAnalysisStale(cached.stamp, live, now)) {
      return {
        analysis: withLiveValues(cached, live),
        unavailableReason: null,
        usage,
      };
    }
  }

  if (isDailyBudgetExhausted(used)) {
    /* budget finito: meglio l'analisi vecchia con i valori vivi reiniettati
       che nessuna analisi — purché si dica che è quella di prima */
    return {
      analysis: cached === null ? null : withLiveValues(cached, live),
      unavailableReason: ANALYSIS_BUDGET_MESSAGE,
      usage,
    };
  }

  const outcome = await generateDeepAnalysis(facts).catch(() => ({
    ok: false as const,
    reason: "errore" as const,
  }));
  await bumpUsage(now);

  if (!outcome.ok) {
    return {
      analysis: null,
      unavailableReason:
        outcome.reason === "chiave_assente"
          ? "analisi non disponibile: chiave del modello non configurata"
          : outcome.reason === "timeout"
            ? "analisi non disponibile: timeout del modello"
            : outcome.reason === "risposta_invalida"
              ? "analisi non disponibile: la risposta conteneva una raccomandazione o era incompleta, quindi è stata scartata"
              : "analisi non disponibile: errore del modello",
      usage: { used: used + 1, limit: CONTEXT_DAILY_LIMIT },
    };
  }

  const analysis = assembleAnalysis(facts, outcome.prose, now);
  await writeCache(matchId, analysis, now).catch(() => undefined);
  return {
    analysis: withLiveValues(analysis, live),
    unavailableReason: null,
    usage: { used: used + 1, limit: CONTEXT_DAILY_LIMIT },
  };
}

/** Riesportata per i test di contratto. */
export { parseAnalysisProse };
