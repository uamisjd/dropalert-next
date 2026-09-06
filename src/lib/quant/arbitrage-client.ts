/**
 * Funzioni client-side per calcolatori manuali di arbitraggio e dutching.
 *
 * Questo file è separato da `arbitrage.ts` (che usa il database) per evitare
 * di importare moduli Node.js (postgres, fs, net, tls) in componenti client-side.
 *
 * Usato da:
 * - SurebetCalculator.tsx (calcolatore surebet manuale)
 * - DutchingCalculator.tsx (calcolatore dutching manuale)
 */

interface ArbitrageOutcome {
  label: string;
  bookmaker: string;
  odds: number;
}

export interface ArbitrageResult {
  isArbitrage: boolean;
  totalImpliedProb: number;
  arbitrageMarginPct: number; // overround - 100 (positivo = mercato con margine)
  profitPct: number;
  guaranteedProfit: number;
  totalStake: number;
  totalPayout: number;
  outcomes: Array<{
    label: string;
    bookmaker: string;
    odds: number;
    stake: number;
    payout: number;
    profit: number;
  }>;
}

/**
 * Calcola arbitraggio per quote inserite manualmente.
 * Usato dal componente SurebetCalculator.
 */
export function calculateArbitrage(
  outcomes: ArbitrageOutcome[],
  totalStake: number,
): ArbitrageResult {
  const impliedProbs = outcomes.map((o) => 1 / o.odds);
  const totalImpliedProb = impliedProbs.reduce((sum, p) => sum + p, 0);
  const profitPct = (1 - totalImpliedProb) * 100;
  const arbitrageMarginPct = (totalImpliedProb - 1) * 100;
  const isArbitrage = totalImpliedProb < 1;

  // Calcola stake per ogni outcome (proporzionale alla probabilità implicita)
  const result = outcomes.map((o, i) => {
    const stakePct = impliedProbs[i] / totalImpliedProb;
    const stake = Math.round((totalStake * stakePct) * 100) / 100;
    const payout = Math.round(stake * o.odds * 100) / 100;
    const profit = Math.round((payout - totalStake) * 100) / 100;
    return {
      label: o.label,
      bookmaker: o.bookmaker,
      odds: o.odds,
      stake,
      payout,
      profit,
    };
  });

  const guaranteedProfit = isArbitrage
    ? Math.round((totalStake * (1 - totalImpliedProb)) * 100) / 100
    : 0;

  const totalPayout = isArbitrage
    ? Math.min(...result.map((o) => o.payout))
    : 0;

  return {
    isArbitrage,
    totalImpliedProb: Math.round(totalImpliedProb * 10000) / 10000,
    arbitrageMarginPct: Math.round(arbitrageMarginPct * 100) / 100,
    profitPct: Math.round(profitPct * 100) / 100,
    guaranteedProfit,
    totalStake,
    totalPayout,
    outcomes: result,
  };
}

interface DutchOutcome {
  label: string;
  odds: number;
}

export interface DutchingResult {
  totalStake: number;
  totalImpliedProb: number;
  combinedOdds: number; // quota sintetica combinata
  profitAmount: number; // profitto netto in euro
  roiPct: number; // ROI in percentuale
  outcomes: Array<{
    label: string;
    odds: number;
    stake: number;
    payout: number;
    profit: number;
  }>;
}

/**
 * Calcola dutching: ripartizione di una puntata su più esiti in modo che
 * il profitto sia uguale indipendentemente dall'esito vincente.
 * Usato dal componente DutchingCalculator.
 */
export function calculateDutching(
  outcomes: DutchOutcome[],
  totalStake: number,
  commissionPct: number = 0,
): DutchingResult | null {
  if (outcomes.length === 0) return null;

  const impliedProbs = outcomes.map((o) => 1 / o.odds);
  const totalImpliedProb = impliedProbs.reduce((sum, p) => sum + p, 0);
  const combinedOdds = 1 / totalImpliedProb;

  // Calcola stake per ogni outcome (proporzionale alla probabilità implicita)
  const result = outcomes.map((o, i) => {
    const stakePct = impliedProbs[i] / totalImpliedProb;
    const stake = Math.round((totalStake * stakePct) * 100) / 100;
    const grossPayout = stake * o.odds;
    const commission = commissionPct > 0 ? (grossPayout - stake) * (commissionPct / 100) : 0;
    const payout = Math.round((grossPayout - commission) * 100) / 100;
    const profit = Math.round((payout - totalStake) * 100) / 100;
    return {
      label: o.label,
      odds: o.odds,
      stake,
      payout,
      profit,
    };
  });

  // Profitto netto (minimo tra tutti gli outcomes)
  const profitAmount = Math.min(...result.map((o) => o.profit));
  const roiPct = Math.round((profitAmount / totalStake) * 1000) / 10;

  return {
    totalStake,
    totalImpliedProb: Math.round(totalImpliedProb * 10000) / 10000,
    combinedOdds: Math.round(combinedOdds * 100) / 100,
    profitAmount,
    roiPct,
    outcomes: result,
  };
}
