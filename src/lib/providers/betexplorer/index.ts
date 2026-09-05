/**
 * Adapter BetExplorer (Sprint 3B) — prima fonte reale.
 *
 * Implementa `OddsProvider` senza toccare il motore né lo schema.
 *
 * COSA QUESTA FONTE PUÒ E NON PUÒ DARE, dichiarato una volta per tutte:
 *
 * - Può dare: partite, campionato, quota 1X2 di CONSENSO, quota di
 *   apertura della selezione in calo, accordo fra book pubblicato dalla
 *   fonte ("18/19"), risultati finali.
 *
 * - NON può dare: le quote dei singoli bookmaker. Stanno dietro endpoint
 *   AJAX con `?matchid=`, vietati dal robots.txt. Di conseguenza
 *   `perBookmakerOdds` è false: coordinazione fra book e conferma della
 *   linea sharp NON sono calcolabili da questa fonte e restano dichiarate
 *   mancanti. Non si stimano, non si mettono a zero.
 *
 * La serie storica nasce dal NOSTRO polling ripetuto: ogni rilevazione è
 * un dato realmente osservato in quell'istante, non una ricostruzione.
 */
import {
  fetchPage,
  resultsPath,
  DROPPING_ODDS_PATH,
  type FetchLike,
  type FetchOutcome,
} from "./http";
import {
  humanizeSlug,
  matchKeyFor,
  parseDroppingOdds,
  parseMatchStartDate,
  parseResults,
  type ParsedFixtureRow,
} from "./parse";
import { envFlag, envInt } from "../registry";
import { EXCLUSION_CODES, taggedExclusion } from "../exclusion-codes";
import {
  fail,
  ok,
  partial,
  type DateRange,
  type FixtureDTO,
  type FixtureFetchLimits,
  type FixtureRef,
  type OddsProvider,
  type OddsQuoteDTO,
  type ProviderError,
  type ProviderHealth,
  type ProviderListing,
  type ProviderResult,
  type ResultDTO,
} from "../types";

export const BETEXPLORER_KEY = "betexplorer";

/**
 * Bookmaker sintetico sotto cui salvare la linea di consenso.
 * Chiave esplicita e `isSharp = false`: chi legge il dato deve sapere
 * subito che non è un singolo operatore.
 */
export const CONSENSUS_BOOKMAKER_KEY = "betexplorer-consensus";

/** La fonte è accesa salvo spegnimento esplicito: è la fonte principale. */
export function betexplorerEnabled(): boolean {
  return envFlag("BETEXPLORER_ENABLED", true);
}

/* ------------------------------------------------------------------ */
/* Traduzione degli errori HTTP                                        */
/* ------------------------------------------------------------------ */

/**
 * Classifica un esito HTTP fallito.
 * 403/429 non sono semplici errori: indicano che la fonte ci sta
 * respingendo, e vanno distinti per far scattare blocco e riposo.
 */
export function classifyFailure(outcome: FetchOutcome): ProviderError {
  if (outcome.status === 429) {
    return {
      kind: "rate_limited",
      message: `Troppe richieste (429) su ${outcome.url}. La fonte ci sta limitando.`,
      httpStatus: 429,
      url: outcome.url,
    };
  }
  if (outcome.status === 403 || outcome.status === 401) {
    return {
      kind: "blocked",
      message: `Accesso negato (${outcome.status}) su ${outcome.url}.`,
      httpStatus: outcome.status,
      url: outcome.url,
    };
  }
  if (outcome.status >= 400) {
    return {
      kind: "http",
      message: `Risposta HTTP ${outcome.status} su ${outcome.url}.`,
      httpStatus: outcome.status,
      url: outcome.url,
    };
  }
  return {
    kind: "network",
    message: outcome.errorMessage ?? `Errore sconosciuto su ${outcome.url}.`,
    url: outcome.url,
  };
}

/** Un errore di rete o di limite si può ritentare; un blocco no. */
export function isRetryable(error: ProviderError): boolean {
  return error.kind === "network" || error.kind === "rate_limited" || error.kind === "http";
}

/* ------------------------------------------------------------------ */
/* Costruzione dei DTO                                                 */
/* ------------------------------------------------------------------ */

/** Traduce una riga già validata in `FixtureDTO`, con orario esatto. */
export function toFixtureDTO(row: ParsedFixtureRow, kickoffAt: Date): FixtureDTO {
  return {
    key: matchKeyFor(row.providerMatchId),
    providerMatchId: row.providerMatchId,
    sourceUrl: row.sourceUrl,
    homeTeamRaw: row.homeTeamRaw,
    awayTeamRaw: row.awayTeamRaw,
    leagueRaw: row.leagueLabel ?? humanizeSlug(row.leagueSlug),
    countryRaw: humanizeSlug(row.countrySlug),
    kickoffAt,
    /* false: l'istante viene dal JSON-LD, che dichiara il fuso */
    kickoffIsAssumedUtc: false,
  };
}

/** Traduce le quote di una riga in `OddsQuoteDTO`, tutte di consenso. */
export function toQuoteDTOs(row: ParsedFixtureRow, observedAt: Date): OddsQuoteDTO[] {
  return row.quotes.map((quote, index) => ({
    fixtureKey: matchKeyFor(row.providerMatchId),
    bookmakerKey: CONSENSUS_BOOKMAKER_KEY,
    isConsensus: true,
    market: quote.market,
    selection: quote.selection,
    price: quote.price,
    /* l'apertura è pubblicata solo per la selezione in calo */
    openingPrice: index === row.droppedIndex ? row.openingPrice : null,
    observedAt,
    agreement: index === row.droppedIndex ? row.agreement : null,
  }));
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export interface BetexplorerOptions {
  /** iniettabile nei test, per non toccare la rete */
  fetchImpl?: FetchLike;
  enabled?: boolean;
  /** campionati da interrogare per i risultati, come "paese/lega" */
  resultLeagues?: string[];
  /**
   * Tetto di pagine di dettaglio visitate per giro e budget di tempo per
   * visitarle (test e casi estremi). Default dai `FIXTURE_DETAIL_*` sotto.
   */
  detailRowCap?: number;
  detailBudgetMs?: number;
}

/**
 * Quante pagine di dettaglio partita visitare al massimo per giro, e in
 * quanto tempo. L'elenco del weekend supera le 200 righe: visitarle tutte
 * in serie ha sforato i 10 minuti del job tre giri di fila (set-2026),
 * con la raccolta ferma e nessun errore dichiarato. Si visitano i cali
 * maggiori; le altre righe restano dichiarate come non visitate.
 */
export const FIXTURE_DETAIL_CAP = 60;
export const FIXTURE_DETAIL_BUDGET_MS = 300_000;

export function createBetexplorerProvider(
  options: BetexplorerOptions = {},
): OddsProvider {
  const enabled = options.enabled ?? betexplorerEnabled();
  const fetchImpl = options.fetchImpl;
  const detailRowCap =
    options.detailRowCap ?? envInt("BETEXPLORER_DETAIL_CAP", FIXTURE_DETAIL_CAP);
  const detailBudgetMs =
    options.detailBudgetMs ??
    envInt("BETEXPLORER_DETAIL_BUDGET_MS", FIXTURE_DETAIL_BUDGET_MS);

  /**
   * Cache brevissima dell'elenco drop.
   *
   * L'elenco è UNA pagina che contiene le quote di TUTTE le partite.
   * Senza cache, raccogliere 20 partite significherebbe scaricare 20
   * volte lo stesso documento da 160 KB: scortese verso la fonte e
   * inutile. Con una validità di pochi secondi si scarica una volta e si
   * serve l'intero giro di raccolta.
   *
   * Non è un modo per spacciare dati vecchi per nuovi: `observedAt` è
   * l'istante dello SCARICAMENTO, non quello della lettura dalla cache.
   */
  const listingTtlMs = envInt("BETEXPLORER_LISTING_TTL_MS", 30_000);
  let cached: { outcome: FetchOutcome; fetchedAt: Date } | null = null;

  /* ultimo elenco grezzo scaricato da fetchFixtures, esposto in sola
     lettura per la misura di copertura. Non provoca traffico. */
  let lastListing: ProviderListing | null = null;

  async function getListing(): Promise<{ outcome: FetchOutcome; fetchedAt: Date }> {
    const now = Date.now();
    if (cached && now - cached.fetchedAt.getTime() < listingTtlMs && cached.outcome.ok) {
      /* payload già contabilizzato al primo scaricamento: non lo si
         conta due volte nelle statistiche del run */
      return { outcome: { ...cached.outcome, bytes: 0, latencyMs: 0 }, fetchedAt: cached.fetchedAt };
    }
    const outcome = await fetchPage(DROPPING_ODDS_PATH, { fetchImpl });
    const fetchedAt = new Date();
    if (outcome.ok) cached = { outcome, fetchedAt };
    return { outcome, fetchedAt };
  }

  /* cortesia verso la fonte: un intervallo ampio fra richieste.
     Configurabile, ma con default prudenti. */
  const rateLimit = {
    requestsPerMinute: envInt("BETEXPLORER_RPM", 12),
    minIntervalMs: envInt("BETEXPLORER_MIN_INTERVAL_MS", 10_000), // Aumentato da 4s a 10s per ridurre 429
  };

  return {
    key: BETEXPLORER_KEY,
    label: "BetExplorer (consenso)",
    enabled,
    capabilities: {
      fixtures: true,
      odds: true,
      results: true,
      /* dichiarazione centrale di questo sprint: NON abbiamo i singoli
         book, e il sistema deve saperlo invece di dedurlo */
      perBookmakerOdds: false,
    },
    rateLimit,

    /**
     * Partite in calo di quota.
     *
     * Nota sulla finestra temporale: l'elenco pubblica ciò che si muove
     * ADESSO, non è filtrabile per data senza query string (vietate).
     * Il filtro sulla finestra si applica dopo, sugli orari certi.
     */
    async fetchFixtures(
      window: DateRange,
      limits: FixtureFetchLimits = {},
    ): Promise<ProviderResult<FixtureDTO[]>> {
      const outcome = await fetchPage(DROPPING_ODDS_PATH, { fetchImpl });

      /* si conserva l'elenco grezzo appena scaricato: la misura di
         copertura deve poter contare anche le righe che scartiamo qui
         sotto, senza rifare la richiesta */
      lastListing = outcome.ok
        ? { body: outcome.body, fetchedAt: new Date(), url: outcome.url }
        : null;

      if (!outcome.ok) {
        const error = classifyFailure(outcome);
        return fail<FixtureDTO[]>(error, outcome.latencyMs, isRetryable(error), outcome.bytes);
      }

      const parsed = parseDroppingOdds(outcome.body);
      const missing: string[] = parsed.problems.map((p) => `${p.ref}: ${p.reason}`);

      /* Una pagina che risponde 200 ma non contiene NULLA di
         riconoscibile è un cambio di struttura, non un elenco vuoto. */
      if (parsed.fixtures.length === 0 && parsed.footballRowsSeen === 0) {
        return partial<FixtureDTO[]>([], outcome.latencyMs, missing, outcome.bytes);
      }

      /* L'orario affidabile sta nella pagina della partita: una richiesta
         in più per partita, ma è l'unico istante con fuso dichiarato.
         Senza di esso la partita viene SCARTATA, non salvata a caso.
         Tetto + budget (vedi FIXTURE_DETAIL_*): l'elenco non sta mai fermo
         e visitarlo tutto in serie sfora il timeout del job. Si parte dai
         cali maggiori; chi resta fuori è dichiarato, non sparisce. */
      const ordered = [...parsed.fixtures].sort(
        (a, b) => (b.dropPercent ?? -1) - (a.dropPercent ?? -1),
      );
      /* Il chiamante può soltanto stringere i limiti del provider. Il
         profilo serverless usa questa porta per garantirsi il tempo di
         chiudere il run prima del timeout, senza cambiare il giro Actions. */
      const requestedRows = limits.maxRows;
      const effectiveRowCap =
        requestedRows === undefined || !Number.isFinite(requestedRows)
          ? detailRowCap
          : Math.min(detailRowCap, Math.max(0, Math.floor(requestedRows)));
      const requestedBudget = limits.budgetMs;
      const effectiveBudgetMs =
        requestedBudget === undefined || !Number.isFinite(requestedBudget)
          ? detailBudgetMs
          : Math.max(0, Math.min(detailBudgetMs, requestedBudget));

      const detailRows = ordered.slice(0, effectiveRowCap);
      for (const skipped of ordered.slice(effectiveRowCap)) {
        missing.push(
          taggedExclusion(
            skipped.providerMatchId,
            EXCLUSION_CODES.DETAIL_BUDGET,
            `pagina di dettaglio non visitata: oltre il tetto di ${effectiveRowCap} righe per giro, si visitano i cali maggiori.`,
          ),
        );
      }
      const detailStartedAt = Date.now();
      const fixtures: FixtureDTO[] = [];
      /* righe di `detailRows` effettivamente visitate: serve per dichiarare
         quelle mai raggiunte quando il budget scade a metà. */
      let visitedCount = 0;
      for (const row of detailRows) {
        if (Date.now() - detailStartedAt >= effectiveBudgetMs) break;
        visitedCount += 1;
        const detail = await fetchPage(row.sourceUrl, { fetchImpl });
        if (!detail.ok) {
          missing.push(
            taggedExclusion(
              row.providerMatchId,
              EXCLUSION_CODES.PAGE_UNREACHABLE,
              `pagina partita non raggiungibile (${
                detail.status || detail.errorMessage
              }), orario di inizio non verificabile: partita esclusa.`,
            ),
          );
          continue;
        }
        const kickoffAt = parseMatchStartDate(detail.body);
        if (kickoffAt === null) {
          missing.push(
            taggedExclusion(
              row.providerMatchId,
              EXCLUSION_CODES.KICKOFF_MISSING,
              "orario di inizio assente o senza fuso nella pagina partita. Nessun orario dedotto: partita esclusa.",
            ),
          );
          continue;
        }
        if (kickoffAt < window.from || kickoffAt > window.to) {
          /* finora questo scarto non lasciava traccia: la riga spariva
             senza che nessuno potesse dire perché. È corretto escluderla,
             ma va dichiarato. */
          missing.push(
            taggedExclusion(
              row.providerMatchId,
              EXCLUSION_CODES.OUT_OF_WINDOW,
              `inizio ${kickoffAt.toISOString()} fuori dalla finestra interrogata: correttamente esclusa.`,
            ),
          );
          continue;
        }
        fixtures.push(toFixtureDTO(row, kickoffAt));
      }

      /* Il budget è scaduto a metà: le righe mai raggiunte si dichiarano con
         il loro codice, invece di sparire come se l'elenco fosse finito. */
      if (visitedCount < detailRows.length) {
        for (const row of detailRows.slice(visitedCount)) {
          missing.push(
            taggedExclusion(
              row.providerMatchId,
              EXCLUSION_CODES.DETAIL_BUDGET,
              `pagina di dettaglio non visitata: budget di ${Math.max(0, Math.round(effectiveBudgetMs / 1000))} s per giro esaurito, si riprova al prossimo giro.`,
            ),
          );
        }
      }

      if (missing.length > 0) {
        return partial<FixtureDTO[]>(fixtures, outcome.latencyMs, missing, outcome.bytes);
      }
      return ok<FixtureDTO[]>(fixtures, outcome.latencyMs, outcome.bytes);
    },

    /**
     * Quote di una singola partita.
     *
     * L'elenco drop è la sola pagina che espone quota corrente e apertura
     * entro il robots.txt, quindi si rilegge quello e si filtra. Se la
     * partita non è più in elenco, il suo movimento è finito: si dichiara,
     * non si riporta l'ultimo valore noto come se fosse attuale.
     */
    async fetchOdds(fixture: FixtureRef): Promise<ProviderResult<OddsQuoteDTO[]>> {
      const { outcome, fetchedAt } = await getListing();

      if (!outcome.ok) {
        const error = classifyFailure(outcome);
        return fail<OddsQuoteDTO[]>(error, outcome.latencyMs, isRetryable(error), outcome.bytes);
      }

      const parsed = parseDroppingOdds(outcome.body);
      const row = parsed.fixtures.find(
        (f) => matchKeyFor(f.providerMatchId) === fixture.key,
      );

      if (!row) {
        return partial<OddsQuoteDTO[]>([], outcome.latencyMs, [
          `${fixture.key}: non più presente nell'elenco dei drop. Nessuna quota corrente osservabile adesso.`,
        ], outcome.bytes);
      }

      /* l'istante di osservazione è quello dello scaricamento reale */
      const quotes = toQuoteDTOs(row, fetchedAt);
      return ok<OddsQuoteDTO[]>(quotes, outcome.latencyMs, outcome.bytes);
    },

    /**
     * Risultati finali.
     *
     * I campionati da controllare arrivano da fuori (le partite che
     * stiamo seguendo), così i tornei minori restano coperti: è il cuore
     * del monitor e non va sacrificato a una lista fissa di leghe grandi.
     */
    async fetchResults(
      window: DateRange,
      leagues?: string[],
    ): Promise<ProviderResult<ResultDTO[]>> {
      /* l'argomento vince sulle opzioni di costruzione: è il giro di
         raccolta a sapere quali tornei controllare, giro per giro */
      const list = leagues ?? options.resultLeagues ?? [];
      if (list.length === 0) {
        return ok<ResultDTO[]>([], 0, 0);
      }

      const results: ResultDTO[] = [];
      const missing: string[] = [];
      let totalBytes = 0;
      let totalLatency = 0;
      let hardFailures = 0;

      for (const league of list) {
        const [countrySlug, leagueSlug] = league.split("/");
        if (!countrySlug || !leagueSlug) {
          missing.push(`Campionato "${league}" non interpretabile: saltato.`);
          continue;
        }

        const outcome = await fetchPage(resultsPath(countrySlug, leagueSlug), {
          fetchImpl,
        });
        totalBytes += outcome.bytes;
        totalLatency += outcome.latencyMs;

        if (!outcome.ok) {
          hardFailures += 1;
          const error = classifyFailure(outcome);
          missing.push(`${league}: ${error.message}`);
          continue;
        }

        const parsed = parseResults(outcome.body);
        for (const p of parsed.problems) {
          missing.push(`${league}/${p.ref}: ${p.reason}`);
        }
        for (const r of parsed.results) {
          results.push({
            fixtureKey: matchKeyFor(r.providerMatchId),
            providerMatchId: r.providerMatchId,
            homeGoals: r.homeGoals,
            awayGoals: r.awayGoals,
            status: "finished",
            observedAt: new Date(),
          });
        }
      }

      /* tutte le pagine fallite: è un errore della fonte, non un parziale */
      if (hardFailures === list.length && list.length > 0) {
        return fail<ResultDTO[]>(
          {
            kind: "http",
            message: `Nessuna pagina risultati raggiungibile (${hardFailures}/${list.length}).`,
          },
          totalLatency,
          true,
          totalBytes,
        );
      }

      void window;
      if (missing.length > 0) {
        return partial<ResultDTO[]>(results, totalLatency, missing, totalBytes);
      }
      return ok<ResultDTO[]>(results, totalLatency, totalBytes);
    },

    /** Raggiungibilità: una sola richiesta leggera all'elenco. */
    async healthCheck(): Promise<ProviderHealth> {
      const outcome = await fetchPage(DROPPING_ODDS_PATH, { fetchImpl });
      const checkedAt = new Date();

      if (!outcome.ok) {
        return {
          reachable: false,
          latencyMs: outcome.latencyMs,
          detail: classifyFailure(outcome).message,
          checkedAt,
        };
      }

      const parsed = parseDroppingOdds(outcome.body);
      return {
        reachable: true,
        latencyMs: outcome.latencyMs,
        detail: `Elenco drop raggiungibile: ${parsed.footballRowsSeen} righe di calcio, ${parsed.fixtures.length} leggibili. Solo quota di consenso (nessun dato per singolo bookmaker).`,
        checkedAt,
      };
    },

    /**
     * Elenco grezzo dell'ultima `fetchFixtures`.
     * Sola lettura, nessuna richiesta di rete: se non è stato ancora
     * scaricato nulla, restituisce `null` e la copertura resta non misurata.
     */
    lastListing(): ProviderListing | null {
      return lastListing;
    },
  };
}
