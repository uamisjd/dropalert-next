/**
 * Esito descrittivo di un segnale, calcolato DAI GOL FINALI (Sprint 9).
 *
 * Questo modulo risponde a una sola domanda: la selezione su cui il
 * mercato si è mossa è poi corrisposta nel risultato finale? È una
 * lettura fattuale di ciò che è accaduto in campo, registrata dal
 * collector risultati in `matches.home_goals` / `matches.away_goals`.
 *
 * Non è, e non deve diventare, una misura di qualità del segnale:
 * quella resta il CLV, confronto fra la quota al rilevamento e la quota
 * di chiusura. Qui il CLV non viene nemmeno letto — l'esito e il CLV
 * misurano cose diverse e non devono mai essere mescolati.
 *
 * Regola delle assenze: senza risultato registrato l'esito resta
 * «in attesa». Mai convertito in centrata o mancata, mai stimato.
 *
 * Funzioni PURE: nessun database, nessuna rete, nessun orologio.
 */

/** I mercati che il monitor sa leggere. */
export type SettleMarket = "1x2" | "ou_2_5" | "btts";

/** Le selezioni ammesse, valide a livello applicativo per mercato. */
export type SettleSelection =
  | "home"
  | "draw"
  | "away"
  | "over"
  | "under"
  | "yes"
  | "no";

export type OutcomeVerdict = "centrata" | "mancata" | "in_attesa";

export const OUTCOME_LABELS_IT: Record<OutcomeVerdict, string> = {
  centrata: "Centrata",
  mancata: "Mancata",
  in_attesa: "In attesa",
};

/**
 * Sotto questo numero di esiti RISOLTI (centrate + mancate) la pagina
 * dichiara che non si tratta di una tendenza. È la stessa soglia
 * dichiarativa usata altrove nel monitor: pochi esiti fanno Prozentualen
 * rumorose, non letture.
 */
export const MIN_OUTCOMES_FOR_TREND = 10;

/** Avviso fisso che accompagna ogni numero della pagina /ieri. */
export const OUTCOME_DISCLAIMER = "Non è un rendimento né un consiglio.";

/** Il conteggio dei tre esiti. */
export interface OutcomeTally {
  centrata: number;
  mancata: number;
  in_attesa: number;
}

/** Ciò che serve al calcolo: selezione e risultato finale registrato. */
export interface SettleInput {
  market: SettleMarket;
  selection: SettleSelection;
  homeGoals: number | null;
  awayGoals: number | null;
}

/**
 * Esito della selezione dai gol finali.
 *
 * Lo switch è esaustivo sulle selezioni: se l'enum cresce, TypeScript
 * rompe qui la compilazione invece di lasciare una selezione senza
 * verdetto. La regola è una sola per selezione, dichiarata, senza
 * correzioni per mercato o aggiustamenti di sorta.
 */
export function outcomeOf(input: SettleInput): OutcomeVerdict {
  const { homeGoals, awayGoals } = input;

  /* senza risultato registrato non si può dire niente: resta in attesa */
  if (homeGoals === null || awayGoals === null) return "in_attesa";

  switch (input.selection) {
    case "home":
      return homeGoals > awayGoals ? "centrata" : "mancata";
    case "draw":
      return homeGoals === awayGoals ? "centrata" : "mancata";
    case "away":
      return homeGoals < awayGoals ? "centrata" : "mancata";
    case "over":
      return homeGoals + awayGoals > 2.5 ? "centrata" : "mancata";
    case "under":
      return homeGoals + awayGoals < 2.5 ? "centrata" : "mancata";
    case "yes":
      return homeGoals > 0 && awayGoals > 0 ? "centrata" : "mancata";
    case "no":
      return homeGoals === 0 || awayGoals === 0 ? "centrata" : "mancata";
  }
}

/** Conta i verdetti. Gli «in attesa» restano visibili e separati. */
export function tallyOutcomes(verdicts: OutcomeVerdict[]): OutcomeTally {
  const tally: OutcomeTally = { centrata: 0, mancata: 0, in_attesa: 0 };
  for (const v of verdicts) tally[v] += 1;
  return tally;
}

/** Esiti con un risultato registrato: sono gli unici che fanno conteggio. */
export function settledCount(tally: OutcomeTally): number {
  return tally.centrata + tally.mancata;
}

/**
 * true finché gli esiti risolti sono meno della soglia.
 *
 * A 10 esatti la lettura è permessa: la soglia è «sotto dieci», come
 * dichiarato nella pagina.
 */
export function isUnderpowered(tally: OutcomeTally): boolean {
  return settledCount(tally) < MIN_OUTCOMES_FOR_TREND;
}
