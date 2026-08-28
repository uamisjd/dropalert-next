/**
 * Mappa competizione → chiave sport di The Odds API (Sprint G).
 *
 * Deliberatamente CORTA. Ogni lettura costa un credito su un budget mensile
 * di 490: si spende solo dove la fonte copre davvero il campionato, cioè sui
 * tornei maggiori. Per tutto il resto la risposta è «competizione non
 * mappata sulla fonte» e non parte alcuna richiesta — è la prima difesa del
 * budget, prima ancora dei contatori.
 *
 * Il confronto è sul nome della lega come arriva dall'archivio, in minuscolo.
 */

const MAP: Array<{ match: RegExp; sportKey: string }> = [
  { match: /serie a(?!\s*cup)/i, sportKey: "soccer_italy_serie_a" },
  { match: /serie b/i, sportKey: "soccer_italy_serie_b" },
  { match: /premier league/i, sportKey: "soccer_epl" },
  { match: /championship/i, sportKey: "soccer_efl_champ" },
  { match: /la ?liga/i, sportKey: "soccer_spain_la_liga" },
  { match: /bundesliga/i, sportKey: "soccer_germany_bundesliga" },
  { match: /ligue 1/i, sportKey: "soccer_france_ligue_one" },
  { match: /eredivisie/i, sportKey: "soccer_netherlands_eredivisie" },
  { match: /primeira liga/i, sportKey: "soccer_portugal_primeira_liga" },
  { match: /champions league/i, sportKey: "soccer_uefa_champs_league" },
  { match: /europa league/i, sportKey: "soccer_uefa_europa_league" },
  { match: /conference league/i, sportKey: "soccer_uefa_europa_conference_league" },
];

/** Escluso a priori: coppe minori, femminili, riserve, giovanili. */
const EXCLUDE = /\b(women|femminile|u1[5-9]|u2[0-3]|b\b|ii\b|riserve|reserves|youth|primavera)\b/i;

/**
 * Competizioni che CONTENGONO il nome di un campionato coperto ma non sono
 * quel campionato: «England: Premier League Cup» è un torneo di squadre
 * riserve, non la Premier League, e la fonte non lo espone. Senza questo
 * controllo il confronto per sottostringa spendeva un credito su una
 * competizione che non avrebbe mai restituito una linea sharp.
 *
 * Le coppe UEFA restano coperte perché hanno una chiave propria: qui si
 * escludono solo i tornei che si travestono da campionato.
 */
const COPPA_TRAVESTITA = /\b(cup|coppa|trophy|shield|playoff|play-off|qualifying)\b/i;

/**
 * Chiave sport della competizione, o `null` se non è coperta.
 * `null` significa: non spendere un credito per questa partita.
 */
export function sportKeyFor(league: string | null): string | null {
  if (league === null) return null;
  const name = league.trim();
  if (name === "" || EXCLUDE.test(name)) return null;
  for (const row of MAP) {
    if (!row.match.test(name)) continue;
    /* le coppe UEFA hanno una voce dedicata e vanno bene così; per tutte le
       altre, se il nome dice «cup» non è il campionato che abbiamo mappato */
    const isUefa = row.sportKey.startsWith("soccer_uefa");
    if (!isUefa && COPPA_TRAVESTITA.test(name)) return null;
    return row.sportKey;
  }
  return null;
}

/** Competizioni coperte, per il pannello: si dichiara dove si spende. */
export const COVERED_LABEL =
  "Serie A e B, Premier League e Championship, Liga, Bundesliga, Ligue 1, Eredivisie, Primeira Liga e coppe UEFA maschili";
