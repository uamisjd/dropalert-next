/**
 * Filtri di lettura dell'elenco divari (`/value-bets`), tenuti fuori dal componente.
 *
 * Perché un modulo puro: la soglia «Mostra tutto, anche i negativi» è la promessa con
 * cui la pagina dice che un divario negativo è un risultato, non un guasto. Finché il
 * filtro stava dentro il JSX quella promessa non era verificata da nulla, e infatti era
 * rotta: l'opzione «mostra tutto» valeva `0` e il confronto `edgePct < 0` scartava
 * proprio i negativi — su dati reali la lista usciva vuota e la pagina sembrava dire
 * «nessun valore» mentre voleva dire «ho filtrato via tutto». Qui la soglia ha un
 * sentinella esplicita e il comportamento è bloccato da `npm run test:filters`.
 */

export const SHOW_ALL_EDGES = Number.NEGATIVE_INFINITY;

export type OddsBand = "all" | "low" | "medium" | "high";

export interface ScannerFilters {
  /** Divario minimo accettato, in punti percentuali. */
  minEdge: number;
  /** Lascia passare solo i divari sopra zero. */
  positiveOnly: boolean;
  /** Fascia di quota eseguibile. */
  oddsRange: OddsBand;
  /** Testo libero su squadra o campionato. */
  searchTerm: string;
}

export const DEFAULT_SCANNER_FILTERS: ScannerFilters = {
  minEdge: SHOW_ALL_EDGES,
  positiveOnly: false,
  oddsRange: "all",
  searchTerm: "",
};

/** Le sole proprietà che i filtri guardano: nessuna dipendenza dal database. */
export interface FilterableGap {
  edgePct: number;
  currentOdds: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  selectionLabel: string;
}

export function applyScannerFilters<T extends FilterableGap>(
  items: T[],
  filters: ScannerFilters,
): T[] {
  const term = filters.searchTerm.trim().toLowerCase();

  return items.filter((item) => {
    if (item.edgePct < filters.minEdge) return false;
    if (filters.positiveOnly && item.edgePct <= 0) return false;

    if (filters.oddsRange === "low" && item.currentOdds >= 2.0) return false;
    if (
      filters.oddsRange === "medium" &&
      (item.currentOdds < 2.0 || item.currentOdds > 3.5)
    )
      return false;
    if (filters.oddsRange === "high" && item.currentOdds <= 3.5) return false;

    if (term !== "") {
      const hay =
        `${item.homeTeam} ${item.awayTeam} ${item.league} ${item.selectionLabel}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}

/**
 * Che cosa dire quando l'elenco filtrato è vuoto. La distinzione conta: «non c'è nulla
 * da misurare» e «c'è una misura ma l'hai filtrata via» sono due verità diverse, e la
 * seconda non deve mai somigliare alla prima.
 */
export function describeEmptyScanner(
  items: readonly FilterableGap[],
  filtered: readonly unknown[],
  filters: ScannerFilters,
): { title: string; note: string } {
  if (items.length === 0) {
    return {
      title: "Nessun divario calcolabile, in questo momento.",
      note: "Un divario si calcola solo su una partita non ancora al kickoff con la terna " +
        "completa dello stesso bookmaker alla stessa ora di lettura.",
    };
  }

  const negative = items.filter((i) => i.edgePct <= 0).length;
  const hidden = items.length - filtered.length;
  const mean =
    items.length > 0
      ? items.reduce((a, b) => a + b.edgePct, 0) / items.length
      : null;

  const parts = [
    `Su ${items.length} divari calcolati, ${negative} sono negativi e ` +
      `${items.length - negative} sopra zero.`,
  ];
  if (mean !== null) parts.push(`Media ${mean.toFixed(2)} pp.`);
  if (filters.minEdge !== SHOW_ALL_EDGES) {
    parts.push(
      `La soglia è «da ${filters.minEdge.toFixed(1)} pp»: ${hidden} righe sono fuori ` +
        `soglia. Scegli «Mostra tutto, anche i negativi» per vederle.`,
    );
  } else if (filters.positiveOnly) {
    parts.push(
      "La casella «solo divari positivi» è attiva: toglierla per leggere i negativi.",
    );
  } else {
    parts.push(
      "Fascia quota o ricerca stanno escludendo tutto: prova «Tutte le quote lette».",
    );
  }

  return {
    title: "Nessuna riga passa i filtri scelti.",
    note: parts.join(" "),
  };
}
