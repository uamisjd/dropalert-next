/**
 * Fonte SECONDARIA dei risultati (Sprint FIX-2, punto 2).
 *
 * Perché esiste: la fonte primaria a volte non pubblica il punteggio finale,
 * e la partita resta a registro con «risultato non ancora pubblicato dalla
 * fonte». Non è un errore nostro, ma è un buco che una fonte gratuita può
 * colmare.
 *
 * Fonte scelta: TheSportsDB (free tier, chiave di prova pubblica `3`,
 * sovrascrivibile con `SPORTSDB_API_KEY`). Nessun costo, nessun contratto,
 * nessuna carta.
 *
 * Regole non negoziabili:
 *  - si interroga SOLO per partite il cui risultato manca davvero;
 *  - il punteggio si accetta solo se la partita combacia per squadre E per
 *    giorno: un evento «simile» non è la nostra partita;
 *  - l'origine viaggia col dato: chi legge vede «risultato da fonte
 *    secondaria (TheSportsDB)», mai un punteggio senza provenienza;
 *  - se nemmeno la secondaria lo ha, resta «non pubblicato». Mai un esito
 *    inventato, mai uno 0-0 di comodo.
 *
 * Le parti decisionali sono pure e testabili senza rete.
 */

/** Etichetta della fonte, dichiarata ovunque compaia un risultato suo. */
export const SECONDARY_SOURCE_NAME = "TheSportsDB";

/** Frase unica usata dalla UI. */
export const SECONDARY_SOURCE_NOTE = `risultato da fonte secondaria (${SECONDARY_SOURCE_NAME})`;

const TIMEOUT_MS = 6_000;
const ROME = "Europe/Rome";

const romeDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: ROME,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Nome normalizzato: due fonti scrivono la stessa squadra in modi diversi. */
export function normTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|afc|sc|ac|as|ss|us|cd|ca|club|calcio|football)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export interface SecondaryResult {
  homeGoals: number;
  awayGoals: number;
  source: string;
}

interface SportsDbEvent {
  strHomeTeam?: unknown;
  strAwayTeam?: unknown;
  intHomeScore?: unknown;
  intAwayScore?: unknown;
  dateEvent?: unknown;
}

function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Sceglie fra gli eventi restituiti quello che è DAVVERO la nostra partita.
 *
 * Deve combaciare la coppia di squadre (in un verso o nell'altro) e il giorno
 * civile del calcio d'inizio. Senza entrambe le condizioni si restituisce
 * `null`: meglio nessun risultato che il risultato di un'altra partita.
 */
export function pickMatchingEvent(
  events: unknown,
  homeTeam: string,
  awayTeam: string,
  kickoffAt: Date,
): SecondaryResult | null {
  if (!Array.isArray(events)) return null;
  const h = normTeam(homeTeam);
  const a = normTeam(awayTeam);
  const giorno = romeDay.format(kickoffAt);

  for (const raw of events) {
    if (typeof raw !== "object" || raw === null) continue;
    const e = raw as SportsDbEvent;
    const eh = typeof e.strHomeTeam === "string" ? normTeam(e.strHomeTeam) : "";
    const ea = typeof e.strAwayTeam === "string" ? normTeam(e.strAwayTeam) : "";
    if (eh === "" || ea === "") continue;

    const combaciaDiretto =
      (eh.includes(h) || h.includes(eh)) && (ea.includes(a) || a.includes(ea));
    if (!combaciaDiretto) continue;

    /* il giorno deve corrispondere: la stessa coppia si affronta più volte */
    if (typeof e.dateEvent === "string" && e.dateEvent.trim() !== "") {
      const d = new Date(`${e.dateEvent}T12:00:00Z`);
      if (Number.isFinite(d.getTime())) {
        const diff = Math.abs(
          Date.parse(`${romeDay.format(d)}T00:00:00Z`) -
            Date.parse(`${giorno}T00:00:00Z`),
        );
        /* si tollera un giorno: le fonti datano diversamente le notturne */
        if (diff > 86_400_000) continue;
      }
    }

    const hg = intOrNull(e.intHomeScore);
    const ag = intOrNull(e.intAwayScore);
    /* punteggio assente = partita non ancora refertata: non è uno 0-0 */
    if (hg === null || ag === null) continue;

    return { homeGoals: hg, awayGoals: ag, source: SECONDARY_SOURCE_NAME };
  }
  return null;
}

export type SecondaryOutcome =
  | { ok: true; result: SecondaryResult }
  | { ok: false; reason: "non_pubblicato" | "irraggiungibile" };

/**
 * Chiede alla fonte secondaria il risultato di UNA partita.
 * Nessuna eccezione esce da qui: al peggio «non pubblicato».
 */
export async function fetchSecondaryResult(
  params: { homeTeam: string; awayTeam: string; kickoffAt: Date },
  options: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<SecondaryOutcome> {
  const key = options.apiKey ?? process.env.SPORTSDB_API_KEY ?? "3";
  const doFetch = options.fetchImpl ?? fetch;
  const giorno = romeDay.format(params.kickoffAt);
  const url = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(
    key,
  )}/eventsday.php?d=${giorno}&s=Soccer`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      headers: { "user-agent": "DropAlert/1.0 (osservatorio statistico)" },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: "irraggiungibile" };
    const body = (await res.json()) as { events?: unknown };
    const trovato = pickMatchingEvent(
      body.events,
      params.homeTeam,
      params.awayTeam,
      params.kickoffAt,
    );
    return trovato === null
      ? { ok: false, reason: "non_pubblicato" }
      : { ok: true, result: trovato };
  } catch {
    return { ok: false, reason: "irraggiungibile" };
  } finally {
    clearTimeout(timer);
  }
}
