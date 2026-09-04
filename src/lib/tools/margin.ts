/**
 * Margine del bookmaker e quote fair — il lato "betting" dell'osservatorio.
 *
 * Che cosa fa questo modulo e che cosa NON fa.
 *
 * Fa: prende un insieme COMPLETO di quote, misura quanto margine contengono
 * e le riporta a probabilità che sommano a 100%, con tre metodi dichiarati.
 * Mostra cioè quanto costa il prezzo, non quale prezzo prendere.
 *
 * Non fa: non sceglie una selezione, non dice dove giocare, non confronta
 * operatori, non promette un vantaggio. Nessun valore qui è un consiglio di
 * scommessa, e il testo in interfaccia lo ripete.
 *
 * Regole ereditate dal resto del progetto:
 *  - un mercato incompleto è un errore dichiarato, non una stima;
 *  - un metodo che produce una probabilità non positiva lo dice invece di
 *    arrotondare a zero: sarebbe un numero inventato;
 *  - il metodo usato è sempre scritto accanto al risultato.
 *
 * Tutte le funzioni sono pure: nessuna rete, nessun database, nessun browser.
 */
import { isValidPrice, round } from "@/lib/drop/math";

/* ------------------------------------------------------------------ */
/* Misura del margine                                                  */
/* ------------------------------------------------------------------ */

export interface MarginFailure {
  /** indici (0-based) delle quote assenti o non utilizzabili */
  invalidIndexes: number[];
  reason: string;
}

export interface MarginReport {
  /** somma delle probabilità implicite, in percentuale: 106.14 = 106,14% */
  overroundPct: number;
  /** margine in punti percentuali sopra il 100%: 6.14 */
  marginPct: number;
  /**
   * Trattenuta teorica: quanto il banco trattiene in media per ogni euro
   * giocato su questo mercato, in percentuale. È `margine / overround`, non
   * il margine: su un 106% il banco trattiene il 5,7%, non il 6%.
   */
  holdPct: number;
  /** probabilità implicite grezze, in percentuale, margine incluso */
  impliedPct: number[];
  /** quante selezioni compongono il mercato */
  outcomes: number;
}

/**
 * Misura il margine di un mercato completo.
 *
 * @param prices quote decimali, tutte le selezioni del mercato
 */
export function marginOf(
  prices: Array<number | null | undefined>,
): { ok: true; data: MarginReport } | { ok: false; failure: MarginFailure } {
  if (prices.length < 2) {
    return {
      ok: false,
      failure: {
        invalidIndexes: [],
        reason:
          "Servono almeno due quote: con una sola non esiste un mercato e il margine non è definibile.",
      },
    };
  }

  const invalidIndexes: number[] = [];
  const implied: number[] = [];
  prices.forEach((p, i) => {
    if (!isValidPrice(p)) {
      invalidIndexes.push(i);
      return;
    }
    implied.push(1 / p);
  });

  if (invalidIndexes.length > 0) {
    return {
      ok: false,
      failure: {
        invalidIndexes,
        reason: `Quote non utilizzabili alle posizioni ${invalidIndexes
          .map((i) => i + 1)
          .join(", ")}: una quota decimale deve essere un numero fra 1,01 e 1000. Il margine non viene stimato.`,
      },
    };
  }

  const overround = implied.reduce((a, b) => a + b, 0);
  return {
    ok: true,
    data: {
      overroundPct: round(overround * 100, 2),
      marginPct: round((overround - 1) * 100, 2),
      holdPct: round(((overround - 1) / overround) * 100, 2),
      impliedPct: implied.map((p) => round(p * 100, 2)),
      outcomes: prices.length,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Rimozione del margine: tre metodi dichiarati                        */
/* ------------------------------------------------------------------ */

export type DevigMethod = "proportional" | "additive" | "power";

export const DEVIG_METHODS: Array<{
  key: DevigMethod;
  label: string;
  note: string;
}> = [
  {
    key: "proportional",
    label: "Proporzionale",
    note: "Divide ogni probabilità per la loro somma: il margine viene ripartito in proporzione. È il metodo più semplice e più trasparente, ed è lo stesso che il progetto usa per la chiusura fair no-vig.",
  },
  {
    key: "additive",
    label: "Additivo",
    note: "Sottrae a ogni selezione la stessa quota di margine in valore assoluto: per questo pesa di più sulle quote alte, a cui toglie proporzionalmente di più. Su mercati molto sbilanciati può produrre valori non positivi, e allora lo dichiara.",
  },
  {
    key: "power",
    label: "Power (esponente)",
    note: "Cerca l'esponente k per cui le probabilità elevate a k sommano a 1. Tiene conto del fatto che il margine pesa di più sulle quote alte. Risolto per bisezione: è un'approssimazione, dichiarata come tale.",
  },
];

export interface DevigOutcome {
  /** probabilità fair, in percentuale, sommano a 100 (a meno di arrotondamento) */
  fairPct: number[];
  /** quota fair corrispondente a ciascuna probabilità */
  fairPrice: number[];
  method: DevigMethod;
  /** scostamento massimo fra i metodi, in punti percentuali */
  spreadPct?: number;
}

export interface DevigFailure {
  method: DevigMethod | null;
  reason: string;
}

function toResult(
  probs: number[],
  method: DevigMethod,
): { ok: true; data: DevigOutcome } {
  return {
    ok: true,
    data: {
      fairPct: probs.map((p) => round(p * 100, 2)),
      fairPrice: probs.map((p) => round(1 / p, 3)),
      method,
    },
  };
}

function impliedOf(
  prices: Array<number | null | undefined>,
): number[] | { failure: MarginFailure } {
  const m = marginOf(prices);
  if (!m.ok) return { failure: m.failure };
  return m.data.impliedPct.map((p) => p / 100);
}

/**
 * Rimozione proporzionale: p_i / Σp.
 * Sempre definita quando il mercato è valido.
 */
export function devigProportional(
  prices: Array<number | null | undefined>,
): { ok: true; data: DevigOutcome } | { ok: false; failure: DevigFailure } {
  const implied = impliedOf(prices);
  if (!Array.isArray(implied)) {
    return { ok: false, failure: { method: null, reason: implied.failure.reason } };
  }
  const sum = implied.reduce((a, b) => a + b, 0);
  return toResult(
    implied.map((p) => p / sum),
    "proportional",
  );
}

/**
 * Rimozione additiva: p_i − (Σp − 1)/n.
 *
 * Su mercati molto sbilanciati può dare una probabilità ≤ 0. Non la portiamo
 * a zero: una probabilità nulla direbbe «impossibile», che è un'affermazione
 * sul mondo, non un arrotondamento.
 */
export function devigAdditive(
  prices: Array<number | null | undefined>,
): { ok: true; data: DevigOutcome } | { ok: false; failure: DevigFailure } {
  const implied = impliedOf(prices);
  if (!Array.isArray(implied)) {
    return { ok: false, failure: { method: null, reason: implied.failure.reason } };
  }
  const excess = (implied.reduce((a, b) => a + b, 0) - 1) / implied.length;
  const probs = implied.map((p) => p - excess);
  const negative = probs.findIndex((p) => p <= 0);
  if (negative !== -1) {
    return {
      ok: false,
      failure: {
        method: "additive",
        reason: `Il metodo additivo porta la selezione ${negative + 1} a una probabilità non positiva: su questo mercato non è applicabile. Il risultato non viene forzato a zero.`,
      },
    };
  }
  return toResult(probs, "additive");
}

/** Tolleranza della bisezione: 1e-12 è sotto la cifra che mostriamo. */
const POWER_TOLERANCE = 1e-12;
/** Tetto di iterazioni: la bisezione converge ben prima. */
const POWER_MAX_ITERATIONS = 200;

/**
 * Rimozione con esponente: cerca k > 0 tale che Σ p_i^k = 1.
 *
 * Σ p_i^k è strettamente decrescente in k, passa da Σp_i > 1 (k→0) a 0
 * (k→∞): la soluzione esiste ed è unica, e la bisezione la trova senza
 * dipendenze esterne.
 */
export function devigPower(
  prices: Array<number | null | undefined>,
): { ok: true; data: DevigOutcome } | { ok: false; failure: DevigFailure } {
  const implied = impliedOf(prices);
  if (!Array.isArray(implied)) {
    return { ok: false, failure: { method: null, reason: implied.failure.reason } };
  }
  const sum = implied.reduce((a, b) => a + b, 0);
  if (sum <= 1) {
    /* mercato senza margine (o sotto): k = 1 è già la soluzione, ma un
       mercato così non è un prezzo di bookmaker: lo dichiariamo */
    return {
      ok: false,
      failure: {
        method: "power",
        reason:
          "Le probabilità implicite non superano il 100%: non c'è margine da rimuovere. Un prezzo così non è una quota di bookmaker.",
      },
    };
  }

  const f = (k: number) =>
    implied.reduce((a, p) => a + Math.pow(p, k), 0) - 1;

  let lo = 1e-9;
  let hi = 1;
  /* raddoppia il bordo superiore finché la funzione non diventa negativa */
  while (f(hi) > 0 && hi < 1e6) hi *= 2;
  if (f(hi) > 0) {
    return {
      ok: false,
      failure: {
        method: "power",
        reason:
          "L'esponente cercato non converge entro i limiti imposti: risultato non calcolato invece di restituirne uno approssimato.",
      },
    };
  }

  let k = hi;
  for (let i = 0; i < POWER_MAX_ITERATIONS; i++) {
    k = (lo + hi) / 2;
    const v = f(k);
    if (Math.abs(v) < POWER_TOLERANCE) break;
    if (v > 0) lo = k;
    else hi = k;
  }

  const probs = implied.map((p) => Math.pow(p, k));
  const total = probs.reduce((a, b) => a + b, 0);
  return toResult(
    probs.map((p) => p / total),
    "power",
  );
}

/** Tutti i metodi insieme, con lo scostamento massimo fra loro. */
export function devigAll(
  prices: Array<number | null | undefined>,
): {
  results: Array<{ ok: true; data: DevigOutcome } | { ok: false; failure: DevigFailure }>;
  /** scostamento massimo fra i metodi riusciti, in punti percentuali */
  spreadPct: number | null;
  /** il metodo che fallisce, se c'è: va dichiarato, non nascosto */
  failures: Array<{ method: DevigMethod; reason: string }>;
} {
  const results = [
    devigProportional(prices),
    devigAdditive(prices),
    devigPower(prices),
  ];
  const riusciti = results.filter(
    (r): r is { ok: true; data: DevigOutcome } => r.ok,
  );
  const failures = results
    .map((r, i) =>
      r.ok ? null : { method: DEVIG_METHODS[i]!.key, reason: r.failure.reason },
    )
    .filter((f): f is { method: DevigMethod; reason: string } => f !== null);

  let spreadPct: number | null = null;
  if (riusciti.length >= 2) {
    const n = riusciti[0]!.data.fairPct.length;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const values = riusciti.map((r) => r.data.fairPct[i] ?? 0);
      max = Math.max(max, Math.max(...values) - Math.min(...values));
    }
    spreadPct = round(max, 2);
  }

  return { results, spreadPct, failures };
}
