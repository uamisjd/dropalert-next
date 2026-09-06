/**
 * Adapter opzionale — the-odds-api.com.
 *
 * Il client di rete e il parser sono implementati e testabili con fixture,
 * ma l'adapter resta intenzionalmente disattivato finché non esistono anche
 * ingest/persistenza cablati nel ciclo reale e uno smoke test live riuscito.
 * Una capacità prevista non deve comparire come disponibile.
 */
import { envFlag } from "../registry";
import { readOddsApiKey } from "./odds-api-budget";
import { fetchTheOddsApiOdds } from "./the-odds-api-client";
import {
  disabledResult,
  unsupported,
  type DateRange,
  type FixtureDTO,
  type FixtureRef,
  type OddsProvider,
  type OddsQuoteDTO,
  type ProviderHealth,
  type ProviderResult,
  type ResultDTO,
} from "../types";

const KEY = "the-odds-api";

/**
 * Interruttore di attivazione controllata.
 *
 * Resta `false` di default: una capacità prevista non deve comparire come
 * disponibile. Diventa `true` solo impostando `ODDS_ADAPTER_IMPLEMENTED=true`
 * nell'ambiente, dopo che lo smoke test live è riuscito (06/09/2026, run
 * `34036327654`: chiamata reale, matching, 54 snapshot in `odds_snapshots`,
 * freshness verificata). Senza il flag, il comportamento è identico a prima:
 * l'adapter risponde `unsupported` e non dichiara quote per bookmaker.
 */
export const ADAPTER_IMPLEMENTED = envFlag("ODDS_ADAPTER_IMPLEMENTED", false);

/** Il flag e la chiave accendono la fonte; la capacità resta però falsa finché l'adapter non è dichiarato implementato. */
export function theOddsApiEnabled(): boolean {
  return envFlag("ODDS_API_ENABLED", false) && readOddsApiKey() !== null;
}

export function createTheOddsApiProvider(): OddsProvider {
  const enabled = theOddsApiEnabled();

  return {
    key: KEY,
    label: "The Odds API (opzionale)",
    enabled,
    capabilities: {
      fixtures: false,
      odds: ADAPTER_IMPLEMENTED,
      results: false,
      perBookmakerOdds: ADAPTER_IMPLEMENTED,
    },
    rateLimit: { requestsPerMinute: 10, minIntervalMs: 6_000 },

    async fetchFixtures(_window: DateRange): Promise<ProviderResult<FixtureDTO[]>> {
      void _window;
      if (!enabled) return disabledResult<FixtureDTO[]>(KEY);
      return unsupported<FixtureDTO[]>(KEY, "il calendario: serve una mappa sportKey configurata");
    },

    async fetchOdds(fixture: FixtureRef): Promise<ProviderResult<OddsQuoteDTO[]>> {
      if (!enabled) return disabledResult(KEY);
      if (!ADAPTER_IMPLEMENTED) {
        return unsupported<OddsQuoteDTO[]>(KEY, "le quote (adapter non ancora dichiarato disponibile)");
      }
      if (
        fixture.sportKey === undefined ||
        fixture.homeTeam === undefined ||
        fixture.awayTeam === undefined
      ) {
        return unsupported(KEY, "le quote senza sportKey e nomi squadra verificati");
      }
      return fetchTheOddsApiOdds({
        sportKey: fixture.sportKey,
        fixtureKey: fixture.key,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        kickoffAt: fixture.kickoffAt,
      });
    },

    async fetchResults(_window: DateRange): Promise<ProviderResult<ResultDTO[]>> {
      void _window;
      if (!enabled) return disabledResult<ResultDTO[]>(KEY);
      return unsupported<ResultDTO[]>(KEY, "i risultati");
    },

    async healthCheck(): Promise<ProviderHealth> {
      return {
        reachable: false,
        latencyMs: 0,
        detail: !enabled
          ? "Disattivata: servono ODDS_API_ENABLED=true e una chiave valida."
          : !ADAPTER_IMPLEMENTED
            ? "Flag e chiave presenti, ma adapter non dichiarato implementato: imposta ODDS_ADAPTER_IMPLEMENTED=true solo dopo uno smoke test live riuscito."
            : "Adapter dichiarato implementato: letture per bookmaker governate dal budget in odds-api-budget.ts.",
        checkedAt: new Date(),
      };
    },
  };
}
