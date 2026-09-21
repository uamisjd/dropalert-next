/**
 * SharpAPI Adapter — modulo DEPRECATO, standalone, non cablato nel sito.
 *
 * STATO (deciso il 21/09/2026, `docs/BACKLOG.md` → «Debiti minori»): nessuna
 * rotta, nessun registry (`src/lib/providers/registry.ts`, composizione in
 * `src/lib/providers/index.ts`) e nessun giro di raccolta importa questo file.
 * Verificato con grep il 21/09: zero importazioni esterne, e le cinque funzioni
 * esportate non sono chiamate da nessuna parte del progetto.
 *
 * Conseguenza pratica: **configurare `SHARP_API_KEY` non cambia nulla di ciò
 * che il sito mostra**. La linea sharp usata dal monitor è quella di
 * The Odds API (`src/lib/providers/optional/odds-api-sharp.ts`), dietro il
 * doppio flag del cablaggio (`ODDS_WIRE_COLLECT` +
 * `DROP_EXCLUDE_CONSENSUS_BOOKS`).
 *
 * Perché resta nel repository: è interrogabile a mano dagli script (vedere
 * `GUIDA-OPERATIVA.md` §«Testa l'adapter SharpAPI») e resta il riferimento per
 * un eventuale cablaggio futuro. Quel lavoro non è una riga di codice: chiede
 * l'ingresso nel registry con le capacità dichiarate, un budget e un backoff
 * propri, i test di contratto e una decisione sul costo del provider.
 *
 * Finché non viene fatto: non estendere questo modulo e non farci
 * affidamento. Le esportazioni sono marcate `@deprecated` perché gli editor e
 * `tsc` lo dicano a chi le incontra.
 *
 * Cosa fa, se interrogato direttamente: legge la linea sharp (Pinnacle e altri
 * libri di riferimento) e la confronta con quote soft per +EV e arbitraggio.
 * Free tier dichiarato dal provider: 12 req/min (17.280/giorno).
 *
 * Configurazione (solo per l'uso standalone):
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
 *
 * @deprecated Modulo non cablato: vedere l'intestazione del file.
 */
export function isSharpApiAvailable(): boolean {
  return Boolean(SHARP_API_KEY);
}

/**
 * Recupera le quote sharp (Pinnacle) per un match specifico.
 *
 * @deprecated Modulo non cablato: vedere l'intestazione del file.
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
 * @deprecated Modulo non cablato: vedere l'intestazione del file.
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
 * @deprecated Modulo non cablato: il divario di prezzo del sito è in
 * `src/lib/repo/value-bets.ts` e usa la linea realmente raccolta.
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
 * @deprecated Modulo non cablato: lo scanner di arbitraggio del sito è
 * `src/lib/quant/arbitrage.ts`, che legge i prezzi realmente raccolti.
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

/** Oggetto JSON qualsiasi, per navigare una risposta sconosciuta senza `any`. */
type JsonObject = Record<string, unknown>;

/** Restituisce l'oggetto se è davvero un oggetto (non array/null), altrimenti null. */
function asJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

/** Numero finito se il valore lo è (o lo diventa con Number), altrimenti undefined. */
function toFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Primo valore truthy fra quelli dati (stessa semantica della catena `a || b`). */
function firstTruthy(...values: unknown[]): unknown {
  for (const v of values) {
    if (v) return v;
  }
  return undefined;
}

/**
 * Parser per la risposta di SharpAPI.
 * Adatta il formato JSON dell'API alla nostra interfaccia SharpMatchOdds.
 */
function parseSharpOddsResponse(data: unknown): SharpMatchOdds | null {
  try {
    const root = asJsonObject(data);
    if (!root) return null;

    // Adatta in base al formato reale di SharpAPI
    // Questa è una struttura ipotetica, va adattata quando si vede la risposta reale
    const match = asJsonObject(root.match) ?? root;

    const oddsEntries = Array.isArray(match.odds) ? match.odds : [];
    const odds1X2 = oddsEntries
      .map(asJsonObject)
      .find(
        (o): o is JsonObject =>
          o !== null && (o.market === "1X2" || o.market === "moneyline"),
      );
    if (!odds1X2) {
      return null;
    }

    const findSelection = (sel: string): SharpOdds | null => {
      const selectionEntries = Array.isArray(odds1X2.selections)
        ? odds1X2.selections
        : [];
      const selection = selectionEntries
        .map(asJsonObject)
        .find(
          (s): s is JsonObject =>
            s !== null && (s.name === sel || s.label === sel),
        );
      if (!selection) return null;

      const odds = toFiniteNumber(selection.odds ?? selection.price);
      if (odds === undefined) return null;

      const fair = toFiniteNumber(selection.fairOdds);
      const prob = toFiniteNumber(selection.trueProbability);
      const ev = toFiniteNumber(selection.evPercent);
      const updatedAt = toFiniteNumber(selection.lastUpdate);

      return {
        bookmaker:
          typeof selection.bookmaker === "string"
            ? selection.bookmaker
            : "Pinnacle",
        market: "1X2",
        selection: sel,
        odds: round(odds, 3),
        fairOdds: fair !== undefined ? round(fair, 3) : undefined,
        trueProbability: prob !== undefined ? round(prob, 4) : undefined,
        evPercent: ev !== undefined ? round(ev, 2) : undefined,
        /* lastUpdate può essere un timestamp (numero) o una stringa ISO;
           se manca del tutto si usa l'istante corrente. */
        lastUpdate:
          updatedAt !== undefined
            ? new Date(updatedAt)
            : typeof selection.lastUpdate === "string"
              ? new Date(selection.lastUpdate)
              : new Date(),
      };
    };

    const textOf = (...values: unknown[]): string => {
      for (const v of values) {
        if (v) return typeof v === "string" ? v : String(v);
      }
      return "";
    };

    /* kickoff: può essere stringa ISO o timestamp numerico; si conserva il
       valore grezzo (primo truthy), come faceva la catena `||` originale. */
    const kickoffRaw = firstTruthy(
      match.kickoffAt,
      match.kickoff_at,
      match.startTime,
    );

    return {
      matchId: textOf(match.id, match.matchId),
      homeTeam: textOf(match.homeTeam, match.home_team),
      awayTeam: textOf(match.awayTeam, match.away_team),
      league: textOf(match.league, match.competition),
      /* senza kickoff il Date è volutamente invalido (come faceva
         `new Date(undefined)` dell'originale): mai un istante inventato */
      kickoffAt:
        kickoffRaw === undefined
          ? new Date("")
          : new Date(kickoffRaw as string | number),
      odds: {
        "1": findSelection("1") ?? findSelection("Home"),
        X: findSelection("X") ?? findSelection("Draw"),
        "2": findSelection("2") ?? findSelection("Away"),
      },
    };
  } catch (error) {
    console.error("[sharp-api] Errore nel parsing della risposta:", error);
    return null;
  }
}
