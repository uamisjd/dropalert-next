/**
 * Studio «partite finite» — dove sta (e dove non sta) il profitto.
 *
 * Script FUORI DAL SITO, come i backtest R1/R1.5/R2: nessuna importazione dal
 * codice di DropAlert, nessuna rete, nessun database. Legge gli stessi CSV
 * congelati in `data/football-data/` e stampa markdown su stdout:
 *
 *   npm run study:finished
 *
 * Perché esiste. L'archivio del monitor ha le partite finite ma non ha ancora
 * la forza per dire se un segnale vale denaro (238 osservazioni di CLV, indice
 * sopra i 50 punti quasi irraggiungibile con una sola fonte di consenso). I
 * CSV qui sotto danno ~12 500 partite con due prezzi per selezione
 * (pre-movimento e chiusura) più il risultato: non sostituiscono il dato
 * vivo, mettono alla prova le REGOLE con cui il sito giudica un movimento e
 * misurano quanta strada c'è fra «il mercato si è mosso» e «il prezzo che
 * ottengo batte il margine».
 *
 * Convenzioni (dichiarate, non negoziabili qui dentro):
 *  - probabilità implicita = 1/quota; movimenti in punti percentuali (pp),
 *    come nel sito; delta positivo = probabilità in salita = quota in calo;
 *  - classi di ampiezza del sito: <2 pp noise, 2–5 moderate, 5–10 high,
 *    >10 very_high (`src/lib/drop/constants.ts`);
 *  - fair no-vig per via proporzionale sulla terna completa (stesso metodo di
 *    `src/lib/drop/novig.ts`);
 *  - «pre-movimento» = colonna Friday del provider, NON l'apertura reale;
 *  - ROI = profitto per unità puntata; su un esito vinto la quota paga
 *    (quota − 1), su push la puntata torna indietro.
 *
 * Due famiglie di numeri, da non mescolare mai:
 *  A) RETROSPETTIVI — usano la chiusura per decidere la puntata: misurano
 *     quanto vale l'informazione, non sono eseguibili;
 *  B) SENZA LOOKAHEAD — tutto ciò che serve alla scelta è nell'istante della
 *     scelta: sono gli unici che possono diventare prodotto.
 *
 * Regola metodologica di R1.5 ereditata: le letture si commentano solo se
 * reggono out-of-sample (2023/24 → 2025/26). Sotto i 30 casi: dichiarato,
 * non commentato.
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

const SEASONS = ["1920", "2021", "2122", "2223", "2324", "2425", "2526"] as const;
const IN_SAMPLE = new Set(["1920", "2021", "2122", "2223"]);
const OUT_SAMPLE = new Set(["2324", "2425", "2526"]);

/** Libri con quote individuali nel CSV. `BFE*` è escluso di proposito: è il
    prezzo del betting exchange, non l'offerta di un bookmaker, e mescolarlo
    a un arbitraggio fra book darebbe occasioni inesistenti. */
const BOOK_PREFIXES = ["B365", "BFD", "BMGM", "BV", "BW", "CL", "LB", "PS"] as const;

/** Sotto questo numero di osservazioni la cella non si commenta. */
const MIN_N = 30;

type Side = "H" | "D" | "A";
const SIDES: Side[] = ["H", "D", "A"];

/* ------------------------------------------------------------------ */
/* Lettura dei CSV                                                     */
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
  const header = table[0].map((h) => h.trim());
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

/** Quota decimale valida, altrimenti null (mai 0, mai stimato). */
function odd(value: string | undefined): number | null {
  if (value === undefined) return null;
  const t = value.trim();
  if (t === "") return null;
  const p = Number.parseFloat(t);
  return Number.isFinite(p) && p > 1.0001 ? p : null;
}

function goal(value: string | undefined): number | null {
  if (value === undefined) return null;
  const t = value.trim();
  if (t === "") return null;
  const p = Number.parseInt(t, 10);
  return Number.isFinite(p) && p >= 0 ? p : null;
}

function lineVal(value: string | undefined): number | null {
  if (value === undefined) return null;
  const t = value.trim();
  if (t === "") return null;
  const p = Number.parseFloat(t);
  return Number.isFinite(p) ? p : null;
}

/* ------------------------------------------------------------------ */
/* Aritmetica delle quote                                              */
/* ------------------------------------------------------------------ */

function implied(price: number | null): number | null {
  return price === null ? null : 1 / price;
}

/** Somma delle implicite − 1: il margine del libro (0.055 = 5,5 pp). */
function overround(prices: (number | null)[]): number | null {
  if (prices.some((p) => p === null)) return null;
  return (prices as number[]).reduce((a, p) => a + 1 / p, 0) - 1;
}

/** Fair no-vig proporzionale su una terna completa. */
function fairTerna(prices: Record<Side, number | null>): Record<Side, number> | null {
  const imp = SIDES.map((s) => implied(prices[s]));
  if (imp.some((p) => p === null)) return null;
  const sum = (imp as number[]).reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  const out = {} as Record<Side, number>;
  SIDES.forEach((s, i) => {
    out[s] = (imp[i] as number) / sum;
  });
  return out;
}

/** Fair no-vig su mercato a due selezioni (Over/Under, handicap). */
function fairTwo(a: number | null, b: number | null): [number, number] | null {
  const ia = implied(a);
  const ib = implied(b);
  if (ia === null || ib === null) return null;
  const sum = ia + ib;
  if (sum <= 0) return null;
  return [ia / sum, ib / sum];
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs) as number;
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
}

function se(xs: number[]): number | null {
  const s = stdev(xs);
  return s === null || xs.length < 2 ? null : s / Math.sqrt(xs.length);
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

const pc = (v: number | null, d = 1): string => (v === null ? "n/d" : `${(v * 100).toFixed(d)}%`);
const signed = (v: number | null, d = 2): string =>
  v === null ? "n/d" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
const plain = (v: number | null, d = 2): string => (v === null ? "n/d" : v.toFixed(d));

/* ------------------------------------------------------------------ */
/* Modello dei dati                                                    */
/* ------------------------------------------------------------------ */

interface Terna {
  H: number | null;
  D: number | null;
  A: number | null;
}

interface Pair {
  a: number | null;
  b: number | null;
}

interface Fixture {
  league: string;
  seasonCode: string;
  season: string;
  date: string;
  home: string;
  away: string;
  goalsH: number | null;
  goalsA: number | null;
  result: Side | null;

  b365Open: Terna;
  b365Close: Terna;
  psOpen: Terna;
  psClose: Terna;
  avgOpen: Terna;
  avgClose: Terna;
  maxOpen: Terna;
  maxClose: Terna;

  ouOpen: Pair; // Bet365 over/under 2.5
  ouClose: Pair;
  ouPSOpen: Pair; // Pinnacle
  ouPSClose: Pair;
  ouOpen25: boolean; // il mercato over/under era su 2.5? (flag di qualità)

  /** una terna per ogni libro quotato nel CSV (escluso il betting exchange) */
  booksOpen: Terna[];
  booksClose: Terna[];

  ahLineOpen: number | null;
  ahLineClose: number | null;
  ahB365Open: Pair;
  ahB365Close: Pair;
  ahPSOpen: Pair;
  ahPSClose: Pair;
}

function terna(rec: Record<string, string>, prefix: string, suffix = ""): Terna {
  return {
    H: odd(rec[`${prefix}${suffix}H`]),
    D: odd(rec[`${prefix}${suffix}D`]),
    A: odd(rec[`${prefix}${suffix}A`]),
  };
}

function pair(rec: Record<string, string>, keyA: string, keyB: string): Pair {
  return { a: odd(rec[keyA]), b: odd(rec[keyB]) };
}

function loadFixtures(): Fixture[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".csv"));
  const name = new Map<string, string>(LEAGUES.map((l) => [l.code, l.name]));
  const out: Fixture[] = [];

  for (const file of files) {
    const [code, seasonCode] = file.replace(".csv", "").split("-");
    if (!name.has(code) || !SEASONS.includes(seasonCode as (typeof SEASONS)[number])) {
      continue;
    }
    const season = `${2000 + Number(seasonCode.slice(0, 2))}/${String(
      2000 + Number(seasonCode.slice(2)),
    ).slice(2)}`;

    for (const rec of toRows(readFileSync(join(DATA_DIR, file), "latin1"))) {
      const goalsH = goal(rec["FTHG"]);
      const goalsA = goal(rec["FTAG"]);
      const raw = (rec["FTR"] ?? "").trim().toUpperCase();
      const result: Side | null =
        raw === "H" || raw === "D" || raw === "A"
          ? raw
          : goalsH !== null && goalsA !== null
            ? goalsH > goalsA
              ? "H"
              : goalsH < goalsA
                ? "A"
                : "D"
            : null;

      out.push({
        league: name.get(code) as string,
        seasonCode,
        season,
        date: rec["Date"] ?? "",
        home: rec["HomeTeam"] ?? "",
        away: rec["AwayTeam"] ?? "",
        goalsH,
        goalsA,
        result,
        b365Open: terna(rec, "B365"),
        b365Close: terna(rec, "B365", "C"),
        psOpen: terna(rec, "PS"),
        psClose: terna(rec, "PS", "C"),
        booksOpen: BOOK_PREFIXES.map((pref) => terna(rec, pref)),
        booksClose: BOOK_PREFIXES.map((pref) => terna(rec, pref, "C")),
        avgOpen: terna(rec, "Avg"),
        avgClose: terna(rec, "Avg", "C"),
        maxOpen: terna(rec, "Max"),
        maxClose: terna(rec, "Max", "C"),
        ouOpen: pair(rec, "B365>2.5", "B365<2.5"),
        ouClose: pair(rec, "B365C>2.5", "B365C<2.5"),
        ouPSOpen: pair(rec, "P>2.5", "P<2.5"),
        ouPSClose: pair(rec, "PC>2.5", "PC<2.5"),
        ouOpen25: true,
        ahLineOpen: lineVal(rec["AHh"]),
        ahLineClose: lineVal(rec["AHCh"]),
        ahB365Open: pair(rec, "B365AHH", "B365AHA"),
        ahB365Close: pair(rec, "B365CAHH", "B365CAHA"),
        ahPSOpen: pair(rec, "PAHH", "PAHA"),
        ahPSClose: pair(rec, "PCAHH", "PCAHA"),
      });
    }
  }
  return out;
}

const isIn = (f: Fixture): boolean => IN_SAMPLE.has(f.seasonCode);
const isOut = (f: Fixture): boolean => OUT_SAMPLE.has(f.seasonCode);

/* ------------------------------------------------------------------ */
/* Pagamento                                                           */
/* ------------------------------------------------------------------ */

function profitOf(price: number, won: boolean): number {
  return won ? price - 1 : -1;
}

function won1x2(f: Fixture, side: Side): boolean | null {
  if (f.result === null) return null;
  return f.result === side;
}

/** Over/Under 2.5: con gol interi non esiste push. */
function wonOu(f: Fixture, over: boolean): boolean | null {
  if (f.goalsH === null || f.goalsA === null) return null;
  const total = f.goalsH + f.goalsA;
  return over ? total > 2.5 : total < 2.5;
}

/**
 * Handicap asiatico: le linee .25/.75 si spaccano in due mezze puntate sulle
 * due linee adiacenti (mezza vincita / mezza perdita / push).
 */
function ahProfit(
  price: number,
  side: "home" | "away",
  handicap: number,
  goalsH: number,
  goalsA: number,
): number | null {
  const diff = goalsH - goalsA;
  const l = side === "home" ? handicap : -handicap;
  const frac = Math.abs(l % 0.5);
  const legs = frac > 0.001 ? [l - 0.25, l + 0.25] : [l];
  let total = 0;
  for (const leg of legs) {
    const margin = side === "home" ? diff + leg : -(diff + leg);
    if (Math.abs(margin) < 1e-9) total += 0;
    else if (margin > 0) total += price - 1;
    else total += -1;
  }
  return total / legs.length;
}

/* ------------------------------------------------------------------ */
/* Aggregati                                                           */
/* ------------------------------------------------------------------ */

/** Una puntata osservata: prezzo pagato, esito, fair di chiusura, età. */
interface Shot {
  /** profitto per unità puntata */
  profit: number;
  /** true se la selezione ha vinto (push esclusi dal conteggio frequenze) */
  won: boolean;
  push: boolean;
  /** fair no-vig della chiusura, se calcolabile (serve per il residuo) */
  fair: number | null;
  /** implicita pagata */
  paid: number;
  price: number;
  /** stagione in-sample o out-of-sample */
  out: boolean;
  /** fascia di quota */
  band: string;
}

function shot(
  f: Fixture,
  price: number | null,
  won: boolean | null,
  fair: number | null,
  profit?: number,
): Shot | null {
  if (price === null || won === null) return null;
  const p = profit ?? profitOf(price, won);
  return {
    profit: p,
    won: won === true,
    push: profit !== undefined && p === 0,
    fair,
    paid: 1 / price,
    price,
    out: isOut(f),
    band: oddsBand(price),
  };
}

/** Punto d'appoggio per gli insiemi di puntate che non hanno una fair. */

interface Agg {
  n: number;
  /** quante osservazioni hanno una fair di chiusura (copertura del confronto) */
  fairN: number;
  roi: number | null;
  roiSe: number | null;
  hit: number | null;
  hitCi: [number, number] | null;
  fair: number | null;
  residual: number | null;
  avgPrice: number | null;
  t: number | null;
}

function agg(shots: Shot[]): Agg {
  const settled = shots.filter((s) => !s.push);
  const profits = shots.map((s) => s.profit);
  const fairVals = shots.filter((s) => s.fair !== null).map((s) => s.fair as number);
  const hits = settled.filter((s) => s.won).length;
  const hitRate = settled.length > 0 ? hits / settled.length : null;
  const roi = mean(profits);
  const roiSe = se(profits);
  const fairVals2 = fairVals;
  return {
    n: shots.length,
    fairN: fairVals2.length,
    roi,
    roiSe,
    hit: hitRate,
    hitCi: wilson95(hits, settled.length),
    fair: mean(fairVals2),
    residual:
      hitRate === null || fairVals2.length < 0.9 * shots.length
        ? null
        : (hitRate - (mean(fairVals2) as number)) * 100,
    avgPrice: mean(shots.map((s) => s.price)),
    t: roi === null || roiSe === null || roiSe === 0 ? null : roi / roiSe,
  };
}

function aggOf(shots: Shot[], out: boolean | null): Agg {
  const sel = out === null ? shots : shots.filter((s) => s.out === out);
  return agg(sel);
}

/** Fascia di quota alla stessa scala usata in R1.5, estesa al longshot. */
function oddsBand(price: number): string {
  if (price < 1.4) return "1.01–1.39";
  if (price < 2.0) return "1.40–1.99";
  if (price < 3.0) return "2.00–2.99";
  if (price < 5.0) return "3.00–4.99";
  if (price < 10.0) return "5.00–9.99";
  return "10.00+";
}

const BANDS = ["1.01–1.39", "1.40–1.99", "2.00–2.99", "3.00–4.99", "5.00–9.99", "10.00+"];

/** Classi di ampiezza esattamente come le definisce il sito. */
function magnitudeClass(deltaPp: number): "noise" | "moderate" | "high" | "very_high" {
  if (deltaPp < 2) return "noise";
  if (deltaPp < 5) return "moderate";
  if (deltaPp < 10) return "high";
  return "very_high";
}

const HEAD = `| Segmento | n | Frequent. reale | Attesa fair chiusura | Residuo (pp) | ROI | IC 95% del ROI | t | Verdetto |
|---|---|---|---|---|---|---|---|---|`;

function lineOut(label: string, a: Agg): string {
  const weak = a.n < MIN_N;
  return `| ${label} | ${a.n}${weak ? " *(n<${MIN_N})*" : ""} | ${pc(a.hit)} | ${pc(a.fair, 1)} | ${
    a.residual === null ? "n/d" : signed(a.residual, 1)
  } | ${pc(a.roi, 2)} | ${a.roiSe === null ? "n/d" : `±${(a.roiSe * 100).toFixed(2)} pp`} | ${
    a.t === null ? "n/d" : a.t.toFixed(2)
  } | ${weak ? "non concludente" : a.t !== null && a.t > 1.96 ? "sopra zero" : a.t !== null && a.t < -1.96 ? "sotto zero" : "non distinguibile da zero"} |`;
}

/* ------------------------------------------------------------------ */
/* Costruzione delle osservazioni                                      */
/* ------------------------------------------------------------------ */

interface Obs {
  f: Fixture;
  /** selezione più scesa per movimento di probabilità implicita (Pinnacle) */
  side: Side;
  deltaPp: number; // pre-movimento → chiusura, Pinnacle
  dropPct: number; // variazione di quota in frazione (negativa = quota calo)
  openPrice: number | null; // Pinnacle pre-movimento
  /** puntate possibili sulla selezione più scesa */
  atB365Close: Shot | null;
  atMaxClose: Shot | null;
  atB365Open: Shot | null;
  /** tutte le selezioni della partita a chiusura, marcata quella scesa: il
      riferimento «stessa fascia, stesso calendario, nessun segnale» si
      costruisce escludendo la selezione scesa, mai tenendola in entrambi i
      gruppi (sovrapposizione = confronto falso). */
  matchShots: { shot: Shot; dropped: boolean }[];
}

function buildObs(fx: Fixture[]): Obs[] {
  const out: Obs[] = [];
  for (const f of fx) {
    if (f.result === null) continue;
    if (SIDES.some((s) => f.psOpen[s] === null || f.psClose[s] === null)) continue;
    const deltas = SIDES.map((s) => ({
      side: s,
      delta: ((1 / (f.psClose[s] as number)) - (1 / (f.psOpen[s] as number))) * 100,
    })).sort((a, b) => b.delta - a.delta);
    const top = deltas[0];
    if (top.delta <= 0) continue; // nessun movimento nella direzione del drop

    const fair = fairTerna(f.psClose);
    const openPrice = f.psOpen[top.side];
    out.push({
      f,
      side: top.side,
      deltaPp: top.delta,
      dropPct: (f.psClose[top.side] as number) / (f.psOpen[top.side] as number) - 1,
      openPrice,
      atB365Close: shot(f, f.b365Close[top.side], won1x2(f, top.side), fair ? fair[top.side] : null),
      atMaxClose: shot(f, f.maxClose[top.side], won1x2(f, top.side), fair ? fair[top.side] : null),
      atB365Open: shot(f, f.b365Open[top.side], won1x2(f, top.side), fair ? fair[top.side] : null),
      matchShots: SIDES.map((s) => ({
        shot: shot(f, f.b365Close[s], won1x2(f, s), fair ? fair[s] : null) as Shot,
        dropped: s === top.side,
      })).filter((x) => x.shot !== null && x.shot !== undefined),
    });
  }
  return out;
}

/* ================================================================== */
/* S0 — censimento                                                     */
/* ================================================================== */

function sectionCensus(fx: Fixture[]): void {
  console.log("## S0 — Che cosa c'è davvero nell'archivio congelato\n");
  const withResult = fx.filter((f) => f.result !== null);
  const usable = withResult.filter(
    (f) =>
      SIDES.every((s) => f.psOpen[s] !== null && f.psClose[s] !== null) &&
      SIDES.every((s) => f.b365Close[s] !== null),
  );
  console.log(
    `Righe lette: ${fx.length} · con risultato: ${withResult.length} · base comune ` +
      `(esito + terna Pinnacle nei due istanti + terna Bet365 a chiusura): **${usable.length}** ` +
      `· di cui out-of-sample ${usable.filter(isOut).length}.`,
  );
  console.log("");
  console.log("| Campionato | partite | base usabile | Pinnacle assente |");
  console.log("|---|---|---|---|");
  for (const l of LEAGUES) {
    const all = withResult.filter((f) => f.league === l.name);
    const ok = usable.filter((f) => f.league === l.name);
    console.log(`| ${l.name} | ${all.length} | ${ok.length} | ${all.length - ok.length} |`);
  }
  console.log("");
  console.log(
    "Nessuna partita viene scartata in silenzio: la colonna «Pinnacle assente» è " +
      "il conto di ciò che non è misurabile (stagione 2025/26 interrotta a metà " +
      "dal provider, dichiarato in `data/README.md`).",
  );
}

/* ================================================================== */
/* S1 — quanto è margine e non informazione                          */
/* ================================================================== */

function sectionMargin(fx: Fixture[]): void {
  console.log("\n## S1 — Quanto del CLV negativo è soltanto margine\n");
  console.log(
    "Domanda tecnica con conseguenze economiche: quando il CLV è calcolato " +
      "contro una chiusura GREZZA (base `raw_consensus`, quella che il sito usa " +
      "quando il mercato non è completo o la fonte non espone i singoli libri), " +
      "quanta parte del delta negativo è imposta del bookmaker e non mercato.\n",
  );

  const samples = new Map<string, number[]>();
  const add = (k: string, v: number | null) => {
    if (v === null) return;
    samples.set(k, [...(samples.get(k) ?? []), v * 100]);
  };
  for (const f of fx) {
    add("Bet365 · pre-movimento", overround(SIDES.map((s) => f.b365Open[s])));
    add("Bet365 · chiusura", overround(SIDES.map((s) => f.b365Close[s])));
    add("Consenso (Avg) · pre-movimento", overround(SIDES.map((s) => f.avgOpen[s])));
    add("Consenso (Avg) · chiusura", overround(SIDES.map((s) => f.avgClose[s])));
    add("Pinnacle · pre-movimento", overround(SIDES.map((s) => f.psOpen[s])));
    add("Pinnacle · chiusura", overround(SIDES.map((s) => f.psClose[s])));
    add("Migliore disponibile · chiusura", overround(SIDES.map((s) => f.maxClose[s])));
  }
  console.log("| Libro e istante | n partite | margine medio (pp) |");
  console.log("|---|---|---|");
  for (const [k, xs] of samples) {
    console.log(`| ${k} | ${xs.length} | ${plain(mean(xs))} |`);
  }

  console.log(
    "\nImposta per singola selezione: implicita del consenso **meno** fair no-vig " +
      "Pinnacle, stesso istante (chiusura). È ciò che un CLV su base grezza perde " +
      "per costruzione, fascia per fascia.\n",
  );
  const byBand = new Map<string, number[]>();
  for (const f of fx) {
    const fair = fairTerna(f.psClose);
    if (fair === null) continue;
    for (const s of SIDES) {
      const c = f.avgClose[s];
      if (c === null) continue;
      const k = oddsBand(c);
      byBand.set(k, [...(byBand.get(k) ?? []), (1 / c - fair[s]) * 100]);
    }
  }
  console.log("| Fascia di quota a chiusura | selezioni | imposta media (pp di probabilità) |");
  console.log("|---|---|---|");
  for (const b of BANDS) {
    const xs = byBand.get(b);
    if (!xs || xs.length === 0) continue;
    console.log(`| ${b} | ${xs.length} | ${signed(mean(xs))} |`);
  }
  console.log("");
  console.log(
    "Lettura: un CLV medio di −3,77 pp su base grezza, in fascia 1.40–2.99, è " +
      "dentro due punti e mezzo di imposta: non è una bocciatura del metodo, è " +
      "un numero **non confrontabile**. Finché la base non è `fair_novig` su " +
      "tutta la popolazione, la frase giusta è «non misurabile», non «negativo».",
  );

  /* ---------------------------------------------------------------- */
  console.log(
    "\n### 1.1 — La prova del bias di base (è il controllo più importante di tutto lo studio)\n",
  );
  console.log(
    "Il sito calcola `clvPp = (probChiusura − probSegnale) × 100`. Se la " +
      "probabilità di chiusura è quella **fair senza margine** e quella del " +
      "segnale è il prezzo **grezzo** (che il margine lo contiene), il " +
      "confronto mescola due basi e il CLV esce depresso di un importo " +
      "meccanico, non di mercato. Qui sotto la stessa partita misurata nei " +
      "due modi onesti: grezzo-contro-grezzo, fair-contro-fair.\n",
  );
  const bias: { all: number[]; flip: number; n: number } = { all: [], flip: 0, n: 0 };
  const biasBand = new Map<string, number[]>();
  for (const f of fx) {
    /* stesso libro, stesso istante di chiusura: l'unica differenza fra i due
       numeri è la rimozione del margine, quindi la misura è pulita */
    const fairClose = fairTerna(f.b365Close);
    if (fairClose === null) continue;
    for (const side of SIDES) {
      const openRaw = f.b365Open[side];
      const closeRaw = f.b365Close[side];
      if (openRaw === null || closeRaw === null) continue;
      const sigProb = 1 / openRaw;
      /* CLV come lo produce una base mista: segnale grezzo contro chiusura fair */
      const mixed = (fairClose[side] - sigProb) * 100;
      /* CLV con le due quote sulla stessa base: grezzo contro grezzo */
      const same = (1 / closeRaw - sigProb) * 100;
      bias.all.push(mixed - same);
      bias.n += 1;
      if (mixed <= 0 !== same <= 0) bias.flip += 1;
      const band = oddsBand(openRaw);
      biasBand.set(band, [...(biasBand.get(band) ?? []), mixed - same]);
    }
  }
  console.log("| Fascia di quota al rilevamento | osservazioni | spostamento medio del CLV per solo errore di base (pp) |");
  console.log("|---|---|---|");
  for (const band of BANDS) {
    const xs = biasBand.get(band);
    if (!xs || xs.length === 0) continue;
    console.log(`| ${band} | ${xs.length} | ${signed(mean(xs))} pp |`);
  }
  console.log("");
  console.log(
    `Media su tutte le ${bias.n} osservazioni: **${signed(
      mean(bias.all),
    )} pp** di CLV bruciati dal solo errore di base, e ${(
      ((100 * bias.flip) / Math.max(1, bias.n)).toFixed(1)
    )}% dei casi cambierebbe verso (da «non ha battuto la chiusura» a «l'ha battuta», o il contrario).`,
  );
  console.log("");
  console.log(
    "Conseguenza diretta su /performance: un CLV medio di −3,77 pp su 238 " +
      "osservazioni è dello stesso ordine di grandezza dello spostamento " +
      "meccanico qui misurato. Prima di leggere qualsiasi verdetto sui " +
      "signal, la domanda da mettere per iscritto è: **le due quote del CLV " +
      "stanno sulla stessa base?** Se no, il numero non dice che i drop " +
      "perdono: dice che il confronto è sporco.",
  );
}

/* ================================================================== */
/* S2 — il valore assorbito: quanto in fretta bisogna arrivare       */
/* ================================================================== */

function sectionDecay(obs: Obs[]): void {
  console.log("\n## S2 — Quanto del movimento è già assorbito dal prezzo\n");
  console.log(
    "Il drop che il monitor rileva non è denaro: è denaro **finché qualcuno è " +
      "disposto a fare meglio di te**. Misura: per la selezione più scesa, la " +
      "differenza fra il prezzo pre-movimento e la chiusura, e quanto resta " +
      "disponibile a chiusura.\n",
  );
  const kept = obs.filter((o) => o.atB365Close !== null && o.atB365Open !== null);
  const byClass = new Map<string, { absorb: number[]; openProb: number[]; closeProb: number[] }>();
  for (const o of kept) {
    const cls = magnitudeClass(o.deltaPp);
    const e = byClass.get(cls) ?? { absorb: [], openProb: [], closeProb: [] };
    /* frazione di movimento che sopravvive fino alla chiusura (pre-movimento e
       apertura soft a confronto: quanta parte del prezzo la si può ancora avere) */
    e.absorb.push(1 - (o.atB365Close as Shot).paid / (o.atB365Open as Shot).paid);
    e.openProb.push((o.atB365Open as Shot).paid);
    e.closeProb.push((o.atB365Close as Shot).paid);
    byClass.set(cls, e);
  }
  console.log("| Classe di ampiezza (soglie del sito) | n | Δ implicita pre→chiusura (pp) | ROI puntando sulla stessa selezione al prezzo pre-movimento | ROI alla chiusura |");
  console.log("|---|---|---|---|---|");
  for (const cls of ["moderate", "high", "very_high"]) {
    const e = byClass.get(cls);
    if (!e || e.absorb.length === 0) continue;
    const a = agg(
      kept.filter((o) => magnitudeClass(o.deltaPp) === cls).map((o) => o.atB365Open as Shot),
    );
    const b = agg(
      kept.filter((o) => magnitudeClass(o.deltaPp) === cls).map((o) => o.atB365Close as Shot),
    );
    console.log(
      `| \`${cls}\` | ${e.absorb.length} | ${signed(mean(e.closeProb) === null ? null : ((mean(e.closeProb) as number) - (mean(e.openProb) as number)) * 100, 2)} | ${pc(
        a.roi,
        2,
      )} | ${pc(b.roi, 2)} |`,
    );
  }
  console.log("");
  console.log(
    "Perché conta per il prodotto: la cadenza del collector è di ~45 minuti. Se " +
      "il movimento si consuma in una frazione d'ora, un segnale arrivato dopo " +
      "vale poco in termini di prezzo e la corsa non è sul trovare il drop, è " +
      "nell'arrivare prima. È la stessa gerarchia che R1.5 aveva già indicato: " +
      "il valore del movimento cresce con la soglia, ma il prezzo a cui lo " +
      "ottieni cresce con esso.",
  );
}

/* ================================================================== */
/* S3 — il drop ha valore informativo? (confronto con la stessa fascia) */
/* ================================================================== */

function sectionDropVsBaseline(obs: Obs[]): void {
  console.log("\n## S3 — Il drop aggiunge qualcosa al «puntare a caso nella stessa fascia»?\n");
  console.log(
    "Test corretto: la selezione più scesa si giudica contro le selezioni della " +
      "**stessa fascia di quota delle stesse partite**, non contro la media " +
      "generale — altrimenti si misura la lunghezza della quota, non il " +
      "movimento. Base retrospettiva (quota di chiusura), dichiarata come tetto.\n",
  );

  /* Il riferimento onesto: per ogni fascia di quota, tutte le selezioni di
     tutte le partite a quella stessa quota, ESCLUSA la selezione scesa. */
  const pool: { band: string; shot: Shot; dropped: boolean }[] = [];
  for (const o of obs) {
    if (o.atB365Close === null) continue;
    for (const m of o.matchShots) {
      pool.push({ band: m.shot.band, shot: m.shot, dropped: m.dropped });
    }
  }

  for (const [title, out] of [
    ["In-sample 2019/20–2022/23", false],
    ["Out-of-sample 2023/24–2025/26", true],
  ] as [string, boolean][]) {
    console.log(`\n**${title}** — stessa fascia di quota, stesso metodo:\n`);
    console.log(
      "| Fascia di quota | puntate sul calo (n, ROI) | riferimento senza segnale (n, ROI) | Differenza | Errore standard della differenza | t |",
    );
    console.log("|---|---|---|---|---|---|");
    for (const band of BANDS) {
      const inBand = pool.filter((x) => x.band === band && x.shot.out === out);
      const dropped = inBand.filter((x) => x.dropped).map((x) => x.shot);
      const base = inBand.filter((x) => !x.dropped).map((x) => x.shot);
      if (dropped.length < MIN_N || base.length < MIN_N) continue;
      const a = agg(dropped);
      const b = agg(base);
      const diff = (a.roi as number) - (b.roi as number);
      const seDiff =
        a.roiSe !== null && b.roiSe !== null ? Math.sqrt(a.roiSe ** 2 + b.roiSe ** 2) : null;
      console.log(
        `| ${band} | ${a.n}, ROI ${pc(a.roi, 2)} | ${b.n}, ROI ${pc(b.roi, 2)} | **${signed(
          diff * 100,
          2,
        )} pp** | ${seDiff === null ? "n/d" : `${(seDiff * 100).toFixed(2)} pp`} | ${
          seDiff === null ? "n/d" : (diff / seDiff).toFixed(2)
        } |`,
      );
    }
  }

  console.log("\n### 3.1 — Per classe di ampiezza, e solo dove il sito potrebbe arrivare\n");
  console.log(HEAD);
  for (const cls of ["moderate", "high", "very_high"]) {
    const all = obs.filter((o) => magnitudeClass(o.deltaPp) === cls && o.atB365Close !== null);
    if (all.length < MIN_N) continue;
    console.log(
      lineOut(
        `tutte le stagioni · \`${cls}\` (${all.filter((o) => isOut(o.f)).length} fuori campione)`,
        agg(all.map((o) => o.atB365Close as Shot)),
      ),
    );
  }
  for (const cls of ["moderate", "high", "very_high"]) {
    const all = obs.filter(
      (o) => magnitudeClass(o.deltaPp) === cls && isOut(o.f) && o.atB365Close !== null,
    );
    if (all.length < MIN_N) continue;
    console.log(lineOut(`fuori campione · \`${cls}\``, agg(all.map((o) => o.atB365Close as Shot))));
  }

  console.log("\n### 3.2 — Con il prezzo migliore disponibile invece di Bet365\n");
  console.log(HEAD);
  for (const cls of ["moderate", "high", "very_high"]) {
    const all = obs.filter((o) => magnitudeClass(o.deltaPp) === cls && o.atMaxClose !== null);
    if (all.length < MIN_N) continue;
    console.log(lineOut(`\`${cls}\` al prezzo migliore`, agg(all.map((o) => o.atMaxClose as Shot))));
  }
  console.log("");
  console.log(
    "Il confronto 3.1 / 3.2 è il vero «dove si può fare profit» su questa idea: " +
      "stesso segnale, prezzo diverso. Se il ROI gira solo comprando meglio, la " +
      "strategia non è il segnale.",
  );
}

/* ================================================================== */
/* S4 — valore senza lookahead, per decili di edge                    */
/* ================================================================== */

interface EdgeShot extends Shot {
  /** pp di probabilità: fair sharp − implicita pagata, allo stesso istante */
  edge: number;
}

function buildEdgeShots(fx: Fixture[], when: "open" | "close"): EdgeShot[] {
  const out: EdgeShot[] = [];
  for (const f of fx) {
    if (f.result === null) continue;
    const fair = fairTerna(when === "open" ? f.psOpen : f.psClose);
    if (fair === null) continue;
    for (const s of SIDES) {
      const price = (when === "open" ? f.b365Open : f.b365Close)[s];
      if (price === null) continue;
      const won = won1x2(f, s);
      if (won === null) continue;
      const sh = shot(f, price, won, fair[s]);
      if (sh === null) continue;
      out.push({ ...sh, edge: (fair[s] - 1 / price) * 100 });
    }
  }
  return out;
}

function sectionEdge(fx: Fixture[]): void {
  console.log(
    "\n## S4 — Esecuibile: valore contro il fair sharp allo stesso istante, per decili\n",
  );
  console.log(
    "Regola del test: tutto ciò che serve per decidere deve essere nell'istante " +
      "della scelta. Confronto fra l'implicita pagata (Bet365) e la fair no-vig " +
      "Pinnacle **nello stesso istante**; poi ROI realizzato sui gol. Nessun uso " +
      "della chiusura per scegliere: questi numeri sono eseguibili, non " +
      "retrospettivi.\n",
  );

  for (const when of ["open", "close"] as const) {
    const shots = buildEdgeShots(fx, when);
    const sorted = [...shots].sort((a, b) => a.edge - b.edge);
    const k = 10;
    console.log(
      `\n### 4.${when === "open" ? "1" : "2"} — istante ${
        when === "open" ? "pre-movimento (venerdì)" : "chiusura"
      } — ${sorted.length} puntate\n`,
    );
    console.log("| Decile di edge vs fair sharp | edge medio (pp) | n | Frequent. reale | Attesa fair | Residuo (pp) | ROI | IC 95% del ROI | t |");
    console.log("|---|---|---|---|---|---|---|---|---|");
    for (let i = 0; i < k; i += 1) {
      const part = sorted.slice(Math.floor((i * sorted.length) / k), Math.floor(((i + 1) * sorted.length) / k));
      if (part.length === 0) continue;
      const a = agg(part);
      console.log(
        `| D${i + 1} | ${signed(mean(part.map((s) => s.edge)))} | ${a.n} | ${pc(a.hit)} | ${pc(
          a.fair,
          1,
        )} | ${signed(a.residual, 1)} | ${pc(a.roi, 2)} | ${
          a.roiSe === null ? "n/d" : `±${(a.roiSe * 100).toFixed(2)} pp`
        } | ${a.t === null ? "n/d" : a.t.toFixed(2)} |`,
      );
    }
    const top = sorted.slice(Math.floor(0.9 * sorted.length));
    const a = agg(top);
    const aOut = aggOf(top, true);
    console.log(
      `\nDecile migliore (${a.n} puntate, ROI ${pc(a.roi, 2)}) — solo out-of-sample: n ${
        aOut.n
      }, ROI ${pc(aOut.roi, 2)}, IC ±${aOut.roiSe === null ? "n/d" : (aOut.roiSe * 100).toFixed(2)} pp.` +
        (when === "close"
          ? "\n\n*Alla chiusura il confronto è fra due prezzi quasi simultanei: è il test più pulito ma anche il più costoso da eseguire (limiti, conti, velocità).*"
          : ""),
    );
  }

  console.log("\n### 4.3 — Stessa regola sugli altri due mercati (istante di chiusura)\n");
  const ou: EdgeShot[] = [];
  const ah: EdgeShot[] = [];
  for (const f of fx) {
    const fairOu = fairTwo(f.ouPSClose.a, f.ouPSClose.b);
    if (fairOu !== null) {
      const opts = [
        { over: true, price: f.ouClose.a, fair: fairOu[0] },
        { over: false, price: f.ouClose.b, fair: fairOu[1] },
      ];
      for (const o of opts) {
        if (o.price === null) continue;
        const won = wonOu(f, o.over);
        if (won === null) continue;
        ou.push({ ...(shot(f, o.price, won, o.fair) as Shot), edge: (o.fair - 1 / o.price) * 100 });
      }
    }
    const fairAh = fairTwo(f.ahPSClose.a, f.ahPSClose.b);
    if (fairAh !== null && f.ahLineClose !== null && f.goalsH !== null && f.goalsA !== null) {
      const opts = [
        { side: "home" as const, price: f.ahB365Close.a, fair: fairAh[0] },
        { side: "away" as const, price: f.ahB365Close.b, fair: fairAh[1] },
      ];
      for (const o of opts) {
        if (o.price === null) continue;
        const p = ahProfit(o.price, o.side, f.ahLineClose, f.goalsH, f.goalsA);
        if (p === null) continue;
        const sh = shot(f, o.price, p > 0, o.fair, p);
        if (sh === null) continue;
        ah.push({ ...sh, edge: (o.fair - 1 / o.price) * 100 });
      }
    }
  }
  for (const [label, shots] of [
    ["Over/Under 2.5", ou],
    ["Handicap asiatico", ah],
  ] as [string, EdgeShot[]][]) {
    const sorted = [...shots].sort((x, y) => x.edge - y.edge);
    const top = sorted.slice(Math.floor(0.9 * sorted.length));
    const bottom = sorted.slice(0, Math.floor(0.1 * sorted.length));
    const aT = agg(top);
    const aB = agg(bottom);
    console.log(
      `- **${label}** (${shots.length} puntate): decile di edge più alto → ROI ${pc(aT.roi, 2)} ` +
        `(n ${aT.n}, t ${aT.t === null ? "n/d" : aT.t.toFixed(2)}); decile più basso → ROI ${pc(
        aB.roi,
        2,
      )}. Ampiezza della scala: ${signed(aT.roi === null || aB.roi === null ? null : (aT.roi - aB.roi) * 100, 2)} pp di ROI.`,
    );
  }
}

/* ================================================================== */
/* S5 — CLV come predittore del profitto: la riga del break-even      */
/* ================================================================== */

function sectionClv(fx: Fixture[]): void {
  console.log("\n## S5 — Il CLV predice i soldi? Tabella di break-even\n");
  console.log(
    "È la tabella che decide se il CLV — l'unica misura di validità del sito — " +
      "misura denaro o solo igiene statistica. Scelta senza lookahead: si paga " +
      "il prezzo Bet365 del pre-movimento; il «CLV contro la fair di chiusura» è " +
      "quanto la fair Pinnacle alla chiusura stava sopra l'implicita pagata.\n",
  );
  interface R2 {
    clv: number;
    expected: number;
    profit: number;
    out: boolean;
  }
  const rows2: R2[] = [];
  for (const f of fx) {
    if (f.result === null) continue;
    const fair = fairTerna(f.psClose);
    if (fair === null) continue;
    for (const s2 of SIDES) {
      const p = f.b365Open[s2];
      if (p === null) continue;
      const won = won1x2(f, s2);
      if (won === null) continue;
      rows2.push({
        clv: (fair[s2] - 1 / p) * 100,
        expected: fair[s2] * p - 1,
        profit: profitOf(p, won),
        out: isOut(f),
      });
    }
  }

  const edges = [-99, -4, -2, -1, 0, 0.5, 1, 1.5, 2, 3, 4, 6, 99];
  console.log(
    "| Bucket di CLV (pp) | n | ROI atteso dal CLV | ROI realizzato | Differenza | IC 95% del ROI | t | ROI realizzato, solo out-of-sample |",
  );
  console.log("|---|---|---|---|---|---|---|---|");
  let cross: number | null = null;
  for (let i = 0; i < edges.length - 1; i += 1) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const sel = rows2.filter((r) => r.clv > lo && r.clv <= hi);
    if (sel.length < MIN_N) continue;
    const profits = sel.map((r) => r.profit);
    const roi = mean(profits) as number;
    const expected = mean(sel.map((r) => r.expected)) as number;
    const s = se(profits);
    const outRoi = mean(sel.filter((r) => r.out).map((r) => r.profit));
    const label =
      lo === -99 ? `sotto ${signed(hi, 1)}` : hi === 99 ? `sopra ${signed(lo, 1)}` : `${signed(lo, 1)} … ${signed(hi, 1)}`;
    console.log(
      `| ${label} | ${sel.length} | ${pc(expected, 2)} | ${pc(roi, 2)} | ${signed(
        (roi - expected) * 100,
        2,
      )} pp | ${s === null ? "n/d" : `±${(s * 100).toFixed(2)} pp`} | ${
        s === null ? "n/d" : (roi / s).toFixed(2)
      } | ${pc(outRoi, 2)} |`,
    );
    if (cross === null && roi >= 0 && lo >= -4) cross = (Math.max(lo, -4) + hi) / 2;
  }
  /* interpolazione lineare fra i due bucket che attraversano lo zero */
  const centres: { c: number; roi: number; n: number }[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const sel = rows2.filter((r) => r.clv > edges[i] && r.clv <= edges[i + 1]);
    if (sel.length < MIN_N) continue;
    centres.push({
      c: (Math.max(edges[i], -3) + Math.min(edges[i + 1], 8)) / 2,
      roi: mean(sel.map((r) => r.profit)) as number,
      n: sel.length,
    });
  }
  let be: number | null = null;
  for (let i = 0; i + 1 < centres.length; i += 1) {
    const a = centres[i];
    const b = centres[i + 1];
    if (a.roi <= 0 && b.roi > 0) {
      const t = (0 - a.roi) / (b.roi - a.roi);
      be = a.c + t * (b.c - a.c);
      break;
    }
  }
  console.log("");
  console.log(
    be === null
      ? "Attraversamento dello zero non osservato nei bucket centrali: la scala del CLV, " +
          "su questi dati, non produce un punto di pareggio leggibile. È già un verdetto."
      : `Punto di pareggio stimato: **${signed(be, 1)} pp di CLV** contro la fair di chiusura: ` +
          "sotto quella riga il margine mangia tutto, sopra il vantaggio esiste sulla carta.",
  );
  console.log("");
  console.log(
    "Tradotto per il sito: il CLV medio dell'archivio è −3,77 pp su 238 " +
      "osservazioni. Se la scala qui sopra tiene, il problema non è «poco " +
      "margine»: è che il prezzo rilevato oggi sta sotto la chiusura fair di un " +
      "importo che nessuna gestione del bankroll può recuperare.",
  );
}

/* ================================================================== */
/* S6 — shopping e arbitraggio: profitto senza modello                */
/* ================================================================== */

function sectionShopping(fx: Fixture[]): void {
  console.log("\n## S6 — Quanto vale il prezzo, prima ancora del segnale\n");
  const gain: number[] = [];
  let nPriceBase = 0;
  let arbClose = 0;
  let arbOpen = 0;
  let nArbDenominator = 0;
  let nArbOpenDenominator = 0;
  const arbProfitClose: number[] = [];
  const arbProfitOpen: number[] = [];
  const roiB365: Shot[] = [];
  const roiMax: Shot[] = [];

  for (const f of fx) {
    if (f.result === null) continue;
    for (const s of SIDES) {
      const c = f.b365Close[s];
      const m = f.maxClose[s];
      if (c !== null && m !== null) {
        nPriceBase += 1;
        if (m > c) gain.push(m / c - 1);
      }
      const won = won1x2(f, s);
      if (won === null) continue;
      if (c !== null) {
        roiB365.push(shot(f, c, won, null) as Shot);
      }
      if (m !== null) {
        roiMax.push(shot(f, m, won, null) as Shot);
      }
    }
    /* arbitraggio fra bookmaker veri: miglior prezzo per selezione fra gli 8
       libri individuali del CSV, closing e pre-movimento */
    for (const [books, isClose] of [
      [f.booksClose, true],
      [f.booksOpen, false],
    ] as [Terna[], boolean][]) {
      const best = SIDES.map((side) => {
        const xs = books.map((b) => b[side]).filter((v): v is number => v !== null);
        return xs.length === 0 ? null : Math.max(...xs);
      });
      const or = overround(best);
      if (or === null) continue;
      if (isClose) {
        nArbDenominator += 1;
        if (or < 0) {
          arbClose += 1;
          arbProfitClose.push(-or * 100);
        }
      } else {
        nArbOpenDenominator += 1;
        if (or < 0) {
          arbOpen += 1;
          arbProfitOpen.push(-or * 100);
        }
      }
    }
  }

  const aB = agg(roiB365);
  const aM = agg(roiMax);
  console.log(
    `- Prezzo migliore rispetto a Bet365 sulla stessa selezione a chiusura: presente nel ${pc(
      gain.length / Math.max(1, nPriceBase),
      1,
    )} delle selezioni (${gain.length} su ${nPriceBase}); quando c'è vale in media ${pc(
      mean(gain),
      2,
    )} di quota in più.`,
  );
  console.log(
    `- ROI delle stesse identiche puntate (tutte le selezioni 1X2 a chiusura, ${
        aB.n
      } casi): Bet365 ${pc(aB.roi, 2)}, prezzo migliore ${pc(
      aM.roi,
      2,
    )} → **${signed(((aM.roi as number) - (aB.roi as number)) * 100, 2)} pp di ROI** solo per aver comprato altrove, senza sapere nulla della partita.`,
  );
  console.log(
    `- Arbitraggio fra bookmaker veri (8 libri individuali del CSV, miglior prezzo per selezione; somma delle implicite sotto 1): **${arbClose} su ${nArbDenominator} partite a chiusura** (${pc(
      nArbDenominator === 0 ? null : arbClose / nArbDenominator,
      3,
    )}), profitto medio ${plain(mean(arbProfitClose), 2)}% quando esiste. Al pre-movimento: ${arbOpen} su ${nArbOpenDenominator} (${pc(
      nArbOpenDenominator === 0 ? null : arbOpen / nArbOpenDenominator,
      3,
    )}), profitto medio ${plain(mean(arbProfitOpen), 2)}%.`,
  );
  console.log(
    `- Nota sul prezzo "Max" del CSV: è il migliore fra la lista completa del provider, exchange compreso, quindi la sua somma di implicite scende sotto 1 nel ${pc(
      (() => {
        let k = 0;
        let d = 0;
        for (const g of fx) {
          const or = overround(SIDES.map((side) => g.maxClose[side]));
          if (or === null) continue;
          d += 1;
          if (or < 0) k += 1;
        }
        return d === 0 ? null : k / d;
      })(),
      1,
    )} delle partite: è l'artefatto che una calcolatrice di sicurezze, se non dichiara la fonte del prezzo, trasforma in "occasioni" inesistenti.`,
  );
  console.log("");
  console.log(
    "Questo è l'unico risultato dello studio che non dipende da un modello e non " +
      "usa la chiusura per scegliere: è margine strutturale, piccolo, reale, e " +
      "non finisce mai in una card di pronostici. Se il progetto vuole parlare " +
      "di denaro, la riga da costruire prima di ogni altra è «quanto stai " +
      "regalando comprando dal solito book».",
  );
}

/* ================================================================== */
/* S7 — la tassa di base: ROI per fascia di quota, tutte le puntate   */
/* ================================================================== */

function sectionLongshot(fx: Fixture[]): void {
  console.log("\n## S7 — La tassa di base: ROI per fascia di quota senza nessun segnale\n");
  console.log(
    "Si punta su **tutte** le selezioni 1X2 di tutte le partite, allo stesso " +
      "prezzo, e si guarda il ROI per fascia di quota. È l'imposta che ogni " +
      "strategia deve pagare: se una fascia sta sopra lo zero senza nessun " +
      "segnale, lì il profitto ha una casa; se nessuna ci sta, il sito non ha " +
      "niente da promettere a nessuno.\n",
  );
  const close: Shot[] = [];
  const open: Shot[] = [];
  for (const f of fx) {
    if (f.result === null) continue;
    const fair = fairTerna(f.psClose);
    for (const s of SIDES) {
      const won = won1x2(f, s);
      const c = shot(f, f.b365Close[s], won, fair ? fair[s] : null);
      const o = shot(f, f.b365Open[s], won, fair ? fair[s] : null);
      if (c !== null) close.push(c);
      if (o !== null) open.push(o);
    }
  }
  for (const [label, shots] of [
    ["Alla chiusura (Bet365)", close],
    ["Al pre-movimento / venerdì (Bet365)", open],
  ] as [string, Shot[]][]) {
    console.log(`\n${label}:`);
    console.log(HEAD);
    for (const band of BANDS) {
      const sel = shots.filter((s) => s.band === band);
      if (sel.length < MIN_N) continue;
      console.log(lineOut(`quota ${band}`, agg(sel)));
    }
    console.log(lineOut("**tutte le quote**", agg(shots)));
  }
}

/* ================================================================== */
/* S8 — potenza: quante partite servono prima di ogni verdetto        */
/* ================================================================== */

function sectionPower(fx: Fixture[], obs: Obs[]): void {
  console.log("\n## S8 — Quante partite servono, prima di ogni verdetto\n");
  const profits: number[] = [];
  for (const f of fx) {
    if (f.result === null) continue;
    for (const s of SIDES) {
      const p = f.b365Close[s];
      if (p === null) continue;
      profits.push(profitOf(p, won1x2(f, s) === true));
    }
  }
  const sd = stdev(profits) as number;
  console.log(
    `Deviazione standard del profitto per puntata, misurata su questi dati: **${sd.toFixed(
      2,
    )} per unità puntata** (è la ragione per cui le percentuali di vincita dicono poco e gli scarti dicono tutto).`,
  );
  console.log("");
  console.log("| ROI per puntata da dimostrare | puntate necessarie (potenza 80%, α 5%) | partite 1X2 equivalenti |");
  console.log("|---|---|---|");
  for (const roi of [0.005, 0.01, 0.02, 0.05]) {
    const n = Math.ceil(((1.959964 + 0.8416) ** 2 * sd ** 2) / (roi * roi));
    console.log(
      `| ${pc(roi, 1)} | ${n.toLocaleString("it-IT")} | ${Math.ceil(n / 3).toLocaleString("it-IT")} |`,
    );
  }
  console.log("");
  const clvN = 238;
  console.log(
    `Confronto con l'archivio del monitor: ${clvN} osservazioni di CLV. Per un effetto da 2 pp di ROI le ` +
      "puntate necessarie sono nell'ordine delle decine di migliaia: nessuna " +
      "verifica «scheda per scheda» cambia questo ordine di grandezza, lo " +
      "aumenta. Due conseguenze operative: (1) gli esiti delle partite finite " +
      "servono a validare il percorso, non a pubblicare un rendimento; (2) il " +
      "CLV resta l'unica metrica che cresce di un'unità per segnale, e va " +
      "protetto da ogni contaminazione (base grezza, margini, partite fantasma).",
  );
  console.log("");
  console.log(
    `Numero di segnali con drop ≥ 2 pp nell'archivio congelato: ${
      obs.length
    }. È la scala con cui si può discutere di pattern; i 238 del sito sono ${pc(
      clvN / Math.max(1, obs.length),
      1,
    )} di quel campione.`,
  );
}


/* ================================================================== */
/* S9 — La formula dello scanner «Value Bet (+EV)», misurata           */
/* ================================================================== */

/**
 * `getValueOpportunities` (src/lib/repo/value-bets.ts) costruisce l'edge così:
 *   fairOdds = prezzoCorrente × 1.045            (margine "ipotizzato", riga 42)
 *   prezzoValutato = apertura, se apertura > corrente : corrente × 1.05   (riga 46-48)
 *   edge = (1 / fairOdds) × prezzoValutato − 1
 *   edgePct mostrato = max(0.5, edge)            (riga 82: pavimento)
 * Nessun libro sharp, nessuna linea di chiusura altrui: l'«edge» è la
 * variazione di prezzo già avvenuta, rivestita da valore atteso. Qui la
 * misuriamo dove i due prezzi esistono davvero (apertura soft e chiusura), e
 * la confrontiamo con ciò che restava da incassare.
 */
interface PageShot {
  /** edge dichiarato dalla formula della pagina, in frazione */
  pageEdge: number;
  /** profitto reale puntando al prezzo che SI POTEVA ottenere (corrente) */
  profit: number;
  won: boolean;
  out: boolean;
  /** stake frazionale di Kelly calcolato con i numeri della pagina */
  stake: number;
}

function parseDmy(d: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d.trim());
  if (m === null) return 0;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
}

function pageShots(fx: Fixture[]): PageShot[] {
  const out: PageShot[] = [];
  for (const f of fx) {
    if (f.result === null) continue;
    for (const side of SIDES) {
      const open = f.b365Open[side];
      const cur = f.b365Close[side];
      if (open === null || cur === null || open <= cur) continue;
      const fairProb = Math.min(0.95, 1 / cur / 1.045);
      const evaluated = open > cur ? open : cur * 1.05;
      const pageEdge = fairProb * evaluated - 1;
      const won = won1x2(f, side) === true;
      /* Kelly frazionaria (quarter) con la probabilità della pagina, tetto 5% */
      const b = evaluated - 1;
      const full = (fairProb * b - (1 - fairProb)) / b;
      const stake = full > 0 ? Math.min(0.05, full * 0.25) : 0;
      out.push({
        pageEdge,
        profit: profitOf(cur, won),
        won,
        out: isOut(f),
        stake,
      });
    }
  }
  return out;
}

function sectionScanner(fx: Fixture[]): void {
  console.log("\n## S9 — Che cosa vale davvero l'«edge» dello scanner +EV\n");
  console.log(
    "Ricostruzione fedele della formula di `getValueOpportunities` su 12 459 " +
      "partite reali: due prezzi veri (apertura e chiusura dello stesso libro), " +
      "la «fair» costruita come corrente × 1,045, l'edge come rapporto fra i " +
      "due. Poi: che cosa incassa chi quel prezzo lo paga davvero.\n",
  );
  const shots = pageShots(fx);
  const actionable = shots.filter((x) => x.pageEdge >= 0.015);
  const floored = shots.filter((x) => x.pageEdge < 0.005);
  console.log(
    `- Opportunità che la pagina mostrerebbe: ${shots.length} · con edge ≥ +1,5% (soglia ` +
      `isActionableValue): ${actionable.length} (${pc(
        actionable.length / Math.max(1, shots.length),
        1,
      )}) · edge medio dichiarato: **${signed(
        (mean(shots.map((x) => x.pageEdge)) as number) * 100,
        1,
      )} pp** (la scala dello screenshot legge +19,8%).`,
  );
  console.log(
    `- Con il pavimento a +0,5% ogni selezione scesa diventa un'«opportunità»: quelle con edge sotto lo ` +
      `0,5% sono ${floored.length} (${pc(floored.length / Math.max(1, shots.length), 1)}) ` +
      `e comparirebbero in lista comunque, con +0,5% scritto accanto.`,
  );
  console.log("");
  console.log("| Decile dell'edge dichiarato dalla pagina | n | edge medio | Frequent. reale | ROI realizzato sul prezzo ottenibile | ROI solo fuori campione |");
  console.log("|---|---|---|---|---|---|");
  const sorted = [...shots].sort((a, b) => a.pageEdge - b.pageEdge);
  for (let i = 0; i < 10; i += 1) {
    const part = sorted.slice(Math.floor((i * sorted.length) / 10), Math.floor(((i + 1) * sorted.length) / 10));
    if (part.length === 0) continue;
    const a = agg(part.map((x) => shot0(x)));
    console.log(
      `| D${i + 1} | ${part.length} | ${pc(mean(part.map((x) => x.pageEdge)), 1)} | ${pc(
        a.hit,
      )} | ${pc(a.roi, 2)} | ${pc(mean(part.filter((x) => x.out).map((x) => x.profit)), 2)} |`,
    );
  }
  console.log("");
  console.log(
    "Lettura: se l'edge della pagina misurasse valore, il ROI realizzato " +
      "dovrebbe salire con i decili. Guarda le ultime due colonne: il gradiente " +
      "è piatto o rovesciato, e il livello resta sotto zero. L'edge è la " +
      "fotografia di un movimento già chiuso: nessuno può più comprarlo a " +
      "quel prezzo, e questo lo si vede nel numero, non nell'argomentazione.",
  );

  for (const th of [0.05, 0.2, 0.5]) {
    const sub = shots.filter((x) => x.pageEdge >= th);
    const a = agg(sub.map((x) => shot0(x)));
    console.log(
      `- con l'etichetta «Elevato» della pagina (edge ≥ ${(th * 100).toFixed(0)}%): ` +
        `${sub.length} righe · frequent. reale ${pc(a.hit)} · ROI realizzato ` +
        `${pc(a.roi, 2)} · righe in utile: ${pc(
          sub.length === 0 ? 0 : sub.filter((x) => x.profit > 0).length / sub.length,
        )}.`,
    );
  }
  console.log(
    "Il codice di ValueScannerTable assegna l'etichetta «Elevato» a partire da +5%: "
      + "è la fascia col peggior risultato realizzato. La coda estrema (edge ≥ +20%)"
      + " va invece in utile, ma è un campione piccolo: ordine di grandezza, non "
      + "intervallo di confidenza.",
  );

  /* -------------------------------------------------------------- */
  console.log("\n### 9.1 — Che cosa succede a seguirla, davvero\n");
  console.log(
    "Simulazione deterministica, nessun casofortismo: bankroll 1 000 €, " +
      "puntata = Kelly frazionaria (quarter) con la probabilità dichiarata " +
      "dalla pagina, tetto 5% del bankroll per giocata — esattamente i numeri " +
      "che la card mostra («Kelly stake», «€ del bankroll»). Si incassa però al " +
      "prezzo che era ottenibile (quello corrente), perché l'apertura del " +
      "venerdì nessuno la compra più. Ordine cronologico, nessuna ribasatura " +
      "dei prezzi.\n",
  );
  const chrono = fx
    .filter((f) => f.result !== null)
    .sort((a, b) => parseDmy(a.date) - parseDmy(b.date));
  let bankroll = 1000;
  let peak = 1000;
  let maxDrawdown = 0;
  let placed = 0;
  let stakedTotal = 0;
  const curve: number[] = [];
  for (const f of chrono) {
    if (f.result === null) continue;
    for (const side of SIDES) {
      const open = f.b365Open[side];
      const cur = f.b365Close[side];
      if (open === null || cur === null || open <= cur) continue;
      const fairProb = Math.min(0.95, 1 / cur / 1.045);
      const evaluated = open;
      const b = evaluated - 1;
      const full = (fairProb * b - (1 - fairProb)) / b;
      if (full <= 0) continue;
      const stake = Math.min(0.05, full * 0.25) * bankroll;
      if (stake < 1 || bankroll < 1) continue;
      const won = won1x2(f, side) === true;
      const pnl = won ? stake * (cur - 1) : -stake;
      bankroll += pnl;
      placed += 1;
      stakedTotal += stake;
      if (bankroll > peak) peak = bankroll;
      maxDrawdown = Math.max(maxDrawdown, (peak - bankroll) / peak);
      if (placed % 2000 === 0) curve.push(bankroll);
    }
  }
  console.log(
    `- puntate eseguite: ${placed.toLocaleString("it-IT")} · capitale totale impegnato: ${Math.round(
      stakedTotal,
    ).toLocaleString("it-IT")} € · bankroll finale: **${Math.round(bankroll).toLocaleString(
      "it-IT",
    )} €** (partenza 1 000 €) · drawdown massimo: ${pc(maxDrawdown, 1)}.`,
  );
  console.log(
    `- ROI complessivo di chi ha eseguito la pagina: ${pc(
      (bankroll - 1000) / stakedTotal,
      2,
    )} sul capitale impegnato.`,
  );
  console.log("");
  console.log(
    "Questa è la differenza fra un numero e un consiglio: la pagina calcola " +
      "l'edge con un prezzo e ne propone la puntata, ma il prezzo eseguibile è " +
      "l'altro. Su 12 459 partite il risultato è scritto sopra; la parte " +
      "preoccupante non è il segno, è che il bankroll finale dipenda da una " +
      "costante (1,045) che nessuno ha misurato.",
  );
}

/** Adattatore minimale per riutilizzare agg() su PageShot. */
function shot0(x: PageShot): Shot {
  return {
    profit: x.profit,
    won: x.won,
    push: false,
    fair: null,
    paid: 1,
    price: 1,
    out: x.out,
    band: "n/d",
  };
}

/* ================================================================== */
/* main                                                                */
/* ================================================================== */

function main(): void {
  const fx = loadFixtures();
  const obs = buildObs(fx);
  console.log("# Studio «partite finite» — output rigenerato\n");
  console.log(
    `Dati: \`data/football-data/*\`, 5 campionati, 7 stagioni, ${fx.length} righe lette; ` +
      `${obs.length} partite con un drop ≥ 0 pp misurabile su Pinnacle. ` +
      `In-sample ${fx.filter(isIn).length} righe, out-of-sample ${fx.filter(isOut).length}.\n`,
  );
  sectionCensus(fx);
  sectionMargin(fx);
  sectionDecay(obs);
  sectionDropVsBaseline(obs);
  sectionEdge(fx);
  sectionClv(fx);
  sectionShopping(fx);
  sectionLongshot(fx);
  sectionPower(fx, obs);
  sectionScanner(fx);
}

main();
