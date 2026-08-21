/**
 * Contesto 360° — regole pure e confezionamento (Sprint contesto).
 *
 * Nessuna rete, nessun database, nessun orologio implicito: qui vivono le
 * costanti dichiarate, la validazione della risposta del modello e le
 * finestre di cache. La generazione vera sta in `llm.ts`, la cache in
 * `repo/context.ts`.
 *
 * Regola che governa il tutto: il contesto NON entra nel punteggio, non
 * lo alimenta e non lo giustifica. È la facciata narrativa del movimento,
 * dichiarata per ciò che è — conoscenza di un modello linguistico, da
 * verificare — e mai spacciata per dato raccolto.
 */

/** Dicitura fissa in testa al blocco, ovunque il contesto compaia. */
export const CONTEXT_DISCLAIMER =
  "Contesto generato automaticamente: non è un pronostico né una garanzia.";

/** Tag che accompagna ogni campo privo di fonte recuperata. */
export const MODEL_KNOWLEDGE_TAG = "conoscenza modello, da verificare";

/** Valori ammessi per l'accordo col movimento osservato. */
export const ACCORDO_VALUES = ["sostiene", "contraddice", "non c'entra"] as const;
export type AccordoValue = (typeof ACCORDO_VALUES)[number];

/** I cinque campi obbligatori del contesto. */
export interface ContextFields {
  livelloCategorie: string;
  anomaliaCampo: string;
  postaInPalo: string;
  rotazioniFatica: string;
  accordoColDrop: AccordoValue;
}

/** Durata della cache di un contesto riuscito. */
export const CONTEXT_CACHE_HOURS = 24;

/** Un fallimento si riprota prima: dopo un'ora, non dopo un giorno. */
export const CONTEXT_RETRY_HOURS = 1;

/**
 * Tetto giornaliero di chiamate al modello, dichiarato nel pannello.
 * Sotto il tetto del free tier dichiarato dal provider: margine per
 * riprovi e per altri usi, senza avvicinarsi al limite.
 */
export const CONTEXT_DAILY_LIMIT = 50;

/** Timeout della chiamata al modello: oltre, il contesto non c'è. */
export const CONTEXT_TIMEOUT_MS = 8000;

/** Lunghezza massima accettata per un campo, oltre la quale si respinge. */
const FIELD_MAX_LENGTH = 300;

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return null;
  if (trimmed.length > FIELD_MAX_LENGTH) return null;
  return trimmed;
}

/**
 * Valida e normalizza la risposta del modello.
 *
 * Rigetta tutto — `null` — se un solo campo manca, è vuoto, è troppo
 * lungo o l'accordo non è uno dei tre valori ammessi: meglio nessun
 * contesto che un contesto mezzo inventato dal parsing. Nessun campo
 * viene completato per deduzione.
 */
export function parseContextFields(payload: unknown): ContextFields | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  const livelloCategorie = cleanText(p.livello_categorie);
  const anomaliaCampo = cleanText(p.anomalia_campo);
  const postaInPalo = cleanText(p.posta_in_palo);
  const rotazioniFatica = cleanText(p.rotazioni_fatica);
  const accordoRaw = cleanText(p.accordo_col_drop);

  if (
    livelloCategorie === null ||
    anomaliaCampo === null ||
    postaInPalo === null ||
    rotazioniFatica === null ||
    accordoRaw === null
  ) {
    return null;
  }

  /* l'accordo è una classificazione chiusa: nessuna sinonimia a occhio */
  const accordo = ACCORDO_VALUES.find((v) => v.toLowerCase() === accordoRaw.toLowerCase());
  if (accordo === undefined) return null;

  return {
    livelloCategorie,
    anomaliaCampo,
    postaInPalo,
    rotazioniFatica,
    accordoColDrop: accordo,
  };
}

/** true se la riga di cache copre l'istante richiesto. */
export function isContextFresh(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() > now.getTime();
}

/** true se il tetto giornaliero è stato raggiunto (hard-stop dichiarato). */
export function isDailyBudgetExhausted(usedToday: number): boolean {
  return usedToday >= CONTEXT_DAILY_LIMIT;
}

/** Chiave del contatore giornaliero in `system_state`, per data italiana. */
export function dailyUsageKey(now: Date): string {
  const romeDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `context:daily:${romeDay}`;
}
