/**
 * Job di raccolta BetExplorer (Sprint 3B, esteso nello sprint scheduler).
 *
 * Orchestrazione, non logica di dominio: mette in fila adapter, runner e
 * ingest, e lascia traccia di tutto in `collector_runs`.
 *
 * Resta una funzione che parte, fa UN giro e finisce: la ripetizione nel
 * tempo è del runner schedulato (`src/lib/pipeline/collect-loop.ts`), che
 * chiama questa funzione e non le chiede nulla di diverso da quello che le
 * chiede una raccolta manuale. L'unica differenza che il giro registra è
 * **chi lo ha chiesto** (`trigger`), perché la profondità della serie si
 * conta sui soli giri schedulati.
 *
 * Secondo tentativo: una riga che uscirebbe come `not_reached` viene
 * ritentata UNA volta dopo 60 secondi. Poi l'etichetta è definitiva. Non
 * si indaga oltre e non si corregge nulla: si ritenta una volta, e ciò che
 * resta mancante resta dichiarato mancante.
 */
import { withRun } from "@/lib/pipeline/runs";
import { runProviderCall } from "../runner";
import { getProvider } from "../registry";
import { initProviders } from "../index";
import { BETEXPLORER_KEY } from "./index";
import {
  applyResults,
  declarePerBookmakerGap,
  ensureConsensusBookmaker,
  upsertMatch,
  writeSnapshots,
} from "./ingest";
import { matchKeyFor } from "./parse";
import { parseExclusion, EXCLUSION_CODES } from "../exclusion-codes";
import {
  buildRunCoverage,
  selectRetryTargets,
  type ExclusionNote,
  type RunCoverageInput,
  type RunTrigger,
} from "@/lib/cov/instrument";
import { scanSourceRows } from "@/lib/cov/scan";
import type { FixtureDTO, OddsQuoteDTO, ResultDTO } from "../types";

export const COLLECTOR_KEY = "betexplorer-collect";

/**
 * Attesa fra il primo esito e il secondo e ultimo tentativo.
 *
 * 60 secondi è il valore concordato: abbastanza per superare un intoppo
 * momentaneo della fonte, abbastanza poco da restare dentro lo stesso
 * giro. Non è l'inizio di una scala di tentativi: dopo questo, l'etichetta
 * è finale.
 */
export const RETRY_DELAY_MS = 60_000;

/** Tentativi totali su una riga non raggiunta: il primo, più uno. */
export const MAX_ATTEMPTS_PER_ROW = 2;

export interface CollectOptions {
  /** ampiezza della finestra in avanti, in ore */
  horizonHours?: number;
  /** true per interrogare anche le pagine dei risultati */
  withResults?: boolean;
  /** limite di partite per giro, per non martellare la fonte */
  maxFixtures?: number;
  /**
   * Chi ha chiesto il giro. Default `manual`: un giro che non si dichiara
   * schedulato non viene contato nella profondità della serie.
   */
  trigger?: RunTrigger;
  /**
   * false per saltare il secondo tentativo (test e diagnostica).
   * In esercizio resta acceso: è l'unico trattamento previsto per le
   * righe non raggiunte.
   */
  retryNotReached?: boolean;
  /** attesa iniettabile, così i test non dormono davvero 60 secondi */
  sleep?: (ms: number) => Promise<void>;
}

export interface CollectReport {
  status: "success" | "partial" | "failed";
  fixturesSeen: number;
  matchesUpserted: number;
  matchesCreated: number;
  snapshotsWritten: number;
  snapshotsSkipped: number;
  resultsUpdated: number;
  problems: string[];
  latencyMs: number;
  payloadBytes: number;
  /** chi ha chiesto il giro */
  trigger: RunTrigger;
  /** esito del secondo e ultimo tentativo sulle righe non raggiunte */
  retry: RetryReport;
}

/** Bilancio del secondo tentativo. Zero righe = niente da ritentare. */
export interface RetryReport {
  attempted: number;
  recovered: number;
  /** righe ancora mancanti dopo il retry: etichetta finale `not_reached` */
  stillMissing: number;
  /** riferimenti ritentati, per la diagnostica del giro */
  refs: string[];
}

/**
 * Esegue una raccolta completa.
 *
 * Il flusso è volutamente lineare e leggibile:
 *   partite → anagrafiche → quote → risultati
 * Ogni passaggio può fallire da solo senza far cadere gli altri, e ogni
 * fallimento viene dichiarato invece che aggirato.
 */
export async function collectBetexplorer(
  options: CollectOptions = {},
): Promise<CollectReport> {
  const horizonHours = options.horizonHours ?? 72;
  const withResults = options.withResults ?? true;
  const maxFixtures = options.maxFixtures ?? 25;
  const trigger: RunTrigger = options.trigger ?? "manual";
  const retryEnabled = options.retryNotReached ?? true;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  initProviders();
  const provider = getProvider(BETEXPLORER_KEY);

  if (!provider) {
    throw new Error(
      `Fonte "${BETEXPLORER_KEY}" non presente nel registry: raccolta impossibile.`,
    );
  }

  return withRun(COLLECTOR_KEY, async (handle) => {
    const problems: string[] = [];
    let payloadBytes = 0;
    let latencyMs = 0;

    /* --- 1. partite ------------------------------------------------ */
    const now = new Date();
    const window = {
      from: new Date(now.getTime() - 6 * 60 * 60 * 1000),
      to: new Date(now.getTime() + horizonHours * 60 * 60 * 1000),
    };

    const fixturesCall = await runProviderCall<FixtureDTO[]>(
      provider,
      "fetchFixtures",
      () => provider.fetchFixtures(window),
    );

    payloadBytes += fixturesCall.stats.payloadBytes;
    latencyMs += fixturesCall.stats.latencyMs;

    if (!fixturesCall.result.ok) {
      const message = fixturesCall.result.error.message;
      const report: CollectReport = {
        status: "failed",
        fixturesSeen: 0,
        matchesUpserted: 0,
        matchesCreated: 0,
        snapshotsWritten: 0,
        snapshotsSkipped: 0,
        resultsUpdated: 0,
        problems: [message],
        latencyMs,
        payloadBytes,
        trigger,
        retry: { attempted: 0, recovered: 0, stillMissing: 0, refs: [] },
      };
      return {
        result: report,
        stats: {
          status: "failed" as const,
          errors: [message],
          meta: { phase: "fetchFixtures", trigger, ...fixturesCall.stats },
        },
      };
    }

    const allFixtures = fixturesCall.result.data;
    const fixtures = allFixtures.slice(0, maxFixtures);
    if (fixturesCall.result.partial) {
      problems.push(...fixturesCall.result.missing);
    }

    /* il tetto per giro è una nostra scelta di cortesia, non un limite
       della fonte: quando taglia va detto, altrimenti le partite tagliate
       sparirebbero dal conteggio senza spiegazione */
    const cappedFixtures = allFixtures.slice(maxFixtures);
    for (const fixture of cappedFixtures) {
      problems.push(
        `${fixture.providerMatchId ?? fixture.key}: [${EXCLUSION_CODES.RUN_CAP}] esclusa dal tetto di ${maxFixtures} partite per giro (nostra scelta di cortesia verso la fonte, non un limite della fonte).`,
      );
    }

    /* --- 2. anagrafiche e partite ---------------------------------- */
    const bookmakerId = await ensureConsensusBookmaker();

    let matchesUpserted = 0;
    let matchesCreated = 0;
    let snapshotsWritten = 0;
    let snapshotsSkipped = 0;

    /** chiave interna → id, per la fase quote */
    const matchIds = new Map<string, number>();
    /** righe effettivamente lavorate e scritte, per la misura di copertura */
    const importedIds = new Set<string>();
    const withOddsIds = new Set<string>();
    /** campionati toccati, per sapere quali pagine risultati leggere */
    const leaguePaths = new Set<string>();

    /* Le due fasi sono chiuse in funzioni perché il secondo tentativo
       deve ripercorrere ESATTAMENTE la stessa strada della prima volta:
       se il retry usasse un percorso suo, recupererebbe righe che il giro
       normale non prende, e la copertura misurerebbe due cose diverse. */

    /** anagrafica di una fixture. Restituisce l'id, o null se saltata. */
    const importFixture = async (
      fixture: FixtureDTO,
    ): Promise<number | null> => {
      /* il percorso della fonte è la sola fonte di paese/lega */
      const segments = (fixture.sourceUrl ?? "").split("/").filter(Boolean);
      const countrySlug = segments[1] ?? "";
      const leagueSlug = segments[2] ?? "";

      if (!countrySlug || !leagueSlug) {
        problems.push(
          `${fixture.key}: percorso della fonte non interpretabile ("${fixture.sourceUrl}"): partita saltata.`,
        );
        return null;
      }

      const upserted = await upsertMatch(fixture, countrySlug, leagueSlug);
      matchesUpserted += 1;
      if (upserted.created) matchesCreated += 1;
      matchIds.set(fixture.key, upserted.id);
      if (fixture.providerMatchId !== null) {
        importedIds.add(fixture.providerMatchId);
      }
      leaguePaths.add(`${countrySlug}/${leagueSlug}`);
      return upserted.id;
    };

    /** quote di una fixture già in anagrafica. true se ne ha scritta almeno una. */
    const collectOdds = async (
      fixture: FixtureDTO,
      matchId: number,
    ): Promise<boolean> => {
      const perMatch = await runProviderCall<OddsQuoteDTO[]>(
        provider,
        "fetchOdds",
        () =>
          provider.fetchOdds({
            key: fixture.key,
            providerMatchId: fixture.providerMatchId,
            sourceUrl: fixture.sourceUrl,
            kickoffAt: fixture.kickoffAt,
          }),
        { matchId },
      );

      payloadBytes += perMatch.stats.payloadBytes;
      latencyMs += perMatch.stats.latencyMs;

      if (!perMatch.result.ok) {
        problems.push(`${fixture.key}: ${perMatch.result.error.message}`);
        return false;
      }

      const quotes = perMatch.result.data;
      if (perMatch.result.partial) problems.push(...perMatch.result.missing);
      if (quotes.length === 0) return false;

      const written = await writeSnapshots(matchId, bookmakerId, quotes, handle.id);
      snapshotsWritten += written.written;
      snapshotsSkipped += written.skipped;
      if (fixture.providerMatchId !== null) {
        withOddsIds.add(fixture.providerMatchId);
      }

      /* la mancanza dei singoli book va dichiarata partita per partita */
      const agreement = quotes.find((q) => q.agreement !== null)?.agreement ?? null;
      await declarePerBookmakerGap(matchId, agreement);
      return true;
    };

    for (const fixture of fixtures) {
      await importFixture(fixture);
    }

    /* --- 3. quote --------------------------------------------------- */
    /* L'elenco drop è una sola pagina che contiene le quote di tutte le
       partite: l'adapter la tiene in cache per pochi secondi, quindi
       questo ciclo produce UNA sola richiesta di rete complessiva. */
    for (const fixture of fixtures) {
      const matchId = matchIds.get(fixture.key);
      if (matchId === undefined) continue;
      await collectOdds(fixture, matchId);
    }

    /* --- 3-bis. secondo e ultimo tentativo --------------------------- */
    /* Una riga che a questo punto uscirebbe come `not_reached` è una
       perdita nostra: la fonte la pubblica, il giro non l'ha presa. Le si
       concede UN tentativo dopo 60 secondi, perché le perdite osservate
       finora sono sembrate momentanee. Se manca ancora, l'etichetta è
       definitiva: qui non si indaga la causa e non si corregge nulla. */
    const listing = provider.lastListing?.() ?? null;
    const scan = listing === null ? null : scanSourceRows(listing.body);

    /** riferimenti già spiegati da una fase: non si ritentano */
    const problemsToRefs = (): Map<string, ExclusionNote> => {
      const byRef = new Map<string, ExclusionNote>();
      for (const message of problems) {
        const parsed = parseExclusion(message);
        if (parsed.ref !== null) {
          byRef.set(parsed.ref, {
            code: parsed.code,
            explanation: parsed.explanation,
          });
        }
      }
      return byRef;
    };

    const parsedIds = new Set(
      allFixtures
        .map((f) => f.providerMatchId)
        .filter((id): id is string => id !== null),
    );

    const retry: RetryReport = {
      attempted: 0,
      recovered: 0,
      stillMissing: 0,
      refs: [],
    };
    const retriedRefs = new Set<string>();

    if (retryEnabled && scan !== null) {
      const targets = selectRetryTargets({
        scan,
        parsedIds,
        problemsByRef: problemsToRefs(),
        importedIds,
        withOddsIds,
      });

      if (targets.length > 0) {
        retry.attempted = targets.length;
        retry.refs = [...targets];
        for (const ref of targets) retriedRefs.add(ref);

        await sleep(RETRY_DELAY_MS);

        /* l'elenco in cache è scaduto: la fonte viene riletta una volta
           sola, e le righe bersaglio vengono ripercorse con lo stesso
           codice del primo passaggio */
        const retryCall = await runProviderCall<FixtureDTO[]>(
          provider,
          "fetchFixtures",
          () => provider.fetchFixtures(window),
        );

        payloadBytes += retryCall.stats.payloadBytes;
        latencyMs += retryCall.stats.latencyMs;

        if (!retryCall.result.ok) {
          problems.push(
            `Secondo tentativo non eseguito: ${retryCall.result.error.message}. Le ${targets.length} righe restano dichiarate non raggiunte.`,
          );
        } else {
          const byRef = new Map<string, FixtureDTO>();
          for (const fixture of retryCall.result.data) {
            if (fixture.providerMatchId === null) continue;
            byRef.set(fixture.providerMatchId, fixture);
            parsedIds.add(fixture.providerMatchId);
          }

          for (const ref of targets) {
            const fixture = byRef.get(ref);
            if (fixture === undefined) continue;

            const matchId =
              matchIds.get(fixture.key) ?? (await importFixture(fixture));
            if (matchId === null) continue;
            await collectOdds(fixture, matchId);
          }
        }

        for (const ref of targets) {
          if (withOddsIds.has(ref)) retry.recovered += 1;
        }
        retry.stillMissing = retry.attempted - retry.recovered;

        problems.push(
          `Secondo tentativo dopo ${Math.round(RETRY_DELAY_MS / 1000)} s su ${retry.attempted} righe non raggiunte: ${retry.recovered} recuperate, ${retry.stillMissing} ancora mancanti (etichetta finale).`,
        );
      }
    }

    /* --- 4. risultati ----------------------------------------------- */
    let resultsUpdated = 0;

    if (withResults && leaguePaths.size > 0) {
      const resultsCall = await runProviderCall<ResultDTO[]>(
        provider,
        "fetchResults",
        () =>
          provider.fetchResults({
            from: window.from,
            to: window.to,
          }),
      );

      payloadBytes += resultsCall.stats.payloadBytes;
      latencyMs += resultsCall.stats.latencyMs;

      if (!resultsCall.result.ok) {
        problems.push(`Risultati non raccolti: ${resultsCall.result.error.message}`);
      } else {
        if (resultsCall.result.partial) problems.push(...resultsCall.result.missing);
        const applied = await applyResults(resultsCall.result.data);
        resultsUpdated = applied.updated;
      }
    }

    /* --- 5. misura della copertura di QUESTO giro -------------------- */
    /* Non costa una richiesta in più: si rilegge l'elenco che l'adapter
       ha già scaricato. Se la fonte non lo espone, la copertura resta
       non misurata invece di essere stimata.

       Si misura sull'elenco del PRIMO passaggio, dopo l'eventuale
       recupero: il denominatore resta ciò che la fonte mostrava quando il
       giro è partito, mentre al numeratore contano anche le righe salvate
       dal secondo tentativo. */
    let coverage: ReturnType<typeof buildRunCoverage> | null = null;

    if (scan !== null && listing !== null) {
      const coverageInput: RunCoverageInput = {
        scan,
        parsedIds,
        problemsByRef: problemsToRefs(),
        importedIds,
        withOddsIds,
        perBookmakerUnavailable: !provider.capabilities.perBookmakerOdds,
        nonRealMatches: 0,
        measuredAt: listing.fetchedAt,
        retriedRefs,
      };
      coverage = buildRunCoverage(coverageInput);
    }

    const status: CollectReport["status"] =
      problems.length > 0 ? "partial" : "success";

    const report: CollectReport = {
      status,
      fixturesSeen: fixtures.length,
      matchesUpserted,
      matchesCreated,
      snapshotsWritten,
      snapshotsSkipped,
      resultsUpdated,
      problems,
      latencyMs,
      payloadBytes,
      trigger,
      retry,
    };

    return {
      result: report,
      stats: {
        status,
        matchesSeen: fixtures.length,
        snapshotsWritten,
        signalsTouched: 0,
        errors: problems.slice(0, 20),
        meta: {
          /* chi ha chiesto il giro: la profondità della serie si conta
             sui soli giri schedulati */
          trigger,
          latencyMs,
          payloadBytes,
          matchesCreated,
          snapshotsSkipped,
          resultsUpdated,
          leagues: [...leaguePaths],
          perBookmakerOdds: false,
          /* esito del secondo e ultimo tentativo, anche quando è vuoto */
          retry,
          note: "Fonte di solo consenso: coordinazione e conferma sharp non calcolabili.",
          /* bilancio del giro: visti, lavorati, importati, persi, con il
             motivo di ogni esclusione. `null` se la fonte non ha esposto
             l'elenco grezzo: non misurato ≠ copertura zero. */
          coverage,
        },
      },
    };
  });
}

/** Chiavi delle partite raccolte, utile ai test e alla diagnostica. */
export function fixtureKeysOf(providerMatchIds: string[]): string[] {
  return providerMatchIds.map(matchKeyFor);
}
