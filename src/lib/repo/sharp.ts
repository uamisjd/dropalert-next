/**
 * Linea sharp: contatori di budget e cache (Sprint G).
 *
 * I contatori vivono in `system_state`, come gli altri budget del progetto:
 * niente migrazioni, un solo posto dove leggere quanto si è speso.
 *
 * Le fotografie della linea sharp («sharp_snapshots») sono conservate per
 * partita e per giornata italiana: una lettura al giorno per partita, e la
 * pagina riusa quella invece di comprarne un'altra.
 *
 * Regole di spesa: tutte in `odds-api-budget.ts`. Qui si contano i crediti
 * e si scrive ciò che è stato letto — mai un valore stimato.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { systemState } from "@/db/schema";
import {
  ODDS_DAILY_HARD_CAP,
  ODDS_MONTHLY_CAP,
  dailyAllowance,
  dayKey,
  decide,
  matchKey,
  monthKey,
  readOddsApiKey,
  type BudgetDecision,
} from "@/lib/providers/optional/odds-api-budget";
import {
  fetchSharpLine,
  type SharpSnapshot,
} from "@/lib/providers/optional/odds-api-sharp";

export interface SharpBudgetView {
  usedThisMonth: number;
  monthlyCap: number;
  usedToday: number;
  allowanceToday: number;
  dailyHardCap: number;
}

export interface SharpView {
  snapshot: SharpSnapshot | null;
  /** motivo in italiano quando la lettura non c'è */
  unavailableReason: string | null;
  budget: SharpBudgetView;
}

async function readCounter(key: string): Promise<number> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, key))
    .limit(1);
  return row !== undefined &&
    typeof (row.value as { used?: unknown }).used === "number"
    ? (row.value as { used: number }).used
    : 0;
}

async function addCredits(key: string, add: number, now: Date): Promise<void> {
  if (add <= 0) return;
  const value = { used: (await readCounter(key)) + add };
  await db
    .insert(systemState)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: now } });
}

async function readSnapshot(
  matchId: number,
  now: Date,
): Promise<SharpSnapshot | null> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, matchKey(matchId, now)))
    .limit(1);
  if (row === undefined) return null;
  const v = row.value as { snapshot?: SharpSnapshot };
  return v.snapshot ?? null;
}

async function writeSnapshot(
  matchId: number,
  snapshot: SharpSnapshot,
  now: Date,
): Promise<void> {
  const key = matchKey(matchId, now);
  const value = { snapshot };
  await db
    .insert(systemState)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: now } });
}

function hasKey(): boolean {
  return readOddsApiKey() !== null;
}

async function budgetView(now: Date): Promise<SharpBudgetView> {
  const usedThisMonth = await readCounter(monthKey(now));
  const usedToday = await readCounter(dayKey(now));
  return {
    usedThisMonth,
    monthlyCap: ODDS_MONTHLY_CAP,
    usedToday,
    allowanceToday: dailyAllowance(usedThisMonth, now),
    dailyHardCap: ODDS_DAILY_HARD_CAP,
  };
}

/** Solo lettura del budget, per il pannello: non spende nulla. */
export async function getSharpBudget(now: Date = new Date()): Promise<SharpBudgetView> {
  return budgetView(now);
}

/**
 * La linea sharp di una partita.
 *
 * Ordine: fotografia del giorno se c'è; altrimenti si chiede il permesso al
 * budget; solo se concesso si spende un credito. Qualunque esito diverso è
 * dichiarato in italiano e nulla viene inventato.
 */
export async function getSharpLine(
  params: {
    matchId: number;
    sportKey: string | null;
    homeTeam: string;
    awayTeam: string;
    selection: string;
    consensusOpening: number | null;
    consensusCurrent: number | null;
    signalActive: boolean;
  },
  now: Date = new Date(),
): Promise<SharpView> {
  const budget = await budgetView(now);

  const cached = await readSnapshot(params.matchId, now).catch(() => null);
  if (cached !== null) {
    return { snapshot: cached, unavailableReason: null, budget };
  }

  if (params.sportKey === null || params.sportKey.trim() === "") {
    return {
      snapshot: null,
      unavailableReason:
        "linea sharp non disponibile: competizione non mappata sulla fonte",
      budget,
    };
  }

  const decision: BudgetDecision = decide(
    {
      usedThisMonth: budget.usedThisMonth,
      usedToday: budget.usedToday,
      matchAlreadyRead: false,
      signalActive: params.signalActive,
    },
    now,
    hasKey(),
  );

  if (!decision.allowed) {
    return { snapshot: null, unavailableReason: decision.message, budget };
  }

  const outcome = await fetchSharpLine(
    {
      sportKey: params.sportKey,
      homeTeam: params.homeTeam,
      awayTeam: params.awayTeam,
      selection: params.selection,
      consensusOpening: params.consensusOpening,
      consensusCurrent: params.consensusCurrent,
    },
    { now },
  ).catch(() => ({ ok: false as const, reason: "errore della fonte", creditsUsed: 1 }));

  /* il credito si conta SEMPRE se la richiesta è partita: il provider lo
     addebita anche quando la risposta non ci serve */
  if (outcome.creditsUsed > 0) {
    await addCredits(monthKey(now), outcome.creditsUsed, now).catch(() => undefined);
    await addCredits(dayKey(now), outcome.creditsUsed, now).catch(() => undefined);
  }

  const refreshed = await budgetView(now);

  if (!outcome.ok) {
    return {
      snapshot: null,
      unavailableReason: `linea sharp non disponibile: ${outcome.reason}`,
      budget: refreshed,
    };
  }

  await writeSnapshot(params.matchId, outcome.snapshot, now).catch(() => undefined);
  return { snapshot: outcome.snapshot, unavailableReason: null, budget: refreshed };
}
