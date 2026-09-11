/**
 * Sorgenti scritte in `odds_snapshots.source`.
 *
 * Modulo foglia (zero import): ogni scrittore e ogni lettore che filtra per
 * sorgente importa da qui, così i nomi esistono in un solo posto. La regola
 * che li governa: le righe scritte dagli smoke test restano in archivio come
 * prova della verifica, ma NON devono mai spostare un denominatore o un
 * tetto di produzione (trovato 11/09/2026: le righe degli smoke avevano
 * portato il denominatore 1x2 a 25, deprimendo copertura e punteggi).
 */

/** Consenso BetExplorer: l'unica linea di produzione del monitor. */
export const BETEXPLORER_SNAPSHOT_SOURCE = "betexplorer-dropping-odds";

/** Adapter The Odds API: sorgente di produzione del cablaggio nel ciclo. */
export const THE_ODDS_API_SNAPSHOT_SOURCE = "the-odds-api";

/** Smoke test manuale `smoke:odds-api`: verifica, non dato di produzione. */
export const THE_ODDS_API_SMOKE_SOURCE = "the-odds-api-smoke";

/** Smoke test del cablaggio `smoke:odds-wire --read`: verifica, non produzione. */
export const THE_ODDS_API_WIRE_SMOKE_SOURCE = "the-odds-api-wire-smoke";

/**
 * Solo queste sorgenti contano per denominatori, tetti e coperture.
 * Tutto ciò che finisce con `-smoke` è una verifica e resta fuori.
 */
export const PRODUCTION_SNAPSHOT_SOURCES: string[] = [
  BETEXPLORER_SNAPSHOT_SOURCE,
  THE_ODDS_API_SNAPSHOT_SOURCE,
];
