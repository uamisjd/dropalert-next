/**
 * Sprint UX-1/UX-2 — lettura temporale della lista partite.
 *
 * Funzioni pure, nessun accesso al database e nessuna metrica nuova: qui si
 * decide soltanto QUANDO una partita è ancora rilevante per la lista
 * principale, in quale giorno cade e come si scrive il tempo che manca.
 *
 * Il giorno di riferimento è sempre quello civile italiano (Europe/Rome):
 * confrontare istanti UTC produrrebbe un "oggi" sbagliato per due ore.
 *
 * UX-2 — la partizione delle chip è stata SEMPLIFICATA per essere verificabile
 * a mente: tre chip mutuamente esclusive, con un'aritmetica dichiarata,
 *
 *     Tutte = Da giocare + Giocate
 *     Da giocare = oggi + in arrivo   (le due quote sono mostrate come testo)
 *
 * "Oggi" e "In arrivo" non sono più chip perché la lista è già raggruppata per
 * giorno (Oggi / Domani / Poi): erano due filtri che si sovrapponevano alla
 * chip predefinita e rendevano i conteggi non sommabili.
 */

const ROME = "Europe/Rome";

/** Minuti di tolleranza dopo il fischio d'inizio: dopo +3h la partita esce. */
export const PLAYED_GRACE_MINUTES = 180;

/** Finestra della striscia "Ultimi movimenti", in ore. */
export const RECENT_WINDOW_HOURS = 3;

export type TimeChip = "da-giocare" | "giocate" | "tutte";

export const TIME_CHIPS: Array<{
  value: TimeChip;
  label: string;
  hint: string;
}> = [
  {
    value: "da-giocare",
    label: "Da giocare",
    hint: "Calcio d'inizio non ancora avvenuto, oppure iniziata da meno di 3 ore. È la vista predefinita.",
  },
  {
    value: "giocate",
    label: "Giocate",
    hint: "Archiviate: calcio d'inizio passato da oltre 3 ore. Restano consultabili anche in /ieri.",
  },
  {
    value: "tutte",
    label: "Tutte",
    hint: "Intero archivio in lista: da giocare più giocate. Tutte = Da giocare + Giocate.",
  },
];

const VALID_CHIPS = new Set<string>(TIME_CHIPS.map((c) => c.value));

/** Chip predefinita: "Da giocare". */
export const DEFAULT_TIME_CHIP: TimeChip = "da-giocare";

/** Legge la chip dall'URL; qualunque valore ignoto torna al default. */
export function parseTimeChip(raw: string | undefined | null): TimeChip {
  if (raw && VALID_CHIPS.has(raw)) return raw as TimeChip;
  return DEFAULT_TIME_CHIP;
}

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ROME,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Chiave del giorno civile italiano, es. "2026-08-25". */
export function romeDayKey(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return dayKeyFmt.format(date);
}

/** Differenza in giorni civili italiani fra due istanti (b − a). */
export function romeDayDiff(a: Date | string, b: Date | string): number {
  const ka = romeDayKey(a);
  const kb = romeDayKey(b);
  const da = Date.parse(`${ka}T00:00:00Z`);
  const db = Date.parse(`${kb}T00:00:00Z`);
  return Math.round((db - da) / 86400000);
}

export type DayBucket = "oggi" | "domani" | "poi";

export const DAY_BUCKET_LABELS: Record<DayBucket, string> = {
  oggi: "Oggi",
  domani: "Domani",
  poi: "Poi",
};

/**
 * Giorno di appartenenza della partita rispetto a ora.
 * Il passato resta in "Oggi" se cade nella giornata civile corrente:
 * è ciò che rende leggibile la coda delle partite appena iniziate.
 */
export function dayBucketOf(kickoffAt: string | Date, now: Date): DayBucket {
  const diff = romeDayDiff(now, kickoffAt);
  if (diff <= 0) return "oggi";
  if (diff === 1) return "domani";
  return "poi";
}

/** Minuti trascorsi dal kickoff: negativi se deve ancora iniziare. */
export function minutesSinceKickoff(kickoffAt: string | Date, now: Date): number {
  const k = kickoffAt instanceof Date ? kickoffAt : new Date(kickoffAt);
  return Math.round((now.getTime() - k.getTime()) / 60000);
}

/** true quando il fischio d'inizio è passato. */
export function isPlayed(kickoffAt: string | Date, now: Date): boolean {
  return minutesSinceKickoff(kickoffAt, now) > 0;
}

/** true quando la partita ha superato la tolleranza di +3h: è archiviata. */
export function isExpiredFromMain(kickoffAt: string | Date, now: Date): boolean {
  return minutesSinceKickoff(kickoffAt, now) > PLAYED_GRACE_MINUTES;
}

/**
 * Filtro della chip. Le prime due sono complementari per costruzione:
 * "giocate" è esattamente il complemento di "da-giocare".
 */
export function matchesTimeChip(
  kickoffAt: string | Date,
  chip: TimeChip,
  now: Date,
): boolean {
  const archived = isExpiredFromMain(kickoffAt, now);
  switch (chip) {
    case "giocate":
      return archived;
    case "tutte":
      return true;
    case "da-giocare":
    default:
      return !archived;
  }
}

/** Conteggi delle chip più le due quote interne alla chip predefinita. */
export interface ChipCounts {
  "da-giocare": number;
  giocate: number;
  tutte: number;
  /** dentro "da giocare": giornata civile italiana corrente */
  oggi: number;
  /** dentro "da giocare": giornate successive */
  inArrivo: number;
}

/**
 * Calcola i conteggi e li rende verificabili: chi legge deve poter fare la
 * somma a mente e ritrovare il totale.
 */
export function chipCounts(
  items: Array<{ kickoffAt: string }>,
  now: Date,
): ChipCounts {
  let daGiocare = 0;
  let giocate = 0;
  let oggi = 0;
  let inArrivo = 0;
  for (const it of items) {
    if (isExpiredFromMain(it.kickoffAt, now)) {
      giocate++;
      continue;
    }
    daGiocare++;
    if (romeDayDiff(now, it.kickoffAt) <= 0) oggi++;
    else inArrivo++;
  }
  return {
    "da-giocare": daGiocare,
    giocate,
    tutte: daGiocare + giocate,
    oggi,
    inArrivo,
  };
}

/** Countdown leggibile: "tra 2h 15m", "tra 40m", "giocata 1h fa". */
export function fmtCountdown(kickoffAt: string | Date, now: Date): string {
  const mins = minutesSinceKickoff(kickoffAt, now);
  if (mins > 0) {
    if (mins < 60) return `giocata ${mins}m fa`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `giocata ${h}h fa`;
    return `giocata ${Math.floor(h / 24)}g fa`;
  }
  const left = -mins;
  if (left < 1) return "in corso a momenti";
  if (left < 60) return `tra ${left}m`;
  const h = Math.floor(left / 60);
  const m = left % 60;
  if (h < 24) return m === 0 ? `tra ${h}h` : `tra ${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `tra ${d}g ${h % 24}h`;
}

/* ------------------------------------------------------------------ */
/* Ordinamento e raggruppamento                                        */
/* ------------------------------------------------------------------ */

/** Forma minima richiesta: basta il kickoff e una forza del segnale. */
export interface TimelineItem {
  kickoffAt: string;
  confidenceScore: number | null;
  updatedAt?: string;
}

const LEVEL_RANK: Record<string, number> = {
  forte: 3,
  reale: 2,
  debole: 1,
  nessuno: 0,
};

/**
 * Ordine dentro il giorno: prima i segnali più forti (livello, poi punteggio),
 * e a parità il kickoff più vicino. Il tempo resta visibile come badge, ma non
 * comanda l'ordine: la lista serve a far emergere i movimenti.
 */
export function compareWithinDay<
  T extends TimelineItem & { level?: string },
>(a: T, b: T): number {
  const la = LEVEL_RANK[a.level ?? ""] ?? 0;
  const lb = LEVEL_RANK[b.level ?? ""] ?? 0;
  if (la !== lb) return lb - la;
  const sa = a.confidenceScore ?? -1;
  const sb = b.confidenceScore ?? -1;
  if (sa !== sb) return sb - sa;
  return new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime();
}

export interface DayGroup<T> {
  key: DayBucket;
  label: string;
  items: T[];
}

/** Raggruppa in Oggi / Domani / Poi, saltando i gruppi vuoti. */
export function groupByDay<T extends TimelineItem & { level?: string }>(
  items: T[],
  now: Date,
): Array<DayGroup<T>> {
  const order: DayBucket[] = ["oggi", "domani", "poi"];
  const buckets = new Map<DayBucket, T[]>(order.map((k) => [k, []]));
  for (const it of items) {
    buckets.get(dayBucketOf(it.kickoffAt, now))!.push(it);
  }
  return order
    .map((key) => ({
      key,
      label: DAY_BUCKET_LABELS[key],
      items: [...buckets.get(key)!].sort(compareWithinDay),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Striscia "Ultimi movimenti": segnali nati o cambiati nelle ultime 3 ore.
 * Si basa su `updatedAt`, che è l'unico istante realmente a registro; senza
 * quel dato l'elemento non entra nella striscia invece di essere indovinato.
 */
export function recentMovements<T extends TimelineItem>(
  items: T[],
  now: Date,
  hours = RECENT_WINDOW_HOURS,
): T[] {
  const cutoff = now.getTime() - hours * 3600000;
  return items
    .filter((i) => {
      if (!i.updatedAt) return false;
      const t = new Date(i.updatedAt).getTime();
      return Number.isFinite(t) && t >= cutoff && t <= now.getTime() + 60000;
    })
    .sort(
      (a, b) =>
        new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime(),
    );
}
