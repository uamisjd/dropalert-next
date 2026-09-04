/**
 * Money Management e Staking Scientifico: Criterio di Kelly Frazionale.
 *
 * Formule:
 *  - f* = (p * (Odds - 1) - (1 - p)) / (Odds - 1)
 *  - Quarter Kelly = 0.25 * f* (Standard professionale per minimizzare il drawdown)
 *  - Half Kelly = 0.50 * f*
 *  - Eighth Kelly = 0.125 * f*
 */
import { round, isValidPrice } from "@/lib/drop/math";
import type { FractionalKellyTier, KellyCalculationResult } from "./types";

export interface KellyInput {
  offeredOdds: number;
  trueProbability: number; // 0.0 - 1.0
  bankroll?: number; // default 1000
  tier?: FractionalKellyTier; // default "quarter"
  maxCapPct?: number; // tetto massimo di stake per singola giocata, es. 5%
}

/**
 * Calcola la percentuale e l'importo di puntata ottimale secondo Kelly Frazionale.
 */
export function calculateKellyStake(input: KellyInput): KellyCalculationResult {
  const {
    offeredOdds,
    trueProbability,
    bankroll = 1000,
    tier = "quarter",
    maxCapPct = 5.0,
  } = input;

  if (
    !isValidPrice(offeredOdds) ||
    typeof trueProbability !== "number" ||
    trueProbability <= 0 ||
    trueProbability >= 1.0
  ) {
    return {
      fullKellyPct: 0,
      halfKellyPct: 0,
      quarterKellyPct: 0,
      eighthKellyPct: 0,
      selectedTier: tier,
      recommendedStakePct: 0,
      recommendedStakeAmount: 0,
      hasEdge: false,
      edgePct: 0,
      growthRatePct: 0,
    };
  }

  const p = trueProbability;
  const q = 1 - p;
  const b = offeredOdds - 1;

  // f* = (p * b - q) / b
  const fullKelly = (p * b - q) / b;
  const hasEdge = fullKelly > 0;
  const edgePct = round((p * offeredOdds - 1) * 100, 2);

  if (!hasEdge) {
    return {
      fullKellyPct: 0,
      halfKellyPct: 0,
      quarterKellyPct: 0,
      eighthKellyPct: 0,
      selectedTier: tier,
      recommendedStakePct: 0,
      recommendedStakeAmount: 0,
      hasEdge: false,
      edgePct,
      growthRatePct: 0,
    };
  }

  const fullKellyPct = fullKelly * 100;
  const halfKellyPct = fullKellyPct * 0.5;
  const quarterKellyPct = fullKellyPct * 0.25;
  const eighthKellyPct = fullKellyPct * 0.125;

  let rawRecommendedPct = quarterKellyPct;
  if (tier === "full") rawRecommendedPct = fullKellyPct;
  else if (tier === "half") rawRecommendedPct = halfKellyPct;
  else if (tier === "eighth") rawRecommendedPct = eighthKellyPct;

  // Applica il tetto di sicurezza (maxCapPct, es. max 5% del bankroll)
  const cappedRecommendedPct = Math.min(rawRecommendedPct, maxCapPct);
  const stakeAmount = (bankroll * cappedRecommendedPct) / 100;

  // Tasso di crescita geometrico atteso g(f) = p * ln(1 + f*b) + (1-p) * ln(1 - f)
  const f = cappedRecommendedPct / 100;
  let growthRate = 0;
  if (f < 1.0) {
    growthRate = p * Math.log(1 + f * b) + q * Math.log(1 - f);
  }

  return {
    fullKellyPct: round(fullKellyPct, 2),
    halfKellyPct: round(halfKellyPct, 2),
    quarterKellyPct: round(quarterKellyPct, 2),
    eighthKellyPct: round(eighthKellyPct, 2),
    selectedTier: tier,
    recommendedStakePct: round(cappedRecommendedPct, 2),
    recommendedStakeAmount: round(stakeAmount, 2),
    hasEdge: true,
    edgePct,
    growthRatePct: round(growthRate * 100, 3),
  };
}
