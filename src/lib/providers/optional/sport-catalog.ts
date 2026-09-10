/**
 * Catalogo per-bookmaker di The Odds API — risoluzione guidata dal catalogo reale.
 *
 * PERCHÉ ESISTE: prima la copertura era una lista fatta a mano di sole leghe
 * «grandi» (Serie A, Premier, Liga, …). Ma la fonte `/v4/sports` (endpoint
 * GRATUITO, 0 crediti) espone molti più campionati — MLS, Argentina, Brasile,
 * Belgio, ecc. — e l'utente vuole poter trovare la partita giusta ovunque, non
 * solo nei tornei maggiori. Quindi la copertura deve essere guidata dal
 * catalogo reale della fonte, non da una scelta a monte.
 *
 * REGOLE DI ONESTÀ (per non ripetere il bug «Brazil: Serie A → chiave della
 * Serie A italiana», 06/09/2026):
 *  - ogni voce è vincolata al PAESE quando il titolo lo esplicita
 *    («Italy Serie A», «Russia Premier League»);
 *  - una lega il cui nome è ambiguo fra più paesi (Premier League, Serie A)
 *    si risolve solo con il paese giusto: la `MAP` curata in `sport-keys.ts`
 *    resta la prima passata proprio per questi casi;
 *  - una voce senza paese nel titolo (MLS, World Cup) si risolve per nome,
 *    ma deve essere unica nel catalogo (non si indovina su ambigui);
 *  - ciò che il catalogo NON espone (Algeria, Egitto, Georgia, Colombia, …)
 *    resta `null`: la fonte non ha quei dati, nessuna mappa li inventa.
 *
 * Il confronto del nome tollera un piccolo insieme di disambigatori che la
 * fonte aggiunge e l'archivio omette (es. «EFL League One» ≈ «League One»),
 * e viceversa, ma solo quando il paese vincola: mai un match senza paese.
 */

/** Voce tipizzata del catalogo reale `/v4/sports`. */
export interface CatalogSoccerEntry {
  /** chiave della fonte, es. `soccer_mls` */
  key: string;
  /** etichetta leggibile del catalogo, es. `"MLS"`, `"Italy Serie A"` */
  title: string;
}

/**
 * Snapshot del catalogo reale — campionati di calcio ATTIVI (`active: true`).
 * È la fonte di verità di quali competizioni la fonte offre davvero.
 * 41 voci soccer nel fixture, di cui 39 attive: `soccer_austria_bundesliga` e
 * `soccer_usa_mls` sono INATTIVE e vanno escluse (nessun evento da leggere).
 */
export const SOURCE_SOCCER_CATALOG: readonly CatalogSoccerEntry[] = [
  { key: "soccer_argentina_primera_division", title: "Argentina Primera División" },
  { key: "soccer_australia_aleague", title: "Australia A-League" },
  { key: "soccer_belgium_first_div", title: "Belgium First Division" },
  { key: "soccer_brazil_campeonato", title: "Brazil Campeonato" },
  { key: "soccer_china_superleague", title: "China Super League" },
  { key: "soccer_denmark_superliga", title: "Denmark Superliga" },
  { key: "soccer_efl_champ", title: "EFL Championship" },
  { key: "soccer_england_league1", title: "EFL League One" },
  { key: "soccer_england_league2", title: "EFL League Two" },
  { key: "soccer_epl", title: "EPL" },
  { key: "soccer_fa_cup", title: "FA Cup" },
  { key: "soccer_finland_veikkausliiga", title: "Finland Veikkausliiga" },
  { key: "soccer_france_ligue_one", title: "France Ligue 1" },
  { key: "soccer_france_ligue_two", title: "France Ligue 2" },
  { key: "soccer_germany_bundesliga", title: "Germany Bundesliga" },
  { key: "soccer_germany_bundesliga2", title: "Germany Bundesliga 2" },
  { key: "soccer_italy_serie_a", title: "Italy Serie A" },
  { key: "soccer_italy_serie_b", title: "Italy Serie B" },
  { key: "soccer_japan_j_league", title: "Japan J-League" },
  { key: "soccer_korea_kleague1", title: "South Korea K-League 1" },
  { key: "soccer_league_of_ireland", title: "League of Ireland" },
  { key: "soccer_mexico_ligamx", title: "Mexico Liga MX" },
  { key: "soccer_mls", title: "MLS" },
  { key: "soccer_netherlands_eredivisie", title: "Netherlands Eredivisie" },
  { key: "soccer_norway_eliteserien", title: "Norway Eliteserien" },
  { key: "soccer_portugal_primeira_liga", title: "Portugal Primeira Liga" },
  { key: "soccer_russia_premier_league", title: "Russia Premier League" },
  { key: "soccer_scotland_premiership", title: "Scotland Premiership" },
  { key: "soccer_spain_la_liga", title: "Spain La Liga" },
  { key: "soccer_spain_segunda_division", title: "Spain Segunda División" },
  { key: "soccer_sweden_allsvenskan", title: "Sweden Allsvenskan" },
  { key: "soccer_sweden_superettan", title: "Sweden Superettan" },
  { key: "soccer_switzerland_superleague", title: "Switzerland Super League" },
  { key: "soccer_turkey_super_league", title: "Turkey Süper Lig" },
  { key: "soccer_uefa_champs_league", title: "UEFA Champions League" },
  { key: "soccer_uefa_europa_conference_league", title: "UEFA Europa Conference League" },
  { key: "soccer_uefa_europa_league", title: "UEFA Europa League" },
  { key: "soccer_uefa_nations_league", title: "UEFA Nations League" },
  { key: "soccer_world_cup", title: "World Cup" },
];

/** Testo in forma confrontabile: minuscolo, senza accenti, spazi collassati. */
function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " e ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonicalizza il paese dell'archivio a una forma stabile (alias inclusi). */
function normalizeCountry(value: string): string {
  const n = norm(value);
  const aliases: Record<string, string> = {
    "united states": "usa",
    "us": "usa",
    "united states of america": "usa",
    "america": "usa",
    "south-coreea": "south korea",
    "inghilterra": "england",
    "gran bretagna": "england",
    "paesi bassi": "netherlands",
    "olanda": "netherlands",
  };
  return aliases[n] ?? n;
}

/** Parole di paese/regione che compaiono all'inizio di un titolo del catalogo. */
const COUNTRY_WORDS: readonly string[] = [
  "south korea", "united states", "argentina", "australia", "austria",
  "belgium", "brazil", "canada", "china", "colombia", "denmark", "egypt",
  "england", "finland", "france", "georgia", "germany", "ireland", "italy",
  "japan", "korea", "mexico", "netherlands", "norway", "portugal", "russia",
  "scotland", "spain", "sweden", "switzerland", "turkey", "usa", "europe",
  "world", "algeria",
];

const COUNTRY_SET: ReadonlySet<string> = new Set(COUNTRY_WORDS.map(normalizeCountry));

/**
 * Se il titolo inizia con un paese riconosciuto, lo restituisce (forma
 * canonicalizzata) e il resto del titolo (nome puro della lega).
 */
function splitTitle(title: string): { country: string | null; league: string } {
  const n = norm(title);
  const tokens = n.split(" ");
  // Prova con le parole-paese multi-parola prima, poi a una parola.
  for (let len = Math.min(2, tokens.length); len >= 1; len--) {
    const prefix = tokens.slice(0, len).join(" ");
    const canonical = normalizeCountry(prefix);
    if (COUNTRY_SET.has(canonical)) {
      return { country: canonical, league: tokens.slice(len).join(" ") };
    }
  }
  return { country: null, league: n };
}

/** Scarta il prefisso-disambigatore che la fonte aggiunge e l'archivio omette. */
function stripAliasPrefix(league: string): string {
  return league.replace(/^(efl|uefa) /, "").trim();
}

/**
 * Forme alternative del nome di una lega che la fonte può usare in modo
 * diverso dall'archivio (es. «EFL Championship» ≈ «Championship»).
 */
function leagueForms(league: string): string[] {
  const forms = new Set<string>([league]);
  const stripped = stripAliasPrefix(league);
  if (stripped !== league) {
    forms.add(stripped);
    // anche la forma «efl X» esplicita, se l'archivio la usa al contrario
    forms.add(`efl ${stripped}`);
    forms.add(`uefa ${stripped}`);
  }
  return [...forms];
}

/**
 * Risolve (paese, nome) → chiave sport usando il catalogo reale.
 * Collision-safe: il vincolo di paese evita «Brazil: Serie A → Serie A IT».
 *
 * Ritorna `null` se:
 *  - il catalogo non espone quella competizione (la fonte non la copre); oppure
 *  - il nome è ambiguo e il paese non lo disambigua.
 */
export function resolveSportKeyFromCatalog(
  country: string | null,
  name: string | null,
  catalog: readonly CatalogSoccerEntry[] = SOURCE_SOCCER_CATALOG,
): string | null {
  if (!country || !name) return null;
  const c = normalizeCountry(country);
  const n = norm(name);
  if (c === "" || n === "") return null;

  let found: CatalogSoccerEntry | null = null;
  for (const entry of catalog) {
    const { country: entryCountry, league } = splitTitle(entry.title);
    const forms = leagueForms(league);
    const nameMatches = forms.includes(n) || forms.includes(n.replace(/-/g, " "));
    if (!nameMatches) continue;

    // Vincolo di paese: se il titolo esplicita un paese, DEVE coincidere.
    if (entryCountry !== null && entryCountry !== c) continue;

    // Più di una voce combacia per nome senza disambiguazione di paese:
    // non si indovina.
    if (found !== null) return null;
    found = entry;
  }
  return found === null ? null : found.key;
}

/** Chiavi sport coperti = campionati di calcio ATTIVI nel catalogo reale. */
export function activeCatalogKeys(
  catalog: readonly CatalogSoccerEntry[] = SOURCE_SOCCER_CATALOG,
): readonly string[] {
  return catalog.map((entry) => entry.key);
}
