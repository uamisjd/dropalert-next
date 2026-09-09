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
 * REGOLE DI ONESTÀ:
 *  - la lista è su una base ESPLICITA e verificata: niente slug indovinati;
 *  - una `sportKey` fuori base restituisce `null` (la cattura non è
 *    dichiarata possibile) invece di inventare un titolo «Paese: Lega»
 *    che la mappa poi non riconoscerebbe;
 *  - il titolo «Paese: Lega» è ESATTAMENTE il formato che `sportKeyFor`
 *    si aspetta (es. «Italy: Serie A» → `soccer_italy_serie_a`).
 *
 * Per aggiungere una lega servita alla cattura basta estendere `CAPTURABLE`
 * con i dati reali del campionato (verificati sul catalogo /v4/sports).
 */
import { SOURCE_SOCCER_CATALOG } from "./sport-catalog";
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
 * Campionati serviti che sappiamo catturare, con i dati verificati.
 * Le slug sono quelle usate da BetExplorer per le anagrafiche interne
 * (non cambiano l'esito della mappa: il titolo «Paese: Lega» è ciò che
 * conta per `sportKeyFor`).
 */
const CAPTURABLE: readonly CaptureLeague[] = [
  {
    sportKey: "soccer_italy_serie_a",
    countryRaw: "Italy",
    leagueRaw: "Italy: Serie A",
    countrySlug: "italy",
    leagueSlug: "serie-a",
  },
  {
    sportKey: "soccer_italy_serie_b",
    countryRaw: "Italy",
    leagueRaw: "Italy: Serie B",
    countrySlug: "italy",
    leagueSlug: "serie-b",
  },
  {
    sportKey: "soccer_epl",
    countryRaw: "England",
    leagueRaw: "England: Premier League",
    countrySlug: "england",
    leagueSlug: "premier-league",
  },
  {
    sportKey: "soccer_spain_la_liga",
    countryRaw: "Spain",
    leagueRaw: "Spain: La Liga",
    countrySlug: "spain",
    leagueSlug: "la-liga",
  },
  {
    sportKey: "soccer_germany_bundesliga",
    countryRaw: "Germany",
    leagueRaw: "Germany: Bundesliga",
    countrySlug: "germany",
    leagueSlug: "bundesliga",
  },
  {
    sportKey: "soccer_france_ligue_one",
    countryRaw: "France",
    leagueRaw: "France: Ligue 1",
    countrySlug: "france",
    leagueSlug: "ligue-1",
  },
];

/**
 * Titolo del catalogo reale per una `sportKey`, se presente nel nostro
 * snapshot. Serve solo per la diagnosi onesta quando la chiave non è in base.
 */
function catalogTitleFor(sportKey: string): string | null {
  const entry: { title: string } | undefined = (SOURCE_SOCCER_CATALOG as ReadonlyArray<{ key: string; title: string }>).find(
    (item) => item.key === sportKey,
  );
  return entry?.title ?? null;
}

/**
 * Risolve il descrittore di cattura per una `sportKey`.
 *
 * `null` significa: la cattura non è dichiarata possibile per questa lega.
 * Non è un errore di rete, è un limite dichiarato (o la lega non è servita,
 * o non l'abbiamo ancora in base: in dubbio si fallisce chiuso).
 */
export function captureLeagueFor(sportKey: string | null | undefined): CaptureLeague | null {
  if (!sportKey) return null;
  const exact = CAPTURABLE.find((entry) => entry.sportKey === sportKey);
  if (exact) return exact;

  /* Diagnosi onesta per chi sbaglia chiave: diciamo cosa offre il catalogo,
     ma senza inventare un titolo che la mappa poi non riconoscerebbe. */
  const title = catalogTitleFor(sportKey);
  if (title !== null) {
    // Titolo esistente ma NON in base di cattura: restituiamo null lo stesso,
    // la diagnosi vive nel commento/risposta della rotta.
  }
  return null;
}

/**
 * Converte un evento della fonte in `FixtureDTO`, il formato che l'ingestione
 * delle anagrafiche sa scrivere.
 *
 * `key` usa il prefisso `oddsapi-` per tracciare l'origine (il dato non viene
 * da BetExplorer). `providerMatchId` e `externalRef` conservano l'id reale
 * della fonte, così la provenienza non si perde.
 */
export function eventToFixture(event: OddsApiEventLite, league: CaptureLeague): FixtureDTO {
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
