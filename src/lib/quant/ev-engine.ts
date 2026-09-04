/**
 * Motore di Calcolo Expected Value (+EV) e Rilevamento Alpha.
 *
 * Principi:
 *  - EV = (True Probability * Offered Odds) - 1
 *  - Edge % = EV * 100
 *  - Calcola la discrepanza tra la quota offerta dal bookmaker e la quota fair di riferimento
 */
import { round, isValidPrice } from "@/lib/drop/math";
import { getBestFairOdds } from "./devig-advanced";
import { calculateKellyStake } from "./kelly";
import type { ValueOpportunity } from "./types";

export interface EVCalculation {
  offeredOdds: number;
  fairOdds: number;
  trueProbability: number;
  impliedProbability: number;
  expectedValue: number; // decimale, es. 0.052
  edgePct: number; // percentuale, es. +5.20%
  hasEdge: boolean;
  volatilityTier: "low" | "medium" | "high" | "extreme";
  roiExpectationPct: number;
}

/**
 * Calcola l'Expected Value e l'Edge % dati quota offerta e probabilità reale (o quota fair).
 */
export function calculateEV(
  offeredOdds: number,
  trueProbabilityOrFairOdds: { trueProb?: number; fairOdds?: number },
): EVCalculation | null {
  if (!isValidPrice(offeredOdds)) return null;

  let trueProb = trueProbabilityOrFairOdds.trueProb;
  let fairOdds = trueProbabilityOrFairOdds.fairOdds;

  if (fairOdds !== undefined && isValidPrice(fairOdds)) {
    trueProb = 1 / fairOdds;
  } else if (trueProb !== undefined && trueProb > 0 && trueProb <= 1.0) {
    fairOdds = 1 / trueProb;
  } else {
    return null;
  }

  const impliedProb = 1 / offeredOdds;
  const ev = trueProb * offeredOdds - 1.0;
  const edgePct = round(ev * 100, 2);

  // Volatilità in base all'entità della quota
  let volatilityTier: "low" | "medium" | "high" | "extreme" = "medium";
  if (offeredOdds < 1.7) volatilityTier = "low";
  else if (offeredOdds <= 2.8) volatilityTier = "medium";
  else if (offeredOdds <= 5.0) volatilityTier = "high";
  else volatilityTier = "extreme";

  return {
    offeredOdds: round(offeredOdds, 3),
    fairOdds: round(fairOdds, 3),
    trueProbability: round(trueProb, 4),
    impliedProbability: round(impliedProb, 4),
    expectedValue: round(ev, 4),
    edgePct,
    hasEdge: ev > 0.0001,
    volatilityTier,
    roiExpectationPct: edgePct,
  };
}

/**
 * Confronta un set di quote di mercato con una terna di quote Sharp (es. Pinnacle)
 * e trova tutte le selezioni che presentano un vantaggio matematico (+EV).
 */
export function findValueFromSharpPrices(
  marketPrices: number[], // es. quote offerte dal bookmaker soft per [1, X, 2]
  sharpPrices: number[], // es. quote offerte da Pinnacle per [1, X, 2]
  selectionLabels: string[] = ["1", "X", "2"],
): Array<{
  selectionIndex: number;
  label: string;
  offeredPrice: number;
  sharpPrice: number;
  fairOdds: number;
  trueProbPct: number;
  edgePct: number;
  hasValue: boolean;
}> {
  if (
    !marketPrices ||
    !sharpPrices ||
    marketPrices.length !== sharpPrices.length ||
    marketPrices.length < 2
  ) {
    return [];
  }

  const devig = getBestFairOdds(sharpPrices);
  if (!devig) return [];

  const results = [];
  for (let i = 0; i < marketPrices.length; i++) {
    const offered = marketPrices[i];
    const fair = devig.fairOdds[i];
    const trueP = devig.fairProbabilities[i];

    if (isValidPrice(offered) && isValidPrice(fair)) {
      const ev = calculateEV(offered, { fairOdds: fair, trueProb: trueP });
      if (ev) {
        results.push({
          selectionIndex: i,
          label: selectionLabels[i] ?? `Esito ${i + 1}`,
          offeredPrice: offered,
          sharpPrice: sharpPrices[i],
          fairOdds: fair,
          trueProbPct: round(trueP * 100, 2),
          edgePct: ev.edgePct,
          hasValue: ev.hasEdge && ev.edgePct >= 1.0, // valore rilevante se >= +1%
        });
      }
    }
  }

  return results;
}

/**
 * Calcola l'opportunità +EV a partire dal movimento del prezzo osservato
 * (se il mercato è crollato da 2.30 a 1.95 e un book è fermo a 2.15).
 */
export function evaluateDroppingSignalValue(params: {
  openingPrice: number;
  currentConsensusPrice: number;
  offeredPrice: number;
  sustainedMinutes: number;
  sharpConfirms: boolean | null;
  confidenceScore: number;
}): {
  edgePct: number;
  fairOdds: number;
  isActionableValue: boolean;
  strategy: ValueOpportunity["strategy"];
  recommendedKellyPct: number;
} {
  const { openingPrice, currentConsensusPrice, offeredPrice, sharpConfirms } = params;

  // Stima della quota fair dal consenso corrente de-viggato
  // Ipotizziamo un margine medio standard del 5% sul consenso
  const implied = 1 / currentConsensusPrice;
  // Fair prob approssimata rimuovendo un margine stimato
  const fairProb = implied / 1.045;
  const fairOdds = round(1 / fairProb, 3);

  const ev = calculateEV(offeredPrice, { fairOdds, trueProb: fairProb });
  const edgePct = ev ? ev.edgePct : 0;

  let strategy: ValueOpportunity["strategy"] = "value_bet";
  if (sharpConfirms) {
    strategy = "steam_chase";
  } else if (offeredPrice > currentConsensusPrice) {
    strategy = "market_lag";
  }

  const kelly = calculateKellyStake({
    offeredOdds: offeredPrice,
    trueProbability: fairProb,
    bankroll: 1000,
    tier: "quarter",
  });

  return {
    edgePct,
    fairOdds,
    isActionableValue: edgePct >= 1.5,
    strategy,
    recommendedKellyPct: kelly.recommendedStakePct,
  };
}
