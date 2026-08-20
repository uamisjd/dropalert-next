/**
 * Backtest R1 — gocce storiche di quota su dati football-data.co.uk.
 *
 * Script FUORI DAL SITO: non importa nulla del codice di DropAlert, non
 * tocca il database, non chiama la rete. Legge i CSV congelati in
 * `data/football-data/` e stampa le tabelle in markdown su stdout.
 *
 * Eseguire con: npx tsx scripts/backtest-r1.ts   (o npm run backtest:r1)
 *
 * Domanda a cui risponde: sulle partite in cui un esito 1X2 è sceso fra
 * la rilevazione settimanale della fonte e la chiusura, con che
 * frequenza quell'esito si verifica, rispetto a quella che il mercato
 * stesso dichiara (1/quota)? E la quota rilevata prima del movimento ha
 * battuto la chiusura fair di Pinnacle (CLV)?
 *
 * Tutto è dichiarato: le esclusioni contano, i campioni piccoli vengono
 * marcati, nessun valore viene stimato.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* ------------------------------------------------------------------ */
/* Costanti del backtest                                               */
/* ------------------------------------------------------------------ */

const DATA_DIR = join(process.cwd(), "data", "football-data");

const LEAGUES = [
  { code: "E0", name: "Premier League" },
  { code: "I1", name: "Serie A" },
  { code: "SP1", name: "La Liga" },
  { code: "D1", name: "Bundesliga" },
  { code: "F1", name: "Ligue 1" },
] as const;

const SEASONS = [
  { code: "1920", label: "2019/20" },
  { code: "2021", label: "2020/21" },
  { code: "2122", label: "2021/22" },
  { code: "2223", label: "2022/23" },
  { code: "2324", label: "2023/24" },
  { code: "2425", label: "2024/25" },
  { code: "2526", label: "2025/26" },
] as const;

/** Le soglie di caduta della quota, in percentuale sull'esito più sceso. */
const DROP_BUCKETS = [5, 10, 15] as const;

type Outcome = "H" | "D" | "A";

interface BookDef {
  key: string;
  name: string;
  early: Record<Outcome, string>;
  close: Record<Outcome, string>;
}

const BOOKS: BookDef[] = [
  {
    key: "pinnacle",
    name: "Pinnacle",
    early: { H: "PSH", D: "PSD", A: "PSA" },
    close: { H: "PSCH", D: "PSCD", A: "PSCA" },
  },
  {
    key: "bet365",
    name: "Bet365",
    early: { H: "B365H", D: "B365D", A: "B365A" },
    close: { H: "B365CH", D: "B365CD", A: "B365CA" },
  },
];

/** Colonne della chiusura Pinnacle: la base fair no-vig del CLV. */
const PIN_CLOSE: Record<Outcome, string> = {
  H: "PSCH",
  D: "PSCD",
  A: "PSCA",
};

/* ------------------------------------------------------------------ */
/* Lettura CSV (minimale, con gestione dei campi virgolettati)          */
/* ------------------------------------------------------------------ */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toRows(text: string): Record<string, string>[] {
  const table = parseCsv(text);
  if (table.length === 0) return [];
  const header = table[0];
  const out: Record<string, string>[] = [];
  for (const line of table.slice(1)) {
    if (line.length === 1 && line[0].trim() === "") continue;
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      rec[h] = line[i] ?? "";
    });
    out.push(rec);
  }
  return out;
}

function num(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/* ------------------------------------------------------------------ */
/* Statistiche pure                                                    */
/* ------------------------------------------------------------------ */

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Intervallo di Wilson al 95% per una proporzione. `null` senza osservazioni. */
function wilson95(k: number, n: number): [number, number] | null {
  if (n === 0) return null;
  const z = 1.959964;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function pct(v: number | null, decimals = 1): string {
  if (v === null) return "n/d";
  return `${(v * 100).toFixed(decimals)}%`;
}

function signed(v: number | null, decimals = 2, unit = ""): string {
  if (v === null) return "n/d";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(decimals)}${unit}`;
}

/* ------------------------------------------------------------------ */
/* Il campione                                                         */
/* ------------------------------------------------------------------ */

interface Observation {
  league: string;
  season: string;
  book: string;
  /** esito più sceso */
  outcome: Outcome;
  /** caduta della quota in frazione 0–1 (1 − chiusura/rilevata) */
  drop: number;
  hit: boolean;
  /** 1/quota di chiusura del libro, grezza */
  impliedCloseRaw: number;
  /** 1/quota rilevata (pre-movimento) */
  impliedEarly: number;
  /** probabilità fair no-vig dalla chiusura Pinnacle, se calcolabile */
  impliedCloseFair: number | null;
  /** CLV in percentuale sulla quota: rilevata/fair − 1 */
  clvPct: number | null;
  /** CLV in punti percentuali di probabilità */
  clvPp: number | null;
}

interface Exclusions {
  matchesRead: number;
  missingEarly: number;
  missingClose: number;
  /** chiusura Pinnacle assente: il match conta per la frequenza, non per il CLV fair */
  missingFairBase: number;
}

/** Rimuove il margine in via proporzionale dalla terna di chiusura Pinnacle. */
function fairProbabilities(
  close: Record<Outcome, number | null>,
): Record<Outcome, number> | null {
  const ps = (["H", "D", "A"] as Outcome[]).map((o) => close[o]);
  if (ps.some((p) => p === null)) return null;
  const implied = ps.map((p) => 1 / (p as number));
  const sum = implied.reduce((a, b) => a + b, 0);
  const out = {} as Record<Outcome, number>;
  (["H", "D", "A"] as Outcome[]).forEach((o, i) => {
    out[o] = implied[i] / sum;
  });
  return out;
}

function observeMatch(
  row: Record<string, string>,
  league: string,
  season: string,
  book: BookDef,
  acc: { obs: Observation[]; excl: Exclusions },
): void {
  const ftr = row["FTR"]?.trim();
  if (ftr !== "H" && ftr !== "D" && ftr !== "A") return; // partita non giocata

  const early: Record<Outcome, number | null> = {
    H: num(row[book.early.H]),
    D: num(row[book.early.D]),
    A: num(row[book.early.A]),
  };
  const close: Record<Outcome, number | null> = {
    H: num(row[book.close.H]),
    D: num(row[book.close.D]),
    A: num(row[book.close.A]),
  };

  if ((["H", "D", "A"] as Outcome[]).some((o) => early[o] === null)) {
    acc.excl.missingEarly += 1;
    return;
  }
  if ((["H", "D", "A"] as Outcome[]).some((o) => close[o] === null)) {
    acc.excl.missingClose += 1;
    return;
  }

  /* l'esito più sceso: massima caduta relativa della quota */
  let best: Outcome = "H";
  let bestDrop = -Infinity;
  for (const o of ["H", "D", "A"] as Outcome[]) {
    const drop = 1 - (close[o] as number) / (early[o] as number);
    if (drop > bestDrop) {
      bestDrop = drop;
      best = o;
    }
  }

  /* base fair no-vig: solo Pinnacle, terza completa, altrimenti dichiarato */
  const pinClose: Record<Outcome, number | null> = {
    H: num(row[PIN_CLOSE.H]),
    D: num(row[PIN_CLOSE.D]),
    A: num(row[PIN_CLOSE.A]),
  };
  const fair = fairProbabilities(pinClose);
  if (fair === null) acc.excl.missingFairBase += 1;

  const earlyOdds = early[best] as number;
  const closeOdds = close[best] as number;
  const fairProb = fair === null ? null : fair[best];

  acc.obs.push({
    league,
    season,
    book: book.key,
    outcome: best,
    drop: bestDrop,
    hit: ftr === best,
    impliedCloseRaw: 1 / closeOdds,
    impliedEarly: 1 / earlyOdds,
    impliedCloseFair: fairProb,
    clvPct: fairProb === null ? null : earlyOdds * fairProb - 1,
    clvPp: fairProb === null ? null : (fairProb - 1 / earlyOdds) * 100,
  });
}

/* ------------------------------------------------------------------ */
/* Aggregazione                                                        */
/* ------------------------------------------------------------------ */

interface Agg {
  n: number;
  hits: number;
  freq: number | null;
  ci: [number, number] | null;
  expectedCloseRaw: number | null;
  expectedCloseFair: number | null;
  expectedEarly: number | null;
  clvPctMean: number | null;
  clvPctMedian: number | null;
  clvPpMean: number | null;
  clvPositive: number | null;
  nClv: number;
}

function aggregate(obs: Observation[]): Agg {
  const n = obs.length;
  const hits = obs.filter((o) => o.hit).length;
  const withFair = obs.filter((o) => o.impliedCloseFair !== null);
  const clvs = obs.filter((o) => o.clvPct !== null);

  return {
    n,
    hits,
    freq: n === 0 ? null : hits / n,
    ci: wilson95(hits, n),
    expectedCloseRaw: mean(obs.map((o) => o.impliedCloseRaw)),
    expectedCloseFair: mean(withFair.map((o) => o.impliedCloseFair as number)),
    expectedEarly: mean(obs.map((o) => o.impliedEarly)),
    clvPctMean: mean(clvs.map((o) => o.clvPct as number)),
    clvPctMedian: median(clvs.map((o) => o.clvPct as number)),
    clvPpMean: mean(clvs.map((o) => o.clvPp as number)),
    clvPositive:
      clvs.length === 0 ? null : clvs.filter((o) => (o.clvPct as number) > 0).length / clvs.length,
    nClv: clvs.length,
  };
}

function aggRow(label: string, a: Agg): string {
  const small = a.n < 30 ? " ⚠" : "";
  return `| ${label} | ${a.n}${small} | ${a.hits} | ${pct(a.freq)}${
    a.ci ? ` (${pct(a.ci[0])}–${pct(a.ci[1])})` : ""
  } | ${pct(a.expectedEarly)} | ${pct(a.expectedCloseFair)} | ${pct(a.expectedCloseRaw)} | ${signed(a.clvPctMean !== null ? a.clvPctMean * 100 : null)}% | ${signed(a.clvPctMedian !== null ? a.clvPctMedian * 100 : null)}% | ${signed(a.clvPpMean)} pp (${a.nClv}) |`;
}

const AGG_HEADER =
  "| Segmento | n | vinti | freq reale (IC 95%) | attesa pre-movimento | attesa fair no-vig | attesa chiusura grezza | CLV % medio | CLV % mediano | CLV pp medio |";

/* ------------------------------------------------------------------ */
/* Esecuzione                                                          */
/* ------------------------------------------------------------------ */

function main(): void {
  const files = readdirSyncSafe(DATA_DIR).filter((f) => f.endsWith(".csv")).sort();
  const acc = { obs: [] as Observation[], excl: freshExclusions() };
  const coverage: { file: string; league: string; season: string; rows: number; perBook: Record<string, number> }[] = [];

  for (const league of LEAGUES) {
    for (const season of SEASONS) {
      const file = `${league.code}-${season.code}.csv`;
      if (!files.includes(file)) continue;
      const rows = toRows(
        readFileSync(join(DATA_DIR, file), "latin1"),
      );
      const played = rows.filter(
        (r) => r["FTR"] === "H" || r["FTR"] === "D" || r["FTR"] === "A",
      );
      const perBook: Record<string, number> = {};
      for (const book of BOOKS) {
        const before = acc.obs.length;
        for (const row of played) observeMatch(row, league.name, season.label, book, acc);
        perBook[book.key] = acc.obs.length - before;
      }
      coverage.push({ file, league: league.name, season: season.label, rows: played.length, perBook });
    }
  }

  const all = acc.obs;

  console.log("<!-- generato da scripts/backtest-r1.ts — tabelle rigenerabili -->\n");

  /* --- copertura --- */
  console.log("## Copertura dei dati\n");
  console.log("| File | Competizione | Stagione | Partite giocate | Usabili Pinnacle | Usabili Bet365 |");
  console.log("|---|---|---|---|---|---|");
  for (const c of coverage) {
    console.log(`| ${c.file} | ${c.league} | ${c.season} | ${c.rows} | ${c.perBook.pinnacle} | ${c.perBook.bet365} |`);
  }
  const matchesRead = coverage.reduce((a, c) => a + c.rows, 0);
  console.log(`\nPartite giocate totali: **${matchesRead}**; esclusioni: terne di apertura mancanti ${acc.excl.missingEarly}, terne di chiusura mancanti ${acc.excl.missingClose}, chiusura Pinnacle assente (CLV fair non calcolabile, il match resta nella frequenza) ${acc.excl.missingFairBase}.\n`);

  /* --- tabella generale, per libro e fascia --- */
  for (const book of BOOKS) {
    const obs = all.filter((o) => o.book === book.key);
    console.log(`\n## ${book.name} — tutte le competizioni, tutte le stagioni\n`);
    console.log(AGG_HEADER);
    console.log("|---|---|---|---|---|---|---|---|---|---|");
    for (const bucket of DROP_BUCKETS) {
      const sel = obs.filter((o) => o.drop * 100 >= bucket);
      console.log(aggRow(`drop ≥ ${bucket}%`, aggregate(sel)));
    }
    console.log("");
  }

  /* --- per competizione --- */
  for (const book of BOOKS) {
    console.log(`\n## ${book.name} — per competizione (stagioni aggregate)\n`);
    console.log(AGG_HEADER);
    console.log("|---|---|---|---|---|---|---|---|---|---|");
    for (const league of LEAGUES) {
      for (const bucket of DROP_BUCKETS) {
        const sel = all.filter(
          (o) => o.book === book.key && o.league === league.name && o.drop * 100 >= bucket,
        );
        if (sel.length === 0) continue;
        console.log(aggRow(`${league.name} · ≥${bucket}%`, aggregate(sel)));
      }
    }
    console.log("");
  }

  /* --- per stagione --- */
  for (const book of BOOKS) {
    console.log(`\n## ${book.name} — per stagione (competizioni aggregate)\n`);
    console.log(AGG_HEADER);
    console.log("|---|---|---|---|---|---|---|---|---|---|");
    for (const season of SEASONS) {
      for (const bucket of DROP_BUCKETS) {
        const sel = all.filter(
          (o) => o.book === book.key && o.season === season.label && o.drop * 100 >= bucket,
        );
        if (sel.length === 0) continue;
        console.log(aggRow(`${season.label} · ≥${bucket}%`, aggregate(sel)));
      }
    }
    console.log("");
  }

  /* --- segnali deboli: quanto è sceso NON dice quanto vince --- */
  console.log("\n## Controllo di specificità — esiti non scesi\n");
  for (const book of BOOKS) {
    const obs = all.filter((o) => o.book === book.key);
    const stable = obs.filter((o) => Math.abs(o.drop * 100) < 1);
    const a = aggregate(stable);
    console.log(
      `- ${book.name}: partite senza movimento rilevante (±1%): n=${a.n}, freq reale ${pct(a.freq)}, attesa fair ${pct(a.expectedCloseFair)}.`,
    );
  }
}

function freshExclusions(): Exclusions {
  return { matchesRead: 0, missingEarly: 0, missingClose: 0, missingFairBase: 0 };
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

main();
