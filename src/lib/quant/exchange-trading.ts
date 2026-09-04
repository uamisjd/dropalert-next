/**
 * Motore per Trading su Betting Exchange (Betfair, Betdaq).
 * Include:
 *  - Calcolatore di Green-Up (Hedging a profitto distribuito su tutti gli esiti)
 *  - Calcolatore di Freebet (Trade a rischio zero)
 *  - Calcolo dei Tick Betfair (struttura a gradini dei prezzi)
 *  - Scalping Pre-Match & In-Play Momentum
 */
import { round, isValidPrice } from "@/lib/drop/math";
import type { GreenUpCalculation } from "./types";

/**
 * Tabella degli scaglioni di tick standard Betfair.
 */
export const BETFAIR_TICK_LADDER = [
  { from: 1.01, to: 2.0, step: 0.01 },
  { from: 2.0, to: 3.0, step: 0.02 },
  { from: 3.0, to: 4.0, step: 0.05 },
  { from: 4.0, to: 6.0, step: 0.1 },
  { from: 6.0, to: 10.0, step: 0.2 },
  { from: 10.0, to: 20.0, step: 0.5 },
  { from: 20.0, to: 30.0, step: 1.0 },
  { from: 30.0, to: 50.0, step: 2.0 },
  { from: 50.0, to: 100.0, step: 5.0 },
  { from: 100.0, to: 1000.0, step: 10.0 },
];

/**
 * Calcola quanti tick separano due quote su un exchange.
 */
export function calculateTickDistance(fromOdds: number, toOdds: number): number {
  if (!isValidPrice(fromOdds) || !isValidPrice(toOdds)) return 0;
  if (Math.abs(fromOdds - toOdds) < 1e-6) return 0;

  const sign = toOdds < fromOdds ? -1 : 1;
  const start = Math.min(fromOdds, toOdds);
  const end = Math.max(fromOdds, toOdds);

  let ticks = 0;
  let current = start;

  for (const tier of BETFAIR_TICK_LADDER) {
    if (current >= end) break;
    const tierEnd = Math.min(tier.to, end);
    if (current < tierEnd && current >= tier.from - 1e-6) {
      const diff = tierEnd - current;
      const count = Math.round(diff / tier.step);
      ticks += count;
      current = tierEnd;
    }
  }

  return ticks * sign;
}

/**
 * Esegue il calcolo di Green-Up o Freebet per una posizione Back aperta.
 */
export function calculateGreenUp(params: {
  backOdds: number;
  backStake: number;
  layOdds: number;
  commissionPct?: number; // default 2% o 5%
  mode?: "equal_profit" | "freebet_back" | "freebet_lay";
}): GreenUpCalculation | null {
  const {
    backOdds,
    backStake,
    layOdds,
    commissionPct = 4.5,
    mode = "equal_profit",
  } = params;

  if (
    !isValidPrice(backOdds) ||
    !isValidPrice(layOdds) ||
    typeof backStake !== "number" ||
    backStake <= 0
  ) {
    return null;
  }

  const commFactor = 1 - commissionPct / 100;
  const ticks = calculateTickDistance(backOdds, layOdds);

  // Equal Profit (Green Up)
  // Lay Stake = (Back Stake * Back Odds) / Lay Odds
  const requiredLayStakeEqual = (backStake * backOdds) / layOdds;
  const grossProfitEqual = requiredLayStakeEqual - backStake;
  const netProfitEqual = grossProfitEqual > 0 ? grossProfitEqual * commFactor : grossProfitEqual;

  // Freebet on Selection (Lay stake = Back stake)
  const requiredLayStakeFreebet = backStake;
  const grossFreebetWin = backStake * (backOdds - layOdds);
  const netFreebetWin = grossFreebetWin > 0 ? grossFreebetWin * commFactor : grossFreebetWin;

  let chosenLayStake = requiredLayStakeEqual;
  if (mode === "freebet_back") {
    chosenLayStake = requiredLayStakeFreebet;
  }

  const roiPct = round((netProfitEqual / backStake) * 100, 2);

  return {
    backOdds: round(backOdds, 3),
    backStake: round(backStake, 2),
    layOdds: round(layOdds, 3),
    commissionPct: round(commissionPct, 1),
    mode,
    requiredLayStake: round(chosenLayStake, 2),
    hedgedProfitIfWin: round(netProfitEqual, 2),
    hedgedProfitIfLose: round(netProfitEqual, 2),
    hedgedProfitNet: round(netProfitEqual, 2),
    freebetProfitIfWin: round(netFreebetWin, 2),
    freebetProfitIfLose: 0,
    roiPct,
    tickDifference: ticks,
  };
}
