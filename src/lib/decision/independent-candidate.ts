import { assessDecision, type DecisionAssessment } from "./contract";
import { THE_ODDS_API_SNAPSHOT_SOURCE } from "../providers/snapshot-sources";

export const CANDIDATE_POLICY = Object.freeze({ maxAgeMs: 5 * 60_000, maxSkewMs: 60_000, historyMs: 30 * 60_000, minMovementMs: 5 * 60_000, minimumEdgePct: 2, minimumIndex: 45 });
export type Outcome = "home" | "draw" | "away";
const outcomes: Outcome[] = ["home", "draw", "away"];
export interface CandidateSnapshot {
  matchId: number; market: string; selection: string; bookmaker: string;
  source: string; at: Date; price: number; isStale: boolean;
  /** Timestamp dichiarato dal provider, senza fallback sull’ora di download. */
  providerTimestampVerified?: boolean;
}
export interface ExecutionConfirmation {
  matchId: number; market: "1x2"; selection: Outcome; bookmaker: string;
  price: number; checkedAt: Date;
}
export interface IndependentCandidateInput {
  matchId: number; matchKey: string; matchStatus: string; kickoffAt: Date;
  selection: Outcome; targetBookmaker: string; confidenceScore: number;
  now: Date; snapshots: CandidateSnapshot[];
  /** Conferma esplicita dell'offerta accessibile, non un flag del provider. */
  execution: ExecutionConfirmation | null;
}
interface Line { at: Date; prices: Record<Outcome, number>; valid: boolean; providerTimed: boolean }
export interface IndependentCandidateResult {
  targetBookmaker: string; referenceBookmaker: "pinnacle";
  targetAt: Date | null; referenceAt: Date | null;
  price: number | null; fairProbability: number | null; fairOdds: number | null;
  /** (prezzo × probabilità di riferimento − 1) × 100, non punti di probabilità. */
  edgePct: number | null; blockers: string[]; decision: DecisionAssessment;
}

/** Nessun recupero di una vecchia terna completa se l’ultima lettura è incompleta. */
function linesFor(input: IndependentCandidateInput, book: string): Line[] {
  const grouped = new Map<number, CandidateSnapshot[]>();
  for (const row of input.snapshots) {
    if (row.matchId !== input.matchId || row.market !== "1x2" || row.bookmaker !== book || row.source !== THE_ODDS_API_SNAPSHOT_SOURCE) continue;
    const at = row.at.getTime();
    // Un timestamp corrotto non deve far selezionare una vecchia linea.
    if (!Number.isFinite(at)) return [];
    const list = grouped.get(at) ?? []; list.push(row); grouped.set(at, list);
  }
  return [...grouped].sort((a, b) => b[0] - a[0]).map(([at, rows]) => {
    const prices = {} as Record<Outcome, number>;
    const valid = rows.length === 3 && outcomes.every(selection => {
      const found = rows.filter(r => r.selection === selection);
      if (found.length !== 1 || found[0].isStale || !Number.isFinite(found[0].price) || found[0].price <= 1) return false;
      prices[selection] = found[0].price; return true;
    });
    return { at: new Date(at), prices, valid, providerTimed: rows.every(r => r.providerTimestampVerified === true) };
  });
}

/** Scanner sperimentale pre-gara. Nessuna rete, sizing, notifica o scrittura. */
export function evaluateIndependentCandidate(input: IndependentCandidateInput): IndependentCandidateResult {
  const p = CANDIDATE_POLICY;
  const blockers: string[] = [];
  const now = input.now.getTime();
  if (!Number.isFinite(now)) throw new Error("Istante di valutazione non valido");
  if (!Number.isInteger(input.matchId) || input.matchId <= 0 || input.matchKey.startsWith("demo-") || input.matchStatus !== "scheduled") blockers.push("Partita non pre-gara reale e programmata.");
  if (!outcomes.includes(input.selection)) blockers.push("Selezione non supportata: solo 1x2.");
  if (!Number.isFinite(input.confidenceScore) || input.confidenceScore < p.minimumIndex) blockers.push("Indice sotto 45 o non valido.");
  const book = input.targetBookmaker;
  if (!/^[a-z0-9_-]+$/.test(book) || /consensus|aggregate|exchange|betfair|smarkets/.test(book) || book === "pinnacle") blockers.push("Operatore non supportato o uguale al riferimento; exchange esclusi finché i costi non sono modellati.");
  const targetLines = linesFor(input, book), referenceLines = linesFor(input, "pinnacle");
  const target = targetLines[0], reference = referenceLines[0];
  const fresh = (line: Line | undefined) => !!line && line.valid && line.at.getTime() <= now && now - line.at.getTime() <= p.maxAgeMs;
  if (!target?.providerTimed || !reference?.providerTimed) blockers.push("Origine del timestamp provider non attestata: l'ora di download non prova la freschezza delle quote.");
  if (!fresh(target)) blockers.push("Ultima linea target assente, incompleta, stale o non fresca entro 5 minuti.");
  if (!fresh(reference)) blockers.push("Ultima linea Pinnacle assente, incompleta, stale o non fresca entro 5 minuti.");
  if (target && reference && Math.abs(target.at.getTime() - reference.at.getTime()) > p.maxSkewMs) blockers.push("Letture distanti oltre 60 secondi: confronto non sincronizzato.");
  let fairProbability: number | null = null;
  const price = fresh(target) ? target.prices[input.selection] ?? null : null;
  if (fresh(reference)) {
    const total = outcomes.reduce((sum, selection) => sum + 1 / reference.prices[selection], 0);
    if (total < 1 || total > 1.30) blockers.push("Margine del riferimento fuori intervallo di controllo 0–30%.");
    else fairProbability = (1 / reference.prices[input.selection]) / total;
  }
  const proof = input.execution;
  const executable = !!proof && proof.matchId === input.matchId && proof.market === "1x2" && proof.selection === input.selection && proof.bookmaker === book && proof.price === price && Number.isFinite(proof.checkedAt.getTime()) && proof.checkedAt.getTime() <= now && now - proof.checkedAt.getTime() <= p.maxAgeMs && !!target && proof.checkedAt.getTime() >= target.at.getTime();
  if (!executable) blockers.push("Offerta e accessibilità non confermate: una quota nel feed non prova l'eseguibilità.");

  function movement(lines: Line[]) {
    const recent = lines.filter(l => l.at.getTime() >= now - p.historyMs && l.at.getTime() <= now);
    const last = recent[0], first = recent[recent.length - 1];
    if (recent.length < 2 || recent.some(l => !l.valid || !l.providerTimed) || !last || !first || last.at.getTime() - first.at.getTime() < p.minMovementMs) return null;
    const drop = (last.prices[input.selection] / first.prices[input.selection] - 1) * 100;
    const rebound = recent.some((line, i) => i + 1 < recent.length && line.prices[input.selection] > recent[i + 1].prices[input.selection]);
    return { drop, rebound, duration: (last.at.getTime() - first.at.getTime()) / 60_000 };
  }
  const targetMovement = movement(targetLines), sharpMovement = movement(referenceLines);
  const edgePct = price !== null && fairProbability !== null ? (price * fairProbability - 1) * 100 : null;
  const decision = assessDecision({
    now: input.now, kickoffAt: input.kickoffAt, dataError: blockers.length ? blockers.join(" ") : null,
    priceAgeMinutes: target ? (now - target.at.getTime()) / 60_000 : null,
    maxPriceAgeMinutes: p.maxAgeMs / 60_000, currentPrice: price,
    priceSource: executable ? "bookmaker" : "unknown", marketComplete: fresh(target) && fresh(reference),
    fairProbability, fairSource: fairProbability !== null ? "independent_sharp" : "none",
    edgePct, minimumEdgePct: p.minimumEdgePct,
    movement: { observed: targetMovement !== null, dropPct: targetMovement?.drop ?? null, durationMinutes: targetMovement?.duration ?? null, isFlash: null, rebounded: targetMovement?.rebound ?? null, directionCoherent: targetMovement !== null && targetMovement.drop < 0, hoursToKickoff: (input.kickoffAt.getTime() - now) / 3_600_000 },
    sharpAvailable: fresh(reference), sharpConfirmed: sharpMovement !== null && sharpMovement.drop < 0 && !sharpMovement.rebound,
    context: { status: "unavailable", newsCount: null },
    // Nessuna opzione per inventare validazione storica o valore verificato.
    validation: { sampleSize: 0, minimumSampleSize: 30, outOfSamplePassed: false, clvPositive: false, calibrationPassed: false },
  });
  return { targetBookmaker: book, referenceBookmaker: "pinnacle", targetAt: target?.at ?? null, referenceAt: reference?.at ?? null, price, fairProbability, fairOdds: fairProbability !== null ? 1 / fairProbability : null, edgePct, blockers, decision };
}
