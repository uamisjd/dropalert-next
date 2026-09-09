/**
 * POST /api/jobs/capture-odds — porta in archivio la prossima partita di una
 * lega SERVITA da The Odds API, per chiudere il vero `SMOKE OK`.
 *
 * Perché esiste: la scheda `smoke:odds-api` legge una partita dall'ARCHIVIO
 * (serve un `match_id` in `matches`). The Odds API (piano gratuito) espone
 * eventi solo per alcune leghe (verificato: Serie A → 20 eventi, 0 crediti;
 * MLS → HTTP 404 perché non servito dal piano). Questa rotta prende un evento
 * reale di una lega servita e lo scrive in archivio, così il percorso di
 * produzione (mappa → confronto eventi → lettura reale) può chiudersi.
 *
 * NON è un'attivazione: `ADAPTER_IMPLEMENTED` resta `false`; è un inserimento
 * manuale di verifica, come da dottrina.
 *
 * Corpo (JSON, tutto opzionale):
 *   {
 *     "sportKey": "soccer_italy_serie_a"   // default Serie A
 *   }
 *
 * Autorizzazione: come `/api/jobs/analyze`, in produzione va protetta da
 * `JOBS_TOKEN` (header `x-jobs-token`). Senza `JOBS_TOKEN` risponde solo
 * fuori da NODE_ENV=production.
 *
 * Costo: 0 crediti (endpoint eventi gratuito). La lettura vera (1 credito)
 * resta un passo esplicito dello smoke, non di questa rotta.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readOddsApiKey } from "@/lib/providers/optional/odds-api-budget";
import { fetchOddsApiEvents } from "@/lib/providers/optional/the-odds-api-events";
import { captureLeagueFor } from "@/lib/providers/optional/odds-capture-league";
import { ingestOddsEvent } from "@/lib/providers/optional/ingest-odds-event";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sportKey: z.string().trim().min(1).default("soccer_italy_serie_a"),
});

/** Verifica l'autorizzazione del job (stesso pattern di /api/jobs/analyze). */
function authorize(request: Request): { ok: boolean; reason?: string } {
  const token = process.env.JOBS_TOKEN;
  if (token) {
    const provided = request.headers.get("x-jobs-token");
    if (provided !== token) {
      return { ok: false, reason: "token non valido" };
    }
    return { ok: true };
  }
  if (process.env.NODE_ENV === "production") {
    return {
      ok: false,
      reason: "JOBS_TOKEN non configurato: la rotta è disabilitata in produzione.",
    };
  }
  return { ok: true };
}

/** Stato HTTP e messaggio onesti per un esito della fonte non `ok`. */
function upstreamStatus(
  outcome: { result: { ok: boolean; error?: { kind: string; httpStatus?: number; message: string } } },
): { status: number; error: string } {
  const err = outcome.result.error;
  if (!err) return { status: 502, error: "La fonte non ha restituito un esito valido." };
  if (err.kind === "blocked") return { status: 403, error: err.message };
  if (err.kind === "rate_limited") return { status: 429, error: err.message };
  if (err.kind === "http" && err.httpStatus === 404) {
    return {
      status: 502,
      error: `${err.message} Lo sport potrebbe non essere disponibile sul tuo piano (The Odds API usa 404 apposta in quel caso).`,
    };
  }
  return { status: 502, error: err.message };
}

export async function POST(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "non autorizzato", detail: auth.reason }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const rawBody = await request.text();
    const parsed = bodySchema.safeParse(rawBody ? JSON.parse(rawBody) : {});
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "corpo della richiesta non valido",
          details: parsed.error.issues.map((i) => i.message),
        },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  const sportKey = body.sportKey;

  const apiKey = readOddsApiKey();
  if (apiKey === null) {
    return NextResponse.json(
      {
        error: "Chiave The Odds API non configurata",
        detail: "Imposta la chiave nell'ambiente (vedi docs/SMOKE-THE-ODDS-API.md). 0 crediti spesi.",
      },
      { status: 503 },
    );
  }

  const league = captureLeagueFor(sportKey);
  if (league === null) {
    return NextResponse.json(
      {
        error: `Cattura non dichiarata possibile per "${sportKey}"`,
        detail:
          "La lega non è nella base di cattura (o non è servita dal piano). Aggiungila a CAPTURABLE solo con dati verificati. 0 crediti spesi.",
      },
      { status: 400 },
    );
  }

  const outcome = await fetchOddsApiEvents({ sportKey, apiKey });
  if (!outcome.result.ok) {
    const { status, error } = upstreamStatus(outcome);
    return NextResponse.json(
      {
        error: "Cattura non eseguita",
        detail: error,
        creditsUsed: outcome.creditsUsed,
        creditsRemaining: outcome.creditsRemaining,
      },
      { status },
    );
  }

  const events = outcome.result.data;
  const now = new Date();
  const upcoming = events
    .filter((e) => e.commenceTime.getTime() > now.getTime())
    .sort((a, b) => a.commenceTime.getTime() - b.commenceTime.getTime());

  if (upcoming.length === 0) {
    return NextResponse.json(
      {
        error: "Nessun evento in programma",
        detail: `La fonte non pubblica partite future per "${sportKey}" adesso. 0 crediti spesi.`,
        events: events.length,
        creditsUsed: outcome.creditsUsed,
        creditsRemaining: outcome.creditsRemaining,
      },
      { status: 404 },
    );
  }

  const event = upcoming[0];
  const ingested = await ingestOddsEvent(event, league);

  return NextResponse.json(
    {
      ok: true,
      matchId: ingested.matchId,
      matchKey: ingested.matchKey,
      created: ingested.created,
      sportKey,
      league: { name: league.leagueRaw, country: league.countryRaw, slug: `${league.countrySlug}/${league.leagueSlug}` },
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      kickoffAt: event.commenceTime.toISOString(),
      eventsFetched: events.length,
      creditsUsed: outcome.creditsUsed,
      creditsRemaining: outcome.creditsRemaining,
      hint: `Ora puoi chiudere lo smoke con: which=smoke-odds, match_id=${ingested.matchId}, sport_key=${sportKey}`,
      note: "Partita portata in archivio per verifica manuale. L'adapter resta OFF (ADAPTER_IMPLEMENTED=false). Nessuna vincita garantita.",
      generatedAt: new Date().toISOString(),
    },
    { status: 201 },
  );
}

/** GET: nessuna esecuzione, solo la spiegazione d'uso. */
export async function GET() {
  return NextResponse.json(
    {
      error: "metodo non consentito",
      detail: "Usare POST con {\"sportKey\": \"soccer_italy_serie_a\"} per catturare la prossima partita servita.",
      note: "La cattura è gratuita (endpoint eventi, 0 crediti). La lettura vera (1 credito) resta uno step esplicito dello smoke: which=smoke-odds, match_id=<id>. Vedi docs/SMOKE-THE-ODDS-API.md.",
    },
    { status: 405 },
  );
}
