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
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  oddsSnapshots,
  sourceHealth,
  systemState,
} from "@/db/schema";
import { runProviderCall } from "../runner";
import { getProvider } from "../registry";
import { initProviders } from "../index";
import { BETEXPLORER_KEY } from "./index";
import {
  applyResults,
  declarePerBookmakerGap,
  ensureConsensusBookmaker,
  findPendingResultMatches,
  upsertMatch,
  writeSnapshots,
  MAX_RESULT_LEAGUES,
} from "./ingest";
import { recordGap } from "@/lib/pipeline/detect";
import {
  cooldownUntilForLevel,
  nextLevelAfter429,
  remainingCooldownMinutes,
} from "../backoff";
import { isStableQuote, RESULTS_LEAGUE_TTL_MIN } from "../pressure";
import { matchKeyFor } from "./parse";
import { num } from "@/lib/drop/math";
import {
  parseExclusion,
  EXCLUSION_CODES,
  onlyOwnChoiceExclusions,
} from "../exclusion-codes";
import {
  buildRunCoverage,
  selectRetryTargets,
  type ExclusionNote,
  type RunCoverageInput,
  type RunTrigger,
} from "@/lib/cov/instrument";
import { scanSourceRows } from "@/lib/cov/scan";
import type {
  FixtureDTO,
  FixtureFetchLimits,
  OddsQuoteDTO,
  ResultDTO,
} from "../types";
import type { CycleMode } from "@/lib/pipeline/cycle-mode";

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
  /** tipo di ciclo che contiene la raccolta, salvato per l'osservabilità */
  cycleMode?: CycleMode;
  /** limiti più stretti per un runner con deadline; mai allargano il provider */
  fixtureFetchLimits?: FixtureFetchLimits;
  /**
   * true per ignorare il cooldown sui 429: solo richiesta esplicita
   * dell'operatore (il --force di job:collect). Il cron non lo usa mai.
   */
  force?: boolean;
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
  /** partite con kickoff passato oltre la grazia ancora senza esito, dopo il tentativo di questo giro */
  resultsPending: number;
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
  const cycleMode: CycleMode = options.cycleMode ?? "full";
  const retryEnabled = options.retryNotReached ?? true;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const collectionProfile = {
    withResults,
    retryNotReached: retryEnabled,
    fixtureFetchLimits: options.fixtureFetchLimits ?? null,
  };

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
    let cooldownSkipped = false;
    const startedAt = new Date();

    /* --- 0. cooldown adattivo sui 429 -------------------------------- */
    /* Dopo un giro con rate-limit, la fonte merita una pausa vera: il
       giro di rete NON parte finché il cooldown è attivo. Le fasi locali
       (analisi, chiusura) proseguono fuori da qui. Il `force` manuale è
       l'unica porta d'uscita, e lo dichiara. */
    const [healthRow] = await db
      .select({
        cooldownUntil: sourceHealth.cooldownUntil,
        cooldownLevel: sourceHealth.cooldownLevel,
      })
      .from(sourceHealth)
      .where(eq(sourceHealth.sourceKey, BETEXPLORER_KEY))
      .limit(1);

    const cooldownLeft = remainingCooldownMinutes(
      healthRow?.cooldownUntil ?? null,
      new Date(),
    );
    if (cooldownLeft > 0 && options.force !== true) {
      cooldownSkipped = true;
      const report: CollectReport = {
        status: "partial",
        fixturesSeen: 0,
        matchesUpserted: 0,
        matchesCreated: 0,
        snapshotsWritten: 0,
        snapshotsSkipped: 0,
        resultsUpdated: 0,
        resultsPending: 0,
        problems: [
          `Fonte in cooldown per 429: ancora ${cooldownLeft} min. Giro di rete saltato (le fasi locali procedono); la scala 45→90→180 min si azzera solo con un giro senza 429.`,
        ],
        latencyMs: 0,
        payloadBytes: 0,
        trigger,
        retry: { attempted: 0, recovered: 0, stillMissing: 0, refs: [] },
      };
      return {
        result: report,
        stats: {
          status: "partial" as const,
          matchesSeen: 0,
          snapshotsWritten: 0,
          signalsTouched: 0,
          errors: [],
          meta: {
            trigger,
            cycleMode,
            collectionProfile,
            cooldown: { skipped: true, minutesLeft: cooldownLeft },
          } as Record<string, unknown>,
        },
      };
    }

    /* --- 1. partite ------------------------------------------------ */
    const now = new Date();
    const window = {
      from: new Date(now.getTime() - 6 * 60 * 60 * 1000),
      to: new Date(now.getTime() + horizonHours * 60 * 60 * 1000),
    };

    const fixturesCall = await runProviderCall<FixtureDTO[]>(
      provider,
      "fetchFixtures",
      () => provider.fetchFixtures(window, options.fixtureFetchLimits),
      { expectedPartial: onlyOwnChoiceExclusions },
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
        resultsPending: 0,
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
          meta: {
            phase: "fetchFixtures",
            trigger,
            cycleMode,
            collectionProfile,
            ...fixturesCall.stats,
          },
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

    /**
     * Una partita è STABILE quando ogni sua serie ha le ultime tre
     * rilevazioni identiche alla quota che l'elenco pubblica adesso.
     * Si legge la cache dell'elenco (nessuna richiesta nuova): se il
     * prezzo si è mosso, la partita non è stabile e si scrive.
     */
    const matchQuoteIsStable = async (
      fixture: FixtureDTO,
      matchId: number,
    ): Promise<boolean> => {
      const odds = await provider
        .fetchOdds({
          key: fixture.key,
          providerMatchId: fixture.providerMatchId,
          sourceUrl: fixture.sourceUrl,
          kickoffAt: fixture.kickoffAt,
        })
        .then((r) => (r.ok ? r.data : []))
        .catch(() => []);
      if (odds.length === 0) return false;

      const rows = await db
        .select({
          market: oddsSnapshots.market,
          selection: oddsSnapshots.selection,
          price: oddsSnapshots.price,
        })
        .from(oddsSnapshots)
        .where(eq(oddsSnapshots.matchId, matchId))
        .orderBy(desc(oddsSnapshots.collectedAt))
        .limit(30);

      const byKey = new Map<string, number[]>();
      for (const r of rows) {
        const k = `${r.market}::${r.selection}`;
        const list = byKey.get(k) ?? [];
        if (list.length < 3) list.push(num(r.price) ?? 0);
        byKey.set(k, list);
      }

      /* ogni quota in arrivo dev'essere identica alle ultime tre */
      return odds.every((q) => {
        const k = `${q.market}::${q.selection}`;
        const last = byKey.get(k);
        return last !== undefined && isStableQuote(last, q.price);
      });
    };

    /* --- 3. quote --------------------------------------------------- */
    /* L'elenco drop è una sola pagina che contiene le quote di tutte le
       partite: l'adapter la tiene in cache per pochi secondi, quindi
       questo ciclo produce UNA sola richiesta di rete complessiva.
       Le quote STABILI da 3 giri non si riscrivono: la riga sarebbe una
       copia della precedente, e la pressione (di righe e di attenzione)
       non compra informazione. N=3 dichiarato in lib/providers/pressure. */
    let stableSkipped = 0;
    const stableIds = new Set<string>();
    for (const fixture of fixtures) {
      const matchId = matchIds.get(fixture.key);
      if (matchId === undefined) continue;
      if (await matchQuoteIsStable(fixture, matchId)) {
        stableSkipped += 1;
        if (fixture.providerMatchId !== null) {
          stableIds.add(fixture.providerMatchId);
          importedIds.add(fixture.providerMatchId);
          /* le ha, le quote: sono ferme da tre giri, non assenti */
          withOddsIds.add(fixture.providerMatchId);
        }
        continue;
      }
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
          () => provider.fetchFixtures(window, options.fixtureFetchLimits),
          { expectedPartial: onlyOwnChoiceExclusions },
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
    /* Il canale precedente leggeva solo i campionati presenti
       nell'elenco dei movimenti DI QUESTO giro: una competizione uscita
       dall'elenco (partita giocata, drop finito) spariva anche dalla
       lettura dei risultati, e l'esito non arrivava mai. Il contratto
       adesso è l'opposto: ogni partita monitorata con kickoff passato
       oltre la grazia viene cercata a OGNI giro, finché il risultato non
       arriva o la fonte non dichiara — pagina letta — che non c'è. */
    let resultsUpdated = 0;
    let resultsPending = 0;

    if (withResults) {
      const pending = await findPendingResultMatches(now);

      /* la pagina risultati di un campionato non si rilegge più di una
         volta ogni RESULTS_LEAGUE_TTL_MIN minuti: il cron passa ogni 45,
         i risultati non cambiano a quella cadenza. Chi resta fuori per
         il TTL lo si dichiara, e rientra al giro utile */
      const [seenRow] = await db
        .select({ value: systemState.value })
        .from(systemState)
        .where(eq(systemState.key, "betexplorer:results_seen"))
        .limit(1);
      const seen = (seenRow?.value ?? {}) as Record<string, string>;
      const freshEnough = (league: string): boolean => {
        const at = seen[league];
        if (at === undefined) return true;
        return now.getTime() - new Date(at).getTime() > RESULTS_LEAGUE_TTL_MIN * 60_000;
      };

      /* prima le competizioni in attesa (sono in ritardo), poi quelle
         del giro corrente; tetto dichiarato, oltre si riprova al giro dopo */
      const leaguesToCheck = [
        ...new Set([...pending.map((p) => p.leaguePath), ...leaguePaths]),
      ].filter(freshEnough);
      const deferredByTtl = [
        ...new Set([...pending.map((p) => p.leaguePath), ...leaguePaths]),
      ].filter((l) => !freshEnough(l));
      const capped = leaguesToCheck.slice(MAX_RESULT_LEAGUES);
      if (capped.length > 0) {
        problems.push(
          `Tetto di ${MAX_RESULT_LEAGUES} campionati risultati per giro: ${capped.length} competizioni non controllate in questo giro, si riprova al prossimo.`,
        );
      }
      if (deferredByTtl.length > 0) {
        problems.push(
          `Pagine risultati lette nelle ultime ${RESULTS_LEAGUE_TTL_MIN} ore e non rilette (nostra scelta di pressione): ${deferredByTtl.length} campionati. Nessun dato perso: rientrano al prossimo giro utile.`,
        );
      }
      const checkedLeagues = new Set(leaguesToCheck.slice(0, MAX_RESULT_LEAGUES));

      if (checkedLeagues.size > 0) {
        const resultsCall = await runProviderCall<ResultDTO[]>(
          provider,
          "fetchResults",
          () =>
            provider.fetchResults(
              { from: window.from, to: window.to },
              [...checkedLeagues],
            ),
        );

        payloadBytes += resultsCall.stats.payloadBytes;
        latencyMs += resultsCall.stats.latencyMs;

        if (!resultsCall.result.ok) {
          problems.push(`Risultati non raccolti: ${resultsCall.result.error.message}`);
        } else {
          if (resultsCall.result.partial) problems.push(...resultsCall.result.missing);
          const applied = await applyResults(resultsCall.result.data);
          resultsUpdated = applied.updated;

          /* memoria del TTL: queste pagine sono state lette adesso */
          const stamp = new Date().toISOString();
          for (const league of checkedLeagues) seen[league] = stamp;
          await db
            .insert(systemState)
            .values({
              key: "betexplorer:results_seen",
              value: seen as unknown as object,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: systemState.key,
              set: { value: seen as unknown as object, updatedAt: now },
            });

          /* chi è ancora in attesa dopo il tentativo di questo giro:
             o la pagina del suo campionato è stata letta e non lo
             contiene → la fonte non ha pubblicato l'esito, si dichiara
             (un solo gap aperto per partita, il giro dopo si ritenta);
             o la pagina non è stata raggiungibile → nessuna dichiarazione,
             perché la fonte non ha potuto dire niente */
          const stillPending = await findPendingResultMatches(now);
          resultsPending = stillPending.length;

          const failedLeagues = new Set(
            (resultsCall.result.partial ? resultsCall.result.missing : [])
              .map((m) => (m.split(":")[0] ?? "").trim())
              .filter((l) => l.includes("/")),
          );

          for (const p of stillPending) {
            if (!checkedLeagues.has(p.leaguePath)) continue;
            if (failedLeagues.has(p.leaguePath)) continue;
            await recordGap({
              matchId: p.matchId,
              reason: "result_not_published",
              detail: `Pagina risultati "${p.leaguePath}" letta il ${now.toISOString()} senza questa partita (kickoff ${p.kickoffAt.toISOString()}): la fonte non ha ancora pubblicato l'esito. Il giro successivo ritenterà.`,
            });
          }
        }
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

    /* --- 6. cooldown adattivo: l'episodio 429 decide la scala -------- */
    /* l'episodio si misura su source_health.lastRateLimitAt, datato a
       parte dal runner proprio per questo: se è nuovo di questo giro, la
       scala sale; se il giro è arrivato in fondo senza 429, si azzera */
    const [healthAfter] = await db
      .select({
        lastRateLimitAt: sourceHealth.lastRateLimitAt,
        cooldownLevel: sourceHealth.cooldownLevel,
      })
      .from(sourceHealth)
      .where(eq(sourceHealth.sourceKey, BETEXPLORER_KEY))
      .limit(1);

    const had429 =
      healthAfter?.lastRateLimitAt !== null &&
      healthAfter !== undefined &&
      healthAfter.lastRateLimitAt !== null &&
      healthAfter.lastRateLimitAt.getTime() >= startedAt.getTime();

    let cooldownNote: string | null = null;
    if (had429) {
      const level = nextLevelAfter429(healthAfter?.cooldownLevel ?? 0);
      const until = cooldownUntilForLevel(level, now);
      await db
        .update(sourceHealth)
        .set({ cooldownLevel: level, cooldownUntil: until, updatedAt: now })
        .where(eq(sourceHealth.sourceKey, BETEXPLORER_KEY));
      cooldownNote = `429 nel giro: cooldown al livello ${level}, la fonte riparte fra ${Math.round((until!.getTime() - now.getTime()) / 60_000)} min.`;
      problems.push(cooldownNote);
    } else if ((healthAfter?.cooldownLevel ?? 0) > 0) {
      /* giro completo senza 429: la scala si azzera, dichiarato */
      await db
        .update(sourceHealth)
        .set({ cooldownLevel: 0, cooldownUntil: null, updatedAt: now })
        .where(eq(sourceHealth.sourceKey, BETEXPLORER_KEY));
      cooldownNote = "Giro senza 429: cooldown azzerato.";
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
      resultsPending,
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
          cycleMode,
          collectionProfile,
          latencyMs,
          payloadBytes,
          matchesCreated,
          snapshotsSkipped,
          resultsUpdated,
          resultsPending,
          stableSkipped,
          cooldown: { skipped: cooldownSkipped, note: cooldownNote },
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
