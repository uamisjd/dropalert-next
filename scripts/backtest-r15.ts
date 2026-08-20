/**
 * Backtest R1.5 — pattern storici segmentati, con validazione out-of-sample.
 *
 * Script FUORI DAL SITO: nessuna importazione dal codice di DropAlert,
 * nessuna rete, nessun database. Legge gli stessi CSV congelati di R1 in
 * `data/football-data/` e stampa le tabelle in markdown su stdout.
 *
 * Eseguire con: npx tsx scripts/backtest-r15.ts   (o npm run backtest:r15)
 *
 * REGOLA METODOLOGICA BLOCCATA (docs/RESEARCH-BACKLOG.md, voce 1):
 *   - in-sample:     stagioni 2019/20 – 2022/23  (le ipotesi si formulano e
 *     si stimano qui);
 *   - out-of-sample: stagioni 2023/24 – 2025/26  (solo validazione).
 * Un pattern che non regge out-of-sample si scarta e si dichiara scartato.
 *
 * Quattro test, uno per sezione del programma R1.5:
 *   1. drop × fascia di quota dell'esito sceso (pre-movimento <2.0 / 2.0–3.0 / >3.0);
 *   2. drop × lega (le cinque separatemente);
 *   3. drop sulla casa vs drop sulla trasferta;
 *   4. soglia di drop (3/5/8/10/15%) che massimizza il CLV per campione.
 *
 * Libro di riferimento: Pinnacle (lo sharp). Base comune ai test 1–3:
 * drop ≥ 5% sull'esito più sceso, come in R1. Il CLV è il bound
 * pre-movimento di R1: quota rilevata prima del movimento contro la
 * chiusura fair no-vig Pinnacle. Cresce meccanicamente con il drop: nei
 * verdetti conta la STABILITÀ del valore fra in-sample e out-of-sample.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

const IN_SAMPLE = ["2019/20", "2020/21", "2021/22", "2022/23"];
const OUT_OF_SAMPLE = ["2023/24", "2024/25", "2025/26"];

type Outcome = "H" | "D" | "A";

/* ------------------------------------------------------------------ */
/* Copia delle funzioni pure di scripts/backtest-r1.ts                  */
/* (script volutamente standalone: nessuna condivisione con il sito)    */
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
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
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
  const t = value.trim();
  if (t === "") return null;
  const p = Number.parseFloat(t);
  return Number.isFinite(p) && p > 0 ? p : null;
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function wilson95(k: number, n: number): [number, number] | null {
  if (n === 0) return null;
  const z = 1.959964;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function pct(v: number | null, d = 1): string {
  return v === null ? "n/d" : `${(v * 100).toFixed(d)}%`;
}

function pp(v: number | null, d = 1): string {
  return v === null ? "n/d" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
}

/* ------------------------------------------------------------------ */
/* Osservazioni                                                        */
/* ------------------------------------------------------------------ */

interface Obs {
  league: string;
  season: string;
  outcome: Outcome;
  drop: number; // frazione 0–1
  hit: boolean;
  impliedEarly: number; // 1/quota pre-movimento
  impliedCloseFair: number | null; // fair no-vig Pinnacle
  clvPct: number | null; // quota pre-movimento / fair chiusura − 1
  earlyOdds: number;
}

function fairProbabilities(close: Record<Outcome, number | null>): Record<Outcome, number> | null {
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

function buildObservations(): Obs[] {
  const obs: Obs[] = [];
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".csv"));

  for (const league of LEAGUES) {
    for (const season of SEASONS) {
      const file = `${league.code}-${season.code}.csv`;
      if (!files.includes(file)) continue;
      const rows = toRows(readFileSync(join(DATA_DIR, file), "latin1"));

      for (const row of rows) {
        const ftr = row["FTR"]?.trim();
        if (ftr !== "H" && ftr !== "D" && ftr !== "A") continue;

        const early: Record<Outcome, number | null> = {
          H: num(row.PSH), D: num(row.PSD), A: num(row.PSA),
        };
        const close: Record<Outcome, number | null> = {
          H: num(row.PSCH), D: num(row.PSCD), A: num(row.PSCA),
        };
        if ((["H", "D", "A"] as Outcome[]).some((o) => early[o] === null || close[o] === null)) continue;

        let best: Outcome = "H";
        let bestDrop = -Infinity;
        for (const o of ["H", "D", "A"] as Outcome[]) {
          const drop = 1 - (close[o] as number) / (early[o] as number);
          if (drop > bestDrop) {
            bestDrop = drop;
            best = o;
          }
        }

        const fair = fairProbabilities(close);
        const earlyOdds = early[best] as number;
        const fairProb = fair === null ? null : fair[best];

        obs.push({
          league: league.name,
          season: season.label,
          outcome: best,
          drop: bestDrop,
          hit: ftr === best,
          impliedEarly: 1 / earlyOdds,
          impliedCloseFair: fairProb,
          clvPct: fairProb === null ? null : earlyOdds * fairProb - 1,
          earlyOdds,
        });
      }
    }
  }
  return obs;
}

/* ------------------------------------------------------------------ */
/* Aggregati in-sample / out-of-sample                                 */
/* ------------------------------------------------------------------ */

interface Agg {
  n: number;
  hits: number;
  freq: number | null;
  ci: [number, number] | null;
  attesaFair: number | null;
  attesaEarly: number | null;
  /** freq reale − attesa fair, in pp */
  residuoPp: number | null;
  clvMean: number | null;
}

function aggregate(obs: Obs[]): Agg {
  const n = obs.length;
  const hits = obs.filter((o) => o.hit).length;
  const freq = n === 0 ? null : hits / n;
  const withFair = obs.filter((o) => o.impliedCloseFair !== null);
  const attesaFair = mean(withFair.map((o) => o.impliedCloseFair as number));
  const attesaEarly = mean(obs.map((o) => o.impliedEarly));
  const clv = mean(obs.filter((o) => o.clvPct !== null).map((o) => o.clvPct as number));
  return {
    n,
    hits,
    freq,
    ci: wilson95(hits, n),
    attesaFair,
    attesaEarly,
    residuoPp: freq !== null && attesaFair !== null ? (freq - attesaFair) * 100 : null,
    clvMean: clv,
  };
}

function half(obs: Obs[], sample: "in" | "out"): Obs[] {
  const seasons = sample === "in" ? IN_SAMPLE : OUT_OF_SAMPLE;
  return obs.filter((o) => seasons.includes(o.season));
}

function row(label: string, segment: Obs[]): string {
  const aIn = aggregate(half(segment, "in"));
  const aOut = aggregate(half(segment, "out"));
  const fmt = (a: Agg) =>
    `${a.n} | ${pct(a.freq)} | ${pct(a.attesaFair)} | ${pp(a.residuoPp)} | ${a.clvMean === null ? "n/d" : `${(a.clvMean * 100).toFixed(1)}%`}`;
  return `| ${label} | ${fmt(aIn)} | ${fmt(aOut)} |`;
}

const HEADER =
  "| Segmento | n in | freq in | attesa fair in | residuo pp in | CLV in | n out | freq out | attesa fair out | residuo pp out | CLV out |";
const SEP = "|---|---|---|---|---|---|---|---|---|---|---|";

function main(): void {
  const all = buildObservations();
  const base = all.filter((o) => o.drop >= 0.05); // fascia base ≥5%, come R1

  console.log("<!-- generato da scripts/backtest-r15.ts — tabelle rigenerabili -->\n");
  console.log(
    `Osservazioni Pinnacle totali (terna completa): ${all.length}; con drop ≥5%: ${base.length}.`,
  );
  console.log(
    `In-sample ${IN_SAMPLE.join(", ")}: ${half(base, "in").length} osservazioni ≥5%. Out-of-sample ${OUT_OF_SAMPLE.join(", ")}: ${half(base, "out").length}.\n`,
  );

  /* --- test 1: fascia di quota dell'esito sceso --- */
  console.log("## Test 1 — drop ≥5% × fascia di quota pre-movimento dell'esito sceso\n");
  console.log(HEADER);
  console.log(SEP);
  const bands: Array<[string, (o: Obs) => boolean]> = [
    ["quota < 2.0 (favorito)", (o) => o.earlyOdds < 2.0],
    ["quota 2.0–3.0", (o) => o.earlyOdds >= 2.0 && o.earlyOdds <= 3.0],
    ["quota > 3.0 (sfavorito)", (o) => o.earlyOdds > 3.0],
  ];
  for (const [label, fn] of bands) console.log(row(label, base.filter(fn)));
  console.log("");

  /* --- test 2: per lega --- */
  console.log("## Test 2 — drop ≥5% × lega\n");
  console.log(HEADER);
  console.log(SEP);
  for (const l of LEAGUES) console.log(row(l.name, base.filter((o) => o.league === l.name)));
  console.log("");

  /* --- test 3: casa vs trasferta --- */
  console.log("## Test 3 — drop ≥5%: esito casa vs esito trasferta\n");
  console.log(HEADER);
  console.log(SEP);
  console.log(row("drop sulla casa (1)", base.filter((o) => o.outcome === "H")));
  console.log(row("drop sulla trasferta (2)", base.filter((o) => o.outcome === "A")));
  console.log(row("drop sul pareggio (X, controllo)", base.filter((o) => o.outcome === "D")));
  console.log("");

  /* --- test 4: soglia di drop --- */
  console.log("## Test 4 — soglia di drop: CLV per campione in vs out-of-sample\n");
  console.log("| Soglia | n in | CLV in | freq−attesa pp in | n out | CLV out | freq−attesa pp out |");
  console.log("|---|---|---|---|---|---|---|");
  for (const t of [3, 5, 8, 10, 15]) {
    const seg = all.filter((o) => o.drop * 100 >= t);
    const aIn = aggregate(half(seg, "in"));
    const aOut = aggregate(half(seg, "out"));
    const f = (a: Agg) =>
      `${a.n} | ${a.clvMean === null ? "n/d" : `${(a.clvMean * 100).toFixed(1)}%`} | ${pp(a.residuoPp)}`;
    console.log(`| drop ≥ ${t}% | ${f(aIn)} | ${f(aOut)} |`);
  }
  console.log("");

  /* dettaglio n per fascia quota × soglia, per i verdetti */
  console.log("## Dettaglio n (per dichiarare i campioni piccoli)\n");
  console.log("| Segmento | n in | n out |");
  console.log("|---|---|---|");
  for (const [label, fn] of bands) {
    const seg = base.filter(fn);
    console.log(`| ${label} | ${half(seg, "in").length} | ${half(seg, "out").length} |`);
  }
  for (const l of LEAGUES) {
    const seg = base.filter((o) => o.league === l.name);
    console.log(`| ${l.name} | ${half(seg, "in").length} | ${half(seg, "out").length} |`);
  }
  for (const t of [3, 5, 8, 10, 15]) {
    const seg = all.filter((o) => o.drop * 100 >= t);
    console.log(`| soglia ≥${t}% | ${half(seg, "in").length} | ${half(seg, "out").length} |`);
  }
}

main();
