/**
 * Ribasatura del CLV — decisione pura, riga per riga.
 *
 * Il problema, misurato sullo storico (`docs/STUDIO-PARTITE-FINITE.md` §1.1):
 * il CLV è `(probChiusura − probSegnale) × 100` e le due probabilità devono
 * stare sulla stessa base. Il prezzo del segnale (`signalPrice`) è **sempre**
 * un prezzo grezzo di mercato, margine incluso: nel registro non ne esiste una
 * versione depurata. Quindi:
 *
 *  - chiusura **grezza** contro segnale grezzo → basi allineate;
 *  - chiusura **senza margine** contro segnale grezzo → basi NON allineate:
 *    depurare il margine alza il prezzo, abbassa la probabilità implicita di
 *    chiusura e quindi abbassa `clvPp` meccanicamente. Misurato: **−1,86 pp**
 *    di CLV bruciati dal solo errore di base, 20,6% dei casi che cambierebbe
 *    verso.
 *
 * La riparazione disponibile sui dati già a registro è una sola: riportare
 * ogni riga sulla base allineata, cioè sulla chiusura grezza mediana che
 * `closing_lines` conserva comunque accanto a quella fair. Non si inventa un
 * margine, non si stima una chiusura, non si tocca il prezzo del segnale
 * (congelato al primo rilevamento: riscriverlo renderebbe il CLV una misura di
 * sé stesso). Il confronto fair-contro-fair sarebbe altrettanto legittimo, ma
 * richiederebbe di depurare anche il segnale, e quel dato non c'è.
 *
 * Modulo puro: nessuna rete, nessun database. La scrittura sta nello script
 * (`src/scripts/rebase-clv.ts`), che di default non scrive nulla.
 */
import { computeClv, type ClvResult } from "@/lib/drop/clv";

/** Le basi registrate in `clv_records.closing_basis`. */
export type ClvBasis = "fair_novig" | "raw_consensus";

/** Una riga di `clv_records`, nei soli campi che servono alla decisione. */
export interface ClvRow {
  id: number;
  signalPrice: number;
  closingPrice: number;
  clvPp: number;
  closingBasis: string;
}

/**
 * La chiusura grezza mediana oggi a registro, cioè la metà che sta sulla
 * stessa base del prezzo del segnale.
 */
export interface AlignedReference {
  price: number;
  /** quanti bookmaker concorrono alla mediana */
  booksUsed: number;
}

/** Cosa scrivere, se si scrive. */
export interface RebaseUpdate {
  closingPrice: number;
  clvPp: number;
  clvPct: number;
  beatClose: boolean;
  closingBasis: ClvBasis;
  /** la base allineata non rimuove alcun margine: sempre null */
  marketMargin: null;
}

export type RebaseDecision =
  | {
      /** da chiusura senza margine a chiusura grezza: basi riallineate */
      action: "repair";
      /** differenza di CLV in punti percentuali: nuovo meno vecchio */
      deltaPp: number;
      update: RebaseUpdate;
      reason: string;
    }
  | { action: "refresh"; deltaPp: number; update: RebaseUpdate; reason: string }
  | { action: "unchanged"; reason: string }
  | { action: "impossible"; reason: string };

/**
 * Soglia sotto cui una differenza di prezzo è rumore di arrotondamento e non
 * giustifica una riscrittura. I prezzi sono registrati con 3 decimali.
 */
export const PRICE_EPSILON = 0.001;

/** La base su cui le due metà del CLV stanno sullo stesso piano. */
export const ALIGNED_BASIS: ClvBasis = "raw_consensus";

function isAligned(raw: string): boolean {
  return raw === ALIGNED_BASIS;
}

/**
 * Decide che cosa fare di una riga di CLV alla luce della chiusura grezza oggi
 * a registro. Ogni esito porta il motivo in italiano: un ricalcolo che non
 * spiega perché ha cambiato (o non ha cambiato) un numero non è verificabile.
 */
export function decideRebase(
  row: ClvRow,
  reference: AlignedReference | null,
): RebaseDecision {
  if (reference === null) {
    return {
      action: "impossible",
      reason: "nessuna chiusura grezza a registro per questa partita",
    };
  }
  if (!Number.isFinite(reference.price) || reference.price <= 1) {
    return {
      action: "impossible",
      reason: "la chiusura a registro non è un prezzo valido",
    };
  }

  const recomputed: ClvResult | null = computeClv({
    signalPrice: row.signalPrice,
    closingPrice: reference.price,
  });
  if (recomputed === null) {
    return {
      action: "impossible",
      reason: "prezzo del segnale o di chiusura non valido",
    };
  }

  const needsRepair = !isAligned(row.closingBasis);
  const priceMoved =
    Math.abs(reference.price - row.closingPrice) > PRICE_EPSILON;

  if (!needsRepair && !priceMoved) {
    return {
      action: "unchanged",
      reason: "già su base allineata e stessa chiusura: niente da ricalcolare",
    };
  }

  const deltaPp = Number((recomputed.clvPp - row.clvPp).toFixed(2));
  const update: RebaseUpdate = {
    closingPrice: recomputed.closingPrice,
    clvPp: recomputed.clvPp,
    clvPct: recomputed.clvPct,
    beatClose: recomputed.beatClose,
    closingBasis: ALIGNED_BASIS,
    marketMargin: null,
  };

  if (needsRepair) {
    return {
      action: "repair",
      deltaPp,
      update,
      reason:
        `chiusura senza margine confrontata con segnale grezzo: riportata sulla ` +
        `chiusura grezza (${reference.price.toFixed(3)}, ${reference.booksUsed} book) perché le due metà stiano sulla stessa base`,
    };
  }
  return {
    action: "refresh",
    deltaPp,
    update,
    reason: `chiusura mediana aggiornata (${row.closingPrice.toFixed(3)} → ${reference.price.toFixed(3)}) su ${reference.booksUsed} book, stessa base`,
  };
}

/** Riepilogo di un passaggio di ribasatura, per il log e per il pannello. */
export interface RebaseSummary {
  rowsSeen: number;
  repaired: number;
  refreshed: number;
  unchanged: number;
  impossible: number;
  /** somma dei deltaPp delle righe cambiate */
  totalDeltaPp: number;
  /** deltaPp medio sulle righe cambiate, null se nessuna è cambiata */
  avgDeltaPp: number | null;
  /** quante righe cambierebbero verso (da negativo a positivo o viceversa) */
  flipped: number;
}

export function emptySummary(): RebaseSummary {
  return {
    rowsSeen: 0,
    repaired: 0,
    refreshed: 0,
    unchanged: 0,
    impossible: 0,
    totalDeltaPp: 0,
    avgDeltaPp: null,
    flipped: 0,
  };
}

/** Accumula una decisione nel riepilogo. Puro: restituisce un nuovo oggetto. */
export function accumulate(
  summary: RebaseSummary,
  row: ClvRow,
  decision: RebaseDecision,
): RebaseSummary {
  const next: RebaseSummary = { ...summary, rowsSeen: summary.rowsSeen + 1 };
  if (decision.action === "unchanged") {
    next.unchanged += 1;
    return next;
  }
  if (decision.action === "impossible") {
    next.impossible += 1;
    return next;
  }
  if (decision.action === "repair") next.repaired += 1;
  else next.refreshed += 1;
  next.totalDeltaPp = Number((next.totalDeltaPp + decision.deltaPp).toFixed(2));
  const changed = next.repaired + next.refreshed;
  next.avgDeltaPp = Number((next.totalDeltaPp / changed).toFixed(2));
  const wasNegative = row.clvPp < 0;
  const isNegative = decision.update.clvPp < 0;
  if (wasNegative !== isNegative) next.flipped += 1;
  return next;
}

/** Frase di riepilogo in italiano, senza promesse. */
export function describeRebase(s: RebaseSummary): string {
  if (s.rowsSeen === 0) {
    return "Nessuna riga di CLV a registro: niente da ribasare.";
  }
  const changed = s.repaired + s.refreshed;
  const base =
    `Su ${s.rowsSeen} righe di CLV: ${s.repaired} riportate sulla base allineata ` +
    `(grezzo contro grezzo), ${s.refreshed} ricalcolate sulla stessa base, ` +
    `${s.unchanged} già allineate, ${s.impossible} non ricalcolabili.`;
  if (changed === 0) {
    return `${base} Nessun valore è cambiato.`;
  }
  return (
    `${base} Variazione media del CLV sulle righe cambiate ` +
    `${s.avgDeltaPp !== null && s.avgDeltaPp > 0 ? "+" : ""}${s.avgDeltaPp} pp; ` +
    `${s.flipped} righe cambiano verso.`
  );
}
