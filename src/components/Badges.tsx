/**
 * Etichette visive della dashboard.
 *
 * Vincolo di progetto: il colore non deve mai suggerire una raccomandazione.
 * Serve a distinguere la QUALITÀ DEL DATO, non la bontà di una scommessa.
 * Per questo il verde non compare mai su una metrica di rendimento.
 */
import type { ReactNode } from "react";
import type { SignalLevel, DataFreshness } from "@/lib/repo/dashboard";

function Pill({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */

const LEVEL_STYLES: Record<SignalLevel, string> = {
  forte: "border-slate-700 bg-slate-800 text-slate-100",
  reale: "border-slate-400 bg-slate-100 text-slate-900",
  debole: "border-slate-300 bg-white text-slate-600",
  nessuno: "border-dashed border-slate-300 bg-white text-slate-500",
};

const LEVEL_TITLES: Record<SignalLevel, string> = {
  forte:
    "Movimento ampio, confermato e sostenuto, con copertura dati sufficiente.",
  reale: "Movimento riconoscibile ma con conferme o durata parziali.",
  debole: "Movimento presente ma rientrato, scaduto o poco supportato.",
  nessuno:
    "Sotto la soglia di rumore o senza dati sufficienti per classificarlo.",
};

/** Livello del segnale: scala di grigi, nessun colore di merito. */
export function SignalLevelBadge({
  level,
  label,
}: {
  level: SignalLevel;
  label: string;
}) {
  return (
    <Pill className={LEVEL_STYLES[level]} title={LEVEL_TITLES[level]}>
      {label}
    </Pill>
  );
}

/* ------------------------------------------------------------------ */

const FRESHNESS_STYLES: Record<DataFreshness, string> = {
  live: "border-emerald-300 bg-emerald-50 text-emerald-800",
  stale: "border-amber-300 bg-amber-50 text-amber-900",
  partial: "border-orange-300 bg-orange-50 text-orange-900",
};

const FRESHNESS_DOT: Record<DataFreshness, string> = {
  live: "bg-emerald-500",
  stale: "bg-amber-500",
  partial: "bg-orange-500",
};

/**
 * Stato del dato. Qui il colore è ammesso e anzi necessario: descrive
 * l'affidabilità della misura, non un giudizio sull'evento.
 */
export function FreshnessBadge({
  level,
  label,
  reason,
}: {
  level: DataFreshness;
  label: string;
  reason?: string;
}) {
  return (
    <Pill className={FRESHNESS_STYLES[level]} title={reason}>
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${FRESHNESS_DOT[level]}`}
      />
      {label}
    </Pill>
  );
}

/* ------------------------------------------------------------------ */

/** Ampiezza del movimento: informazione neutra, sempre grigia. */
export function MagnitudeBadge({ label }: { label: string }) {
  return (
    <Pill className="border-slate-200 bg-slate-50 text-slate-700">{label}</Pill>
  );
}

/**
 * Badge del CLV non concludente.
 *
 * Deliberatamente neutro: mai verde, mai rosso. Il numero di osservazioni
 * viaggia sempre insieme al dato.
 */
export function InconclusiveBadge({ n }: { n: number }) {
  return (
    <Pill
      className="border-slate-400 bg-slate-100 text-slate-700"
      title="Campione troppo piccolo per qualsiasi inferenza."
    >
      {`NON CONCLUDENTE — n=${n}`}
    </Pill>
  );
}

/** Etichetta generica per metadati minori. */
export function MetaPill({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <Pill className="border-slate-200 bg-white text-slate-600" title={title}>
      {children}
    </Pill>
  );
}
