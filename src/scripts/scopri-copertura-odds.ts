/**
 * Scopre la COPERTURA REALE di The Odds API rispetto ai campionati del monitor.
 *
 *   npm run odds:scopri                      # chiave + DB (misura reale)
 *   npm run odds:scopri -- --senza-fonte     # solo archivio, nessuna chiamata
 *   npm run odds:scopri -- --catalogo cat.json --leagues leghe.json
 *                                            # offline: nessuna rete, nessun DB
 *
 * COSTO: zero crediti. Il catalogo arriva da `GET /v4/sports`, che la fonte
 * dichiara fuori quota; qui NON si leggono quote. Serve a rispondere — con
 * dati reali e non a memoria — all'incongruenza che l'utente ha segnalato:
 * «The Odds API copre solo i campionati maggiori? quelli minori no? BetExplorer
 * mi dà invece i minori e non i maggiori, non è un'incongruenza?».
 *
 * Cosa fa:
 *  1. Legge i campionati in archivio (dal DB, o da un file JSON con `--leagues`);
 *  2. scarica il catalogo della fonte (endpoint gratuito), o lo legge da un
 *     file JSON con `--catalogo` (offline);
 *  3. per ogni campionato del monitor dice se la fonte LO COPRE: `mapped`
 *     (chiave esatta), `near` (somiglianza → GRAFIA, verificare a mano),
 *     `uncovered` (buco dichiarato).
 *
 * Non scrive nulla nel database e non stampa mai la chiave.
 */
import { db, sql } from "@/db/client";
import { leagues } from "@/db/schema";
import { readOddsApiKey } from "@/lib/providers/optional/odds-api-budget";
import {
  activeSoccerKeys,
  parseSportsCatalog,
  type OddsApiSport,
} from "@/lib/providers/optional/odds-api-sports";
import { fetchOddsApiSports } from "@/lib/providers/optional/the-odds-api-sports-client";
import {
  classifyCoverage,
  type CoverageLeague,
  type CoverageSport,
} from "@/lib/providers/optional/odds-coverage";

const WITHOUT_SOURCE = process.argv.includes("--senza-fonte");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function readJson<T>(path: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const raw = fs.readFileSync(path, "utf8");
  return JSON.parse(raw) as T;
}

/** Campionati del monitor dal DB (produzione) o da un file JSON `--leagues`. */
async function loadLeagues(file: string | null): Promise<CoverageLeague[]> {
  if (file !== null) {
    const list = readJson<Array<{ key?: string; name: string; country?: string | null }>>(file);
    return list.map((row) => ({
      key: row.key ?? "",
      name: row.name,
      country: row.country ?? null,
    }));
  }
  const rows = await db.select().from(leagues);
  return rows.map((r) => ({ key: r.key, name: r.name, country: r.country }));
}

/** Catalogo della fonte dalla rete (endpoint gratuito) o da un file `--catalogo`. */
async function loadCatalog(
  file: string | null,
  apiKey: string | null,
): Promise<{ soccer: CoverageSport[]; sports: OddsApiSport[] } | { error: string }> {
  if (file !== null) {
    const payload: unknown = readJson(file);
    const result = parseSportsCatalog(payload);
    return { soccer: activeSoccerKeys(result).map((key) => {
      const sport = result.soccer.find((s) => s.key === key)!;
      return { key, title: sport.title };
    }), sports: result.sports };
  }
  if (apiKey === null) {
    return { error: "chiave non configurata" };
  }
  const outcome = await fetchOddsApiSports({ apiKey });
  if (!outcome.result.ok) {
    return { error: outcome.result.error.message };
  }
  const result = parseSportsCatalog(outcome.result.data);
  return {
    soccer: activeSoccerKeys(result).map((key) => {
      const sport = result.soccer.find((s) => s.key === key)!;
      return { key, title: sport.title };
    }),
    sports: result.sports,
  };
}

function printReport(report: ReturnType<typeof classifyCoverage>): void {
  console.log("\n─".repeat(72));
  console.log(`MAPPATI con chiave esatta: ${report.mapped.length}`);
  for (const l of report.mapped) {
    console.log(`  ✓ ${l.country ?? "?"} — ${l.name}`);
  }

  console.log("\n─".repeat(72));
  console.log(`CANDIDATI per somiglianza (VERIFICARE A MANO, non usarli così): ${report.near.length}`);
  for (const n of report.near) {
    console.log(`  ? ${n.league.country ?? "?"} — ${n.league.name}  ⇒  ${n.candidate} (${n.title})`);
  }

  console.log("\n─".repeat(72));
  console.log(`FUORI COPERTURA della fonte (restano buchi dichiarati): ${report.uncovered.length}`);
  for (const l of report.uncovered) {
    console.log(`  ✗ ${l.country ?? "?"} — ${l.name}`);
  }

  console.log("\n─".repeat(72));
  console.log("CONCLUSIONE (dati reali, non a memoria):");
  console.log(`  · Campionati mappabili senza ombra di dubbio: ${report.mapped.length}`);
  console.log(`  · Campionati da ricontrollare se la fonte li copre davvero: ${report.near.length}`);
  console.log(`  · Tornei che la fonte NON espone (buchi dichiarati, mai stimati): ${report.uncovered.length}`);
}

async function main(): Promise<void> {
  const apiKey = readOddsApiKey();
  const leaguesFile = argument("--leagues");
  const catalogFile = argument("--catalogo");

  console.log("\nScoperta copertura di The Odds API rispetto al monitor");
  console.log("═".repeat(72));

  const archive = await loadLeagues(leaguesFile);
  console.log(`campionati in archivio (monitor): ${archive.length}`);

  const catalog = await loadCatalog(catalogFile, apiKey);
  if ("error" in catalog) {
    console.error(`\nCATALOGO NON DISPONIBILE — ${catalog.error}`);
    console.error("Usa `--catalogo <file.json>` per l'offline, o configura la chiave.");
    process.exitCode = 1;
    return;
  }

  console.log(`catalogo della fonte: ${catalog.sports.length} sport, ${catalog.soccer.length} campionati di calcio in stagione`);
  if (catalogFile === null && apiKey !== null) {
    console.log("crediti dichiarati: 0 (atteso: endpoint gratuito)");
  }

  const catalogKeys = new Set(catalog.soccer.map((s) => s.key));
  const report = classifyCoverage(archive, catalogKeys, catalog.soccer);
  printReport(report);

  console.log("\nIl catalogo costa 0 crediti: può essere rieseguito in qualunque momento.");
}

main()
  .catch((error) => {
    console.error("SCOPERTA FALLITA — errore non previsto.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
  });
