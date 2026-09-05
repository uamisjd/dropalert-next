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
import { readOddsApiKey } from "./odds-api-budget";
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
 * L'adapter di rete NON è implementato: i tre metodi rispondono `unsupported`.
 *
 * Questa costante esiste perché la dichiarazione di capacità deve dire la
 * verità. Finché vale `false`, `perBookmakerOdds` resta `false` anche quando
 * la fonte viene accesa con flag e chiave: altrimenti `/api/health`
 * stamperebbe «Quote per singolo bookmaker disponibili» e
 * `perBookmakerOddsUnavailable()` smetterebbe di dichiarare che coordinazione
 * e conferma sharp non sono misurabili — mentre la fonte non restituisce una
 * sola quota. Una capacità dichiarata e non mantenuta è peggio di una
 * capacità assente.
 *
 * Quando l'implementazione di rete arriverà, questa diventa `true` e il test
 * `test:providers` lo verifica insieme al resto.
 */
export const ADAPTER_IMPLEMENTED = false;

/**
 * Accesa solo con flag esplicito E chiave presente.
 *
 * La chiave si legge con `readOddsApiKey()`, che accetta i quattro nomi in uso
 * (`THE_ODDS_API_KEY`, `ODDS_API_KEY`, `theoddsapiKey`, `THEODDSAPIKEY`).
 * Prima questa funzione guardava solo `ODDS_API_KEY`: con una chiave
 * impostata con un altro nome accettato il check sharp funzionava (usa
 * `readOddsApiKey`) ma la fonte restava spenta anche con il flag acceso. Due
 * interruttori che leggono la stessa chiave in modo diverso sono un modo
 * sicuro per passare un pomeriggio a capire perché non si accende nulla.
 */
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
      fixtures: ADAPTER_IMPLEMENTED,
      odds: ADAPTER_IMPLEMENTED,
      results: ADAPTER_IMPLEMENTED,
      /* l'API espone i singoli bookmaker, ma questo adapter non la chiama
         ancora: la capacità si dichiara quando esiste, non quando è prevista */
      perBookmakerOdds: ADAPTER_IMPLEMENTED,
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
