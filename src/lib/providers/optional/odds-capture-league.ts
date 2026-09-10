/**
 * Descrittori delle competizioni che possiamo CATTURARE (portare in archivio)
 * da The Odds API.
 *
 * PERCHÉ: la scheda serve a un vero `SMOKE OK`. The Odds API (piano gratuito)
 * espone gli eventi SOLO per un certo insieme di campionati (verificato:
 * `soccer_italy_serie_a` → 20 eventi, 0 crediti; `soccer_mls` → HTTP 404
 * perché non servito dal piano). Per chiudere il test serve una partita in
 * archivio di una LEGA SERVITA. Questo modulo dice, per una `sportKey`, quale
 * campionato è e come riscriverlo nelle anagrafiche interne.
 *
 * REGOLA D'ORO (copertura dal catalogo reale, non da una lista a mano): la
 * base di cattura è DERIVATA dal catalogo attivo della fonte
 * (`SOURCE_SOCCER_CATALOG`), non più un elenco hardcoded di «sole leghe
 * grandi». Ogni voce attiva è catturabile, salvo le esclusioni dichiarate in
 * `NOT_CAPTURABLE` con il motivo. Le voci il cui titolo non porta il paese
 * («EPL», «UEFA Champions League», «MLS»…) ricevono il paese da
 * `COUNTRY_OVERRIDES`, che riusa la stessa grafia «Paese: Lega» della mappa di
 * lettura (`sport-keys.ts`): è ciò che garantisce il round-trip.
 *
 * REGOLE DI ONESTÀ:
 *  - una `sportKey` fuori catalogo restituisce `null` (la cattura non è
 *    dichiarata possibile) invece di inventare un titolo «Paese: Lega»
 *    che la mappa poi non riconoscerebbe;
 *  - il titolo «Paese: Lega» deve tornare INDIETRO alla stessa `sportKey`
 *    attraverso `sportKeyFor` (è la condizione perché la partita catturata
 *    sia poi leggibile dallo smoke). L'invariante è verificata dai test su
 *    ogni voce della base;
 *  - le esclusioni sono esplicite e motivate (`NOT_CAPTURABLE`): una voce
 *    del catalogo non può cadere dalla base per sbaglio.
 */
import { slugify } from "../betexplorer/parse";
import {
  SOURCE_SOCCER_CATALOG,
  catalogTitleParts,
  type CatalogSoccerEntry,
} from "./sport-catalog";
import type { OddsApiEventLite } from "./odds-match-resolver";
import type { FixtureDTO } from "../types";

export interface CaptureLeague {
  /** chiave sport della fonte, es. `soccer_italy_serie_a` */
  sportKey: string;
  /** nome del paese come lo dichiara la mappa, es. `Italy` */
  countryRaw: string;
  /** titolo «Paese: Lega», il formato atteso da `sportKeyFor` */
  leagueRaw: string;
  /** slug di paese per il percorso/la chiave, es. `italy` */
  countrySlug: string;
  /** slug di campionato, es. `serie-a` */
  leagueSlug: string;
}

/**
 * Paese per i titoli del catalogo che NON lo portano («EPL», «UEFA…»,
 * «EFL…», «FA Cup», «League of Ireland»). La grafia è quella della `MAP` di
 * `sport-keys.ts`, così il titolo composto «Paese: Lega» rientra nella stessa
 * chiave con cui la lettura risolve la competizione (round-trip garantito).
 */
const COUNTRY_OVERRIDES: Readonly<Record<string, { country: string; league: string }>> = {
  soccer_epl: { country: "England", league: "Premier League" },
  soccer_efl_champ: { country: "England", league: "Championship" },
  soccer_england_league1: { country: "England", league: "League One" },
  soccer_england_league2: { country: "England", league: "League Two" },
  soccer_fa_cup: { country: "England", league: "FA Cup" },
  soccer_uefa_champs_league: { country: "Europe", league: "UEFA Champions League" },
  soccer_uefa_europa_league: { country: "Europe", league: "UEFA Europa League" },
  soccer_uefa_europa_conference_league: {
    country: "Europe",
    league: "UEFA Europa Conference League",
  },
  soccer_uefa_nations_league: { country: "Europe", league: "UEFA Nations League" },
  soccer_league_of_ireland: { country: "Ireland", league: "League of Ireland" },
};

/**
 * Esclusioni dichiarate dalla base di cattura, con il motivo.
 * Una voce del catalogo può essere esclusa SOLO se è qui, con il perché:
 * l'invariante «catturabile oppure esclusa esplicitamente» è testata.
 */
const NOT_CAPTURABLE: Readonly<Record<string, string>> = {
  /* In catalogo ma la fonte risponde HTTP 404 sugli eventi: non servita dal
     piano gratuito (verificato il 06/09/2026, HANDOFF §0.4). Catturarla
     fallirebbe sempre alla richiesta eventi. */
  soccer_mls:
    "in catalogo ma non servita dal piano gratuito (la fonte risponde 404 sugli eventi)",
  /* Il titolo naturale dell'archivio («World: World Cup») non rientra in
     `sportKeyFor` (il nome «World Cup» si spezza in paese «World» + lega
     «Cup»), quindi una partita catturata qui resterebbe irrisolvibile allo
     smoke. Meglio dichiararla fuori base che scrivere una lega orfana. */
  soccer_world_cup:
    "nessun titolo «Paese: Lega» con round-trip garantito: esclusa per non scrivere una lega irrisolvibile",
};

/**
 * Descrittore di cattura per una voce del catalogo, oppure null se la voce è
 * esclusa o non esprimibile in formato «Paese: Lega».
 *
 * Il titolo composto è `${paese}: ${lega}`: è ciò che `sportKeyFor` sa
 * risolvere indietro, e la condizione su cui i test fanno la verifica.
 */
function descriptorFor(entry: CatalogSoccerEntry): CaptureLeague | null {
  if (entry.key in NOT_CAPTURABLE) return null;

  const parts = COUNTRY_OVERRIDES[entry.key] ?? catalogTitleParts(entry.title);
  if (parts.country === null || parts.league === "") return null;

  return {
    sportKey: entry.key,
    countryRaw: parts.country,
    leagueRaw: `${parts.country}: ${parts.league}`,
    countrySlug: slugify(parts.country),
    leagueSlug: slugify(parts.league),
  };
}

/**
 * Base di cattura: tutte le competizioni attive del catalogo, meno le
 * esclusioni dichiarate. Derivata dal catalogo reale, non da una lista a mano.
 */
export const CAPTURABLE: readonly CaptureLeague[] = SOURCE_SOCCER_CATALOG.flatMap(
  (entry) => {
    const descriptor = descriptorFor(entry);
    return descriptor === null ? [] : [descriptor];
  },
);

/**
 * Motivo per cui una `sportKey` è ESCLUSA dalla cattura, o `null` se non è
 * un'esclusione dichiarata (chiave catturabile, sconosciuta o assente).
 * Serve alla rotta di cattura per dare una risposta onesta invece del
 * generico «non in base».
 */
export function captureExclusionReason(
  sportKey: string | null | undefined,
): string | null {
  if (!sportKey) return null;
  return NOT_CAPTURABLE[sportKey] ?? null;
}

/**
 * Risolve il descrittore di cattura per una `sportKey`.
 *
 * `null` significa: la cattura non è dichiarata possibile per questa lega.
 * Non è un errore di rete, è un limite dichiarato (la lega non è nel
 * catalogo, o è esclusa con motivo): in dubbio si fallisce chiuso.
 */
export function captureLeagueFor(
  sportKey: string | null | undefined,
): CaptureLeague | null {
  if (!sportKey) return null;
  return CAPTURABLE.find((entry) => entry.sportKey === sportKey) ?? null;
}

/**
 * Converte un evento della fonte in `FixtureDTO`, il formato che l'ingestione
 * delle anagrafiche sa scrivere.
 *
 * `key` usa il prefisso `oddsapi-` per tracciare l'origine (il dato non viene
 * da BetExplorer). `providerMatchId` e `externalRef` conservano l'id reale
 * della fonte, così la provenienza non si perde.
 */
export function eventToFixture(
  event: OddsApiEventLite,
  league: CaptureLeague,
): FixtureDTO {
  return {
    key: `oddsapi-${event.id}`,
    providerMatchId: event.id,
    sourceUrl: null,
    homeTeamRaw: event.homeTeam,
    awayTeamRaw: event.awayTeam,
    leagueRaw: league.leagueRaw,
    countryRaw: league.countryRaw,
    kickoffAt: event.commenceTime,
    /* la fonte dichiara l'istante con fuso (ISO UTC): non è assunto UTC */
    kickoffIsAssumedUtc: false,
  };
}
