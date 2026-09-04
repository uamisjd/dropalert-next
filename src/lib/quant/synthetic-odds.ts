/**
 * Generatore di Quote Sintetiche e Correlazione Multi-Mercato.
 *
 * Consente di:
 *  - Ricavare le quote sintetiche perfette di Doppia Chance, Draw No Bet (DNB) e Asian Handicap da 1X2
 *  - Verificare se il bookmaker ha commesso un errore di disallineamento tra mercati collegati
 */
import { round, isValidPrice } from "@/lib/drop/math";
import type { SyntheticMarketResult } from "./types";

/**
 * Calcola i mercati derivati sintetici a partire dalle quote 1X2.
 */
export function buildSyntheticMarkets(
  homeOdds: number,
  drawOdds: number,
  awayOdds: number,
): SyntheticMarketResult | null {
  if (
    !isValidPrice(homeOdds) ||
    !isValidPrice(drawOdds) ||
    !isValidPrice(awayOdds)
  ) {
    return null;
  }

  // Doppia Chance: 1 / (1/O1 + 1/OX)
  const oneX = 1 / (1 / homeOdds + 1 / drawOdds);
  const xTwo = 1 / (1 / drawOdds + 1 / awayOdds);
  const oneTwo = 1 / (1 / homeOdds + 1 / awayOdds);

  // Draw No Bet (rimborso in caso di pareggio):
  // O_DNB1 = (O1 * (OX - 1)) / OX
  const dnb1 = (homeOdds * (drawOdds - 1)) / drawOdds;
  const dnb2 = (awayOdds * (drawOdds - 1)) / drawOdds;

  return {
    doubleChance: {
      oneX: round(oneX, 3),
      xTwo: round(xTwo, 3),
      oneTwo: round(oneTwo, 3),
    },
    drawNoBet: {
      dnb1: round(Math.max(1.01, dnb1), 3),
      dnb2: round(Math.max(1.01, dnb2), 3),
    },
    asianHandicapZero: {
      ah0Home: round(Math.max(1.01, dnb1), 3),
      ah0Away: round(Math.max(1.01, dnb2), 3),
    },
    asianHandicapMinus05Home: round(homeOdds, 3),
    asianHandicapPlus05Home: round(oneX, 3),
  };
}

/**
 * Rileva discrepanze tra la quota offerta su un mercato secondario (es. DNB o DC)
 * e la quota sintetica implicita nel mercato 1X2.
 */
export function detectMarketDiscrepancy(params: {
  offeredSecondaryOdds: number;
  syntheticOdds: number;
  marketName: string;
}): {
  hasDiscrepancy: boolean;
  edgePct: number;
  direction: "secondary_overpriced" | "secondary_underpriced" | "aligned";
} {
  const { offeredSecondaryOdds, syntheticOdds } = params;
  if (!isValidPrice(offeredSecondaryOdds) || !isValidPrice(syntheticOdds)) {
    return { hasDiscrepancy: false, edgePct: 0, direction: "aligned" };
  }

  const ratio = offeredSecondaryOdds / syntheticOdds;
  const edgePct = round((ratio - 1) * 100, 2);

  if (edgePct >= 2.0) {
    return {
      hasDiscrepancy: true,
      edgePct,
      direction: "secondary_overpriced",
    };
  }
  if (edgePct <= -2.0) {
    return {
      hasDiscrepancy: true,
      edgePct,
      direction: "secondary_underpriced",
    };
  }

  return {
    hasDiscrepancy: false,
    edgePct,
    direction: "aligned",
  };
}
