/**
 * Mappa competizione → chiave sport di The Odds API (Sprint G).
 *
 * La copertura è OGGI guidata dal catalogo reale della fonte, non da una
 * scelta a monte di «sole leghe grandi»: per richiesta dell'utente non deve
 * esistere una distinzione tra leghe minori e maggiori, ma si individua la
 * partita giusta ovunque la fonte abbia davvero i dati.
 *
 * Due passate, in quest'ordine:
 *  - `MAP` CURATA (prima passata): gestisce in modo affidabile le
 *    abbreviazioni e la grafia che l'archivio usa per i tornei più comuni
 *    («England: Premier League» → `soccer_epl», «Italy: Serie A» → …). È
 *    anche la garanzia per i nomi ambigui tra più paesi (il paese è
 *    vincolato, vedi sotto).
 *  - `resolveSportKeyFromCatalog` (fallback): per qualunque altro campionato
 *    la copertura dipende da ciò che la fonte offre nel catalogo `/v4/sports`
 *    (endpoint gratuito, 0 crediti) — MLS, Argentina, Brasile, Belgio, ecc.
 *
 * Il confronto è vincolato al PAESE, non alla sola grafia della lega: il nome
 * in archivio arriva dalla fonte come «Paese: Lega» (es. «Italy: Serie A»,
 * «Europe: UEFA Champions League»). Il 06/09/2026 la lettura di controllo
 * (run 34046688765) ha speso 1 credito leggendo «Brazil: Serie A» con la
 * chiave della Serie A ITALIANA: la regex cercava solo «serie a» e il
 * campionato brasiliano collideva. Stessa classe di errore dei Premier
 * League extra-inglesi (Bahrain, Giordania, Kuwait, Ucraina…), della
 * «Ecuador: Serie B» e della «Northern Ireland: NIFL Championship». Da qui
 * la regola: paese e lega devono combaciare ENTRAMBI, e un nome senza paese
 * non decide nulla (fallire chiuso non costa crediti).
 *
 * Ogni lettura costa un credito su un budget mensile di 490: `null` significa
 * «non spendere», quindi la copertura dichiarata non è mai più ampia di ciò
 * che la fonte espone davvero.
 */

import {
  resolveSportKeyFromCatalog,
  activeCatalogKeys,
} from "./sport-catalog";

const MAP: Array<{ country: RegExp; league: RegExp; sportKey: string }> = [
  { country: /^italy$/i, league: /^serie a$/i, sportKey: "soccer_italy_serie_a" },
  { country: /^italy$/i, league: /^serie b$/i, sportKey: "soccer_italy_serie_b" },
  { country: /^england$/i, league: /^premier league$/i, sportKey: "soccer_epl" },
  { country: /^england$/i, league: /^championship$/i, sportKey: "soccer_efl_champ" },
  { country: /^spain$/i, league: /^la ?liga$/i, sportKey: "soccer_spain_la_liga" },
  { country: /^germany$/i, league: /^bundesliga$/i, sportKey: "soccer_germany_bundesliga" },
  { country: /^france$/i, league: /^ligue 1$/i, sportKey: "soccer_france_ligue_one" },
  { country: /^netherlands$/i, league: /^eredivisie$/i, sportKey: "soccer_netherlands_eredivisie" },
  { country: /^portugal$/i, league: /^(primeira liga|liga portugal)$/i, sportKey: "soccer_portugal_primeira_liga" },
  { country: /^europe$/i, league: /^(uefa )?champions league$/i, sportKey: "soccer_uefa_champs_league" },
  { country: /^europe$/i, league: /^(uefa )?europa league$/i, sportKey: "soccer_uefa_europa_league" },
  { country: /^europe$/i, league: /^(uefa )?(europa )?conference league$/i, sportKey: "soccer_uefa_europa_conference_league" },
];

/**
 * Escluso a priori: coppe minori, femminili, riserve, giovanili. Si prova sul
 * nome COMPLETO «Paese: Lega», com'è sempre stato.
 *
 * Niente tag «B»/«II» qui: sono etichette di squadre riserve (il nome della
 * squadra, non della lega) e includerle escludeva anche la Serie B, che è
 * un campionato coperto e dichiarato tale in `COVERED_LABEL`.
 */
const EXCLUDE = /\b(women|femminile|u1[5-9]|u2[0-3]|riserve|reserves|youth|primavera)\b/i;

/**
 * Competizioni che CONTENGONO il nome di un campionato coperto ma non sono
 * quel campionato: «England: Premier League Cup» è un torneo di squadre
 * riserve, non la Premier League, e la fonte non lo espone.
 *
 * Con i pattern ancorati (^…$) sulla lega questa guardia è quasi sempre
 * ridondante — «premier league cup» non può combaciare con /^premier league$/
 * — ma resta come difesa per chi un domani allargasse la mappa: un costo
 * nullo che impedisce di pagare un credito per una coppa.
 */
const COPPA_TRAVESTITA = /\b(cup|coppa|trophy|shield|playoff|play-off|qualifying)\b/i;

/**
 * Il pezzo lega del nome, in forma confrontabile: minuscolo, senza accenti,
 * spazi interni collassati. «Primera División» e «primera division» devono
 * essere la stessa cosa, altrimenti la mappa dipende dalla grafia del giorno.
 */
function normalizeLeagueName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Chiave sport della competizione, o `null` se non è coperta.
 * `null` significa: non spendere un credito per questa partita.
 *
 * Il nome deve essere «Paese: Lega» (il formato dell'archivio). Un nome
 * senza «:» non decide nulla e restituisce `null`: non si può sapere di
 * quale «Serie A» o «Premier League» si tratti, e il dubbio non si paga.
 */
export function sportKeyFor(league: string | null): string | null {
  if (league === null) return null;
  const name = league.trim();
  if (name === "" || EXCLUDE.test(name)) return null;

  const separator = name.indexOf(":");
  if (separator <= 0) return null;
  const country = name.slice(0, separator).trim();
  const leagueName = normalizeLeagueName(name.slice(separator + 1));
  if (country === "" || leagueName === "") return null;

  for (const row of MAP) {
    if (!row.country.test(country)) continue;
    if (!row.league.test(leagueName)) continue;
    if (COPPA_TRAVESTITA.test(leagueName)) continue;
    return row.sportKey;
  }

  // Fallback guidato dal catalogo reale. La `MAP` curata copre le leghe
  // maggiori e ne gestisce le abbreviazioni (EPL, Serie A, …). Per tutto il
  // resto la copertura dipende da ciò che la fonte offre davvero (MLS,
  // Argentina, Brasile, Belgio, …): qui non esiste più una distinzione tra
  // leghe minori e maggiori — si risolve qualunque campionato che la fonte
  // espone nel catalogo, a patto che il paese collima (collision-safe).
  const catalogResolved = resolveSportKeyFromCatalog(country, leagueName);
  return catalogResolved === null ? null : catalogResolved;
}

/**
 * Risolve la sportKey della fonte per-bookmaker a partire da paese e nome
 * della competizione SEPARATI (com'è nell'archivio: `leagues.country` e
 * `leagues.name` sono campi distinti).
 *
 * `sportKeyFor` si aspetta il formato «Paese: Lega»: se il paese manca la
 * chiave è illeggibile. Qui componiamo la stringa in un modo onesto:
 *  - se manca il paese o il nome → `null` (competizione non leggibile, non si
 *    indovina);
 *  - altrimenti si compone «Paese: Lega» e si delega a `sportKeyFor`.
 *
 * È la funzione che la scheda partita userà (o un suo equivalente) per dire
 * se la conferma sharp è leggibile, evitando il bug di passare un nome senza
 * paese (che renderebbe `sportKeyFor` sempre `null`).
 */
export function resolveSportKey(country: string | null, name: string | null): string | null {
  const c = (country ?? "").trim();
  const n = (name ?? "").trim();
  if (c === "" || n === "") return null;
  return sportKeyFor(`${c}: ${n}`);
}

/**
 * Dice se una competizione (paese + nome) è CERTAMENTE coperta dalla fonte
 * per-bookmaker, senza bisogno del catalogo a runtime.
 *
 * Usa la chiave risolta (`resolveSportKey`) e la confronta con le chiavi
 * coperte dichiarate (`COVERED_SPORT_KEYS`). Regole di onestà:
 *  - un nome o paese non leggibile → `false` (non si indovina: la copertura
 *    non è verificabile, quindi non si dichiara);
 *  - un nome simile ma NON in mappa → `false` (una somiglianza non è
 *    copertura: verrebbe da `findNearKey` che qui non usiamo per non mentire);
 *  - solo una chiave esatta nella mappa coperte → `true`.
 *
 * È il test che la scheda partita può fare a costo zero (senza caricare il
 * catalogo) per dire se la conferma sharp è attendibile o se la competizione
 * è fuori copertura.
 */
export function isCoveredBySportKey(
  country: string | null,
  name: string | null,
): boolean {
  const key = resolveSportKey(country, name);
  if (key === null) return false;
  return COVERED_SPORT_KEYS.includes(key);
}

/** Competizioni coperte, per il pannello: si dichiara dove si spende.
 *  Oggi la copertura segue il catalogo reale della fonte, non una scelta di
 *  «sole leghe grandi»: qualunque campionato che la fonte offre è leggibile
 *  (in vigore la regola dell'utente: nessuna distinzione minori/maggiori). */
export const COVERED_LABEL =
  "tutti i campionati di calcio offerti dalla fonte (39 leghe attive): Serie A/B, Premier e Championship e le divisioni inglesi, Liga, Bundesliga, Ligue 1/2, Eredivisie, Primeira Liga, MLS, Brasile, Argentina, Belgio, coppe UEFA, ecc.";

/** Chiavi sport coperte: l'unione delle chiavi della `MAP` (prima passata,
 *  gestisce le abbreviazioni) e di tutte le leghe attive del catalogo reale.
 *  Restano deterministiche (la `MAP` prima). */
export const COVERED_SPORT_KEYS: readonly string[] = Array.from(
  new Set([...MAP.map((row) => row.sportKey), ...activeCatalogKeys()]),
);
