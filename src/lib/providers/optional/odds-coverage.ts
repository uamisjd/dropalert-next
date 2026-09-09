/**
 * Classificazione della copertura di The Odds API rispetto ai campionati del
 * monitor — funzione PURA (nessun DB, nessuna rete).
 *
 * Serve a rispondere, con dati reali e non a memoria, all'incongruenza
 * segnalata: «The Odds API copre solo i campionati maggiori? quelli minori no?
 * BetExplorer mi dà invece i minori e non i maggiori, non è un'incongruenza?».
 *
 * Classifica ogni campionato in tre gruppi, con regole esplicite:
 *  - `mapped`    → chiave esatta da `sport-keys.ts` PRESENTE nel catalogo;
 *  - `near`      → nessuna chiave esatta, ma il titolo della fonte somiglia al
 *                  campionato (chiave CANDIDATA: va verificata a mano prima di
 *                  aggiungerla alla mappa — mai usata qui come certezza);
 *  - `uncovered` → la fonte non espone nulla di confrontabile: resta buco
 *                  dichiarato, mai colmato con stime.
 *
 * Regole di onestà: ciò che non è leggibile non si indovina; una somiglianza
 * non è una copertura; i tornei fuori copertura restano `bookmaker_missing`.
 */
import { sportKeyFor } from "./sport-keys";

export interface CoverageLeague {
  key: string;
  name: string;
  country: string | null;
}

export interface CoverageSport {
  key: string;
  title: string;
}

export interface NearCandidate {
  league: CoverageLeague;
  candidate: string;
  title: string;
}

export interface CoverageReport {
  mapped: CoverageLeague[];
  near: NearCandidate[];
  uncovered: CoverageLeague[];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Cerca, fra i titoli della fonte, quello che "ragionevolmente" rappresenta il
 * campionato del monitor. NON è una certezza: è un invito a verificare prima di
 * aggiungere la riga alla mappa.
 *
 * Serve solo a non perdere i campionati che la fonte copre con un nome diverso
 * da quello del monitor. Per non produrre abbagli tra paesi, la regola è:
 *  1. se il campionato ha una nazione, il titolo della fonte DEVE nominarla
 *     (un titolo di un altro paese non è mai un candidato: niente abbagli tipo
 *     "Mexico" ⇢ "Denmark Superliga");
 *  2. per le competizioni senza nazione (es. coppe europee), bastano due token
 *     distintivi del nome della competizione.
 */
export function findNearKey(
  league: CoverageLeague,
  soccer: CoverageSport[],
): { candidate: string; title: string } | null {
  const countryText = normalizeText(league.country ?? "");
  // Un "paese" continente/placeholder (Europe, International, World) non è una
  // nazione che compare in un titolo: per queste competizioni si usa la regola
  // dei due token del nome, non l'ancoraggio sulla nazione.
  const isMultinational =
    countryText === "europe" ||
    countryText === "international" ||
    countryText === "mondiale" ||
    countryText === "world" ||
    countryText === "world cup" ||
    countryText === "international cup";
  const countryTokens = isMultinational
    ? []
    : countryText.split(" ").filter((t) => t.length > 2);
  const leagueText = normalizeText(league.name);
  const leagueTokens = leagueText.split(" ").filter((t) => t.length > 2);

  for (const s of soccer) {
    const title = normalizeText(s.title);
    const titleTokens = new Set(title.split(" ").filter((t) => t.length > 2));

    if (countryTokens.length > 0) {
      // Regola 1: la nazione DEVE comparire nel titolo della fonte.
      const countryMatched = countryTokens.every((token) => titleTokens.has(token));
      if (!countryMatched) continue;
      // Se la nazione c'è, serve almeno un token del nome della competizione
      // (o la competizione è un'unica parola forte già espressa).
      const leagueHit = leagueTokens.some((token) => titleTokens.has(token));
      // "MLS", "A-League" ecc. hanno token corti: se la nazione è univoca nel
      // titolo e la competizione non è generica, va bene anche solo la nazione.
      if (leagueHit || (countryTokens.length === 1 && titleTokens.size >= 1)) {
        return { candidate: s.key, title: s.title };
      }
      continue;
    }

    // Regola 2: senza nazione (coppe/competizioni internazionali) servono due
    // token distintivi del nome della competizione.
    const hits = leagueTokens.filter((token) => titleTokens.has(token));
    if (hits.length >= 2) {
      return { candidate: s.key, title: s.title };
    }
  }
  return null;
}

/**
 * Classifica una lista di campionati rispetto al catalogo della fonte.
 *
 * `catalogKeys` è il set delle chiavi sport ATTIVE (in stagione): un campionato
 * che la fonte espone ma in pausa non è «coperto» praticamente.
 */
export function classifyCoverage(
  leagues: CoverageLeague[],
  catalogKeys: Set<string>,
  soccer: CoverageSport[],
): CoverageReport {
  const mapped: CoverageLeague[] = [];
  const near: NearCandidate[] = [];
  const uncovered: CoverageLeague[] = [];

  for (const league of leagues) {
    // `sportKeyFor` si aspetta il formato "Paese: Lega" (quello dell'archivio):
    // senza separatore non decide nulla, e il dubbio sulla nazione non va pagato.
    const exact = sportKeyFor(
      league.country !== null && league.country !== ""
        ? `${league.country}: ${league.name}`
        : league.name,
    );
    if (exact !== null && catalogKeys.has(exact)) {
      mapped.push(league);
      continue;
    }
    const candidate = findNearKey(league, soccer);
    if (candidate !== null) {
      near.push({ league, candidate: candidate.candidate, title: candidate.title });
      continue;
    }
    uncovered.push(league);
  }

  return { mapped, near, uncovered };
}
