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
import { sportKeyFor } from "@/lib/providers/optional/sport-keys";

/** Dicitura fissa in testa al blocco, ovunque il contesto compaia. */
export const CONTEXT_DISCLAIMER =
  "Contesto generato automaticamente: non è un pronostico né una garanzia.";

/** Tag che accompagna ogni campo privo di fonte recuperata. */
export const MODEL_KNOWLEDGE_TAG = "conoscenza modello, da verificare";

/** Valori ammessi per l'accordo col movimento osservato. */
export const ACCORDO_VALUES = ["sostiene", "contraddice", "non c'entra"] as const;
export type AccordoValue = (typeof ACCORDO_VALUES)[number];

/** I cinque campi obbligatori del contesto (v1, colonne di registro). */
export interface ContextFields {
  livelloCategorie: string;
  anomaliaCampo: string;
  postaInPalo: string;
  rotazioniFatica: string;
  accordoColDrop: AccordoValue;
}

/* ------------------------------------------------------------------ */
/* v2 — contesto con ricerca attiva (grounding)                        */
/* ------------------------------------------------------------------ */

/** Le sei chiavi del payload v2. */
export const CONTEXT_FIELD_KEYS = [
  "livello_categorie",
  "anomalia_campo",
  "posta_in_palo",
  "rotazioni_fatica",
  "h2h_e_forma_recente",
  "forma_recente_5",
  "assenze_note",
  "accordo_col_drop",
] as const;
export type ContextFieldKey = (typeof CONTEXT_FIELD_KEYS)[number];

/** Una fonte recuperata dalla ricerca: link e titolo, quando c'è. */
export interface RetrievedSource {
  uri: string;
  title: string | null;
}

/** Un campo v2: il valore e la FONTE che lo sostiene, se recuperata. */
export interface ContextFieldDetail {
  key: ContextFieldKey;
  valore: string;
  /** null = nessuna fonte: il campo viaggia come conoscenza modello */
  fonteUrl: string | null;
  fonteTitolo: string | null;
}

export interface ContextDetail {
  /** true se il grounding Google ha contribuito (chiave a billing) */
  grounded: boolean;
  /** true se la generazione ha usato documenti recuperati in casa */
  retrieved: boolean;
  fields: ContextFieldDetail[];
  /** fonti consultate, al massimo tre */
  sources: RetrievedSource[];
  /** chi ha alimentato la ricerca: "Tavily" | "Wikipedia" | "Google" | null */
  searchProvider: string | null;
}

/** Massimo fonti mostrate nel blocco. */
export const MAX_CONTEXT_SOURCES = 3;

/**
 * Versione della pipeline di retrieval. Bump = invalida la cache al deploy:
 * le righe con versione diversa si rigenerano al primo render. Serve a non
 * mostrare contesti nati con fonti vecchie (es. pre-Tavily).
 */
export const CONTEXT_RETRIEVAL_VERSION = 7;

function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  return t.slice(0, 500);
}

/**
 * Valida il payload v2 con ricerca attiva.
 *
 * Regola dei tag, applicata QUI e non nella UI: una fonte si accetta solo
 * se l'URL è un http(s) serio E è davvero fra le fonti messe sul tavolo —
 * gli URL del grounding Google o i documenti recuperati in casa (Wikipedia
 * e feed). Qualunque altro link si butta via: il campo torna "conoscenza
 * modello, da verificare". Mai un link di facciata, mai un URL sentito
 * dire dal modello.
 *
 * Rigetta tutto se un campo manca, è vuoto, supera i 300 caratteri o
 * l'accordo non è uno dei tre valori ammessi.
 */
export function parseContextDetail(
  payload: unknown,
  grounded: boolean,
  allowedUrls: string[] = [],
): ContextDetail | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  const fields: ContextFieldDetail[] = [];
  for (const key of CONTEXT_FIELD_KEYS) {
    if (key === "accordo_col_drop") continue;
    const raw = p[key];
    const valore =
      typeof raw === "object" && raw !== null
        ? cleanTextLoose((raw as Record<string, unknown>).valore)
        : cleanTextLoose(raw);
    if (valore === null) return null;

    const candidata =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>).fonte_url
        : null;
    const pulita = cleanUrl(candidata);
    const fonteUrl =
      pulita !== null && (grounded || allowedUrls.includes(pulita))
        ? pulita
        : null;
    const fonteTitolo =
      typeof raw === "object" && raw !== null &&
      typeof (raw as Record<string, unknown>).fonte_titolo === "string"
        ? ((raw as Record<string, unknown>).fonte_titolo as string).slice(0, 120)
        : null;

    fields.push({ key, valore, fonteUrl, fonteTitolo });
  }

  const accordoRaw = cleanTextLoose(p.accordo_col_drop);
  if (accordoRaw === null) return null;
  const accordo = ACCORDO_VALUES.find(
    (v) => v.toLowerCase() === accordoRaw.toLowerCase(),
  );
  if (accordo === undefined) return null;
  fields.push({ key: "accordo_col_drop", valore: accordo, fonteUrl: null, fonteTitolo: null });

  return {
    grounded,
    retrieved: allowedUrls.length > 0,
    fields,
    sources: [],
    searchProvider: null,
  };
}

/** Come cleanText ma esposto per il v2. */
function cleanTextLoose(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > 300) return null;
  return trimmed;
}

/** Le fonti del grounding, al massimo tre, deduplicate per URI. */
export function capSources(
  chunks: Array<{ uri?: unknown; title?: unknown }>,
): RetrievedSource[] {
  const seen = new Set<string>();
  const out: RetrievedSource[] = [];
  for (const c of chunks) {
    const uri = cleanUrl(c.uri);
    if (uri === null || seen.has(uri)) continue;
    seen.add(uri);
    out.push({
      uri,
      title: typeof c.title === "string" ? c.title.slice(0, 120) : null,
    });
    if (out.length >= MAX_CONTEXT_SOURCES) break;
  }
  return out;
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

/* ------------------------------------------------------------------ */
/* Copertura informativa della competizione                            */
/* ------------------------------------------------------------------ */

/** Nomi che dichiarano una competizione femminile (o il tag «W»/«WSL»). */
const WOMEN_COMPETITION_HINT =
  /(\bwomen\b|\bfemminile\b|\bwsl\b|(?:^|[\s\-–—])w(?:[\s\-–—]|$))/i;

/**
 * true se la competizione è a bassa copertura informativa per il contesto.
 *
 * È una DICHIARAZIONE, non un dato: per le femminili e per i tornei minori
 * le fonti pubbliche esistono meno, quindi è normale che il modello
 * risponda «non noto» su più campi. Lo si dice in testa al blocco, così chi
 * legge si aspetta meno contenuti invece di percepire la scheda come rotta.
 *
 * Per la «lista coperta dalla linea sharp» si usa la stessa mappa del
 * budget Odds API (`sportKeyFor`): un campionato minore o un femminile non
 * sono lì, e non lo sono neppure le coppe mascherate da campionato.
 */
export function isLowInformationCompetition(league: string | null): boolean {
  if (league === null) return false;
  const name = league.trim();
  if (name === "") return false;
  if (WOMEN_COMPETITION_HINT.test(name)) return true;
  return sportKeyFor(name) === null;
}
