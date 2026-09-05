/**
 * GET /api/signals — elenco dei segnali osservati.
 *
 * Filtri (query string):
 *   status      lista separata da virgole (forming,active,rebounded,closed,expired)
 *   minScore    punteggio di fiducia minimo (0-100)
 *   market      1x2 | ou_2_5 | btts
 *   magnitude   noise,moderate,high,very_high
 *   demo        "1" per includere le fixture dimostrative (escluse di default)
 *   limit       max 200, default 50
 *   offset      default 0
 *
 * I dati dimostrativi sono esclusi salvo richiesta esplicita e restano
 * marcati con `match.isDemo` in ogni risposta.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { listSignals } from "@/lib/repo/signals";

export const dynamic = "force-dynamic";

const statusValues = [
  "forming",
  "active",
  "rebounded",
  "closed",
  "expired",
] as const;
const magnitudeValues = ["noise", "moderate", "high", "very_high"] as const;
const marketValues = ["1x2", "ou_2_5", "btts"] as const;

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(z.enum(values)).nonempty().optional());

const querySchema = z.object({
  status: csv(statusValues),
  magnitude: csv(magnitudeValues),
  market: z.enum(marketValues).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  demo: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "parametri non validi",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const q = parsed.data;

  try {
    const { items, total } = await listSignals({
      status: q.status,
      magnitude: q.magnitude,
      market: q.market,
      minConfidence: q.minScore,
      includeDemo: q.demo,
      limit: q.limit,
      offset: q.offset,
    });

    return NextResponse.json({
      items,
      pagination: {
        total,
        limit: q.limit,
        offset: q.offset,
        hasMore: q.offset + items.length < total,
      },
      meta: {
        includesDemoData: q.demo,
        note: q.demo
          ? "La risposta include fixture dimostrative marcate con match.isDemo = true. Non sono dati reali di mercato."
          : "Sono esclusi i dati dimostrativi. Osservatorio statistico: nessun contenuto è un consiglio di scommessa.",
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    /* il dettaglio resta nei log del server: la risposta non espone mai
       l'SQL o i messaggi interni del driver al client */
    console.error(
      "[api/signals] lettura fallita:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      {
        error: "errore nel recupero dei segnali",
        detail: "Lettura non riuscita. Il dettaglio è registrato nei log del server.",
      },
      { status: 500 },
    );
  }
}
