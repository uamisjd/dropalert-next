/**
 * Modello Statistico Dixon-Coles & Poisson Bivariato per il Calcio.
 *
 * Genera la matrice completa delle probabilità dei risultati esatti (da 0-0 a 6-6)
 * correggendo le correlazioni a basso punteggio tramite il parametro tau di Dixon-Coles (1997).
 * Calcola le probabilità e quote fair per:
 *  - 1X2 (Esito Finale)
 *  - Over / Under 1.5, 2.5, 3.5
 *  - Goal / No Goal (BTTS)
 *  - Risultati esatti più probabili
 */
import { round } from "@/lib/drop/math";
import type { DixonColesParams, PoissonSimulationResult, ScoreMatrixEntry } from "./types";

function factorial(n: number): number {
  if (n <= 1) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

function poissonProb(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Fattore di correzione tau di Dixon-Coles per punteggi bassi.
 */
function dixonColesTau(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) {
    return 1 - lambda * mu * rho;
  }
  if (x === 0 && y === 1) {
    return 1 + lambda * rho;
  }
  if (x === 1 && y === 0) {
    return 1 + mu * rho;
  }
  if (x === 1 && y === 1) {
    return 1 - rho;
  }
  return 1.0;
}

/**
 * Esegue la simulazione Dixon-Coles per una coppia di squadre con xG / goal expectancy.
 */
export function simulateDixonColes(params: DixonColesParams): PoissonSimulationResult {
  const { lambdaHome, muAway, rho = -0.12, maxGoals = 6 } = params;

  const lH = Math.max(0.1, lambdaHome);
  const mA = Math.max(0.1, muAway);

  // Calcola la matrice grezza
  const rawMatrix: number[][] = [];
  let totalRawSum = 0;

  for (let x = 0; x <= maxGoals; x++) {
    rawMatrix[x] = [];
    const pX = poissonProb(x, lH);
    for (let y = 0; y <= maxGoals; y++) {
      const pY = poissonProb(y, mA);
      const tau = dixonColesTau(x, y, lH, mA, rho);
      const prob = Math.max(0, pX * pY * tau);
      rawMatrix[x][y] = prob;
      totalRawSum += prob;
    }
  }

  // Normalizza la matrice
  const scoreMatrix: ScoreMatrixEntry[][] = [];
  const flatScores: Array<{ home: number; away: number; probPct: number; odds: number }> = [];

  let homeWinProb = 0;
  let drawProb = 0;
  let awayWinProb = 0;
  let over15Prob = 0;
  let over25Prob = 0;
  let over35Prob = 0;
  let bttsYesProb = 0;

  for (let x = 0; x <= maxGoals; x++) {
    scoreMatrix[x] = [];
    for (let y = 0; y <= maxGoals; y++) {
      const prob = rawMatrix[x][y] / totalRawSum;
      const probPct = round(prob * 100, 3);
      const fairOdds = prob > 0 ? round(1 / prob, 2) : 999;

      scoreMatrix[x][y] = {
        homeGoals: x,
        awayGoals: y,
        probPct,
        fairOdds,
      };

      flatScores.push({ home: x, away: y, probPct, odds: fairOdds });

      // Aggrega i mercati
      if (x > y) homeWinProb += prob;
      else if (x === y) drawProb += prob;
      else awayWinProb += prob;

      const totalGoals = x + y;
      if (totalGoals >= 2) over15Prob += prob;
      if (totalGoals >= 3) over25Prob += prob;
      if (totalGoals >= 4) over35Prob += prob;

      if (x >= 1 && y >= 1) bttsYesProb += prob;
    }
  }

  // Ordina per risultati più probabili
  flatScores.sort((a, b) => b.probPct - a.probPct);
  const mostLikelyScores = flatScores.slice(0, 6);

  const under15Prob = 1 - over15Prob;
  const under25Prob = 1 - over25Prob;
  const under35Prob = 1 - over35Prob;
  const bttsNoProb = 1 - bttsYesProb;

  const oddsOf = (p: number) => (p > 0.0001 ? round(1 / p, 2) : 999);

  return {
    lambdaHome: round(lH, 2),
    muAway: round(mA, 2),
    scoreMatrix,
    probabilities: {
      homeWinPct: round(homeWinProb * 100, 2),
      drawPct: round(drawProb * 100, 2),
      awayWinPct: round(awayWinProb * 100, 2),
      over15Pct: round(over15Prob * 100, 2),
      under15Pct: round(under15Prob * 100, 2),
      over25Pct: round(over25Prob * 100, 2),
      under25Pct: round(under25Prob * 100, 2),
      over35Pct: round(over35Prob * 100, 2),
      under35Pct: round(under35Prob * 100, 2),
      bttsYesPct: round(bttsYesProb * 100, 2),
      bttsNoPct: round(bttsNoProb * 100, 2),
    },
    fairOdds: {
      homeWin: oddsOf(homeWinProb),
      draw: oddsOf(drawProb),
      awayWin: oddsOf(awayWinProb),
      over15: oddsOf(over15Prob),
      under15: oddsOf(under15Prob),
      over25: oddsOf(over25Prob),
      under25: oddsOf(under25Prob),
      over35: oddsOf(over35Prob),
      under35: oddsOf(under35Prob),
      bttsYes: oddsOf(bttsYesProb),
      bttsNo: oddsOf(bttsNoProb),
    },
    mostLikelyScores,
  };
}

/**
 * Stima i valori di lambda e mu da dati di rating attacco/difesa e media gol campionato.
 */
export function estimateTeamExpectancy(params: {
  homeAttackRating: number; // 1.0 = media, 1.3 = +30% attacco
  homeDefenseRating: number; // 1.0 = media, 0.8 = -20% gol subiti (ottima difesa)
  awayAttackRating: number;
  awayDefenseRating: number;
  leagueAverageHomeGoals?: number; // default 1.45
  leagueAverageAwayGoals?: number; // default 1.15
}): { lambdaHome: number; muAway: number } {
  const {
    homeAttackRating,
    homeDefenseRating,
    awayAttackRating,
    awayDefenseRating,
    leagueAverageHomeGoals = 1.45,
    leagueAverageAwayGoals = 1.15,
  } = params;

  const lambdaHome = homeAttackRating * awayDefenseRating * leagueAverageHomeGoals;
  const muAway = awayAttackRating * homeDefenseRating * leagueAverageAwayGoals;

  return {
    lambdaHome: round(Math.max(0.2, lambdaHome), 2),
    muAway: round(Math.max(0.2, muAway), 2),
  };
}
