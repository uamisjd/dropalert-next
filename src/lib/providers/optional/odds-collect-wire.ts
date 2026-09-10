/**
 * Cablaggio di The Odds API nel ciclo di raccolta — fase parallela, dietro flag.
 *
 * PERCHÉ ESISTE. Il monitor raccoglie da BetExplorer SOLO il consenso: una
 * riga per (partita, mercato, selezione), nessun bookmaker reale. Di
 * conseguenza `coordinationScore` e `sharpConfirms` restano non misurabili e
 * il buco `bookmaker_missing` non si chiude mai (STUDIO-CABLAGGIO-ODDS §0).
 * Questa fase porta nel ciclo le linee per-bookmaker di The Odds API, per i
 * soli segnali attivi su competizioni coperte, governata dal budget già
 * bloccato in `odds-api-budget.ts`.
 *
 * REGOLE NON NEGOZIABILI (tutte dichiarate, nessuna stimata):
 *  - resta SPENTA finché non sono accesi INSIEME due flag:
 *    `ODDS_WIRE_COLLECT=true` e `DROP_EXCLUDE_CONSENSUS_BOOKS=true`. Il
 *    secondo è obbligatorio: senza, la riga di consenso non verrebbe marcata
 *    `isConsensus` e le linee per-book INQUINEREBBERO la mediana di consenso
 *    e la coordinazione (STUDIO-CABLAGGIO-ODDS §4.7). Un flag senza l'altro
 *    non attiva nulla: la fase lo dichiara e non scrive.
 *  - una lettura al giorno per partita (marcatore dedicato + cache della
 *    linea sharp), solo segnali `active` con indice di fiducia ≥ 45, solo
 *    competizioni risolte in una `sportKey` (`resolveSportKey`), mai partite
 *    demo, mai kickoff passato. Ogni rifiuto ha un motivo in italiano.
 *  - il credito si conta quando la richiesta ESCE davvero verso la fonte
 *    (convenzione identica a `fetchSharpLine`); zero crediti solo per
 *    `disabled` (chiave assente) e `unsupported` (adapter non dichiarato).
 *  - i contatori mensile/giornaliero sono CONDIVISI con il percorso della
 *    linea sharp (`repo/sharp.ts`): il tetto globale resta un unico hard-stop,
 *    qualunque percorso abbia speso. La regola «una lettura/partita/giorno»
 *    è applicata qui a entrambi i percorsi: se la scheda partita ha già letto
 *    la partita oggi, il cablaggio non la rilegge.
 *
 * ATTIVAZIONE. Come da dottrina del progetto, il codice non basta: va
 * eseguito prima uno smoke test live del cablaggio (1 credito, via workflow
 * manuale) e un confronto prima/dopo sul punteggio dei segnali in modalità
 * mista (consenso + per-book). L'accensione dei due flag su Vercel resta un
 * passo umano deliberato, non un effetto collaterale del merge.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  dropSignals,
  leagues,
  matches,
  systemState,
  teams,
  type SignalStatus,
} from "@/db/schema";
import { resolveSportKey } from "./sport-keys";
import {
  alreadyReadToday,
  dayKey,
  decide,
  matchKey,
  monthKey,
  readOddsApiKey,
  wireMatchKey,
} from "./odds-api-budget";
import { collectAndPersistTheOddsApiOdds } from "./collect-the-odds-api";
import type { OddsQuoteDTO, ProviderResult } from "../types";

/* ------------------------------------------------------------------ */
/* Flag e soglie (pure)                                               */
/* ------------------------------------------------------------------ */

/** Indice di fiducia minimo per spendere un credito (RESEARCH-BACKLOG §5). */
export const WIRE_MIN_CONFIDENCE = 45;

/** Stati di partita per cui una lettura non ha senso: non si giocherà. */
const NON_PLAYABLE = new Set(["finished", "postponed", "cancelled"]);

export interface WireGate {
  enabled: boolean;
  /** motivo in italiano quando la fase resta spenta */
  reason: string | null;
}

/**
 * Il cancello della fase: due flag, sempre insieme.
 *
 * `DROP_EXCLUDE_CONSENSUS_BOOKS` non è un optional: senza, scrivere le linee
 * per-book in `odds_snapshots` falserebbe la mediana di consenso e la
 * coordinazione (STUDIO-CABLAGGIO-ODDS §4.7). Un solo flag acceso = fase
 * spenta, con il motivo dichiarato.
 */
export function wireGate(
  env: Record<string, string | undefined>,
): WireGate {
  const wire = env.ODDS_WIRE_COLLECT === "true";
  const exclude = env.DROP_EXCLUDE_CONSENSUS_BOOKS === "true";
  if (wire && exclude) return { enabled: true, reason: null };

  const missing: string[] = [];
  if (!wire) missing.push("ODDS_WIRE_COLLECT=true");
  if (!exclude) missing.push("DROP_EXCLUDE_CONSENSUS_BOOKS=true");
  return {
    enabled: false,
    reason:
      `cablaggio per-bookmaker spento: manca ${missing.join(" e ")}. ` +
      "I due flag vanno accesi insieme: senza DROP_EXCLUDE_CONSENSUS_BOOKS " +
      "le linee per-book inquinerebbero la mediana di consenso " +
      "(STUDIO-CABLAGGIO-ODDS §4.7).",
  };
}

/* ------------------------------------------------------------------ */
/* Selezione dei candidati (pura, testabile senza DB)                  */
/* ------------------------------------------------------------------ */

/** Riga minima che la fase legge dal database. */
export interface WireSignalRow {
  matchId: number;
  matchKey: string;
  signalStatus: SignalStatus;
  matchStatus: string;
  confidenceScore: number;
  kickoffAt: Date;
  country: string | null;
  league: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
}

/** Una partita che può davvero essere letta sulla fonte. */
export interface WireCandidate {
  matchId: number;
  fixtureKey: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  confidenceScore: number;
}

export interface WireSkip {
  matchId: number;
  reason: string;
}

export interface WireCandidatesResult {
  candidates: WireCandidate[];
  skipped: WireSkip[];
}

/**
 * Trasforma le righe dei segnali attivi in candidati di lettura.
 *
 * Regole applicate nell'ordine, ognuna con un motivo dichiarato:
 * segnale non `active`, indice sotto soglia, partita demo, partita non
 * giocabile, kickoff passato/illeggibile, squadre mancanti, competizione
 * fuori copertura (`resolveSportKey` → null). Più segnali sulla stessa
 * partita collassano in UN candidato (quello con l'indice più alto):
 * una lettura per partita, non una per segnale.
 */
export function pickWireCandidates(
  rows: WireSignalRow[],
  now: Date,
): WireCandidatesResult {
  const skipped: WireSkip[] = [];
  const byMatch = new Map<number, WireSignalRow>();

  for (const row of rows) {
    const skip = (reason: string) => {
      skipped.push({ matchId: row.matchId, reason });
    };

    if (row.signalStatus !== "active") {
      skip("segnale non attivo: si spende solo per segnali attivi");
      continue;
    }
    if (row.confidenceScore < WIRE_MIN_CONFIDENCE) {
      skip(
        `indice di fiducia ${row.confidenceScore} sotto la soglia ${WIRE_MIN_CONFIDENCE}`,
      );
      continue;
    }
    if (row.matchKey.startsWith("demo-")) {
      skip("partita dimostrativa: nessun credito per i dati sintetici");
      continue;
    }
    if (NON_PLAYABLE.has(row.matchStatus)) {
      skip(`partita in stato "${row.matchStatus}": non si giocherà`);
      continue;
    }

    const kickoff =
      row.kickoffAt instanceof Date ? row.kickoffAt : new Date(row.kickoffAt);
    if (Number.isNaN(kickoff.getTime())) {
      skip("kickoff non interpretabile nel database");
      continue;
    }
    if (kickoff.getTime() <= now.getTime()) {
      skip("kickoff già passato: la fonte non espone più quote");
      continue;
    }

    const home = (row.homeTeam ?? "").trim();
    const away = (row.awayTeam ?? "").trim();
    if (home === "" || away === "") {
      skip("nomi delle squadre mancanti nel database");
      continue;
    }

    const sportKey = resolveSportKey(row.country, row.league);
    if (sportKey === null) {
      skip(
        `competizione "${row.league ?? "sconosciuta"}" fuori copertura: nessuna sportKey, nessun credito`,
      );
      continue;
    }

    /* dedupe per partita: più segnali → una sola lettura, la migliore */
    const existing = byMatch.get(row.matchId);
    if (existing === undefined || row.confidenceScore > existing.confidenceScore) {
      byMatch.set(row.matchId, row);
    }
  }

  const candidates: WireCandidate[] = [...byMatch.values()]
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .map((row) => ({
      matchId: row.matchId,
      fixtureKey: row.matchKey,
      sportKey: resolveSportKey(row.country, row.league) as string,
      homeTeam: (row.homeTeam ?? "").trim(),
      awayTeam: (row.awayTeam ?? "").trim(),
      kickoffAt: row.kickoffAt instanceof Date ? row.kickoffAt : new Date(row.kickoffAt),
      confidenceScore: row.confidenceScore,
    }));

  return { candidates, skipped };
}

/* ------------------------------------------------------------------ */
/* Contabilità dei crediti (pura)                                      */
/* ------------------------------------------------------------------ */

/**
 * Crediti spesi da una lettura, con la stessa convenzione del percorso sharp.
 *
 * Una chiamata a The Odds API costa 1 credito quando la richiesta esce
 * davvero verso la fonte, anche se la risposta non serve (evento non trovato,
 * HTTP non 2xx, timeout): il provider la addebita comunque. Zero crediti solo
 * quando la rete non è stata toccata: `disabled` (chiave assente) e
 * `unsupported` (adapter non dichiarato implementato).
 */
export function creditsSpentFor(result: ProviderResult<OddsQuoteDTO[]>): number {
  if (result.ok) return 1;
  const kind = result.error.kind;
  return kind === "disabled" || kind === "unsupported" ? 0 : 1;
}

/* ------------------------------------------------------------------ */
/* Stato persistente (contatori e marcatori)                           */
/* ------------------------------------------------------------------ */

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

async function keyExists(key: string): Promise<boolean> {
  const [row] = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, key))
    .limit(1);
  return row !== undefined;
}

async function markWireRead(matchId: number, now: Date): Promise<void> {
  const value = { readAt: now.toISOString() };
  await db
    .insert(systemState)
    .values({ key: wireMatchKey(matchId, now), value, updatedAt: now })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: now } });
}

/**
 * La partita è già stata letta oggi, da qualunque percorso?
 *
 * Si guardano entrambi: il marcatore del cablaggio e la cache della linea
 * sharp (`matchKey`), così «una lettura per partita al giorno» vale davvero
 * per l'intero sistema e non per ciascun percorso preso da solo. La regola
 * condivisa sta in `alreadyReadToday` (odds-api-budget): il tetto è del
 * sistema, non del singolo percorso.
 */
async function matchAlreadyReadToday(matchId: number, now: Date): Promise<boolean> {
  const wireHit = await keyExists(wireMatchKey(matchId, now));
  const sharpHit = await keyExists(matchKey(matchId, now));
  return alreadyReadToday(sharpHit, wireHit);
}

/* ------------------------------------------------------------------ */
/* Lettura dei segnali attivi                                          */
/* ------------------------------------------------------------------ */

/**
 * Riga dei segnali attivi, per la fase e per lo smoke test (`smoke:odds-wire`).
 * Esportata perché lo strumento di verifica dell'attivazione deve poter
 * elencare i candidati con la STESSA selezione del ciclo: una selezione
 * diversa nello smoke non proverebbe nulla su ciò che il ciclo farebbe.
 */
export async function listWireSignalRows(): Promise<WireSignalRow[]> {
  const rows = await db
    .select({
      matchId: matches.id,
      matchKey: matches.key,
      signalStatus: dropSignals.status,
      matchStatus: matches.status,
      confidenceScore: dropSignals.confidenceScore,
      kickoffAt: matches.kickoffAt,
      country: leagues.country,
      league: leagues.name,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
    })
    .from(dropSignals)
    .innerJoin(matches, eq(matches.id, dropSignals.matchId))
    .leftJoin(leagues, eq(leagues.id, matches.leagueId))
    .where(
      and(
        eq(dropSignals.status, "active" satisfies SignalStatus),
        gte(dropSignals.confidenceScore, String(WIRE_MIN_CONFIDENCE)),
      ),
    )
    .orderBy(desc(dropSignals.confidenceScore));

  const teamIds = [...new Set(rows.flatMap((r) => [r.homeTeamId, r.awayTeamId]))];
  const teamRows = teamIds.length
    ? await db
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(inArray(teams.id, teamIds))
    : [];
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));

  return rows.map((r) => ({
    matchId: r.matchId,
    matchKey: r.matchKey,
    signalStatus: r.signalStatus,
    matchStatus: r.matchStatus,
    confidenceScore: Number(r.confidenceScore),
    kickoffAt: r.kickoffAt,
    country: r.country,
    league: r.league,
    homeTeam: teamName.get(r.homeTeamId) ?? null,
    awayTeam: teamName.get(r.awayTeamId) ?? null,
  }));
}

/* ------------------------------------------------------------------ */
/* Il report e la fase                                                 */
/* ------------------------------------------------------------------ */

export interface WireReport {
  enabled: boolean;
  /** motivo quando la fase resta spenta */
  reason: string | null;
  /** segnali attivi considerati (dopo soglia di fiducia) */
  candidates: number;
  /** partite lette davvero sulla fonte in questo giro */
  read: number;
  /** snapshot per-book scritti in odds_snapshots */
  quotesWritten: number;
  /** crediti spesi in questo giro */
  creditsSpent: number;
  /** contatore giornaliero dopo il giro */
  usedToday: number;
  /** contatore mensile dopo il giro */
  usedThisMonth: number;
  /** candidati scartati prima della rete, con motivo */
  skipped: WireSkip[];
  /** letture negate dal budget, con motivo */
  budgetDenied: Array<{ matchId: number; reason: string }>;
  errors: string[];
}

const EMPTY_REPORT: WireReport = {
  enabled: false,
  reason: null,
  candidates: 0,
  read: 0,
  quotesWritten: 0,
  creditsSpent: 0,
  usedToday: 0,
  usedThisMonth: 0,
  skipped: [],
  budgetDenied: [],
  errors: [],
};

/**
 * La fase di cablaggio: un giro, per i soli segnali attivi coperte.
 *
 * Spenta (flag assenti o incompleti) non tocca il database né la rete: torna
 * subito con il motivo. Accesa, legge i segnali attivi, seleziona i candidati,
 * chiede il permesso al budget per ciascuno e scrive le linee per-book in
 * `odds_snapshots`. Ogni esito — letto, scartato, negato, errore — resta
 * dichiarato nel report: nessun silenzio e nessun dato inventato.
 */
export async function runPerBookmakerWire(
  now: Date = new Date(),
  runId: number | null = null,
): Promise<WireReport> {
  const gate = wireGate(process.env);
  if (!gate.enabled) {
    return { ...EMPTY_REPORT, reason: gate.reason };
  }

  const rows = await listWireSignalRows();
  const { candidates, skipped } = pickWireCandidates(rows, now);

  const report: WireReport = {
    enabled: true,
    reason: null,
    candidates: candidates.length,
    read: 0,
    quotesWritten: 0,
    creditsSpent: 0,
    usedToday: await readCounter(dayKey(now)),
    usedThisMonth: await readCounter(monthKey(now)),
    skipped,
    budgetDenied: [],
    errors: [],
  };

  const hasKey = readOddsApiKey() !== null;

  for (const candidate of candidates) {
    const decision = decide(
      {
        usedThisMonth: await readCounter(monthKey(now)),
        usedToday: await readCounter(dayKey(now)),
        matchAlreadyRead: await matchAlreadyReadToday(candidate.matchId, now),
        signalActive: true,
      },
      now,
      hasKey,
    );

    if (!decision.allowed) {
      report.budgetDenied.push({ matchId: candidate.matchId, reason: decision.message });
      continue;
    }

    let outcome;
    try {
      outcome = await collectAndPersistTheOddsApiOdds({
        matchId: candidate.matchId,
        fixtureKey: candidate.fixtureKey,
        sportKey: candidate.sportKey,
        homeTeam: candidate.homeTeam,
        awayTeam: candidate.awayTeam,
        kickoffAt: candidate.kickoffAt,
        runId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push(`cablaggio partita ${candidate.matchId}: ${message}`);
      continue;
    }

    const spent = creditsSpentFor(outcome.result);
    if (spent > 0) {
      await addCredits(monthKey(now), spent, now).catch(() => undefined);
      await addCredits(dayKey(now), spent, now).catch(() => undefined);
      await markWireRead(candidate.matchId, now).catch(() => undefined);
      report.creditsSpent += spent;
      report.read += 1;
    }

    if (outcome.result.ok) {
      report.quotesWritten += outcome.persistence?.written ?? 0;
    } else {
      report.errors.push(
        `cablaggio partita ${candidate.matchId}: ${outcome.result.error.kind} — ${outcome.result.error.message}`,
      );
    }
  }

  report.usedToday = await readCounter(dayKey(now));
  report.usedThisMonth = await readCounter(monthKey(now));
  return report;
}
