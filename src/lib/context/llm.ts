/**
 * Chiamata al modello linguistico per il Contesto 360°.
 *
 * Provider: Google Gemini (free tier), chiave nella variabile d'ambiente
 * `LLM_API_KEY`. Modello dichiarato qui sotto: cambia il modello, cambia
 * la "conoscenza modello" che dichiariamo accanto ai campi.
 *
 * Nessun tentativo oltre il timeout: scaduto il termine, il contesto è
 * "non disponibile" e lo si dichiara — mai inventato, mai riprovato in
 * loop durante la stessa richiesta.
 */
import {
  CONTEXT_TIMEOUT_MS,
  parseContextFields,
  type ContextFields,
} from "./pure";

/**
 * Modello dichiarato: flash-lite, scelto per latenza e non per qualità
 * massima — il contesto deve arrivare in un paio di secondi o non arrivare.
 */
export const CONTEXT_MODEL = "gemini-3.5-flash-lite";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${CONTEXT_MODEL}:generateContent`;

export interface ContextRequestInput {
  homeTeam: string;
  awayTeam: string;
  league: string | null;
  country: string | null;
  kickoffAt: string;
  /** descrizione breve del movimento osservato, per la domanda d'accordo */
  dropSummary: string;
}

export type ContextGeneration =
  | { ok: true; fields: ContextFields; model: string }
  | { ok: false; reason: "chiave_assente" | "timeout" | "risposta_invalida" | "errore" };

/** Prompt in italiano, con i cinque campi obbligatori e la classificazione chiusa. */
function buildPrompt(input: ContextRequestInput): string {
  return [
    "Sei un assistente di un osservatorio statistico sui movimenti delle quote del calcio.",
    "Prepari CONTESTO informativo, mai pronostici, mai consigli di scommessa.",
    "Dati della partita:",
    `- competizione: ${input.league ?? "non nota"}${input.country ? ` (${input.country})` : ""}`,
    `- partita: ${input.homeTeam} contro ${input.awayTeam}`,
    `- calcio d'inizio: ${input.kickoffAt}`,
    `- movimento osservato sul mercato 1X2: ${input.dropSummary}`,
    "",
    "Rispondi SOLO con un oggetto JSON con esattamente queste chiavi:",
    "- livello_categorie: livello delle categorie in gara (es. \"prima serie contro seconda serie\"), se noto, altrimenti \"non noto\"",
    "- anomalia_campo: campo neutro, stadio invertito o condiviso, se noto, altrimenti \"non noto\"",
    "- posta_in_palo: importanza della competizione per le squadre (passaggio del turno, salvezza, fine stagione), se nota",
    "- rotazioni_fatica: rotazioni o fatica attese legate al calendario, se note",
    "- accordo_col_drop: esattamente uno fra \"sostiene\", \"contraddice\", \"non c'entra\" —",
    "  dice se il contesto sostiene, contraddice o non c'entra col movimento di quota osservato sopra.",
    "Ogni valore in italiano, massimo 25 parole, senza inventare fatti: se il modello non lo sa, scrive \"non noto\".",
  ].join("\n");
}

/**
 * Genera il contesto. Restituisce sempre un esito esplicito: nessuna
 * eccezione attraversa il confine, chi chiama dichiara lo stato.
 */
export async function generateMatchContext(
  input: ContextRequestInput,
  options: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<ContextGeneration> {
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    return { ok: false, reason: "chiave_assente" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTEXT_TIMEOUT_MS);

  try {
    const doFetch = options.fetchImpl ?? fetch;
    const response = await doFetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(input) }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 400,
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: "errore" };
    }

    const data: unknown = await response.json();
    const candidates =
      typeof data === "object" && data !== null
        ? (data as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string; thought?: boolean }> };
            }>;
          }).candidates
        : undefined;

    /* il modello a volte antepone pezzi di ragionamento: si uniscono i
       soli frammenti che non sono pensieri, e si cerca l'oggetto JSON */
    const text =
      (candidates?.[0]?.content?.parts ?? [])
        .filter((p) => p.thought !== true && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n") ?? "";
    if (text.trim() === "") return { ok: false, reason: "risposta_invalida" };

    const payload: unknown = extractJson(text);
    const fields = parseContextFields(payload);
    if (fields === null) return { ok: false, reason: "risposta_invalida" };

    return { ok: true, fields, model: CONTEXT_MODEL };
  } catch (err) {
    /* l'abort del timer è l'unico caso che si chiama timeout: tutto il
       resto è un errore, dichiarato per ciò che è */
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "errore" };
  } finally {
    clearTimeout(timer);
  }
}

/** Il primo oggetto JSON valido nel testo, o null. Mai interpretazioni. */
function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match === null) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
