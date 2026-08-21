/**
 * Chiamata al modello linguistico per il Contesto 360°, con ricerca attiva.
 *
 * Provider: Google Gemini, chiave `LLM_API_KEY`. Modello flash-lite, scelto
 * per latenza: il contesto deve arrivare in un paio di secondi o dichiarare
 * che non arriva.
 *
 * RICERCA ATTIVA (grounding): la chiamata chiede lo strumento Google Search
 * e ogni campo può citare la fonte che lo sostiene. Limite dichiarato e
 * verificato il 21/08/2026: il grounding NON è nel free tier — con una
 * chiave gratuita la richiesta con strumenti risponde 429 «exceeded your
 * current quota». Perciò: primo tentativo CON ricerca; se la chiave non la
 * consente, si ripete UNA volta senza strumenti e tutto il contesto viaggia
 * taggato «conoscenza modello, da verificare». Con una chiave a billing
 * attivo il grounding si accende da solo, senza toccare il codice.
 *
 * Nessun tentativo oltre il timeout: scaduto il termine, il contesto è
 * «non disponibile» e lo si dichiara — mai inventato.
 */
import {
  CONTEXT_TIMEOUT_MS,
  capSources,
  parseContextDetail,
  parseContextFields,
  type ContextDetail,
  type ContextFields,
} from "./pure";

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
  /** documenti recuperati in casa (Wikipedia, feed): la ricerca che la chiave gratuita può permettersi */
  retrievedDocs?: Array<{ titolo: string; stralcio: string; url: string }>;
}

export interface ContextGeneration {
  ok: boolean;
  /** campi v1, sempre compilati quando ok (retrocompatibilità di registro) */
  fields: ContextFields;
  /** struttura v2 con fonti per campo e fonti consultate */
  detail: ContextDetail;
  model: string;
  reason?: "chiave_assente" | "timeout" | "risposta_invalida" | "errore";
}

function buildPrompt(input: ContextRequestInput): string {
  return [
    "Sei un assistente di un osservatorio statistico sui movimenti delle quote del calcio.",
    "Prepari CONTESTO informativo, mai pronostici, mai consigli di scommessa.",
    "Usa la ricerca per trovare dati reali e verifica ciò che sai.",
    "Dati della partita:",
    `- competizione: ${input.league ?? "non nota"}${input.country ? ` (${input.country})` : ""}`,
    `- partita: ${input.homeTeam} contro ${input.awayTeam}`,
    `- calcio d'inizio: ${input.kickoffAt}`,
    `- movimento osservato sul mercato 1X2: ${input.dropSummary}`,
    "",
    ...(input.retrievedDocs !== undefined && input.retrievedDocs.length > 0
      ? [
          "FONTI RECUPERATE (le uniche che puoi citare in fonte_url):",
          ...input.retrievedDocs.map(
            (d, i) => `${i + 1}. ${d.titolo} — ${d.stralcio} — URL: ${d.url}`,
          ),
          "",
        ]
      : []),
    "Rispondi SOLO con un oggetto JSON con esattamente queste chiavi.",
    "I primi cinque campi sono oggetti {\"valore\": string, \"fonte_url\": string}:",
    "- livello_categorie: livello delle categorie in gara (es. \"prima serie contro seconda serie\")",
    "- anomalia_campo: campo neutro, stadio invertito o condiviso",
    "- posta_in_palo: la fase PRECISA della competizione e la posta (es. \"semifinale playoff scudetto\", \"salvezza a tre giornate dalla fine\", \"passaggio del turno in coppa\")",
    "- rotazioni_fatica: rotazioni o fatica attese legate al calendario",
    "- h2h_e_forma_recente: scontri diretti e ultimi risultati delle due squadre, con date se noti",
    'Il sesto campo è una stringa: accordo_col_drop, esattamente uno fra "sostiene", "contraddice", "non c\'entra",',
    "  sul se questo contesto sostiene, contraddice o non c'entra col movimento di quota osservato sopra.",
    "Regole: ogni valore in italiano, massimo 30 parole. fonte_url può contenere SOLO uno",
    "degli URL delle fonti recuperate elencate sopra (o della ricerca, se attiva): mettilo",
    "quando un campo deriva da quella fonte, stringa vuota altrimenti. Se il dato non è",
    'noto: valore "non noto" e fonte_url vuota. Non inventare URL.',
  ].join("\n");
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
}

/**
 * Una singola chiamata al modello, con o senza ricerca.
 * Restituisce gli esiti grezzi: chi chiama decide le politiche.
 */
async function callOnce(
  input: ContextRequestInput,
  apiKey: string,
  withSearch: boolean,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; body: GeminiResponse } | { ok: false; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTEXT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(input) }] }],
        ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 900,
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, body: (await response.json()) as GeminiResponse };
  } finally {
    clearTimeout(timer);
  }
}

function extractText(body: GeminiResponse): string {
  return (body.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => p.thought !== true && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

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

/**
 * Genera il contesto. Prima CON ricerca; se la chiave non la copre (429 di
 * quota, il caso del free tier dichiarato) ripete UNA volta senza. Nessuna
 * eccezione attraversa il confine.
 */
export async function generateMatchContext(
  input: ContextRequestInput,
  options: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<ContextGeneration> {
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    return { ok: false, reason: "chiave_assente", fields: nullFields(), detail: emptyDetail(), model: CONTEXT_MODEL };
  }
  const doFetch = options.fetchImpl ?? fetch;

  for (const withSearch of [true, false]) {
    let outcome: Awaited<ReturnType<typeof callOnce>>;
    try {
      outcome = await callOnce(input, apiKey, withSearch, doFetch);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, reason: "timeout", fields: nullFields(), detail: emptyDetail(), model: CONTEXT_MODEL };
      }
      return { ok: false, reason: "errore", fields: nullFields(), detail: emptyDetail(), model: CONTEXT_MODEL };
    }

    if (!outcome.ok) {
      /* 429 con la ricerca accesa = chiave senza grounding (free tier):
         si dichiara e si ripete senza. Gli altri errori non si riprovano
         con la ricerca spenta: 403/404 dicono altro */
      if (withSearch && outcome.status === 429) continue;
      return { ok: false, reason: "errore", fields: nullFields(), detail: emptyDetail(), model: CONTEXT_MODEL };
    }

    const grounded =
      withSearch &&
      (outcome.body.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0) > 0;

    const text = extractText(outcome.body);
    if (text.trim() === "") continue;

    const payload = extractJson(text);
    if (payload === null) continue;

    const allowedUrls = (input.retrievedDocs ?? []).map((d) => d.url);
    const detail = parseContextDetail(payload, grounded, allowedUrls);
    if (detail === null) continue;

    /* Fonti consultate: prima quelle del grounding Google (se la chiave
       lo consente), poi i documenti recuperati in casa. Mai oltre tre. */
    const googleSources = grounded
      ? capSources(
          (outcome.body.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
            .map((c) => ({ uri: c.web?.uri, title: c.web?.title })),
        )
      : [];
    const retrievedSources = capSources(
      (input.retrievedDocs ?? []).map((d) => ({ uri: d.url, title: d.titolo })),
    );
    const seen = new Set<string>();
    const sources = [...googleSources, ...retrievedSources]
      .filter((x) => {
        if (seen.has(x.uri)) return false;
        seen.add(x.uri);
        return true;
      })
      .slice(0, 3);
    detail.sources = sources;

    /* i campi v1 restano compilati per le colonne di registro e le card */
    const legacy = parseContextFields({
      livello_categorie: fieldValue(detail, "livello_categorie"),
      anomalia_campo: fieldValue(detail, "anomalia_campo"),
      posta_in_palo: fieldValue(detail, "posta_in_palo"),
      rotazioni_fatica: fieldValue(detail, "rotazioni_fatica"),
      accordo_col_drop: fieldValue(detail, "accordo_col_drop"),
    });
    if (legacy === null) continue;

    return { ok: true, fields: legacy, detail, model: CONTEXT_MODEL };
  }

  return {
    ok: false,
    reason: "risposta_invalida",
    fields: nullFields(),
    detail: emptyDetail(),
    model: CONTEXT_MODEL,
  };
}

function fieldValue(detail: ContextDetail, key: string): string {
  return detail.fields.find((f) => f.key === key)?.valore ?? "";
}

function nullFields(): ContextFields {
  return {
    livelloCategorie: "",
    anomaliaCampo: "",
    postaInPalo: "",
    rotazioniFatica: "",
    accordoColDrop: "non c'entra",
  };
}

function emptyDetail(): ContextDetail {
  return { grounded: false, retrieved: false, fields: [], sources: [] };
}
