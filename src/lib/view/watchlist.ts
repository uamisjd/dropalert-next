/**
 * Watchlist — regole pure (Sprint lancio, punto H).
 *
 * Le preferite vivono nel localStorage del browser: nessun account, nessun
 * dato inviato al server, nessun cookie. È una scelta dichiarata anche
 * nell'informativa privacy — e ha un limite altrettanto dichiarato: la
 * lista resta su questo dispositivo e su questo browser.
 *
 * Ogni voce può avere una SOGLIA PERSONALE: un valore minimo di indice o un
 * calo percentuale minimo. La soglia non cambia il punteggio e non filtra la
 * lista principale: serve solo a dire, nella pagina /watchlist, se una
 * partita ha raggiunto ciò che avevi chiesto.
 *
 * Questo modulo è puro e testabile: nessun accesso a `window`.
 */

/** Chiave unica dello spazio dati nel browser. */
export const WATCHLIST_KEY = "dropalert.watchlist.v1";

export type ThresholdKind = "indice" | "drop";

export interface WatchEntry {
  /** identità della partita, la stessa usata per deduplicare la lista */
  key: string;
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  /** tipo di soglia scelta; null = nessuna soglia, seguo e basta */
  thresholdKind: ThresholdKind | null;
  /** valore della soglia: indice 0–100 oppure calo percentuale positivo */
  thresholdValue: number | null;
  addedAt: string;
}

/** Soglie proposte, per non costringere a digitare un numero. */
export const THRESHOLD_PRESETS: Array<{
  kind: ThresholdKind;
  value: number;
  label: string;
}> = [
  { kind: "indice", value: 60, label: "Indice ≥ 60" },
  { kind: "indice", value: 75, label: "Indice ≥ 75" },
  { kind: "drop", value: 10, label: "Calo ≥ 10%" },
  { kind: "drop", value: 15, label: "Calo ≥ 15%" },
];

/** Etichetta leggibile della soglia impostata. */
export function thresholdLabel(entry: {
  thresholdKind: ThresholdKind | null;
  thresholdValue: number | null;
}): string {
  if (entry.thresholdKind === null || entry.thresholdValue === null) {
    return "nessuna soglia: seguo la partita";
  }
  return entry.thresholdKind === "indice"
    ? `avvisami sopra indice ${entry.thresholdValue}`
    : `avvisami con calo ≥ ${entry.thresholdValue}%`;
}

/**
 * La soglia è raggiunta?
 *
 * `null` significa «non valutabile»: manca il dato con cui confrontarsi, e
 * un dato mancante non è un «no». Chi mostra il risultato deve distinguere
 * i tre casi, come ovunque nel progetto.
 */
export function thresholdReached(
  entry: { thresholdKind: ThresholdKind | null; thresholdValue: number | null },
  live: { score: number | null; dropPct: number | null },
): boolean | null {
  if (entry.thresholdKind === null || entry.thresholdValue === null) return null;
  if (entry.thresholdKind === "indice") {
    if (live.score === null) return null;
    return live.score >= entry.thresholdValue;
  }
  if (live.dropPct === null) return null;
  /* dropPct è negativo quando la quota scende: la soglia è sul calo */
  return -live.dropPct >= entry.thresholdValue;
}

/* ------------------------------------------------------------------ */
/* Serializzazione                                                     */
/* ------------------------------------------------------------------ */

function isEntry(v: unknown): v is WatchEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.key === "string" &&
    e.key.length > 0 &&
    typeof e.matchId === "number" &&
    typeof e.homeTeam === "string" &&
    typeof e.awayTeam === "string" &&
    typeof e.kickoffAt === "string"
  );
}

/**
 * Legge la lista da una stringa grezza. Una riga malformata viene scartata,
 * non «riparata»: meglio una preferita persa che una voce inventata.
 */
export function parseWatchlist(raw: string | null): WatchEntry[] {
  if (raw === null || raw.trim() === "") return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter(isEntry).map((e) => ({
    key: e.key,
    matchId: e.matchId,
    homeTeam: e.homeTeam,
    awayTeam: e.awayTeam,
    kickoffAt: e.kickoffAt,
    thresholdKind:
      e.thresholdKind === "indice" || e.thresholdKind === "drop"
        ? e.thresholdKind
        : null,
    thresholdValue:
      typeof e.thresholdValue === "number" && Number.isFinite(e.thresholdValue)
        ? e.thresholdValue
        : null,
    addedAt: typeof e.addedAt === "string" ? e.addedAt : new Date(0).toISOString(),
  }));
}

export function serializeWatchlist(entries: WatchEntry[]): string {
  return JSON.stringify(entries);
}

/** Aggiunge o aggiorna una voce, senza duplicare la stessa partita. */
export function upsertEntry(
  entries: WatchEntry[],
  entry: WatchEntry,
): WatchEntry[] {
  const i = entries.findIndex((e) => e.key === entry.key);
  if (i === -1) return [...entries, entry];
  const next = [...entries];
  next[i] = { ...entries[i], ...entry, addedAt: entries[i].addedAt };
  return next;
}

export function removeEntry(entries: WatchEntry[], key: string): WatchEntry[] {
  return entries.filter((e) => e.key !== key);
}

/**
 * Ordine della pagina: prima chi ha raggiunto la soglia, poi il kickoff più
 * vicino. Le partite già giocate scendono in fondo da sole.
 */
export function sortForDisplay<
  T extends { reached: boolean | null; kickoffAt: string },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ra = a.reached === true ? 0 : 1;
    const rb = b.reached === true ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime();
  });
}
