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

/*
 * `evaluateDroppingSignalValue` è stata rimossa (audit `docs/STUDIO-VALUE-BETS.md`):
 * derivava la «fair» dividendo il consenso corrente per 1,045 — un margine ipotizzato,
 * non misurato — e valutava l'edge sul prezzo di apertura, cioè su un'offerta che non
 * esiste più. La misura difendibile sta in `../quant/value-gap.ts`: linea completa dello
 * stesso bookmaker con lo stesso no-vig del CLV, prezzo valutato quello eseguibile.
 *
 * Resta qui `findValueFromSharpPrices`, che invece due linee vere le confronta: serve
 * appena la fonte esporrà le quote per singolo bookmaker (`perBookmakerOdds`).
 */
