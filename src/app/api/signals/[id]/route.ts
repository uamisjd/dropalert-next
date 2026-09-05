/**
 * GET /api/signals/[id] — dettaglio di un singolo segnale.
 *
 * Restituisce i cinque criteri di credibilità, la spiegazione strutturata,
 * la cronologia degli eventi, il CLV se calcolato e i buchi dati noti della
 * partita. I dati mancanti sono dichiarati, mai colmati con stime.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSignalDetail } from "@/lib/repo/signals";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const raw = await context.params;
  const parsed = paramsSchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "identificativo non valido" },
      { status: 400 },
    );
  }

  try {
    const detail = await getSignalDetail(parsed.data.id);

    if (!detail) {
      return NextResponse.json(
        { error: "segnale non trovato", id: parsed.data.id },
        { status: 404 },
      );
    }

    return NextResponse.json({
      signal: detail,
      meta: {
        isDemoData: detail.match.isDemo,
        note: detail.match.isDemo
          ? "Fixture dimostrativa: non è un dato reale di mercato."
          : "Osservatorio statistico: descrizione di un movimento osservato, non un consiglio di scommessa.",
        clvAvailable: detail.clv !== null,
        clvNote:
          detail.clv === null
            ? "CLV non ancora calcolabile: la linea di chiusura non è stata acquisita."
            : "CLV calcolato sul prezzo congelato al rilevamento contro la chiusura di consenso.",
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    /* il dettaglio resta nei log del server: la risposta non espone mai
       l'SQL o i messaggi interni del driver al client */
    console.error(
      "[api/signals/[id]] lettura fallita:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      {
        error: "errore nel recupero del segnale",
        detail: "Lettura non riuscita. Il dettaglio è registrato nei log del server.",
      },
      { status: 500 },
    );
  }
}
