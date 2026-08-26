/**
 * Budget di The Odds API — regole pure e bloccate (Sprint G).
 *
 * Il piano gratuito dà 500 crediti al mese. La regola qui non è «cerca di
 * non esagerare»: è un HARD-STOP aritmetico, scritto in modo che il conto
 * non possa superare i tetti nemmeno se qualcuno chiamasse in un ciclo.
 *
 * Tetti dichiarati, tutti verificabili nei test:
 *  - 490 crediti al mese (10 di margine sul limite reale: se il conteggio
 *    del provider e il nostro divergono, la differenza la paghiamo noi in
 *    margine, non in servizio interrotto a metà mese);
 *  - una quota GIORNALIERA calcolata sui giorni che restano nel mese, con
 *    un tetto duro di 14 e un minimo di 12 finché il budget lo consente:
 *    così i crediti durano fino all'ultimo giorno invece di finire il 3;
 *  - una sola richiesta per partita al giorno, e solo per partite con
 *    segnale ATTIVO: le altre non valgono un credito.
 *
 * Ogni funzione è pura: prende i contatori e restituisce una decisione.
 */

/** Crediti utilizzabili in un mese: 490, non 500. Il margine è voluto. */
export const ODDS_MONTHLY_CAP = 490;

/** Tetto duro giornaliero: oltre non si va, nemmeno a inizio mese. */
export const ODDS_DAILY_HARD_CAP = 14;

/** Quota giornaliera minima di riferimento, finché il budget la copre. */
export const ODDS_DAILY_FLOOR = 12;

/** Una sola lettura per partita nell'arco della giornata italiana. */
export const ODDS_MAX_PER_MATCH_PER_DAY = 1;

const ROME = "Europe/Rome";

const romeParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: ROME,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Chiave del contatore mensile, per mese italiano: "odds:month:2026-08". */
export function monthKey(now: Date): string {
  return `odds-api:month:${romeParts.format(now).slice(0, 7)}`;
}

/** Chiave del contatore giornaliero: "odds:day:2026-08-26". */
export function dayKey(now: Date): string {
  return `odds-api:day:${romeParts.format(now)}`;
}

/** Chiave della singola partita nella giornata. */
export function matchKey(matchId: number, now: Date): string {
  return `odds-api:match:${romeParts.format(now)}:${matchId}`;
}

/** Giorni residui nel mese italiano, oggi compreso. */
export function daysLeftInMonth(now: Date): number {
  const iso = romeParts.format(now);
  const [y, m, d] = iso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.max(1, lastDay - d + 1);
}

/**
 * Quota concessa OGGI.
 *
 * È il minimo fra tre cose: il tetto duro, quanto resta nel mese e la
 * spartizione equa dei crediti residui sui giorni che mancano. La
 * spartizione è ciò che impedisce di bruciare il mese in tre giorni; il
 * pavimento a 12 vale solo finché il budget residuo lo copre davvero.
 */
export function dailyAllowance(usedThisMonth: number, now: Date): number {
  const remaining = Math.max(0, ODDS_MONTHLY_CAP - usedThisMonth);
  if (remaining === 0) return 0;
  const days = daysLeftInMonth(now);
  const fairShare = Math.floor(remaining / days);
  /* il pavimento non può mai superare ciò che resta davvero */
  const floor = Math.min(ODDS_DAILY_FLOOR, remaining);
  return Math.min(ODDS_DAILY_HARD_CAP, remaining, Math.max(fairShare, floor));
}

export interface BudgetState {
  usedThisMonth: number;
  usedToday: number;
  /** true se questa partita è già stata letta oggi */
  matchAlreadyRead: boolean;
  /** true solo per segnali in stato attivo */
  signalActive: boolean;
}

export type BudgetDecision =
  | { allowed: true; remainingToday: number; remainingMonth: number }
  | {
      allowed: false;
      reason:
        | "chiave_assente"
        | "tetto_mensile"
        | "tetto_giornaliero"
        | "gia_letta_oggi"
        | "segnale_non_attivo";
      message: string;
      remainingToday: number;
      remainingMonth: number;
    };

/** Frasi in italiano, una per motivo: nessun blocco silenzioso. */
export const BUDGET_MESSAGES: Record<string, string> = {
  chiave_assente: "linea sharp non disponibile: chiave non configurata",
  tetto_mensile: "linea sharp non disponibile: tetto mensile raggiunto",
  tetto_giornaliero: "linea sharp non disponibile: quota giornaliera esaurita",
  gia_letta_oggi: "linea sharp già letta oggi per questa partita",
  segnale_non_attivo: "linea sharp richiesta solo per segnali attivi",
};

/**
 * La decisione, in un punto solo. Chi chiama non può aggirarla: se non è
 * `allowed`, non esiste un percorso alternativo verso la rete.
 */
export function decide(
  state: BudgetState,
  now: Date,
  hasKey: boolean,
): BudgetDecision {
  const remainingMonth = Math.max(0, ODDS_MONTHLY_CAP - state.usedThisMonth);
  const allowanceToday = dailyAllowance(state.usedThisMonth, now);
  const remainingToday = Math.max(0, allowanceToday - state.usedToday);

  const deny = (reason: keyof typeof BUDGET_MESSAGES): BudgetDecision => ({
    allowed: false,
    reason: reason as Exclude<
      BudgetDecision & { allowed: false },
      never
    >["reason"],
    message: BUDGET_MESSAGES[reason],
    remainingToday,
    remainingMonth,
  });

  if (!hasKey) return deny("chiave_assente");
  if (!state.signalActive) return deny("segnale_non_attivo");
  if (remainingMonth <= 0) return deny("tetto_mensile");
  if (state.matchAlreadyRead) return deny("gia_letta_oggi");
  if (remainingToday <= 0) return deny("tetto_giornaliero");

  return { allowed: true, remainingToday, remainingMonth };
}

/* ------------------------------------------------------------------ */
/* Lettura della linea sharp                                           */
/* ------------------------------------------------------------------ */

/** Bookmaker considerati «sharp», in ordine di preferenza. */
export const SHARP_BOOKS = ["pinnacle", "betfair_ex_eu", "smarkets"] as const;

export type SharpVerdict = "conferma" | "smentisce" | "non osservabile";

export const SHARP_VERDICT_LABELS: Record<SharpVerdict, string> = {
  conferma: "la linea sharp conferma",
  smentisce: "la linea sharp smentisce",
  "non osservabile": "linea sharp non osservabile",
};

/**
 * Confronto fra il movimento del consenso e quello della linea sharp.
 *
 * «Conferma» significa che anche il book sharp prezza l'esito più caro del
 * consenso di partenza, cioè si muove nella stessa direzione. «Smentisce»
 * è il contrario. Senza uno dei due prezzi il verdetto è «non osservabile»,
 * che NON è una smentita: è assenza di dato, e si dichiara come tale.
 */
export function sharpVerdict(
  consensusOpening: number | null,
  consensusCurrent: number | null,
  sharpPrice: number | null,
): SharpVerdict {
  if (
    consensusOpening === null ||
    consensusCurrent === null ||
    sharpPrice === null ||
    consensusOpening <= 0 ||
    consensusCurrent <= 0 ||
    sharpPrice <= 0
  ) {
    return "non osservabile";
  }
  const consensusDown = consensusCurrent < consensusOpening;
  const sharpDown = sharpPrice < consensusOpening;
  /* movimento nullo sul consenso: non c'è direzione da confermare */
  if (Math.abs(consensusCurrent - consensusOpening) < 0.005) {
    return "non osservabile";
  }
  return consensusDown === sharpDown ? "conferma" : "smentisce";
}
