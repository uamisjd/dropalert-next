/**
 * SharpAPI Adapter — Linea sharp (Pinnacle) come benchmark per value betting.
 *
 * SharpAPI fornisce quote da Pinnacle (e altri sharp bookmaker) con +EV detection
 * built-in e latenza <89ms. Free tier: 12 req/min (17.280/giorno).
 *
 * Questo adapter permette di confrontare le quote soft (da BetExplorer) con la
 * linea sharp (Pinnacle) per calcolare il vero Expected Value.
 *
 * Configurazione:
 * - SHARP_API_KEY nel file .env (mai committare!)
 * - SHARP_API_BASE_URL opzionale (default: https://sharpapi.io)
 */

import { round } from "@/lib/drop/math";

const SHARP_API_BASE = process.env.SHARP_API_BASE_URL || "https://sharpapi.io";
const SHARP_API_KEY = process.env.SHARP_API_KEY;

export interface SharpOdds {
  bookmaker: string;
  market: string;
  selection: string;
  odds: number;
  fairOdds?: number;
  trueProbability?: number;
  evPercent?: number;
  lastUpdate: Date;
}

export interface SharpMatchOdds {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: Date;
  odds: {
    "1": SharpOdds | null; // Casa
    X: SharpOdds | null; // Pareggio
    "2": SharpOdds | null; // Trasferta
  };
  arbitrage?: {
    exists: boolean;
    profitPct: number;
  };
}

/**
 * Controlla se l'adapter SharpAPI è configurato e disponibile.
 */
export function isSharpApiAvailable(): boolean {
  return Boolean(SHARP_API_KEY);
}

/**
 * Recupera le quote sharp (Pinnacle) per un match specifico.
 *
 * @param matchId - ID del match nel formato SharpAPI (es. "soccer/england/premier-league/arsenal-chelsea")
 * @returns Quote sharp per 1X2, o null se non disponibili
 */
export async function getSharpOdds(matchId: string): Promise<SharpMatchOdds | null> {
  if (!isSharpApiAvailable()) {
    console.warn("[sharp-api] API key non configurata");
    return null;
  }

  try {
    const response = await fetch(`${SHARP_API_BASE}/v1/odds/${encodeURIComponent(matchId)}`, {
      headers: {
        Authorization: `Bearer ${SHARP_API_KEY}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: 300 }, // Cache per 5 minuti
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[sharp-api] Match non trovato: ${matchId}`);
        return null;
      }
      if (response.status === 429) {
        console.warn("[sharp-api] Rate limit raggiunto, riprova tra 1 minuto");
        return null;
      }
      throw new Error(`SharpAPI error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return parseSharpOddsResponse(data);
  } catch (error) {
    console.error("[sharp-api] Errore nel recupero quote:", error);
    return null;
  }
}

/**
 * Recupera le quote sharp per più match in batch.
 *
 * @param matchIds - Array di ID match
 * @returns Map di matchId -> SharpMatchOdds
 */
export async function getSharpOddsBatch(matchIds: string[]): Promise<Map<string, SharpMatchOdds>> {
  const results = new Map<string, SharpMatchOdds>();

  if (!isSharpApiAvailable() || matchIds.length === 0) {
    return results;
  }

  // SharpAPI free tier: 12 req/min, quindi max 12 match per chiamata
  // Per rispettare il rate limit, facciamo chiamate sequenziali con delay
  const batchSize = 10; // leggermente sotto il limite per sicurezza
  const delayMs = 5000; // 5 secondi tra batch (12 req/min = 1 req ogni 5 sec)

  for (let i = 0; i < matchIds.length; i += batchSize) {
    const batch = matchIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (id) => {
        const odds = await getSharpOdds(id);
        return odds ? [id, odds] as const : null;
      }),
    );

    for (const result of batchResults) {
      if (result) {
        results.set(result[0], result[1]);
      }
    }

    // Delay tra batch (tranne l'ultimo)
    if (i + batchSize < matchIds.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

/**
 * Confronta quote soft (nostre) con quote sharp (Pinnacle) e calcola EV.
 *
 * @param softPrices - Quote dal nostro bookmaker [1, X, 2]
 * @param sharpPrices - Quote da Pinnacle [1, X, 2]
 * @returns Array di value bets con edge > 0
 */
export function findValueBets(
  softPrices: number[],
  sharpPrices: number[],
): Array<{
  selection: "1" | "X" | "2";
  softOdds: number;
  sharpOdds: number;
  fairOdds: number;
  edgePct: number;
  hasValue: boolean;
}> {
  if (softPrices.length !== 3 || sharpPrices.length !== 3) {
    return [];
  }

  // Calcola fair odds da Pinnacle (rimuovi margine)
  const sharpImpliedProbs = sharpPrices.map((p) => 1 / p);
  const totalImplied = sharpImpliedProbs.reduce((sum, p) => sum + p, 0);
  const fairProbs = sharpImpliedProbs.map((p) => p / totalImplied);
  const fairOdds = fairProbs.map((p) => round(1 / p, 3));

  const selections: Array<"1" | "X" | "2"> = ["1", "X", "2"];
  const results = [];

  for (let i = 0; i < 3; i++) {
    const softOdds = softPrices[i];
    const sharpOdd = sharpPrices[i];
    const fair = fairOdds[i];

    // EV = (softOdds / fairOdds) - 1
    const edgePct = round(((softOdds / fair) - 1) * 100, 2);

    results.push({
      selection: selections[i],
      softOdds: round(softOdds, 3),
      sharpOdds: round(sharpOdd, 3),
      fairOdds: fair,
      edgePct,
      hasValue: edgePct > 0,
    });
  }

  return results;
}

/**
 * Calcola arbitraggio fra quote soft e sharp.
 *
 * Arbitraggio esiste se: somma(1/best_odds) < 1
 *
 * @param softPrices - Quote dal nostro bookmaker [1, X, 2]
 * @param sharpPrices - Quote da Pinnacle [1, X, 2]
 * @returns Info arbitraggio se esiste
 */
export function calculateArbitrage(
  softPrices: number[],
  sharpPrices: number[],
): {
  exists: boolean;
  profitPct: number;
  bestOdds: number[];
  stakes: number[]; // per bankroll di 100
} | null {
  if (softPrices.length !== 3 || sharpPrices.length !== 3) {
    return null;
  }

  // Prendi la quota migliore per ogni selezione
  const bestOdds = softPrices.map((soft, i) => Math.max(soft, sharpPrices[i]));

  // Calcola somma inversi
  const sumInverse = bestOdds.reduce((sum, odds) => sum + 1 / odds, 0);

  // Se somma < 1, c'è arbitraggio
  if (sumInverse >= 1) {
    return {
      exists: false,
      profitPct: 0,
      bestOdds,
      stakes: [0, 0, 0],
    };
  }

  // Profitto % = (1 - sumInverse) * 100
  const profitPct = round((1 - sumInverse) * 100, 2);

  // Calcola stakes per bankroll 100
  const totalStake = 100;
  const stakes = bestOdds.map((odds) => round((totalStake / odds) / sumInverse, 2));

  return {
    exists: true,
    profitPct,
    bestOdds,
    stakes,
  };
}

/**
 * Parser per la risposta di SharpAPI.
 * Adatta il formato JSON dell'API alla nostra interfaccia SharpMatchOdds.
 */
interface SharpApiSelection {
  name?: string;
  label?: string;
  bookmaker?: string;
  odds?: number;
  price?: number;
  fairOdds?: number;
  trueProbability?: number;
  evPercent?: number;
  lastUpdate?: string;
}

interface SharpApiMarket {
  market?: string;
  selections?: SharpApiSelection[];
}

interface SharpApiMatch {
  id?: string;
  matchId?: string;
  homeTeam?: string;
  home_team?: string;
  awayTeam?: string;
  away_team?: string;
  league?: string;
  competition?: string;
  kickoffAt?: string;
  kickoff_at?: string;
  startTime?: string;
  odds?: SharpApiMarket[];
  match?: SharpApiMatch;
}

function parseSharpOddsResponse(data: SharpApiMatch): SharpMatchOdds | null {
  try {
    // Adatta in base al formato reale di SharpAPI
    // Questa è una struttura ipotetica, va adattata quando si vede la risposta reale
    const match = data.match || data;

    const odds1X2 = match.odds?.find((o: SharpApiMarket) => o.market === "1X2" || o.market === "moneyline");
    if (!odds1X2) {
      return null;
    }

    const findSelection = (sel: string) => {
      const selection = odds1X2.selections?.find((s: SharpApiSelection) => s.name === sel || s.label === sel);
      if (!selection) return null;

      return {
        bookmaker: selection.bookmaker || "Pinnacle",
        market: "1X2",
        selection: sel,
        odds: round(selection.odds || selection.price, 3),
        fairOdds: selection.fairOdds ? round(selection.fairOdds, 3) : undefined,
        trueProbability: selection.trueProbability ? round(selection.trueProbability, 4) : undefined,
        evPercent: selection.evPercent ? round(selection.evPercent, 2) : undefined,
        lastUpdate: new Date(selection.lastUpdate || Date.now()),
      };
    };

    return {
      matchId: match.id || match.matchId,
      homeTeam: match.homeTeam || match.home_team,
      awayTeam: match.awayTeam || match.away_team,
      league: match.league || match.competition,
      kickoffAt: new Date(match.kickoffAt || match.kickoff_at || match.startTime),
      odds: {
        "1": findSelection("1") || findSelection("Home"),
        X: findSelection("X") || findSelection("Draw"),
        "2": findSelection("2") || findSelection("Away"),
      },
    };
  } catch (error) {
    console.error("[sharp-api] Errore nel parsing della risposta:", error);
    return null;
  }
}
