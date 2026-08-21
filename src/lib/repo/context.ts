/**
 * Cache e generazione del Contesto 360° (Sprint contesto).
 *
 * Regole dichiarate, tutte verificabili qui:
 *  - SOLO partite con segnale in essere (attivo o in formazione);
 *  - una riga di cache per partita, 24h se riuscita, 1h se fallita;
 *  - tetto giornaliero di chiamate (hard-stop) contato per giornata
 *    italiana in `system_state`: raggiunto, il contesto non si genera e
 *    lo si dichiara nel pannello;
 *  - errore, timeout o chiave assente → "contesto non disponibile",
 *    mai un campo inventato.
 *
 * Niente di tutto questo tocca il punteggio: la riga vive per conto suo.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  dropSignals,
  leagues,
  matchContext,
  matches,
  systemState,
  teams,
} from "@/db/schema";
import {
  CONTEXT_CACHE_HOURS,
  CONTEXT_DAILY_LIMIT,
  CONTEXT_RETRY_HOURS,
  dailyUsageKey,
  isContextFresh,
  isDailyBudgetExhausted,
  type ContextFields,
} from "@/lib/context/pure";
import { generateMatchContext } from "@/lib/context/llm";
import { SELECTION_LABELS_IT } from "@/lib/drop/constants";
import { num } from "@/lib/drop/math";

/** Stati del segnale che rendono la partita eleggibile al contesto. */
export const ELIGIBLE_SIGNAL_STATUSES = ["active", "forming"] as const;

export interface ContextUsage {
  used: number;
  limit: number;
  exhausted: boolean;
}

export interface ContextRowView {
  matchId: number;
  status: string;
  model: string | null;
  fields: ContextFields | null;
  generatedAt: string | null;
  expiresAt: string | null;
  /** perché il contesto manca, in italiano, quando manca */
  unavailableReason: string | null;
  usage: ContextUsage;
}

/* ------------------------------------------------------------------ */
/* Contatore giornaliero                                               */
/* ------------------------------------------------------------------ */

async function readUsage(now: Date): Promise<ContextUsage> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, dailyUsageKey(now)))
    .limit(1);
  const used =
    row !== undefined && typeof (row.value as { used?: unknown }).used === "number"
      ? (row.value as { used: number }).used
      : 0;
  return { used, limit: CONTEXT_DAILY_LIMIT, exhausted: isDailyBudgetExhausted(used) };
}

async function bumpUsage(now: Date): Promise<void> {
  const key = dailyUsageKey(now);
  const current = await readUsage(now);
  const value = { used: current.used + 1 };
  await db
    .insert(systemState)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value, updatedAt: now },
    });
}

/* ------------------------------------------------------------------ */
/* Vista                                                               */
/* ------------------------------------------------------------------ */

function toView(
  row: typeof matchContext.$inferSelect | null,
  usage: ContextUsage,
  unavailableReason: string | null,
): ContextRowView {
  const fields: ContextFields | null =
    row !== null && row.status === "ok"
      ? {
          livelloCategorie: row.livelloCategorie ?? "",
          anomaliaCampo: row.anomaliaCampo ?? "",
          postaInPalo: row.postaInPalo ?? "",
          rotazioniFatica: row.rotazioniFatica ?? "",
          accordoColDrop: (row.accordoColDrop as ContextFields["accordoColDrop"]) ?? "non c'entra",
        }
      : null;

  return {
    matchId: row?.matchId ?? 0,
    status: row?.status ?? "assente",
    model: row?.model ?? null,
    fields,
    generatedAt: row?.generatedAt.toISOString() ?? null,
    expiresAt: row?.expiresAt.toISOString() ?? null,
    unavailableReason,
    usage,
  };
}

/* ------------------------------------------------------------------ */
/* Eleggibilità e dati per il prompt                                   */
/* ------------------------------------------------------------------ */

async function hasLiveSignal(matchId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: dropSignals.id })
    .from(dropSignals)
    .where(
      and(
        eq(dropSignals.matchId, matchId),
        inArray(dropSignals.status, [...ELIGIBLE_SIGNAL_STATUSES]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Il movimento più forte in essere, descritto in una frase per il prompt. */
async function dropSummaryFor(matchId: number): Promise<string | null> {
  const [row] = await db
    .select({
      market: dropSignals.market,
      selection: dropSignals.selection,
      openingPrice: dropSignals.openingPrice,
      currentPrice: dropSignals.currentPrice,
      deltaPp: dropSignals.deltaPp,
    })
    .from(dropSignals)
    .where(
      and(
        eq(dropSignals.matchId, matchId),
        inArray(dropSignals.status, [...ELIGIBLE_SIGNAL_STATUSES]),
      ),
    )
    .orderBy(desc(dropSignals.deltaPp))
    .limit(1);
  if (row === undefined) return null;

  const selection = SELECTION_LABELS_IT[row.selection] ?? row.selection;
  const opening = num(row.openingPrice);
  const current = num(row.currentPrice);
  const prices =
    opening !== null && current !== null
      ? `quota ${opening.toFixed(2)} → ${current.toFixed(2)}`
      : "quote non note";
  return `la quota dell'esito ${selection} è scesa (${prices}, ${
    num(row.deltaPp)?.toFixed(1) ?? "?"
  } punti percentuali di probabilità implicita dall'apertura)`;
}

/* ------------------------------------------------------------------ */
/* Pubblico                                                            */
/* ------------------------------------------------------------------ */

/**
 * Contesto di una partita: cache se fresca; altrimenti, se la partita è
 * eleggibile e il tetto non è raggiunto, UNA chiamata al modello con
 * timeout. Nessuna coda, nessun retry in loop, nessuna eccezione fuori.
 */
export async function getContextForMatch(
  matchId: number,
  now: Date = new Date(),
): Promise<ContextRowView | null> {
  const usage = await readUsage(now);

  const [cached] = await db
    .select()
    .from(matchContext)
    .where(eq(matchContext.matchId, matchId))
    .limit(1);

  if (cached !== undefined && isContextFresh(cached.expiresAt, now)) {
    return toView(cached, usage, null);
  }

  if (!(await hasLiveSignal(matchId))) return null;

  if (usage.exhausted) {
    return toView(cached ?? null, usage, "tetto_giornaliero");
  }

  /* dati per il prompt: squadre, competizione, kickoff, movimento */
  const [info] = await db
    .select({
      kickoffAt: matches.kickoffAt,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
      leagueName: leagues.name,
      country: leagues.country,
    })
    .from(matches)
    .leftJoin(leagues, eq(leagues.id, matches.leagueId))
    .where(eq(matches.id, matchId))
    .limit(1);

  if (info === undefined) return null;

  const teamRows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(inArray(teams.id, [info.homeTeamId, info.awayTeamId]));
  const nameOf = new Map(teamRows.map((t) => [t.id, t.name]));
  const homeTeam = nameOf.get(info.homeTeamId) ?? "squadra di casa";
  const awayTeam = nameOf.get(info.awayTeamId) ?? "squadra in trasferta";

  const dropSummary = await dropSummaryFor(matchId);

  const result = await generateMatchContext({
    homeTeam,
    awayTeam,
    league: info.leagueName,
    country: info.country,
    kickoffAt: info.kickoffAt.toISOString(),
    dropSummary:
      dropSummary ?? "movimento non descritto: nessun segnale in essere",
  });

  await bumpUsage(now);

  const expiresAt = new Date(
    now.getTime() +
      (result.ok ? CONTEXT_CACHE_HOURS : CONTEXT_RETRY_HOURS) * 3_600_000,
  );

  const values = {
    matchId,
    status: result.ok ? "ok" : "unavailable",
    model: result.ok ? result.model : null,
    livelloCategorie: result.ok ? result.fields.livelloCategorie : null,
    anomaliaCampo: result.ok ? result.fields.anomaliaCampo : null,
    postaInPalo: result.ok ? result.fields.postaInPalo : null,
    rotazioniFatica: result.ok ? result.fields.rotazioniFatica : null,
    accordoColDrop: result.ok ? result.fields.accordoColDrop : null,
    generatedAt: now,
    expiresAt,
  };

  const [row] = await db
    .insert(matchContext)
    .values(values)
    .onConflictDoUpdate({ target: matchContext.matchId, set: values })
    .returning();

  const refreshedUsage = await readUsage(now);
  return toView(
    row ?? null,
    refreshedUsage,
    result.ok ? null : reasonToItalian(result.reason),
  );
}

function reasonToItalian(reason: string): string {
  switch (reason) {
    case "chiave_assente":
      return "chiave del modello non configurata";
    case "timeout":
      return "timeout del modello";
    case "risposta_invalida":
      return "risposta del modello non valida";
    default:
      return "errore del modello";
  }
}

/**
 * Contesti in cache per le card: solo righe fresche e riuscite, mai
 * generation. La card mostra ciò che esiste, non ciò che dovrebbe.
 */
export async function getContextSummaries(
  matchIds: number[],
): Promise<Map<number, ContextFields>> {
  if (matchIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(matchContext)
    .where(inArray(matchContext.matchId, matchIds));
  const out = new Map<number, ContextFields>();
  for (const r of rows) {
    if (r.status !== "ok") continue;
    const fresh = isContextFresh(r.expiresAt, new Date());
    if (!fresh) continue;
    out.set(r.matchId, {
      livelloCategorie: r.livelloCategorie ?? "",
      anomaliaCampo: r.anomaliaCampo ?? "",
      postaInPalo: r.postaInPalo ?? "",
      rotazioniFatica: r.rotazioniFatica ?? "",
      accordoColDrop: (r.accordoColDrop as ContextFields["accordoColDrop"]) ?? "non c'entra",
    });
  }
  return out;
}
