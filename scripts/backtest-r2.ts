/**
 * Backtest R2 — validazione LIVE sui dati del monitor.
 *
 * Script FUORI DAL SITO: nessuna importazione dal codice, nessuna
 * scrittura. Legge l'API pubblica del deploy (e le pagine partita per i
 * gol finali) e stampa le tabelle in markdown su stdout.
 *
 * Eseguire con: npx tsx scripts/backtest-r2.ts
 * Base URL: DROPALERT_BASE_URL (default: il deploy di produzione).
 *
 * Tagli dichiarati, uno per sezione:
 *  1. CLV per fascia dell'indice di fiducia (0-24 / 25-49 / 50-74 / 75-100)
 *  2. CLV per versione algoritmo (drop-engine/1.0.0 vs suspicion-v2,
 *     con lo split interno: moltiplicatore applicato o no)
 *  3. precoce (rilevamento >24h dal kickoff) vs tardivo (<2h)
 *  4. flash (<30 min) vs sostenuto
 *  5. hit rate per fascia — INFORMATIVO, non è una metrica di qualità
 *
 * Soglie di lettura dichiarate: n<10 ⚠ campione piccolo, n<30 inconcludente.
 * Il CLV resta l'unica metrica di qualità: l'hit rate non lo sostituisce.
 */
const BASE = process.env.DROPALERT_BASE_URL ?? "https://dropalert-next.vercel.app";

const BUCKETS: Array<[string, number, number]> = [
  ["0–24", 0, 24.999],
  ["25–49", 25, 49.999],
  ["50–74", 50, 74.999],
  ["75–100", 75, 100],
];

interface SignalRow {
  id: number;
  matchId: number;
  status: string;
  score: number;
  market: string;
  selection: string;
  detectedAt: string;
  kickoffAt: string;
  homeTeam: string;
  awayTeam: string;
  league: string | null;
  isFlash: boolean;
  sustainedMinutes: number;
  engineVersion: string;
  suspicion: boolean;
  clvPp: number | null;
  clvPct: number | null;
  beatClose: boolean | null;
  homeGoals: number | null;
  awayGoals: number | null;
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "user-agent": "DropAlert-backtest-r2/1.0" },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

/** I gol finali, letti dalla pagina partita: l'unica fonte pubblica che li espone. */
async function fetchGoals(matchId: number): Promise<[number, number] | null> {
  try {
    const response = await fetch(`${BASE}/matches/${matchId}`, {
      headers: { "user-agent": "DropAlert-backtest-r2/1.0" },
    });
    if (!response.ok) return null;
    const html = (await response.text()).replace(/<!--[^>]*-->/g, "");
    const m = html.match(/Risultato finale\s+(\d+)\s*[–\u2013-]\s*(\d+)/);
    if (m === null) return null;
    return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10)];
  } catch {
    return null;
  }
}

async function loadSignals(): Promise<SignalRow[]> {
  const list = (await getJson(`/api/signals?limit=200&includeDemo=1`)) as {
    items?: Array<Record<string, unknown>>;
  };
  const items = list.items ?? [];
  const rows: SignalRow[] = [];
  let fetchErrors = 0;

  for (const item of items) {
    const id = Number(item.id);
    const match = (item.match ?? {}) as Record<string, unknown>;
    try {
      const detail = (await getJson(`/api/signals/${id}`)) as {
        signal?: Record<string, unknown>;
      };
      const sig = (detail.signal ?? {}) as Record<string, unknown>;
      const persistence = (sig.persistence ?? item) as Record<string, unknown>;
      const explanation = (sig.explanation ?? {}) as Record<string, unknown>;
      const clv = (sig.clv ?? null) as Record<string, unknown> | null;

      rows.push({
        id,
        matchId: Number(match.id ?? item.matchId),
        status: String(item.status ?? ""),
        score: Number(item.confidenceScore ?? sig.confidenceScore ?? 0),
        market: String(item.market ?? ""),
        selection: String(item.selection ?? ""),
        detectedAt: String(item.detectedAt ?? sig.detectedAt ?? ""),
        kickoffAt: String(match.kickoffAt ?? ""),
        homeTeam: String(match.homeTeam ?? "?"),
        awayTeam: String(match.awayTeam ?? "?"),
        league: typeof match.league === "string" ? match.league : null,
        isFlash: Boolean(persistence.isFlash ?? item.isFlash),
        sustainedMinutes: Number(persistence.sustainedMinutes ?? item.sustainedMinutes ?? 0),
        engineVersion: String(sig.engineVersion ?? "sconosciuta"),
        suspicion:
          (explanation.suspicion ?? null) !== null &&
          typeof explanation.suspicion === "object",
        clvPp: clv !== null && clv.clvPp !== undefined ? Number(clv.clvPp) : null,
        clvPct: clv !== null && clv.clvPct !== undefined ? Number(clv.clvPct) : null,
        beatClose: clv !== null && clv.beatClose !== undefined ? Boolean(clv.beatClose) : null,
        homeGoals: null,
        awayGoals: null,
      });
    } catch {
      fetchErrors += 1;
    }
  }

  /* i gol, una pagina per partita (solo quelle chiuse con CLV servono) */
  const needsGoals = [...new Set(rows.filter((r) => r.clvPp !== null).map((r) => r.matchId))];
  const goalsByMatch = new Map<number, [number, number] | null>();
  for (const matchId of needsGoals) {
    goalsByMatch.set(matchId, await fetchGoals(matchId));
  }
  for (const r of rows) {
    const g = goalsByMatch.get(r.matchId);
    if (g !== undefined && g !== null) {
      r.homeGoals = g[0];
      r.awayGoals = g[1];
    }
  }

  console.error(
    `segnali letti: ${rows.length}, errori dettaglio: ${fetchErrors}, con CLV: ${rows.filter((r) => r.clvPp !== null).length}`,
  );
  return rows;
}

/* ------------------------------------------------------------------ */
/* Aggregati                                                           */
/* ------------------------------------------------------------------ */

interface Agg {
  n: number;
  meanPp: number | null;
  meanPct: number | null;
  beatRate: number | null;
  hits: number;
  settled: number;
  hitRate: number | null;
}

function aggregate(rows: SignalRow[]): Agg {
  const withClv = rows.filter((r) => r.clvPp !== null);
  const pps = withClv.map((r) => r.clvPp as number);
  const pcts = withClv.map((r) => r.clvPct as number);
  const beaten = withClv.filter((r) => r.beatClose === true).length;

  const settledRows = rows.filter((r) => r.homeGoals !== null && r.awayGoals !== null);
  const hits = settledRows.filter((r) => hitOf(r)).length;

  return {
    n: withClv.length,
    meanPp: pps.length > 0 ? pps.reduce((a, b) => a + b, 0) / pps.length : null,
    meanPct: pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
    beatRate: withClv.length > 0 ? beaten / withClv.length : null,
    hits,
    settled: settledRows.length,
    hitRate: settledRows.length > 0 ? hits / settledRows.length : null,
  };
}

/** Esito centrato dai gol finali (informativo, non qualità). */
function hitOf(r: SignalRow): boolean {
  const h = r.homeGoals as number;
  const a = r.awayGoals as number;
  switch (r.selection) {
    case "home": return h > a;
    case "draw": return h === a;
    case "away": return h < a;
    case "over": return h + a > 2.5;
    case "under": return h + a < 2.5;
    case "yes": return h > 0 && a > 0;
    case "no": return h === 0 || a === 0;
    default: return false;
  }
}

function fmt(v: number | null, decimals = 2, unit = ""): string {
  if (v === null) return "n/d";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(decimals)}${unit}`;
}

function pct(v: number | null): string {
  return v === null ? "n/d" : `${(v * 100).toFixed(1)}%`;
}

function tag(n: number): string {
  if (n < 10) return " ⚠";
  if (n < 30) return " ⚠inconcludente";
  return "";
}

function line(label: string, rows: SignalRow[]): string {
  const a = aggregate(rows);
  return `| ${label} | ${a.n}${tag(a.n)} | ${fmt(a.meanPp, 2, " pp")} | ${fmt(a.meanPct !== null ? a.meanPct * 100 : null, 1, "%")} | ${pct(a.beatRate)} | ${a.settled}${tag(a.settled)} | ${pct(a.hitRate)} |`;
}

const HEADER =
  "| Segmento | n CLV | CLV pp medio | CLV % medio | batte chiusura | n esiti | hit rate (informativo) |";

function hoursBeforeKickoff(r: SignalRow): number | null {
  const d = new Date(r.detectedAt).getTime();
  const k = new Date(r.kickoffAt).getTime();
  if (!Number.isFinite(d) || !Number.isFinite(k)) return null;
  return (k - d) / 3_600_000;
}

async function main(): Promise<void> {
  const rows = await loadSignals();
  const withClv = rows.filter((r) => r.clvPp !== null);
  const settled = rows.filter((r) => r.homeGoals !== null);

  console.log("<!-- generato da scripts/backtest-r2.ts sui dati live del deploy -->\n");
  console.log(
    `Segnali totali: ${rows.length} · con CLV: ${withClv.length} · con risultato: ${settled.length}.`,
  );
  console.log(
    `Versioni: ${rows.filter((r) => r.engineVersion === "drop-engine/1.0.0").length} v1, ${rows.filter((r) => r.engineVersion === "suspicion-v2").length} v2 (di cui ${rows.filter((r) => r.engineVersion === "suspicion-v2" && r.suspicion).length} con moltiplicatore).\n`,
  );

  console.log("## CLV per fascia dell'indice\n");
  console.log(HEADER);
  console.log("|---|---|---|---|---|---|---|");
  for (const [label, lo, hi] of BUCKETS) {
    console.log(line(`fascia ${label}`, rows.filter((r) => r.score >= lo && r.score <= hi)));
  }

  console.log("\n## CLV per versione algoritmo\n");
  console.log(HEADER);
  console.log("|---|---|---|---|---|---|---|");
  console.log(line("v1 (drop-engine/1.0.0)", rows.filter((r) => r.engineVersion === "drop-engine/1.0.0")));
  console.log(line("v2 (suspicion-v2)", rows.filter((r) => r.engineVersion === "suspicion-v2")));
  console.log(line("v2 · moltiplicatore applicato", rows.filter((r) => r.engineVersion === "suspicion-v2" && r.suspicion)));
  console.log(line("v2 · senza moltiplicatore", rows.filter((r) => r.engineVersion === "suspicion-v2" && !r.suspicion)));

  console.log("\n## Precoce vs tardivo (rilevamento → kickoff)\n");
  console.log(HEADER);
  console.log("|---|---|---|---|---|---|---|");
  console.log(line("precoce (>24h prima)", rows.filter((r) => { const h = hoursBeforeKickoff(r); return h !== null && h > 24; })));
  console.log(line("intermedio (2–24h)", rows.filter((r) => { const h = hoursBeforeKickoff(r); return h !== null && h >= 2 && h <= 24; })));
  console.log(line("tardivo (<2h)", rows.filter((r) => { const h = hoursBeforeKickoff(r); return h !== null && h < 2; })));

  console.log("\n## Flash vs sostenuto\n");
  console.log(HEADER);
  console.log("|---|---|---|---|---|---|---|");
  console.log(line("flash (<30 min)", rows.filter((r) => r.isFlash)));
  console.log(line("sostenuto (≥30 min)", rows.filter((r) => !r.isFlash)));

  console.log("\n## Limiti dichiarati\n");
  console.log("- La base del CLV (fair no-vig o consenso grezzo) non è esposta dall'API: valori mescolati, dichiarato.");
  console.log("- I gol finali si leggono dalle pagine partita: chi non ha pagina, non ha esito.");
  console.log("- n<10 ⚠ campione piccolo; n<30 inconcludente: nessun verdetto sotto quella soglia.");
  console.log("- L'hit rate è informativo: la sola metrica di qualità resta il CLV.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
