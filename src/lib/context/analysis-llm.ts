/**
 * Chiamata al modello per l'«Analisi 360° completa».
 *
 * Stesso provider e stessa chiave del Contesto 360°, stesso timeout, stessa
 * disciplina: una sola chiamata, nessun retry in loop, nessuna eccezione
 * fuori dal modulo. Il modello scrive SOLO le parti discorsive — gli schemi
 * sono disegnati in TypeScript, dove la larghezza si può garantire.
 *
 * Se la risposta contiene una raccomandazione, `parseAnalysisProse` la
 * respinge e l'analisi non si pubblica: il divieto è nel parser, non nella
 * buona volontà del prompt.
 */
import { CONTEXT_MODEL } from "./llm";
import { CONTEXT_TIMEOUT_MS } from "./pure";
import {
  buildAnalysisPrompt,
  parseAnalysisProse,
  type AnalysisFacts,
  type AnalysisProse,
} from "./analysis";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${CONTEXT_MODEL}:generateContent`;

/** L'analisi è più lunga del contesto: il tempo concesso è doppio. */
export const ANALYSIS_TIMEOUT_MS = CONTEXT_TIMEOUT_MS * 2;

export type AnalysisOutcome =
  | { ok: true; prose: AnalysisProse; model: string }
  | {
      ok: false;
      reason: "chiave_assente" | "timeout" | "risposta_invalida" | "errore";
    };

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m === null) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

export async function generateDeepAnalysis(
  facts: AnalysisFacts,
  options: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<AnalysisOutcome> {
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    return { ok: false, reason: "chiave_assente" };
  }
  const doFetch = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
  try {
    const response = await doFetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildAnalysisPrompt(facts) }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1600,
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: "errore" };

    const body = (await response.json()) as GeminiResponse;
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => p.thought !== true && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");

    const prose = parseAnalysisProse(extractJson(text));
    if (prose === null) return { ok: false, reason: "risposta_invalida" };
    return { ok: true, prose, model: CONTEXT_MODEL };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "errore" };
  } finally {
    clearTimeout(timer);
  }
}
