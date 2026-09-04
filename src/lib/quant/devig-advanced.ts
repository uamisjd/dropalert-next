/**
 * Tecniche di De-Vigging Avanzate (Rimozione del Margine del Bookmaker).
 * Include:
 *  - Metodo di Shin (standard aureo della letteratura quantitativa / insider trading parameter)
 *  - Metodo Power (esponenziale / correzione favourite-longshot bias)
 *  - Metodo Proporzionale (moltiplicativo)
 *  - Metodo Additivo
 */
import { round, isValidPrice } from "@/lib/drop/math";
import type { AdvancedDevigResult } from "./types";

const TOLERANCE = 1e-11;
const MAX_ITERATIONS = 200;

/**
 * Calcola le probabilità fair e le quote no-vig tramite il metodo di Shin (1991, 1993).
 * Isola la quota z di insider trading nel mercato per restituire le probabilità reali oggettive.
 */
export function devigShin(prices: number[]): AdvancedDevigResult | null {
  if (!prices || prices.length < 2 || prices.some((p) => !isValidPrice(p))) {
    return null;
  }

  const implied = prices.map((p) => 1 / p);
  const overround = implied.reduce((a, b) => a + b, 0);

  if (overround <= 1.0) {
    // Mercato già senza margine o con surebet
    const sum = implied.reduce((a, b) => a + b, 0);
    const probs = implied.map((p) => p / sum);
    return {
      method: "shin",
      fairProbabilities: probs.map((p) => round(p, 5)),
      fairOdds: probs.map((p) => round(1 / p, 3)),
      overroundPct: round(overround * 100, 2),
      marginPct: round((overround - 1) * 100, 2),
      holdPct: round(((overround - 1) / overround) * 100, 2),
      shinZ: 0,
    };
  }

  // Risoluzione per bisezione del parametro z di Shin in [0, 1)
  // Calcolo di pi_i(z) per ogni esito:
  // pi_i = (sqrt(z^2 + 4*(1-z)*(implied_i^2 / sum(implied))) - z) / (2*(1-z))
  const sumImplied = overround;

  const calcProbs = (z: number): number[] => {
    if (Math.abs(z) < 1e-12) {
      return implied.map((p) => p / sumImplied);
    }
    const oneMinusZ = 1 - z;
    const twoOneMinusZ = 2 * oneMinusZ;
    const zSq = z * z;

    return implied.map((imp) => {
      const term = (4 * oneMinusZ * (imp * imp)) / sumImplied;
      const sqrtVal = Math.sqrt(Math.max(0, zSq + term));
      return (sqrtVal - z) / twoOneMinusZ;
    });
  };

  const f = (z: number): number => {
    const probs = calcProbs(z);
    return probs.reduce((a, b) => a + b, 0) - 1.0;
  };

  let lo = 0.0;
  let hi = 0.9999;
  let z = 0.0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    z = (lo + hi) / 2;
    const diff = f(z);
    if (Math.abs(diff) < TOLERANCE) break;
    if (diff > 0) {
      lo = z;
    } else {
      hi = z;
    }
  }

  const rawProbs = calcProbs(z);
  const probSum = rawProbs.reduce((a, b) => a + b, 0);
  const normalizedProbs = rawProbs.map((p) => p / probSum);

  return {
    method: "shin",
    fairProbabilities: normalizedProbs.map((p) => round(p, 5)),
    fairOdds: normalizedProbs.map((p) => round(1 / p, 3)),
    overroundPct: round(overround * 100, 2),
    marginPct: round((overround - 1) * 100, 2),
    holdPct: round(((overround - 1) / overround) * 100, 2),
    shinZ: round(z, 5),
  };
}

/**
 * Calcola le probabilità fair tramite il metodo Power (esponenziale).
 * Risolve k > 0 tale che sum(implied_i^k) = 1.0.
 */
export function devigPower(prices: number[]): AdvancedDevigResult | null {
  if (!prices || prices.length < 2 || prices.some((p) => !isValidPrice(p))) {
    return null;
  }

  const implied = prices.map((p) => 1 / p);
  const overround = implied.reduce((a, b) => a + b, 0);

  if (overround <= 1.0) {
    const sum = implied.reduce((a, b) => a + b, 0);
    const probs = implied.map((p) => p / sum);
    return {
      method: "power",
      fairProbabilities: probs.map((p) => round(p, 5)),
      fairOdds: probs.map((p) => round(1 / p, 3)),
      overroundPct: round(overround * 100, 2),
      marginPct: round((overround - 1) * 100, 2),
      holdPct: round(((overround - 1) / overround) * 100, 2),
    };
  }

  const f = (k: number) => implied.reduce((a, p) => a + Math.pow(p, k), 0) - 1.0;

  let lo = 1e-9;
  let hi = 1.0;
  while (f(hi) > 0 && hi < 1e6) hi *= 2;

  let k = hi;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    k = (lo + hi) / 2;
    const diff = f(k);
    if (Math.abs(diff) < TOLERANCE) break;
    if (diff > 0) lo = k;
    else hi = k;
  }

  const unnorm = implied.map((p) => Math.pow(p, k));
  const sumUnnorm = unnorm.reduce((a, b) => a + b, 0);
  const probs = unnorm.map((p) => p / sumUnnorm);

  return {
    method: "power",
    fairProbabilities: probs.map((p) => round(p, 5)),
    fairOdds: probs.map((p) => round(1 / p, 3)),
    overroundPct: round(overround * 100, 2),
    marginPct: round((overround - 1) * 100, 2),
    holdPct: round(((overround - 1) / overround) * 100, 2),
  };
}

/**
 * Calcola le probabilità fair tramite il metodo Proporzionale (standard).
 * Divide ciascuna probabilità implicita per l'overround totale.
 */
export function devigProportional(prices: number[]): AdvancedDevigResult | null {
  if (!prices || prices.length < 2 || prices.some((p) => !isValidPrice(p))) {
    return null;
  }

  const implied = prices.map((p) => 1 / p);
  const overround = implied.reduce((a, b) => a + b, 0);
  const probs = implied.map((p) => p / overround);

  return {
    method: "proportional",
    fairProbabilities: probs.map((p) => round(p, 5)),
    fairOdds: probs.map((p) => round(1 / p, 3)),
    overroundPct: round(overround * 100, 2),
    marginPct: round((overround - 1) * 100, 2),
    holdPct: round(((overround - 1) / overround) * 100, 2),
  };
}

/**
 * Restituisce la migliore stima quantitativa di Fair Odds e True Probabilities
 * utilizzando il metodo di Shin se applicabile, con fallback su Power e Proporzionale.
 */
export function getBestFairOdds(prices: number[]): AdvancedDevigResult | null {
  const shin = devigShin(prices);
  if (shin) return shin;

  const power = devigPower(prices);
  if (power) return power;

  return devigProportional(prices);
}
