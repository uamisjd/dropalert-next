/**
 * Codici di esclusione dichiarati dagli adapter (Sprint 6B).
 *
 * Un adapter che scarta una riga deve dire PERCHÉ in modo che il chiamante
 * possa contarla senza interpretare una frase in italiano. Il messaggio
 * resta leggibile da un umano; il codice in testa lo rende leggibile da un
 * programma.
 *
 * Formato: `<ref>: [<codice>] <spiegazione>`
 *
 * Il motivo per cui questi codici stanno in un modulo a parte, e non dentro
 * l'adapter: chi conta le esclusioni e chi le produce devono usare la stessa
 * lista, altrimenti il conteggio diverge dal comportamento reale senza che
 * nessuno se ne accorga.
 */

/** Codici che un adapter può dichiarare quando scarta una riga. */
export const EXCLUSION_CODES = {
  /** pagina della partita non raggiungibile: orario non verificabile */
  PAGE_UNREACHABLE: "pagina-non-raggiungibile",
  /** pagina raggiunta ma orario di inizio assente o senza fuso */
  KICKOFF_MISSING: "orario-assente",
  /** orario valido, ma fuori dalla finestra interrogata */
  OUT_OF_WINDOW: "fuori-finestra",
  /** riga non interpretabile dal parser */
  UNREADABLE_ROW: "riga-illeggibile",
  /** esclusa dal tetto di partite per giro: nostra scelta, non della fonte */
  RUN_CAP: "tetto-per-giro",
  /**
   * pagina di dettaglio non visitata: oltre il tetto di righe o oltre il
   * budget di tempo per giro. Nostra scelta anti-timeout, non della fonte.
   */
  DETAIL_BUDGET: "dettaglio-non-visitato",
} as const;

export type ExclusionCode =
  (typeof EXCLUSION_CODES)[keyof typeof EXCLUSION_CODES];

const ALL_CODES: string[] = Object.values(EXCLUSION_CODES);

/** Compone un messaggio di esclusione con il codice in testa. */
export function taggedExclusion(
  ref: string,
  code: ExclusionCode,
  explanation: string,
): string {
  return `${ref}: [${code}] ${explanation}`;
}

/**
 * Rilegge un messaggio di esclusione.
 * Restituisce `code: null` quando il messaggio non è marcato: è il caso dei
 * messaggi vecchi o prodotti altrove, e va trattato come causa non
 * dichiarata, non come causa assente.
 */
export function parseExclusion(message: string): {
  ref: string | null;
  code: ExclusionCode | null;
  explanation: string;
} {
  const match = /^([^:]+):\s*\[([a-z-]+)\]\s*([\s\S]*)$/.exec(message);
  if (!match) {
    const plain = /^([^:]+):\s*([\s\S]*)$/.exec(message);
    return plain
      ? { ref: plain[1].trim(), code: null, explanation: plain[2].trim() }
      : { ref: null, code: null, explanation: message.trim() };
  }
  const [, ref, code, explanation] = match;
  return {
    ref: ref.trim(),
    code: ALL_CODES.includes(code) ? (code as ExclusionCode) : null,
    explanation: explanation.trim(),
  };
}

/**
 * true solo per esclusioni determinate da un nostro limite esplicito.
 * Queste omissioni rendono il giro parziale, ma non dicono che la fonte sia
 * degradata: confondere le due cose falserebbe il gate operativo sui 429.
 */
export function isOwnChoiceExclusion(message: string): boolean {
  const code = parseExclusion(message).code;
  return (
    code === EXCLUSION_CODES.OUT_OF_WINDOW ||
    code === EXCLUSION_CODES.RUN_CAP ||
    code === EXCLUSION_CODES.DETAIL_BUDGET
  );
}

/** Un parziale è atteso solo se ogni omissione è una nostra scelta dichiarata. */
export function onlyOwnChoiceExclusions(messages: string[]): boolean {
  return messages.length > 0 && messages.every(isOwnChoiceExclusion);
}
