/**
 * Adapter opzionale — OddsPapi.
 *
 * Il client di rete e il parser sono implementati e testabili con fixture
 * (schema verificato su `GET /sports`, `/markets`, `/odds`), ma l'adapter
 * resta intenzionalmente DISATTIVATO finché non esistono anche ingest/
 * persistenza cablati nel ciclo reale e uno smoke test live riuscito. Una
 * capacità prevista non deve comparire come disponibile (stesso criterio
 * dell'adapter The Odds API).
 *
 * Non è registrato nel registry: l'attivazione (voci 6–7 della checklist di
 * integrazione) resta gated. Questo modulo esiste già pronto, disattivo, così
 * lo smoke test live è l'unico passo rimasto.
 */
import { envFlag } from "../registry";
import { fetchOddsPapiOdds } from "./oddspapi-client";
import { sportIdForSportKey } from "./oddspapi-maps";
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

const KEY = "oddspapi";

/**
 * Interruttore di attivazione controllata. Resta `false` di default: una
 * capacità prevista non deve comparire come disponibile. Diventa `true` solo
 * impostando `ODDS_PAPI_ADAPTER_IMPLEMENTED=true` DOPO uno smoke test live
 * riuscito (che confermi anche la lista sharp contro `GET /bookmakers`).
 * Senza il flag l'adapter risponde `unsupported` e non dichiara quote.
 */
export const ADAPTER_IMPLEMENTED = envFlag("ODDS_PAPI_ADAPTER_IMPLEMENTED", false);

/** Il flag accende la fonte; la capacità resta comunque falsa finché l'adapter non è dichiarato implementato. */
export function oddsPapiEnabled(): boolean {
  return envFlag("ODDS_PAPI_ENABLED", false);
}

export function createOddsPapiProvider(): OddsProvider {
  const enabled = oddsPapiEnabled();

  return {
    key: KEY,
    label: "OddsPapi (opzionale)",
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
      return unsupported<FixtureDTO[]>(KEY, "il calendario: serve la scoperta dei fixture OddsPapi");
    },

    async fetchOdds(fixture: FixtureRef): Promise<ProviderResult<OddsQuoteDTO[]>> {
      if (!enabled) return disabledResult<OddsQuoteDTO[]>(KEY);
      if (!ADAPTER_IMPLEMENTED) {
        return unsupported<OddsQuoteDTO[]>(KEY, "le quote (adapter non ancora dichiarato disponibile)");
      }
      if (fixture.providerMatchId === null || fixture.providerMatchId === undefined) {
        return unsupported<OddsQuoteDTO[]>(KEY, "le quote senza providerMatchId (fixtureId OddsPapi)");
      }
      if (sportIdForSportKey(fixture.sportKey) === null) {
        return unsupported<OddsQuoteDTO[]>(KEY, "le quote per uno sport non mappato (solo calcio)");
      }
      return fetchOddsPapiOdds({
        sportKey: fixture.sportKey ?? "",
        providerMatchId: fixture.providerMatchId,
        fixtureKey: fixture.key,
        homeTeam: fixture.homeTeam ?? "",
        awayTeam: fixture.awayTeam ?? "",
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
          ? "Disattivata: servono ODDS_PAPI_ENABLED=true e la configurazione della fonte."
          : !ADAPTER_IMPLEMENTED
            ? "Flag presente, ma adapter non dichiarato implementato: imposta ODDS_PAPI_ADAPTER_IMPLEMENTED=true solo dopo uno smoke test live riuscito."
            : "Adapter dichiarato implementato: letture per bookmaker governate dal budget.",
        checkedAt: new Date(),
      };
    },
  };
}
