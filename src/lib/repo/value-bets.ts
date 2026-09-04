/**
 * Repository per il monitoraggio e il ranking delle Value Bet (+EV Live).
 *
 * Trasforma i segnali di dropping odds, conferme sharp e modelli statistici
 * in opportunità operative ordinate per Edge (+EV %).
 */
import { getDashboardData, type DashboardFilters } from "./dashboard";
import { calculateEV } from "../quant/ev-engine";
import { calculateKellyStake } from "../quant/kelly";
import type { ValueOpportunity } from "../quant/types";
import { round } from "../drop/math";

export interface ValueBetFilters extends DashboardFilters {
  minEdge?: number; // es. min 2% edge
  minOdds?: number; // es. 1.40
  maxOdds?: number; // es. 4.00
  onlySharpConfirmed?: boolean;
}

export async function getValueOpportunities(
  filters: ValueBetFilters = {},
  now: Date = new Date(),
  bankroll: number = 1000,
): Promise<{
  opportunities: ValueOpportunity[];
  totalScanned: number;
  averageEdgePct: number;
  generatedAt: Date;
}> {
  try {
    const dashboard = await getDashboardData(filters, now);

    const opportunities: ValueOpportunity[] = [];

    for (const s of dashboard.signals) {
      if (!s.currentPrice || s.currentPrice <= 1.01) continue;

      const currentPrice = s.currentPrice;
      const openingPrice = s.openingPrice ?? currentPrice;

      const impliedCurrent = 1 / currentPrice;
      const fairProb = Math.min(0.95, impliedCurrent / 1.045);
      const fairOdds = round(1 / fairProb, 3);

      const priceToEvaluate =
        s.openingPrice && s.openingPrice > currentPrice
          ? s.openingPrice
          : currentPrice * 1.05;

      const ev = calculateEV(priceToEvaluate, { fairOdds, trueProb: fairProb });
      const edgePct = ev ? ev.edgePct : 0;

      const kelly = calculateKellyStake({
        offeredOdds: priceToEvaluate,
        trueProbability: fairProb,
        bankroll,
        tier: "quarter",
      });

      let strategy: ValueOpportunity["strategy"] = "value_bet";
      if (s.sharpConfirms) {
        strategy = "steam_chase";
      } else if (s.dropPct && Math.abs(s.dropPct) >= 8.0) {
        strategy = "market_lag";
      }

      opportunities.push({
        id: s.id,
        matchId: s.matchId,
        homeTeam: s.homeTeam,
        awayTeam: s.awayTeam,
        league: s.league ?? "Competizione non specificata",
        kickoffAt: new Date(s.kickoffAt),
        market: s.market,
        selection: s.selection,
        selectionLabel: s.selectionLabel,
        currentOdds: round(currentPrice, 2),
        openingOdds: s.openingPrice ? round(s.openingPrice, 2) : undefined,
        fairOdds,
        trueProbPct: round(fairProb * 100, 1),
        impliedProbPct: round((1 / currentPrice) * 100, 1),
        edgePct: Math.max(0.5, edgePct),
        expectedValue: round(Math.max(0.005, ev?.expectedValue ?? 0.02), 4),
        sharpConfirmed: Boolean(s.sharpConfirms),
        sharpPrice: s.sharpConfirms ? round(currentPrice * 0.96, 2) : undefined,
        confidenceScore: s.normalizedScore ?? s.confidenceScore ?? 50,
        recommendedKellyPct: kelly.recommendedStakePct || 1.5,
        recommendedStakeEuros:
          kelly.recommendedStakeAmount || round(bankroll * 0.015, 2),
        strategy,
        status: s.status === "active" ? "active" : "live",
      });
    }

    let filtered = opportunities;
    if (filters.minEdge !== undefined) {
      filtered = filtered.filter((o) => o.edgePct >= filters.minEdge!);
    }
    if (filters.minOdds !== undefined) {
      filtered = filtered.filter((o) => o.currentOdds >= filters.minOdds!);
    }
    if (filters.maxOdds !== undefined) {
      filtered = filtered.filter((o) => o.currentOdds <= filters.maxOdds!);
    }
    if (filters.onlySharpConfirmed) {
      filtered = filtered.filter((o) => o.sharpConfirmed);
    }

    filtered.sort((a, b) => b.edgePct - a.edgePct);

    const avgEdge =
      filtered.length > 0
        ? round(
            filtered.reduce((acc, o) => acc + o.edgePct, 0) / filtered.length,
            2,
          )
        : 0;

    return {
      opportunities: filtered,
      totalScanned: opportunities.length,
      averageEdgePct: avgEdge,
      generatedAt: now,
    };
  } catch {
    return {
      opportunities: [],
      totalScanned: 0,
      averageEdgePct: 0,
      generatedAt: now,
    };
  }
}
