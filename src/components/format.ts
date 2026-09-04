/**
 * Formattazione condivisa della dashboard.
 *
 * Un solo posto decide come si scrive un numero, una data o un'assenza.
 * L'assenza in particolare ha un simbolo dedicato — "n/d" — che non deve mai
 * essere confuso con uno zero.
 */

/** Segnaposto unico per un dato che non esiste. */
export const ND = "n/d";

const ROME = "Europe/Rome";

const dateTimeFmt = new Intl.DateTimeFormat("it-IT", {
  timeZone: ROME,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFmt = new Intl.DateTimeFormat("it-IT", {
  timeZone: ROME,
  hour: "2-digit",
  minute: "2-digit",
});

const dayFmt = new Intl.DateTimeFormat("it-IT", {
  timeZone: ROME,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

/** Data e ora italiane, es. "18/08 22:00". */
export function fmtDateTime(dateOrIso: string | Date | null | undefined): string {
  if (!dateOrIso) return ND;
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  return Number.isNaN(d.getTime()) ? ND : dateTimeFmt.format(d);
}

export function fmtTime(dateOrIso: string | Date | null | undefined): string {
  if (!dateOrIso) return ND;
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  return Number.isNaN(d.getTime()) ? ND : timeFmt.format(d);
}

export function fmtDay(dateOrIso: string | Date | null | undefined): string {
  if (!dateOrIso) return ND;
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  return Number.isNaN(d.getTime()) ? ND : dayFmt.format(d);
}

/** Quota decimale a tre cifre, es. "3.290". */
export function fmtPrice(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return ND;
  return v.toFixed(3);
}

/** Variazione percentuale col segno, es. "−8.86%". */
export function fmtPct(v: number | null, decimals = 2): string {
  if (v === null || !Number.isFinite(v)) return ND;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(decimals)}%`;
}

/** Punti percentuali col segno, es. "+2.69 pp". */
export function fmtPp(v: number | null, decimals = 2): string {
  if (v === null || !Number.isFinite(v)) return ND;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(decimals)} pp`;
}

/** Frazione 0–1 resa come percentuale intera, es. "45%". */
export function fmtRate(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return ND;
  return `${Math.round(v * 100)}%`;
}

/** Durata in minuti resa leggibile: "0 min", "45 min", "3 h 20 min". */
export function fmtMinutes(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return ND;
  if (v < 60) return `${Math.round(v)} min`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Distanza dal presente, per l'ultimo run: "14 min fa". */
export function fmtAgo(iso: string | null, now = new Date()): string {
  if (!iso) return ND;
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "meno di 1 min fa";
  if (mins < 60) return `${mins} min fa`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h fa`;
  return `${Math.floor(h / 24)} g fa`;
}

/** Motivi dei buchi dati, in italiano leggibile. */
export const GAP_REASON_LABELS: Record<string, string> = {
  provider_unavailable: "fonte non raggiungibile",
  market_not_offered: "mercato non proposto dalla fonte",
  bookmaker_missing: "quote per singolo bookmaker non pubblicate",
  stale_snapshot: "rilevazione ferma oltre la soglia",
  parse_error: "lettura della pagina fallita",
  rate_limited: "richieste limitate dalla fonte",
  result_not_published: "risultato non ancora pubblicato dalla fonte",
};

/** Stato di una fonte, in italiano. */
export const SOURCE_STATUS_LABELS: Record<string, string> = {
  ok: "attiva",
  degraded: "degradata",
  blocked: "bloccata",
  disabled: "disattivata",
  unknown: "mai interrogata",
};

export function sourceStatusLabel(status: string): string {
  return SOURCE_STATUS_LABELS[status] ?? status;
}

export function gapReasonLabel(reason: string): string {
  return GAP_REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}
