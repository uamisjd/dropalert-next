/**
 * Disambiguazione minima dell'identità della competizione.
 *
 * Un nome come «Pumas W» condivide quasi tutti i token con la squadra
 * maschile. Citare entrambe le società quindi non basta: per una partita
 * femminile anche il risultato deve dichiarare quel perimetro.
 */

const WOMEN_FIXTURE_HINT =
  /(\bwomen(?:'s)?\b|\bfemminil[ei]\b|\bfemeni[ln]\b|\bfeminin[oa]\b|(?:^|[\s\-–—])w(?:[\s\-–—]|$))/i;

const WOMEN_CONTENT_HINT =
  /(\bwomen(?:'s)?\b|\bwoman\b|\bgirls?\b|\bfemminil[ei]\b|\bfemeni[ln]\b|\bfeminin[oa]\b|\bféminin(?:e)?\b|\bfrauen\b|\bdamen\b|\bkvinn\w*\b|\bkadın\w*\b|\b女子\b|\b여자\b)/i;

export function isWomensFixture(
  homeTeam: string,
  awayTeam: string,
  league: string | null = null,
): boolean {
  return WOMEN_FIXTURE_HINT.test(`${homeTeam} ${awayTeam} ${league ?? ""}`);
}

/** Termini espliciti da aggiungere alla query nella lingua della fonte. */
export function womenSearchTerms(lang: string): string {
  switch (lang) {
    case "es":
      return '("fútbol femenil" OR "fútbol femenino")';
    case "pt":
      return '"futebol feminino"';
    case "it":
      return '"calcio femminile"';
    case "de":
      return "Frauenfußball";
    case "fr":
      return '"football féminin"';
    case "nl":
      return "vrouwenvoetbal";
    case "sv":
      return "damfotboll";
    case "tr":
      return '"kadın futbol"';
    default:
      return '("women football" OR "women soccer")';
  }
}

/**
 * Per le partite senza un perimetro femminile esplicito non aggiunge filtri.
 * Per le femminili richiede un marcatore nel titolo, estratto o URL.
 */
export function matchesFixtureScope(
  text: string,
  homeTeam: string,
  awayTeam: string,
  league: string | null = null,
): boolean {
  if (!isWomensFixture(homeTeam, awayTeam, league)) return true;
  if (WOMEN_CONTENT_HINT.test(text)) return true;

  /* Alcuni calendari pubblicano solo il suffisso «W». In quel caso passa
     esclusivamente la citazione completa del nome con il suffisso, non il
     nome ambiguo della società senza «W». */
  const normalizedText = text.toLowerCase().replace(/\s+/g, " ");
  return [homeTeam, awayTeam]
    .filter((team) => /(?:^|[\s\-–—])w$/i.test(team.trim()))
    .some((team) => normalizedText.includes(team.trim().toLowerCase()));
}
