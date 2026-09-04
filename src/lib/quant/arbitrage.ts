/**
 * Motore di Calcolo Surebet (Arbitraggio a Profitto Certo) e Dutching Multi-Selezione.
 *
 * Formule:
 *  - Somma probabilità implicite S = sum(1 / Odds_i)
 *  - Se S < 1.00 -> SUREBET PRESENTE!
 *  - Profitto % = (1 / S - 1) * 100
 *  - Stake_i = Totale * (1 / Odds_i) / S
 */
import { round, isValidPrice } from "@/lib/drop/math";
import type { ArbitrageResult, DutchingInputOutcome, DutchingResult } from "./types";

/**
 * Calcola l'arbitraggio (Surebet) dato un insieme di esiti, quote e bookmaker.
 */
export function calculateArbitrage(
  outcomes: Array<{ label: string; bookmaker: string; odds: number }>,
  totalStake: number = 1000,
): ArbitrageResult {
  if (!outcomes || outcomes.length < 2 || outcomes.some((o) => !isValidPrice(o.odds))) {
    return {
      isArbitrage: false,
      arbitrageMarginPct: 0,
      profitPct: 0,
      totalStake,
      totalPayout: 0,
      guaranteedProfit: 0,
      outcomes: [],
    };
  }

  const implied = outcomes.map((o) => 1 / o.odds);
  const sumS = implied.reduce((a, b) => a + b, 0);

  const isArbitrage = sumS < 0.9999;
  const arbitrageMarginPct = round((sumS - 1) * 100, 2);
  const profitPct = round((1 / sumS - 1) * 100, 2);

  const calculatedOutcomes = outcomes.map((o) => {
    const rawStake = (totalStake * (1 / o.odds)) / sumS;
    const stake = round(rawStake, 2);
    const payout = round(stake * o.odds, 2);
    return {
      label: o.label,
      bookmaker: o.bookmaker,
      odds: o.odds,
      stake,
      payout,
      impliedPct: round((1 / o.odds) * 100, 2),
    };
  });

  const totalPayout = calculatedOutcomes[0]?.payout ?? 0;
  const guaranteedProfit = round(totalPayout - totalStake, 2);

  return {
    isArbitrage,
    arbitrageMarginPct,
    profitPct,
    totalStake,
    totalPayout,
    guaranteedProfit,
    outcomes: calculatedOutcomes,
  };
}

/**
 * Calcolatore di Dutching: distribuisce lo stake totale su più selezioni
 * in modo da garantire lo stesso profitto netto a prescindere da quale vinca.
 */
export function calculateDutching(
  outcomes: DutchingInputOutcome[],
  totalStake: number = 100,
  commissionPct: number = 0, // es. 2% o 5% su Exchange
): DutchingResult | null {
  if (!outcomes || outcomes.length < 2 || outcomes.some((o) => !isValidPrice(o.odds))) {
    return null;
  }

  const commMult = 1 - commissionPct / 100;
  // Quota netta effettiva dopo la commissione: 1 + (Odds - 1) * commMult
  const effectiveOdds = outcomes.map((o) => 1 + (o.odds - 1) * commMult);
  const implied = effectiveOdds.map((eff) => 1 / eff);
  const sumS = implied.reduce((a, b) => a + b, 0);

  const combinedOdds = round(1 / sumS, 3);
  const totalPayout = totalStake * combinedOdds;
  const profitAmount = round(totalPayout - totalStake, 2);
  const roiPct = round((profitAmount / totalStake) * 100, 2);

  const resultOutcomes = outcomes.map((o, i) => {
    const eff = effectiveOdds[i];
    const stake = round((totalStake * (1 / eff)) / sumS, 2);
    const payout = round(stake + stake * (o.odds - 1) * commMult, 2);
    const profit = round(payout - totalStake, 2);

    return {
      label: o.label,
      odds: o.odds,
      stake,
      payout,
      profit,
    };
  });

  return {
    totalStake,
    profitAmount,
    roiPct,
    combinedOdds,
    outcomes: resultOutcomes,
  };
}
