/**
 * Repository per opportunità di Trading & Scalping su Betting Exchange.
 * Identifica movimenti di quota (steam moves) ideali per strategie
 * Back-to-Lay pre-match e scalping di momentum.
 */
import { getDashboardData } from "./dashboard";
import { calculateGreenUp, calculateTickDistance } from "../quant/exchange-trading";
import { round } from "../drop/math";

export interface TradingOpportunity {
  signalId: number;
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: Date;
  marketLabel: string;
  selectionLabel: string;
  entryBackOdds: number;
  currentLayOdds: number;
  tickMovement: number;
  dropPct: number;
  sustainedMinutes: number;
  greenUpRoiPct: number;
  exampleNetProfitEuros: number; // calcolato su 100€ di puntata iniziale
  strategyPhase: "entry_open" | "momentum_active" | "green_up_ready" | "take_profit";
  volatility: "alta" | "media" | "bassa";
}

export async function getTradingOpportunities(
  now: Date = new Date(),
  baseStake: number = 100,
): Promise<{
  trades: TradingOpportunity[];
  totalActive: number;
  generatedAt: Date;
}> {
  try {
    const dashboard = await getDashboardData({}, now);

    const trades: TradingOpportunity[] = [];

    for (const s of dashboard.signals) {
      if (
        !s.openingPrice ||
        !s.currentPrice ||
        s.openingPrice <= s.currentPrice
      ) {
        continue;
      }

      const backOdds = s.openingPrice;
      const layOdds = s.currentPrice;
      const ticks = calculateTickDistance(backOdds, layOdds);

      if (Math.abs(ticks) >= 3) {
        const greenUp = calculateGreenUp({
          backOdds,
          backStake: baseStake,
          layOdds,
          commissionPct: 4.5,
        });

        if (greenUp) {
          let strategyPhase: TradingOpportunity["strategyPhase"] =
            "momentum_active";
          if (
            Math.abs(ticks) >= 15 ||
            (s.dropPct && Math.abs(s.dropPct) >= 10)
          ) {
            strategyPhase = "green_up_ready";
          } else if (Math.abs(ticks) >= 8) {
            strategyPhase = "take_profit";
          }

          let volatility: TradingOpportunity["volatility"] = "media";
          if (backOdds > 3.0) volatility = "alta";
          else if (backOdds < 1.7) volatility = "bassa";

          trades.push({
            signalId: s.id,
            matchId: s.matchId,
            homeTeam: s.homeTeam,
            awayTeam: s.awayTeam,
            league: s.league ?? "Campionato",
            kickoffAt: new Date(s.kickoffAt),
            marketLabel: s.marketLabel,
            selectionLabel: s.selectionLabel,
            entryBackOdds: round(backOdds, 2),
            currentLayOdds: round(layOdds, 2),
            tickMovement: Math.abs(ticks),
            dropPct: s.dropPct ?? 0,
            sustainedMinutes: s.sustainedMinutes,
            greenUpRoiPct: greenUp.roiPct,
            exampleNetProfitEuros: greenUp.hedgedProfitNet,
            strategyPhase,
            volatility,
          });
        }
      }
    }

    trades.sort((a, b) => b.greenUpRoiPct - a.greenUpRoiPct);

    return {
      trades,
      totalActive: trades.length,
      generatedAt: now,
    };
  } catch {
    return {
      trades: [],
      totalActive: 0,
      generatedAt: now,
    };
  }
}
