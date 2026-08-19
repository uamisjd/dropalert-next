/**
 * Adapter opzionale — the-odds-api.com (Sprint 3A: solo dichiarazione).
 *
 * DISATTIVATO DI DEFAULT, per decisione del committente.
 *
 * Motivo: il piano gratuito (~500 richieste/mese) non regge un polling
 * frequente su più campionati. Non è la fonte principale e il sistema
 * deve funzionare senza di essa e senza alcuna chiave API.
 *
 * Per attivarlo servono ENTRAMBE le cose:
 *   ODDS_API_ENABLED=true
 *   ODDS_API_KEY=<chiave>
 * Se manca la chiave la fonte resta spenta anche con il flag acceso:
 * meglio dichiararsi spenti che fallire a ogni chiamata.
 *
 * In questo sprint l'adapter è un guscio conforme al contratto: dichiara
 * le proprie capacità e risponde `unsupported` invece di fingere dati.
 * L'implementazione di rete arriverà solo se la fonte verrà accesa.
 */
import { envFlag } from "../registry";
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

/** Accesa solo con flag esplicito E chiave presente. */
export function theOddsApiEnabled(): boolean {
  const hasKey = (process.env.ODDS_API_KEY ?? "").trim() !== "";
  return envFlag("ODDS_API_ENABLED", false) && hasKey;
}

export function createTheOddsApiProvider(): OddsProvider {
  const enabled = theOddsApiEnabled();

  return {
    key: KEY,
    label: "The Odds API (opzionale)",
    enabled,
    capabilities: {
      fixtures: true,
      odds: true,
      results: true,
      /* l'API espone i singoli bookmaker: se un giorno verrà accesa,
         coordinazione e sharp tornerebbero calcolabili */
      perBookmakerOdds: true,
    },
    /* limiti prudenti: il piano gratuito è a quota mensile, non al minuto */
    rateLimit: { requestsPerMinute: 10, minIntervalMs: 6_000 },

    async fetchFixtures(_window: DateRange): Promise<ProviderResult<FixtureDTO[]>> {
      void _window;
      if (!enabled) return disabledResult<FixtureDTO[]>(KEY);
      return unsupported<FixtureDTO[]>(KEY, "il calendario (adapter non implementato)");
    },

    async fetchOdds(_fixture: FixtureRef): Promise<ProviderResult<OddsQuoteDTO[]>> {
      void _fixture;
      if (!enabled) return disabledResult<OddsQuoteDTO[]>(KEY);
      return unsupported<OddsQuoteDTO[]>(KEY, "le quote (adapter non implementato)");
    },

    async fetchResults(_window: DateRange): Promise<ProviderResult<ResultDTO[]>> {
      void _window;
      if (!enabled) return disabledResult<ResultDTO[]>(KEY);
      return unsupported<ResultDTO[]>(KEY, "i risultati (adapter non implementato)");
    },

    async healthCheck(): Promise<ProviderHealth> {
      return {
        reachable: false,
        latencyMs: 0,
        detail: enabled
          ? "Fonte abilitata ma adapter non ancora implementato."
          : "Disattivata: servono ODDS_API_ENABLED=true e ODDS_API_KEY.",
        checkedAt: new Date(),
      };
    },
  };
}
