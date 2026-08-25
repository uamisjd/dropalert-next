/**
 * Sprint UX-2 — lingua piana e una card per partita.
 *
 * Tutto qui dentro è PURO e generato DA DATI con template fissi: nessuna
 * chiamata a modelli, nessuna interpretazione. La frase piana riformula
 * numeri già a registro; se un numero manca, la parte di frase corrispondente
 * sparisce invece di essere indovinata.
 *
 * Vincolo di lingua: si descrive il MERCATO, mai il risultato. Nessuna frase
 * può suggerire che un esito sia più probabile nella realtà.
 */
import type { DashboardSignal } from "@/lib/repo/dashboard";

/* ------------------------------------------------------------------ */
/* Etichette piane accanto a quelle tecniche                           */
/* ------------------------------------------------------------------ */

export type PlainStrength = "rumore" | "in-movimento" | "ampio";

export const PLAIN_STRENGTH_LABELS: Record<PlainStrength, string> = {
  rumore: "Movimento piccolo, probabilmente rumore",
  "in-movimento": "Il mercato si sta muovendo",
  ampio: "Movimento ampio e sostenuto",
};

/**
 * Traduzione in lingua piana di ciò che il motore ha già deciso.
 * Non è una metrica nuova: legge classe di ampiezza, livello e persistenza.
 */
export function plainStrengthOf(signal: {
  magnitudeClass: string;
  level: string;
  sustainedMinutes: number;
  isFlash: boolean;
}): PlainStrength {
  if (signal.magnitudeClass === "noise" || signal.level === "nessuno") {
    return "rumore";
  }
  if (
    signal.level === "forte" &&
    !signal.isFlash &&
    signal.sustainedMinutes >= 60
  ) {
    return "ampio";
  }
  return "in-movimento";
}

/* ------------------------------------------------------------------ */
/* Frase piana da template                                             */
/* ------------------------------------------------------------------ */

function fmtOdd(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

/**
 * Durata del movimento in ore, dalla persistenza già misurata dal motore.
 * `null` quando il motore non ha una durata: la frase omette il pezzo.
 */
export function movementHours(sustainedMinutes: number): number | null {
  if (!Number.isFinite(sustainedMinutes) || sustainedMinutes <= 0) return null;
  return Math.round((sustainedMinutes / 60) * 10) / 10;
}

/**
 * Verso del movimento in parole: chi/che cosa il mercato sta prezzando meglio.
 * Usa il nome della squadra quando la selezione lo identifica, mai un codice.
 */
export function towards(signal: {
  selection: string;
  homeTeam: string;
  awayTeam: string;
  selectionLabel: string;
}): string {
  if (signal.selection === "home") return signal.homeTeam;
  if (signal.selection === "away") return signal.awayTeam;
  if (signal.selection === "draw") return "il pareggio";
  return signal.selectionLabel.toLowerCase();
}

/**
 * Soggetto della frase: "la quota della vittoria di X", "la quota del
 * pareggio". Il codice di selezione (1, X, 2) non compare mai in lingua piana.
 */
export function subjectOf(signal: {
  selection: string;
  homeTeam: string;
  awayTeam: string;
  selectionLabel: string;
}): string {
  if (signal.selection === "home") {
    return `La quota della vittoria di ${signal.homeTeam}`;
  }
  if (signal.selection === "away") {
    return `La quota della vittoria di ${signal.awayTeam}`;
  }
  if (signal.selection === "draw") return "La quota del pareggio";
  return `La quota di ${signal.selectionLabel.toLowerCase()}`;
}

/**
 * Frase piana della card, costruita per pezzi da dati verificati.
 *
 * Struttura: movimento della quota → verso → notizie → conferme.
 * Ogni pezzo è omesso quando il dato non c'è: la frase si accorcia, non mente.
 */
export function plainSentence(
  signal: DashboardSignal,
  now: Date = new Date(),
): string {
  const parts: string[] = [];

  const opening = signal.openingPrice;
  const current = signal.currentPrice;
  const hours = movementHours(signal.sustainedMinutes);

  if (opening !== null && current !== null && opening !== current) {
    const verso = current < opening ? "è scesa" : "è salita";
    const durata =
      hours !== null && hours > 0
        ? ` in ${String(hours).replace(".", ",")} ore`
        : "";
    /* elisione obbligatoria: "dal pareggio", non "da il pareggio" */
    const meta = towards(signal);
    const daMeta = meta.startsWith("il ") ? `dal ${meta.slice(3)}` : `da ${meta}`;
    const direzione =
      current < opening
        ? ` : il mercato si sta spostando verso ${meta}`
        : ` : il mercato si sta allontanando ${daMeta}`;
    parts.push(
      `${subjectOf(signal)} ${verso} da ${fmtOdd(opening)} a ${fmtOdd(current)}${durata}${direzione}.`.replace(
        " : ",
        ": ",
      ),
    );
  } else {
    parts.push(
      `${subjectOf(signal)} non ha un percorso completo a registro: il movimento non è raccontabile in numeri.`,
    );
  }

  if (signal.newsCount !== null && signal.newsCount > 0) {
    parts.push(
      signal.newsCount === 1
        ? "Notizie: 1 in archivio."
        : `Notizie: ${signal.newsCount} in archivio.`,
    );
  } else if (signal.newsEmpty) {
    parts.push("Nessuna notizia pubblica trovata.");
  }

  if (signal.booksTotal > 1) {
    parts.push(
      `Movimento su ${signal.booksConfirming} bookmaker su ${signal.booksTotal}.`,
    );
  } else {
    parts.push("Movimento su un solo bookmaker.");
  }

  void now;
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/* Snippet di contesto                                                 */
/* ------------------------------------------------------------------ */

/** Lunghezza massima dello snippet "Contesto:" mostrato sulla card. */
export const CONTEXT_SNIPPET_MAX = 120;

/**
 * Taglia lo snippet di contesto in modo leggibile.
 *
 * Se il testo ci sta, resta intero. Se la prima frase ci sta, si mostra quella
 * intera e basta. Altrimenti si taglia all'ultima parola utile e si chiude con
 * l'ellissi: mai una parola mozzata a metà, mai un taglio silenzioso.
 */
export function contextSnippet(
  raw: string | null,
  max = CONTEXT_SNIPPET_MAX,
): string | null {
  if (raw === null) return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  if (text.length <= max) return text;

  /* prima frase completa, se entra nel budget */
  const sentence = text.match(/^[^.!?·]+[.!?]/);
  if (sentence && sentence[0].trim().length <= max) {
    return sentence[0].trim();
  }

  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const base = (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut)
    .replace(/[\s,;:·—-]+$/, "");
  return `${base}…`;
}

/* ------------------------------------------------------------------ */
/* Una card per partita                                                */
/* ------------------------------------------------------------------ */

export interface MatchGroup {
  matchId: number;
  /** il segnale più forte della partita: è quello che va in card */
  primary: DashboardSignal;
  /** gli altri segnali della stessa partita, già ordinati */
  others: DashboardSignal[];
}

const LEVEL_RANK: Record<string, number> = {
  forte: 3,
  reale: 2,
  debole: 1,
  nessuno: 0,
};

function strongerFirst(a: DashboardSignal, b: DashboardSignal): number {
  const la = LEVEL_RANK[a.level] ?? 0;
  const lb = LEVEL_RANK[b.level] ?? 0;
  if (la !== lb) return lb - la;
  return (b.confidenceScore ?? -1) - (a.confidenceScore ?? -1);
}

/**
 * Raggruppa i segnali per partita conservando l'ordine di arrivo dei gruppi:
 * chi ordina la lista lo ha già fatto a monte, qui non si riordina nulla.
 */
export function groupByMatch(signals: DashboardSignal[]): MatchGroup[] {
  const byMatch = new Map<number, DashboardSignal[]>();
  const order: number[] = [];
  for (const s of signals) {
    if (!byMatch.has(s.matchId)) {
      byMatch.set(s.matchId, []);
      order.push(s.matchId);
    }
    byMatch.get(s.matchId)!.push(s);
  }
  return order.map((matchId) => {
    const list = [...byMatch.get(matchId)!].sort(strongerFirst);
    return { matchId, primary: list[0], others: list.slice(1) };
  });
}

/** "altri 2 segnali su questa partita" — accordo corretto. */
export function othersLabel(n: number): string {
  return n === 1
    ? "altro 1 segnale su questa partita"
    : `altri ${n} segnali su questa partita`;
}

/* ------------------------------------------------------------------ */
/* Etichetta delle fonti                                               */
/* ------------------------------------------------------------------ */

/**
 * "Fonti: 0 ok · 1 degradata (ultimo successo 12 min fa)".
 *
 * Mai un "0/1" senza spiegazione: una fonte degradata che risponde non è una
 * fonte spenta, e il conteggio da solo lo faceva sembrare.
 */
export function sourcesLabel(
  sources: Array<{ status: string; lastSuccessAt: string | null }>,
  now: Date,
): string {
  if (sources.length === 0) return "Fonti: nessuna registrata";
  const count = (st: string) => sources.filter((s) => s.status === st).length;
  const ok = count("ok");
  const pieces: string[] = [`${ok} ok`];
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  const degraded = count("degraded");
  const blocked = count("blocked");
  const disabled = count("disabled");
  const unknown = count("unknown");
  if (degraded > 0) pieces.push(plural(degraded, "degradata", "degradate"));
  if (blocked > 0) pieces.push(plural(blocked, "bloccata", "bloccate"));
  if (disabled > 0) pieces.push(plural(disabled, "disattivata", "disattivate"));
  if (unknown > 0) pieces.push(plural(unknown, "mai interrogata", "mai interrogate"));

  const times = sources
    .map((s) => (s.lastSuccessAt ? new Date(s.lastSuccessAt).getTime() : null))
    .filter((t): t is number => t !== null && Number.isFinite(t));
  let tail = " (nessun successo a registro)";
  if (times.length > 0) {
    const mins = Math.max(0, Math.round((now.getTime() - Math.max(...times)) / 60000));
    const ago =
      mins < 1
        ? "meno di 1 min fa"
        : mins < 60
          ? `${mins} min fa`
          : mins < 1440
            ? `${Math.floor(mins / 60)} h fa`
            : `${Math.floor(mins / 1440)} g fa`;
    tail = ` (ultimo successo ${ago})`;
  }
  return `Fonti: ${pieces.join(" · ")}${tail}`;
}
