/**
 * Parsing difensivo delle pagine BetExplorer (Sprint 3B).
 *
 * Funzioni PURE: ricevono HTML, restituiscono dati o dichiarano il buco.
 * Nessuna rete, nessun accesso al DB: così i test girano sull'HTML reale
 * congelato in `__tests__/fixtures/` senza toccare la fonte.
 *
 * Principio guida: se il markup cambia, il parser DEVE accorgersene e
 * dirlo. Ogni funzione restituisce, accanto ai dati, un elenco di
 * `problems`: righe scartate, campi assenti, strutture inattese. Quelle
 * voci diventano `partial` + `data_gaps`, mai valori dedotti.
 *
 * Scelte imposte dalla struttura reale della pagina, verificate sul campo:
 *
 * 1. Il campionato si ricava dall'URL DELLA RIGA, non dall'intestazione
 *    di gruppo. La pagina mescola sport diversi e le intestazioni si
 *    alternano: legarsi alla precedente è fragile. L'URL
 *    `/football/<paese>/<lega>/<slug>/<id>/` è invece autoportante.
 *
 * 2. LA DATA DELL'ELENCO NON È AFFIDABILE E NON VA USATA PER IL KICKOFF.
 *    Le righe `table-main__date` appartengono al gruppo di uno specifico
 *    sport; le righe di calcio si intercalano ad altri sport, quindi
 *    riportare "l'ultima data vista" attribuisce alla partita la data di
 *    un altro gruppo. Misurato il 18.08.2026 su 4 partite verificate una
 *    per una: la data ereditata era SBAGLIATA in 3 casi su 4
 *    (es. Stt1j9GP → elenco "20.08.2026", reale 18.08.2026).
 *    `listedDateHint` resta esposta solo per diagnostica.
 *
 * 3. L'unico orario affidabile è `startDate` del JSON-LD nella pagina
 *    partita, che dichiara il fuso: `"2026-08-18T22:00:00+02:00"`.
 *    Gli orari dell'elenco non dichiarano il fuso e risultano sfasati
 *    (elenco 21:00 contro le 22:00+02:00 reali). Nessuna correzione fissa
 *    viene applicata: un offset dedotto sarebbe un valore inventato.
 *    Una partita di cui non si ottiene `startDate` viene DICHIARATA
 *    mancante e scartata, mai salvata con un orario indovinato.
 */
import type { MarketType, SelectionCode } from "@/db/schema";

/* ------------------------------------------------------------------ */
/* Utilità                                                             */
/* ------------------------------------------------------------------ */

/** Entità HTML che compaiono davvero nei nomi di squadre e tornei. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&raquo;/g, "»");
}

/** Rimuove i tag e normalizza gli spazi. */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Quota decimale valida. Rifiuta 0, negativi, NaN e quote sotto 1.01:
 * una quota decimale minore di 1 non esiste, e accettarla significherebbe
 * far entrare nel motore una probabilità implicita maggiore di 1.
 */
export function parseDecimalOdds(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 1.01 || n > 1000) return null;
  return n;
}

/** Slug stabile e prevedibile per chiavi interne. */
export function slugify(input: string): string {
  return decodeEntities(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* ------------------------------------------------------------------ */
/* Esito del parsing                                                   */
/* ------------------------------------------------------------------ */

/** Una riga scartata, con il motivo. Diventa un `data_gaps`. */
export interface ParseProblem {
  /** identificativo della riga, se ricavabile */
  ref: string;
  reason: string;
}

export interface ParsedListing {
  fixtures: ParsedFixtureRow[];
  problems: ParseProblem[];
  /** righe di calcio trovate, comprese quelle scartate */
  footballRowsSeen: number;
}

/** Una riga dell'elenco drop, già validata. */
export interface ParsedFixtureRow {
  providerMatchId: string;
  sourceUrl: string;
  countrySlug: string;
  leagueSlug: string;
  leagueLabel: string | null;
  homeTeamRaw: string;
  awayTeamRaw: string;
  /** orario dell'elenco, senza fuso dichiarato. Non usabile da solo. */
  listedTime: string;
  /**
   * Ultima riga di data vista scorrendo la tabella.
   * NON è la data della partita: appartiene al gruppo di un altro sport
   * nella maggior parte dei casi (verificato: errata in 3 casi su 4).
   * Esposta solo per diagnostica, mai per calcolare il kickoff.
   */
  listedDateHint: string | null;
  dropPercent: number | null;
  quotes: ParsedQuote[];
  /** indice della selezione in calo: 0 = 1, 1 = X, 2 = 2 */
  droppedIndex: number | null;
  openingPrice: number | null;
  agreement: { confirming: number; total: number } | null;
}

export interface ParsedQuote {
  market: MarketType;
  selection: SelectionCode;
  price: number;
}

/** Le tre colonne del calcio, in ordine di comparsa. */
const FOOTBALL_SELECTIONS: SelectionCode[] = ["home", "draw", "away"];

/* ------------------------------------------------------------------ */
/* Elenco drop                                                         */
/* ------------------------------------------------------------------ */

/**
 * Estrae le partite di calcio da `/dropping-odds/`.
 *
 * Non lancia mai: una pagina irriconoscibile produce zero fixture e un
 * problema dichiarato, che il chiamante trasforma in `error`/`partial`.
 */
export function parseDroppingOdds(html: string): ParsedListing {
  const problems: ParseProblem[] = [];

  if (typeof html !== "string" || html.trim() === "") {
    return {
      fixtures: [],
      problems: [{ ref: "documento", reason: "Risposta vuota." }],
      footballRowsSeen: 0,
    };
  }

  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g);
  if (!rows || rows.length === 0) {
    return {
      fixtures: [],
      problems: [
        {
          ref: "documento",
          reason:
            "Nessuna riga <tr> trovata: struttura della pagina cambiata o risposta non attesa.",
        },
      ],
      footballRowsSeen: 0,
    };
  }

  /* etichette leggibili dei tornei, indicizzate per percorso di lega */
  const leagueLabels = new Map<string, string>();
  for (const row of rows) {
    const header = /<a href="(\/football\/[^"]+?)"[^>]*class="[^"]*table-main__tournament/.exec(
      row,
    );
    if (header) {
      const label = stripTags(row.replace(/<th>Drop<\/th>[\s\S]*$/, ""));
      if (label) leagueLabels.set(header[1], label);
    }
  }

  const fixtures: ParsedFixtureRow[] = [];
  let currentDate: string | null = null;
  let footballRowsSeen = 0;

  for (const row of rows) {
    const dateMatch = /class="table-main__date"[^>]*>([^<]+)</.exec(row);
    if (dateMatch) {
      currentDate = dateMatch[1].trim();
      continue;
    }

    if (!row.includes("table-main__tt")) continue;

    /* il link della riga è l'unica fonte affidabile di sport e lega */
    const link =
      /<a href="(\/football\/([^/"]+)\/([^/"]+)\/([^/"]+)\/([^/"]+)\/)"[^>]*>([\s\S]*?)<\/a>/.exec(
        row,
      );
    if (!link) continue; /* altro sport: non è un problema, non è calcio */

    footballRowsSeen += 1;

    const [, url, countrySlug, leagueSlug, , providerMatchId, anchorHtml] = link;
    const ref = providerMatchId;

    /* --- squadre ------------------------------------------------- */
    const anchorText = stripTags(anchorHtml);
    const parts = anchorText.split(" - ");
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      problems.push({
        ref,
        reason: `Nomi squadre non separabili da "${anchorText}": riga scartata, nessun nome dedotto.`,
      });
      continue;
    }
    const homeTeamRaw = parts[0].trim();
    const awayTeamRaw = parts[1].trim();

    /* --- orario --------------------------------------------------- */
    const timeMatch = /class="table-main__time"[^>]*>([^<]+)</.exec(row);
    const listedTime = timeMatch ? timeMatch[1].trim() : "";
    if (!/^\d{1,2}:\d{2}$/.test(listedTime)) {
      problems.push({
        ref,
        reason: `Orario assente o illeggibile ("${listedTime}"): riga scartata.`,
      });
      continue;
    }

    /* --- celle quota ---------------------------------------------- */
    const cells = row.match(/<td class="table-main__odds[^"]*"[\s\S]*?<\/td>/g) ?? [];
    if (cells.length !== 3) {
      problems.push({
        ref,
        reason: `Attese 3 colonne 1X2, trovate ${cells.length}: struttura cambiata, riga scartata.`,
      });
      continue;
    }

    const quotes: ParsedQuote[] = [];
    let droppedIndex: number | null = null;
    let malformed = false;

    cells.forEach((cell, index) => {
      if (cell.includes("list-tags__window--drop")) droppedIndex = index;
      /* la prima data-odd della cella è la quota corrente; quelle nel
         tooltip vengono dopo e riguardano l'apertura */
      const priceMatch = /data-odd="([^"]*)"/.exec(cell);
      const price = parseDecimalOdds(priceMatch?.[1]);
      if (price === null) {
        malformed = true;
        problems.push({
          ref,
          reason: `Quota illeggibile nella colonna ${FOOTBALL_SELECTIONS[index]} ("${
            priceMatch?.[1] ?? "assente"
          }"): nessun valore stimato.`,
        });
        return;
      }
      quotes.push({ market: "1x2", selection: FOOTBALL_SELECTIONS[index], price });
    });

    if (malformed || quotes.length !== 3) continue;

    /* --- apertura e accordo, dal tooltip -------------------------- */
    let openingPrice: number | null = null;
    let agreement: { confirming: number; total: number } | null = null;

    const droppedCell = droppedIndex === null ? null : cells[droppedIndex];
    if (droppedCell) {
      const tooltipOdds = [...droppedCell.matchAll(/data-odd="([^"]*)"/g)].map((m) =>
        parseDecimalOdds(m[1]),
      );
      /* schema osservato: [corrente, (mobile), apertura, corrente] */
      const opening = tooltipOdds.find(
        (v, i) => i > 0 && v !== null && v !== tooltipOdds[0],
      );
      openingPrice = opening ?? null;

      const agreementMatch = /B's:\s*\d+%\s*\((\d+)\/(\d+)\)/.exec(droppedCell);
      if (agreementMatch) {
        const confirming = Number(agreementMatch[1]);
        const total = Number(agreementMatch[2]);
        if (Number.isFinite(confirming) && Number.isFinite(total) && total > 0) {
          agreement = { confirming, total };
        }
      }
    }

    const dropMatch = /class="table-main__drop"[^>]*>(\d+)%/.exec(row);
    const dropPercent = dropMatch ? Number(dropMatch[1]) : null;

    fixtures.push({
      providerMatchId,
      sourceUrl: url,
      countrySlug,
      leagueSlug,
      leagueLabel: leagueLabels.get(`/football/${countrySlug}/${leagueSlug}/`) ?? null,
      homeTeamRaw,
      awayTeamRaw,
      listedTime,
      listedDateHint: currentDate,
      dropPercent,
      quotes,
      droppedIndex,
      openingPrice,
      agreement,
    });
  }

  if (footballRowsSeen === 0) {
    problems.push({
      ref: "documento",
      reason:
        "Nessuna riga di calcio nell'elenco drop. Può essere reale (nessun drop al momento) oppure indicare un cambio di struttura.",
    });
  }

  return { fixtures, problems, footballRowsSeen };
}

/* ------------------------------------------------------------------ */
/* Orario autorevole dalla pagina partita                              */
/* ------------------------------------------------------------------ */

/**
 * Legge `startDate` dal JSON-LD della pagina partita.
 *
 * È l'unico orario con fuso ESPLICITO che la fonte pubblichi entro il
 * robots.txt: `"startDate": "2026-08-18T22:00:00+02:00"`. Quando c'è, si
 * usa questo e l'istante è esatto. Quando manca, si resta sull'orario
 * dell'elenco dichiarandolo approssimato.
 */
export function parseMatchStartDate(html: string): Date | null {
  if (typeof html !== "string" || html === "") return null;
  const match = /"startDate"\s*:\s*"([^"]+)"/.exec(html);
  if (!match) return null;
  /* si accetta solo un istante con fuso esplicito: senza offset non
     sapremmo a quale zona riferirlo, e non lo si indovina */
  if (!/[+-]\d{2}:\d{2}$|Z$/.test(match[1])) return null;
  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* ------------------------------------------------------------------ */
/* Risultati                                                           */
/* ------------------------------------------------------------------ */

export interface ParsedResultRow {
  providerMatchId: string;
  homeGoals: number;
  awayGoals: number;
  /** nomi come pubblicati dalla fonte, presi dai due <span> del link */
  homeTeamRaw: string;
  awayTeamRaw: string;
}

export interface ParsedResults {
  results: ParsedResultRow[];
  problems: ParseProblem[];
  rowsSeen: number;
}

/**
 * Estrae i risultati finali da una pagina `/results/`.
 *
 * L'aggancio alla partita avviene tramite l'ID nell'URL, non tramite la
 * data: la pagina stampa "13.08." senza anno, e dedurre l'anno a cavallo
 * di dicembre produrrebbe errori silenziosi. L'ID è già la nostra chiave.
 *
 * Un punteggio non numerico (rinvii, sospese, "AWA.") non viene tradotto
 * in 0:0: la riga viene dichiarata e scartata.
 */
export function parseResults(html: string): ParsedResults {
  const problems: ParseProblem[] = [];

  if (typeof html !== "string" || html.trim() === "") {
    return {
      results: [],
      problems: [{ ref: "documento", reason: "Risposta vuota." }],
      rowsSeen: 0,
    };
  }

  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const results: ParsedResultRow[] = [];
  let rowsSeen = 0;

  for (const row of rows) {
    if (!row.includes("in-match")) continue;

    const idMatch = /href="\/football\/[^"]*?\/([A-Za-z0-9]+)\/"/.exec(row);
    if (!idMatch) continue;
    rowsSeen += 1;
    const providerMatchId = idMatch[1];

    const scoreCell = /<td class="h-text-center">([\s\S]*?)<\/td>/.exec(row);
    if (!scoreCell) {
      problems.push({
        ref: providerMatchId,
        reason: "Cella del punteggio assente: struttura cambiata, riga scartata.",
      });
      continue;
    }

    const scoreText = stripTags(scoreCell[1]);
    const score = /^(\d+):(\d+)$/.exec(scoreText);
    if (!score) {
      /* può essere una partita non giocata: si dichiara, non si inventa */
      problems.push({
        ref: providerMatchId,
        reason: `Punteggio non numerico ("${scoreText}"): nessun risultato dedotto.`,
      });
      continue;
    }

    /* I nomi stanno nei due <span> dentro il link della partita.
       Non si usa il testo grezzo della riga: contiene anche il turno
       ("4. Round") e le intestazioni di colonna. */
    const anchor = /<a[^>]*class="in-match"[^>]*>([\s\S]*?)<\/a>/.exec(row);
    const spans = anchor
      ? [...anchor[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((m) =>
          stripTags(m[1]),
        )
      : [];

    if (spans.length !== 2 || !spans[0] || !spans[1]) {
      problems.push({
        ref: providerMatchId,
        reason: `Nomi squadre non leggibili dal link (trovati ${spans.length} campi): riga scartata, nessun nome dedotto.`,
      });
      continue;
    }

    results.push({
      providerMatchId,
      homeGoals: Number(score[1]),
      awayGoals: Number(score[2]),
      homeTeamRaw: spans[0],
      awayTeamRaw: spans[1],
    });
  }

  if (rowsSeen === 0) {
    problems.push({
      ref: "documento",
      reason:
        "Nessuna riga risultato riconosciuta: struttura della pagina cambiata o campionato senza partite concluse.",
    });
  }

  return { results, problems, rowsSeen };
}

/* ------------------------------------------------------------------ */
/* Chiavi stabili                                                      */
/* ------------------------------------------------------------------ */

/** Chiave interna della partita, stabile nel tempo. */
export function matchKeyFor(providerMatchId: string): string {
  return `be-${providerMatchId}`;
}

/** Chiave interna del campionato. */
export function leagueKeyFor(countrySlug: string, leagueSlug: string): string {
  return `be-${countrySlug}-${leagueSlug}`;
}

/** Chiave interna della squadra. */
export function teamKeyFor(nameRaw: string): string {
  return `be-${slugify(nameRaw)}`;
}

/**
 * Parole che nello slug restano minuscole o hanno una resa propria.
 *
 * La regola «parole corte tutte maiuscole» serve alle sigle (FC, NPL, MFL,
 * USA), ma trasformava «bosnia-and-herzegovina» in «Bosnia AND Herzegovina».
 * Qui si dichiara l'eccezione invece di indovinarla: le congiunzioni e le
 * preposizioni non sono sigle.
 */
const SLUG_WORD_OVERRIDES: Record<string, string> = {
  and: "&",
  of: "of",
  the: "the",
  de: "de",
  del: "del",
  du: "du",
  da: "da",
  di: "di",
  la: "La",
  le: "Le",
  el: "El",
  al: "Al",
  и: "e",
};

/** Nome leggibile di un campionato, quando l'intestazione non è disponibile. */
export function humanizeSlug(slug: string): string {
  const words = slug.split("-").filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      const override = SLUG_WORD_OVERRIDES[lower];
      if (override !== undefined) {
        /* una parola d'unione non apre mai un nome: se capita in testa
           si tratta come parola normale, non come congiunzione */
        if (i === 0) return w[0].toUpperCase() + w.slice(1);
        return override;
      }
      return w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}

/**
 * Ripulisce un nome già in archivio, scritto prima di questa regola.
 *
 * Serve alla lettura: le righe salvate ieri non si riscrivono (i dati non si
 * toccano), ma non c'è motivo di mostrare «Bosnia AND Herzegovina» a chi
 * legge oggi. Interviene solo su parole d'unione rese come sigle.
 */
export function normalizeDisplayName(name: string | null): string | null {
  if (name === null) return null;
  let out = name;
  for (const [word, replacement] of Object.entries(SLUG_WORD_OVERRIDES)) {
    if (replacement === word) continue;
    const upper = word.toUpperCase();
    if (upper === word) continue;
    out = out.replace(
      new RegExp(`(?<=\\S )${upper}(?= \\S)`, "g"),
      replacement,
    );
  }
  return out;
}
