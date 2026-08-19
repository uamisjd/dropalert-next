/**
 * Aritmetica di base delle quote.
 * Tutte le funzioni sono pure e non lanciano su input plausibili:
 * restituiscono null quando il dato non è utilizzabile.
 */

/** Quota decimale minima accettabile. Sotto 1.01 il dato è considerato corrotto. */
const MIN_VALID_PRICE = 1.01;
/** Quota decimale massima accettabile. */
const MAX_VALID_PRICE = 1000;

/** Verifica che una quota decimale sia utilizzabile. */
export function isValidPrice(price: number | null | undefined): price is number {
  return (
    typeof price === "number" &&
    Number.isFinite(price) &&
    price >= MIN_VALID_PRICE &&
    price <= MAX_VALID_PRICE
  );
}

/**
 * Probabilità implicita grezza = 1 / quota.
 * Non è normalizzata: include il margine del bookmaker.
 * @returns frazione 0–1, oppure null se la quota non è valida.
 */
export function impliedProbability(price: number | null | undefined): number | null {
  if (!isValidPrice(price)) return null;
  return 1 / price;
}

/** Inverso: dalla probabilità implicita alla quota. */
export function priceFromProbability(prob: number | null | undefined): number | null {
  if (typeof prob !== "number" || !Number.isFinite(prob) || prob <= 0 || prob >= 1) {
    return null;
  }
  return 1 / prob;
}

/**
 * Variazione di probabilità implicita in PUNTI PERCENTUALI.
 * Positivo = la probabilità implicita è salita, cioè la quota è SCESA (drop).
 */
export function deltaInPercentagePoints(
  fromPrice: number | null | undefined,
  toPrice: number | null | undefined,
): number | null {
  const from = impliedProbability(fromPrice);
  const to = impliedProbability(toPrice);
  if (from === null || to === null) return null;
  return (to - from) * 100;
}

/**
 * Margine del bookmaker (overround) su un insieme completo di selezioni.
 * @returns es. 0.056 per un 105.6%, oppure null se l'insieme è incompleto.
 */
export function bookmakerMargin(prices: Array<number | null | undefined>): number | null {
  if (prices.length < 2) return null;
  let sum = 0;
  for (const p of prices) {
    const prob = impliedProbability(p);
    if (prob === null) return null;
    sum += prob;
  }
  return sum - 1;
}

/**
 * Probabilità normalizzate (margine rimosso con metodo proporzionale).
 * Utile per confrontare book con marginalità diverse.
 */
export function normalizeProbabilities(
  prices: Array<number | null | undefined>,
): number[] | null {
  const probs: number[] = [];
  for (const p of prices) {
    const prob = impliedProbability(p);
    if (prob === null) return null;
    probs.push(prob);
  }
  const sum = probs.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  return probs.map((p) => p / sum);
}

/** Mediana robusta: ignora i valori non finiti. */
export function median(values: Array<number | null | undefined>): number | null {
  const clean = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Media aritmetica robusta. */
export function mean(values: Array<number | null | undefined>): number | null {
  const clean = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (clean.length === 0) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

/** Arrotondamento a n decimali, stabile per la persistenza. */
export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Vincola un valore in [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Differenza in minuti fra due istanti (b - a). */
export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60000;
}

/** Converte un numeric Postgres (stringa) in number, null-safe. */
export function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
