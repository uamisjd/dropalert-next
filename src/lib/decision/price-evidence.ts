import type { PriceSource } from "./contract";

/** Punto minimo che serve per valutare freschezza e provenienza di una linea. */
export interface PriceEvidencePoint {
  at: string;
  isStale: boolean;
}

/** Vista strutturale di una serie persistita, senza dipendenza dal database. */
export interface PriceEvidenceSeries {
  market: string;
  selection: string;
  bookmakerKey: string;
  current: number | null;
  lastAt: string | null;
  points: PriceEvidencePoint[];
}

export interface ExecutablePriceEvidence {
  price: number;
  source: Exclude<PriceSource, "consensus" | "unknown">;
  bookmakerKey: string;
  observedAt: Date;
  ageMinutes: number;
}

/**
 * Una chiave consensus non identifica un operatore: non può passare il gate
 * del prezzo eseguibile anche se la quota è recente e numericamente valida.
 * La regola è difensiva verso le fonti future, non solo verso BetExplorer.
 */
export function isConsensusBookmakerKey(bookmakerKey: string): boolean {
  const key = bookmakerKey.trim().toLowerCase();
  return key === "consensus" || key.includes("consensus") || key.includes("aggregate");
}

function sourceForBookmaker(bookmakerKey: string): Exclude<PriceSource, "consensus" | "unknown"> {
  const key = bookmakerKey.toLowerCase();
  return key.includes("exchange") || key.includes("betfair-ex") || key.includes("smarkets")
    ? "exchange"
    : "bookmaker";
}

/**
 * Seleziona una singola quota persistita realmente utilizzabile.
 *
 * Questa funzione non costruisce fair, non confronta il prezzo con se stesso
 * e non suggerisce stake. Se non trova una linea individuale fresca restituisce
 * `null`: il chiamante deve usare il consensus solo come osservazione e passare
 * `priceSource: "consensus"` al contratto decisionale.
 */
export function executablePriceFromSeries(
  series: PriceEvidenceSeries[],
  market: string,
  selection: string,
  now: Date,
  maxAgeMinutes: number,
): ExecutablePriceEvidence | null {
  const candidates: ExecutablePriceEvidence[] = [];

  for (const item of series) {
    if (item.market !== market || item.selection !== selection) continue;
    if (isConsensusBookmakerKey(item.bookmakerKey)) continue;
    if (item.current === null || !Number.isFinite(item.current) || item.current <= 1) continue;
    if (item.lastAt === null) continue;

    const observedAt = new Date(item.lastAt);
    if (Number.isNaN(observedAt.getTime())) continue;
    const ageMinutes = (now.getTime() - observedAt.getTime()) / 60_000;
    if (!Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > maxAgeMinutes) continue;

    const latestPoint = item.points
      .map((point) => ({ point, at: new Date(point.at) }))
      .filter(({ at }) => !Number.isNaN(at.getTime()))
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    if (latestPoint === undefined || latestPoint.point.isStale) continue;

    candidates.push({
      price: item.current,
      source: sourceForBookmaker(item.bookmakerKey),
      bookmakerKey: item.bookmakerKey,
      observedAt,
      ageMinutes: Math.max(0, Math.round(ageMinutes)),
    });
  }

  candidates.sort((a, b) => {
    const freshness = a.observedAt.getTime() - b.observedAt.getTime();
    return freshness !== 0 ? -freshness : a.bookmakerKey.localeCompare(b.bookmakerKey);
  });
  return candidates[0] ?? null;
}
