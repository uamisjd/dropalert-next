/**
 * Risoluzione della partita per lo smoke test live di The Odds API.
 *
 * Perché esiste questo modulo: lo smoke test (`npm run smoke:odds-api`)
 * chiedeva sei variabili d'ambiente scritte a mano, con i nomi delle squadre
 * copiati dall'API e l'orario nel formato giusto. È esattamente il tipo di
 * comando che si sbaglia senza accorgersene, e uno smoke test lanciato con un
 * nome sbagliato «fallisce» senza che la fonte abbia alcuna colpa — bruciando
 * un credito e facendo credere che l'adapter sia rotto.
 *
 * Qui sta la sola logica: prende la riga della partita dal database e dice
 * se può diventare una lettura sulla fonte, e confronta l'identità interna
 * con gli eventi pubblicati dalla fonte PRIMA di spendere un credito.
 * Nessuna chiamata di rete e nessuna scrittura in questo file.
 *
 * Regola che tiene insieme tutto: la diagnosi qui sotto deve coincidere con
 * `findEvent` di `odds-api-sharp.ts`, che è ciò che il client userà davvero.
 * Se la diagnosi dice «unico» e `findEvent` restituirebbe `null`, lo smoke
 * test fallirebbe dopo aver speso il credito. L'equivalenza è verificata dai
 * test, non promessa nei commenti.
 */
import { EVENT_TIME_TOLERANCE_MINUTES, teamNameMatches } from "./odds-api-sharp";
import { sportKeyFor } from "./sport-keys";

/** Evento così come lo espone l'endpoint `/events` della fonte. */
export interface OddsApiEventLite {
  id: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: Date;
}

/**
 * Normalizzazione dei nomi squadra.
 *
 * Serve ancora per il filtro di vuoto e per i confronti di somiglianza: la
 * regola di combaciamento con la fonte però è una sola, `teamNameMatches` di
 * `odds-api-sharp` (sottostringa sui nomi uniti oppure token contenuti), qui
 * sotto — la STESSA funzione che userà `findEvent`. Duplicarla con una grafia
 * diversa produrrebbe una diagnosi più ottimista del matching reale, che è
 * il difetto peggiore possibile in uno strumento che deve prevenire un
 * credito sprecato.
 */
export function normalizeTeamName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Identità interna della partita, come la conosciamo noi. */
export interface InternalMatchIdentity {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
}

/**
 * Esito del confronto fra la nostra partita e l'elenco della fonte.
 *
 * I quattro casi sono separati perché si curano in modi diversi:
 * `unico` si può leggere; `ambiguo` significa che la fonte ha più eventi con
 * gli stessi nomi (doppio turno, rinvio) e nessuno è preferibile;
 * `kickoff_fuori_tolleranza` significa che i nomi ci sono ma l'orario no,
 * quindi o l'orario interno è sbagliato o la fonte non ha ancora aggiornato;
 * `nomi_non_trovati` significa che la grafia interna non combacia, e i
 * `nearMisses` servono a scegliere l'override giusto.
 */
export type EventMatchDiagnosis =
  | { status: "unico"; event: OddsApiEventLite }
  | { status: "ambiguo"; candidates: OddsApiEventLite[] }
  | { status: "kickoff_fuori_tolleranza"; candidates: OddsApiEventLite[] }
  | { status: "nomi_non_trovati"; nearMisses: OddsApiEventLite[] };

/** I nomi combaciano con la regola unica condivisa con `findEvent`. */
function namesMatch(internalHome: string, internalAway: string, event: OddsApiEventLite): boolean {
  return (
    teamNameMatches(internalHome, event.homeTeam) &&
    teamNameMatches(internalAway, event.awayTeam)
  );
}

/** Token del nome originale, normalizzati uno per uno. */
function tokensOf(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((token) => token !== ""),
  );
}

/**
 * Somiglianza fra due nomi, da 0 a 1 (Jaccard sui token).
 *
 * È dichiaratamente un'euristica e serve SOLO a suggerire all'operatore quale
 * evento potrebbe essere quello giusto quando la grafia interna non combacia.
 * Non decide nulla: una lettura parte solo se `diagnoseEventMatch` dice
 * «unico», e quel giudizio usa la regola di `findEvent`, non questa.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = tokensOf(a);
  const right = tokensOf(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

/** Soglia sotto la quale un evento non vale nemmeno come suggerimento. */
export const NEAR_MISS_THRESHOLD = 0.3;

function byKickoffDistance(
  identity: InternalMatchIdentity,
  events: OddsApiEventLite[],
): OddsApiEventLite[] {
  return [...events].sort(
    (a, b) =>
      Math.abs(a.commenceTime.getTime() - identity.kickoffAt.getTime()) -
      Math.abs(b.commenceTime.getTime() - identity.kickoffAt.getTime()),
  );
}

/**
 * Confronta la partita interna con gli eventi della fonte.
 *
 * Usa la stessa regola di `findEvent` — nomi che si contengono e kickoff
 * entro la tolleranza — e restituisce `unico` se e solo se `findEvent`
 * restituirebbe esattamente quell'evento. La differenza è che qui i casi di
 * insuccesso restano descritti invece di diventare un `null` muto.
 */
export function diagnoseEventMatch(
  identity: InternalMatchIdentity,
  events: OddsApiEventLite[],
): EventMatchDiagnosis {
  const matching = events.filter((event) => namesMatch(identity.homeTeam, identity.awayTeam, event));

  if (matching.length === 0) {
    const scored = events
      .map((event) => ({
        event,
        score:
          (nameSimilarity(identity.homeTeam, event.homeTeam) +
            nameSimilarity(identity.awayTeam, event.awayTeam)) /
          2,
      }))
      .filter((row) => row.score >= NEAR_MISS_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return { status: "nomi_non_trovati", nearMisses: scored.map((row) => row.event) };
  }

  const withinTolerance = matching.filter(
    (event) =>
      Number.isFinite(event.commenceTime.getTime()) &&
      Math.abs(event.commenceTime.getTime() - identity.kickoffAt.getTime()) <=
        EVENT_TIME_TOLERANCE_MINUTES * 60_000,
  );

  if (withinTolerance.length === 1) {
    return { status: "unico", event: withinTolerance[0] };
  }
  if (withinTolerance.length > 1) {
    return { status: "ambiguo", candidates: byKickoffDistance(identity, withinTolerance) };
  }
  return { status: "kickoff_fuori_tolleranza", candidates: byKickoffDistance(identity, matching) };
}

/** Descrizione in italiano della diagnosi, per i log dello smoke test. */
export function describeDiagnosis(diagnosis: EventMatchDiagnosis): string {
  const fmt = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const describe = (event: OddsApiEventLite): string =>
    `${event.homeTeam} — ${event.awayTeam} (${fmt.format(event.commenceTime)} ora italiana, id ${event.id})`;

  switch (diagnosis.status) {
    case "unico":
      return `evento unico sulla fonte: ${describe(diagnosis.event)}`;
    case "ambiguo":
      return `AMBIGUO — ${diagnosis.candidates.length} eventi con gli stessi nomi: ${diagnosis.candidates
        .map(describe)
        .join(" | ")}`;
    case "kickoff_fuori_tolleranza":
      return `NOMI PRESENTI MA ORARIO OLTRE ${EVENT_TIME_TOLERANCE_MINUTES} MINUTI: ${diagnosis.candidates
        .map(describe)
        .join(" | ")}`;
    case "nomi_non_trovati":
      return diagnosis.nearMisses.length === 0
        ? "nessun evento con nomi anche solo simili"
        : `GRAFIA INTERNA NON COMBACIATA. Candidati simili (euristica, non usabili così come sono): ${diagnosis.nearMisses
            .map(describe)
            .join(" | ")}`;
  }
}

/* ------------------------------------------------------------------ */
/* Dalla riga del database ai parametri dello smoke test               */
/* ------------------------------------------------------------------ */

/** Campi della partita che servono per decidere se è leggibile sulla fonte. */
export interface DbMatchRow {
  id: number;
  key: string;
  kickoffAt: Date;
  status: string;
  leagueName: string | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
}

/** Parametri completi di una lettura, pronti per il client. */
export interface SmokeMatchParams {
  matchId: number;
  fixtureKey: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
}

export type SmokeResolution =
  | { ok: true; params: SmokeMatchParams; notes: string[] }
  | { ok: false; reason: string };

/** Stati per i quali una lettura non ha senso: la partita non si giocherà. */
const NON_PLAYABLE = new Set(["finished", "postponed", "cancelled"]);

/**
 * Decide se una riga del database può diventare una lettura sulla fonte.
 *
 * Ogni rifiuto ha un motivo esplicito, perché il caso tipico non è «la fonte
 * non funziona» ma «questa partita non è leggibile»: competizione non mappata,
 * kickoff già passato, squadre mancanti. Confondere i due porta a spegnere una
 * fonte sana.
 */
export function resolveSmokeMatch(
  row: DbMatchRow,
  now: Date,
  overrideSportKey: string | null = null,
): SmokeResolution {
  const kickoffAt = row.kickoffAt instanceof Date ? row.kickoffAt : new Date(row.kickoffAt);
  if (Number.isNaN(kickoffAt.getTime())) {
    return { ok: false, reason: "kickoff non interpretabile nel database." };
  }
  if (NON_PLAYABLE.has(row.status)) {
    return { ok: false, reason: `partita in stato "${row.status}": non si giocherà.` };
  }
  if (kickoffAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      reason: "kickoff già passato: la fonte non espone più quote per questa partita.",
    };
  }

  const homeTeam = row.homeTeamName?.trim() ?? "";
  const awayTeam = row.awayTeamName?.trim() ?? "";
  if (homeTeam === "" || awayTeam === "") {
    return { ok: false, reason: "nomi delle squadre mancanti nel database." };
  }

  /* La chiave sport arriva dalla mappa di budget, a meno che lo smoke test non
     ne passi una esplicita per verificare una competizione fuori mappa. In
     produzione il override non esiste: la mappa resta l'unica autorità. */
  const sportKey = overrideSportKey ?? sportKeyFor(row.leagueName);
  if (sportKey === null) {
    return {
      ok: false,
      reason: `competizione "${row.leagueName ?? "sconosciuta"}" non mappata sulla fonte: nessuna chiave sport, nessun credito da spendere.`,
    };
  }

  const notes: string[] = [];
  if (row.status !== "scheduled") {
    notes.push(`stato partita "${row.status}" (atteso "scheduled"): la lettura parte lo stesso.`);
  }
  if (overrideSportKey !== null) {
    /* L'override è pensato per verificare una competizione FUORI mappa. Ma la
       lega può essere già coperta dalla mappa (es. «Italy: Serie A» passata a
       mano): in quel caso la nota deve dirlo, non dichiararla «fuori mappa». */
    const mappedKey = sportKeyFor(row.leagueName);
    if (mappedKey !== null) {
      notes.push(
        `chiave sport "${overrideSportKey}" fornita manualmente: la lega è comunque coperta dalla mappa (${mappedKey}), l'override è solo conferma.`,
      );
    } else {
      notes.push(
        `chiave sport "${overrideSportKey}" fornita manualmente: competizione fuori dalla mappa di budget (solo verifica).`,
      );
    }
  }

  return {
    ok: true,
    params: {
      matchId: row.id,
      fixtureKey: row.key,
      sportKey,
      homeTeam,
      awayTeam,
      kickoffAt,
    },
    notes,
  };
}
