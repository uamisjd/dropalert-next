/**
 * Escursione dei prezzi pre-gara, letta a ritroso.
 *
 * Che cosa è: per ogni segnale con un movimento misurabile (apertura → ultima
 * lettura) conta i tick percorsi e calcola quanto valeva, QUEI DUE PREZZI, chiudere la
 * posizione. È aritmetica su letture reali del consenso.
 *
 * Che cosa NON è: un'operazione di trading. Questo sito non legge alcun exchange — non
 * esistono prezzi di bancata, né profondità del ladder, né commissioni rilevate: il
 * «lay» qui è la stessa quota di consenso usata per l'apertura, e la commissione è
 * l'assunzione di 4,5% che il calcolatore di exchange usa di norma. Da qui i nomi dei
 * campi (`hindsight*`): la colonna è «quanto valeva», non «quanto vale». L'audit che ha
 * portato a riscriverla è in `docs/STUDIO-VALUE-BETS.md` §2.6.
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
  /** apertura letta dal motore dei drop */
  priceOpening: number;
  /** ultima lettura di consenso: NON è un prezzo di bancata di alcun exchange */
  priceCurrent: number;
  tickMovement: number;
  /** calo % dall'apertura letto dal motore dei drop; `null` se assente, mai 0 di ripiego */
  dropPct: number | null;
  sustainedMinutes: number;
  /** quanto valeva chiudere fra i due prezzi letti, su 100 € ipotetici */
  hindsightNetEuros: number;
  hindsightRoiPct: number;
  /** commissione ASSUNTA, non rilevata: è il 4,5% tipico dei calcolatori di exchange */
  commissionAssumedPct: number;
  /** i dati letti non contengono exchange: lo dichiara la pagina, non lo suggerisce un'etichetta */
  executable: false;
}

export async function getTradingOpportunities(
  now: Date = new Date(),
  baseStake: number = 100,
): Promise<{
  trades: TradingOpportunity[];
  /** segnali letti dall'elenco: il denominale onesto di `trades.length` */
  signalsRead: number;
  /**
   * true quando la lettura è fallita: senza questa bandiera una tabella vuota
   * sarebbe indistinguibile da «nessuna escursione» (zero di ripiego vietato).
   */
  readFailed: boolean;
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

          trades.push({
            signalId: s.id,
            matchId: s.matchId,
            homeTeam: s.homeTeam,
            awayTeam: s.awayTeam,
            league: s.league ?? "Competizione non attribuita",
            kickoffAt: new Date(s.kickoffAt),
            marketLabel: s.marketLabel,
            selectionLabel: s.selectionLabel,
            priceOpening: round(backOdds, 2),
            priceCurrent: round(layOdds, 2),
            tickMovement: Math.abs(ticks),
            dropPct: s.dropPct ?? null,
            sustainedMinutes: s.sustainedMinutes,
            hindsightRoiPct: greenUp.roiPct,
            hindsightNetEuros: greenUp.hedgedProfitNet,
            commissionAssumedPct: 4.5,
            executable: false,
          });
        }
      }
    }

    trades.sort((a, b) => b.tickMovement - a.tickMovement);

    return {
      trades,
      signalsRead: dashboard.signals.length,
      readFailed: false,
      generatedAt: now,
    };
  } catch (err) {
    // Il dettaglio grezzo resta nel log del server; la pagina riceve la bandiera,
    // non il messaggio del driver.
    console.error("[trading] lettura delle escursioni non riuscita:", err);
    return {
      trades: [],
      signalsRead: 0,
      readFailed: true,
      generatedAt: now,
    };
  }
}
