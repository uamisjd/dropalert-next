/**
 * Tipi per il motore quantitativo di DropAlert Pro.
 * Copre: Value Betting (+EV), Dixon-Coles/Poisson, Shin Devig, Kelly Staking,
 * Surebet/Arbitraggio, Dutching e Trading Exchange (Green-Up/Scalping).
 */

export type FractionalKellyTier = "eighth" | "quarter" | "half" | "full";

export interface ValueOpportunity {
  id: string | number;
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: Date;
  market: "1x2" | "ou_2_5" | "btts" | string;
  selection: string;
  selectionLabel: string;
  currentOdds: number;
  openingOdds?: number;
  fairOdds: number;
  trueProbPct: number;
  impliedProbPct: number;
  edgePct: number; // EV % (es. +6.5%)
  expectedValue: number; // edge come decimale (es. 0.065)
  sharpConfirmed: boolean;
  sharpPrice?: number;
  confidenceScore: number;
  recommendedKellyPct: number; // es. 1.63% del bankroll
  recommendedStakeEuros?: number;
  strategy: "value_bet" | "steam_chase" | "market_lag" | "model_discrepancy";
  status: "active" | "live" | "closed";
}

export interface AdvancedDevigResult {
  method: "shin" | "power" | "proportional" | "additive";
  fairProbabilities: number[]; // sommano a 1.0 (100%)
  fairOdds: number[];
  overroundPct: number;
  marginPct: number;
  holdPct: number;
  shinZ?: number; // parametro insider trading di Shin se calcolato
}

export interface DixonColesParams {
  lambdaHome: number; // xG o goal expectancy casa
  muAway: number; // xG o goal expectancy trasferta
  rho?: number; // parametro di correlazione Dixon-Coles per punteggi bassi (-0.15 typ.)
  maxGoals?: number; // default 5 o 6
}

export interface ScoreMatrixEntry {
  homeGoals: number;
  awayGoals: number;
  probPct: number;
  fairOdds: number;
}

export interface PoissonSimulationResult {
  lambdaHome: number;
  muAway: number;
  scoreMatrix: ScoreMatrixEntry[][];
  probabilities: {
    homeWinPct: number;
    drawPct: number;
    awayWinPct: number;
    over15Pct: number;
    under15Pct: number;
    over25Pct: number;
    under25Pct: number;
    over35Pct: number;
    under35Pct: number;
    bttsYesPct: number;
    bttsNoPct: number;
  };
  fairOdds: {
    homeWin: number;
    draw: number;
    awayWin: number;
    over15: number;
    under15: number;
    over25: number;
    under25: number;
    over35: number;
    under35: number;
    bttsYes: number;
    bttsNo: number;
  };
  mostLikelyScores: Array<{ home: number; away: number; probPct: number; odds: number }>;
}

export interface KellyCalculationResult {
  fullKellyPct: number;
  halfKellyPct: number;
  quarterKellyPct: number;
  eighthKellyPct: number;
  selectedTier: FractionalKellyTier;
  recommendedStakePct: number;
  recommendedStakeAmount: number; // in valuta (€) dato un bankroll
  hasEdge: boolean;
  edgePct: number;
  growthRatePct: number; // expected compounding growth rate
}

export interface ArbitrageOutcome {
  label: string;
  bookmaker: string;
  odds: number;
  stake: number;
  payout: number;
  impliedPct: number;
}

export interface ArbitrageResult {
  isArbitrage: boolean;
  arbitrageMarginPct: number; // se negativo c'è surebet (es. -2.35%)
  profitPct: number; // ritorno netto garantito (es. +2.41%)
  totalStake: number;
  totalPayout: number;
  guaranteedProfit: number;
  outcomes: ArbitrageOutcome[];
}

export interface DutchingInputOutcome {
  label: string;
  odds: number;
  targetProfitOnly?: boolean;
}

export interface DutchingResult {
  totalStake: number;
  profitAmount: number;
  roiPct: number;
  combinedOdds: number;
  outcomes: Array<{
    label: string;
    odds: number;
    stake: number;
    payout: number;
    profit: number;
  }>;
}

export interface GreenUpCalculation {
  backOdds: number;
  backStake: number;
  layOdds: number;
  commissionPct: number; // default 2% o 5% per Betfair
  mode: "equal_profit" | "freebet_back" | "freebet_lay";
  requiredLayStake: number;
  hedgedProfitIfWin: number;
  hedgedProfitIfLose: number;
  hedgedProfitNet: number; // se equal_profit, identico in ogni caso
  freebetProfitIfWin: number;
  freebetProfitIfLose: number;
  roiPct: number;
  tickDifference: number;
}

export interface SyntheticMarketResult {
  doubleChance: {
    oneX: number;
    xTwo: number;
    oneTwo: number;
  };
  drawNoBet: {
    dnb1: number;
    dnb2: number;
  };
  asianHandicapZero: {
    ah0Home: number;
    ah0Away: number;
  };
  asianHandicapMinus05Home: number; // uguale a Home 1X2
  asianHandicapPlus05Home: number; // uguale a 1X
}
