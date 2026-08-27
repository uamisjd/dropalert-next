/**
 * Calendario da football-data.org (Sprint ENH-1, punto 1).
 *
 * A COSA SERVE: sapere che cosa si gioca prima che il collector abbia
 * raccolto le quote. È un RADAR, non una fonte di quote: da qui non nasce
 * nessun segnale, nessun prezzo, nessun punteggio. Le quote entrano solo
 * quando BetExplorer le raccoglie, esattamente come prima.
 *
 * BUDGET: il piano gratuito dà 10 richieste al minuto sulle competizioni
 * TIER_ONE. L'endpoint `/v4/matches?dateFrom&dateTo` restituisce in UNA
 * chiamata tutte le competizioni coperte, quindi il costo reale è UNA
 * richiesta al giorno — molto sotto il limite anche nel caso peggiore.
 * La cache di 24 ore è la seconda difesa.
 *
 * COSA NON FA: non inventa partite fuori dalle leghe coperte. Le competizioni
 * minori restano quelle dell'archivio, e la pagina lo dichiara.
 *
 * Le parti decisionali (finestra, parsing, filtro) sono pure e testabili.
 */

/** Competizioni del piano gratuito, dichiarate per la UI. */
export const COVERED_COMPETITIONS =
  "Serie A, Premier League e Championship, Liga, Bundesliga, Ligue 1, Eredivisie, Primeira Liga, Brasileirão, Champions League e grandi tornei per nazionali";

/** Cache di una lettura riuscita. */
export const CALENDAR_CACHE_HOURS = 24;

const ENDPOINT = "https://api.football-data.org/v4/matches";
const TIMEOUT_MS = 8_000;

/** Una partita del calendario: solo ciò che serve a dire «sta arrivando». */
export interface CalendarFixture {
  /** identificativo della fonte, per la deduplica */
  sourceId: number;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffAt: string;
}

const ROME = "Europe/Rome";
const romeDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: ROME,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Giorno civile italiano spostato di `offset` giorni. */
export function romeDayIso(now: Date, offset = 0): string {
  return romeDay.format(new Date(now.getTime() + offset * 86_400_000));
}

/**
 * Stati che significano «deve ancora giocarsi».
 * Una partita finita non è un radar: è archivio, e per l'archivio abbiamo
 * già le nostre pagine.
 */
const UPCOMING_STATUSES = new Set(["SCHEDULED", "TIMED"]);

interface ApiMatch {
  id?: unknown;
  utcDate?: unknown;
  status?: unknown;
  competition?: { name?: unknown };
  homeTeam?: { name?: unknown; shortName?: unknown };
  awayTeam?: { name?: unknown; shortName?: unknown };
}

function teamName(t: ApiMatch["homeTeam"]): string | null {
  const short = typeof t?.shortName === "string" ? t.shortName.trim() : "";
  const full = typeof t?.name === "string" ? t.name.trim() : "";
  const scelto = short !== "" ? short : full;
  return scelto === "" ? null : scelto;
}

/**
 * Estrae le partite ancora da giocare dalla risposta.
 * Una riga senza squadre, data o stato utile viene scartata: meglio una
 * partita in meno che una riga inventata.
 */
export function parseFixtures(payload: unknown, now: Date): CalendarFixture[] {
  if (typeof payload !== "object" || payload === null) return [];
  const matches = (payload as { matches?: unknown }).matches;
  if (!Array.isArray(matches)) return [];

  const out: CalendarFixture[] = [];
  for (const raw of matches) {
    if (typeof raw !== "object" || raw === null) continue;
    const m = raw as ApiMatch;
    if (typeof m.status !== "string" || !UPCOMING_STATUSES.has(m.status)) continue;
    if (typeof m.utcDate !== "string") continue;
    const kick = new Date(m.utcDate);
    if (!Number.isFinite(kick.getTime())) continue;
    /* il calcio d'inizio dev'essere nel futuro: «mai una partita giocata» */
    if (kick.getTime() <= now.getTime()) continue;

    const home = teamName(m.homeTeam);
    const away = teamName(m.awayTeam);
    if (home === null || away === null) continue;

    const competition =
      typeof m.competition?.name === "string" && m.competition.name.trim() !== ""
        ? m.competition.name.trim()
        : "competizione non dichiarata";

    out.push({
      sourceId: typeof m.id === "number" ? m.id : kick.getTime(),
      homeTeam: home,
      awayTeam: away,
      competition,
      kickoffAt: kick.toISOString(),
    });
  }
  return out.sort(
    (a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime(),
  );
}

/** Nome normalizzato per il confronto con l'archivio. */
export function normName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|afc|sc|ac|as|ss|us|cd|ca|club|calcio|football|bk|if)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Identità di una partita di calendario: coppia squadre + giorno italiano. */
export function fixtureKey(f: {
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
}): string {
  const pair = [normName(f.homeTeam), normName(f.awayTeam)].sort().join("|");
  return `${pair}@${romeDay.format(new Date(f.kickoffAt))}`;
}

/**
 * Toglie dal calendario le partite che il monitor già segue.
 *
 * Il confronto è sulla stessa identità usata dalla lista (coppia + giorno):
 * una partita con le quote non deve comparire due volte, una come card e una
 * come «quote in arrivo».
 */
export function withoutTracked(
  fixtures: CalendarFixture[],
  tracked: Array<{ homeTeam: string; awayTeam: string; kickoffAt: string }>,
): CalendarFixture[] {
  const noti = new Set(tracked.map(fixtureKey));
  const visti = new Set<string>();
  return fixtures.filter((f) => {
    const k = fixtureKey(f);
    if (noti.has(k) || visti.has(k)) return false;
    visti.add(k);
    return true;
  });
}

export type CalendarOutcome =
  | { ok: true; fixtures: CalendarFixture[] }
  | { ok: false; reason: string };

/**
 * UNA richiesta per la finestra richiesta: l'endpoint copre già tutte le
 * competizioni del piano. Nessuna eccezione esce da qui.
 */
export async function fetchCalendar(
  from: string,
  to: string,
  options: { fetchImpl?: typeof fetch; apiKey?: string; now?: Date } = {},
): Promise<CalendarOutcome> {
  const apiKey = options.apiKey ?? process.env.FOOTBALL_DATA_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    return { ok: false, reason: "calendario non disponibile: chiave non configurata" };
  }
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(`${ENDPOINT}?dateFrom=${from}&dateTo=${to}`, {
      headers: { "X-Auth-Token": apiKey },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        reason:
          res.status === 429
            ? "calendario non disponibile: limite di richieste della fonte"
            : `calendario non disponibile: fonte non raggiungibile (HTTP ${res.status})`,
      };
    }
    const payload: unknown = await res.json();
    return { ok: true, fixtures: parseFixtures(payload, now) };
  } catch (err) {
    const timeout = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      reason: timeout
        ? "calendario non disponibile: timeout della fonte"
        : "calendario non disponibile: errore della fonte",
    };
  } finally {
    clearTimeout(timer);
  }
}
