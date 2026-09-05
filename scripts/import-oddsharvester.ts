/**
 * Import OddsHarvester Data — Importa quote multi-bookmaker nel database.
 *
 * Legge: data/oddsharvester/latest.json
 * Scrive: odds_snapshots con bookmaker_id per ogni bookmaker
 *
 * Questo script viene eseguito dopo oddsharvester-collect.py
 */

import { db } from "@/db/client";
import { oddsSnapshots, matches, bookmakers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

interface OddsHarvesterMatch {
  home_team: string;
  away_team: string;
  league?: string;
  kickoff?: string;
  bookmakers: Record<string, {
    "1"?: number;
    "X"?: number;
    "2"?: number;
    "over_2_5"?: number;
    "under_2_5"?: number;
    "btts_yes"?: number;
    "btts_no"?: number;
  }>;
}

interface OddsHarvesterData {
  collected_at: string;
  today: {
    error: string | null;
    data: OddsHarvesterMatch[];
  };
  tomorrow: {
    error: string | null;
    data: OddsHarvesterMatch[];
  };
}

async function findOrCreateBookmaker(name: string): Promise<number> {
  // Cerca bookmaker esistente
  const existing = await db
    .select()
    .from(bookmakers)
    .where(eq(bookmakers.name, name))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  // Crea nuovo bookmaker
  const [newBookmaker] = await db
    .insert(bookmakers)
    .values({
      name,
      key: name.toLowerCase().replace(/\s+/g, "_"),
    })
    .returning();

  console.log(`  ✓ Creato bookmaker: ${name} (ID: ${newBookmaker.id})`);
  return newBookmaker.id;
}

async function findMatch(homeTeam: string, awayTeam: string, kickoff?: string): Promise<number | null> {
  // Cerca match esistente per nome squadre
  const conditions = [
    eq(matches.homeTeam, homeTeam),
    eq(matches.awayTeam, awayTeam),
  ];

  const existing = await db
    .select()
    .from(matches)
    .where(and(...conditions))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  // Match non trovato, potrebbe essere nuovo
  return null;
}

async function importOdds(matchId: number, bookmakerId: number, market: string, selection: string, price: number) {
  // Inserisci o aggiorna odds snapshot
  await db
    .insert(oddsSnapshots)
    .values({
      matchId,
      bookmakerId,
      market,
      selection,
      price: price.toString(),
      observedAt: new Date(),
      source: "oddsharvester",
    })
    .onConflictDoNothing(); // Ignora duplicati
}

async function processMatch(match: OddsHarvesterMatch) {
  const matchId = await findMatch(match.home_team, match.away_team, match.kickoff);
  
  if (!matchId) {
    console.log(`  ⚠ Match non trovato: ${match.home_team} vs ${match.away_team}`);
    return 0;
  }

  let imported = 0;

  // Processa ogni bookmaker
  for (const [bookmakerName, odds] of Object.entries(match.bookmakers)) {
    const bookmakerId = await findOrCreateBookmaker(bookmakerName);

    // 1X2
    if (odds["1"]) {
      await importOdds(matchId, bookmakerId, "1x2", "home", odds["1"]);
      imported++;
    }
    if (odds["X"]) {
      await importOdds(matchId, bookmakerId, "1x2", "draw", odds["X"]);
      imported++;
    }
    if (odds["2"]) {
      await importOdds(matchId, bookmakerId, "1x2", "away", odds["2"]);
      imported++;
    }

    // Over/Under 2.5
    if (odds["over_2_5"]) {
      await importOdds(matchId, bookmakerId, "over_under", "over_2_5", odds["over_2_5"]);
      imported++;
    }
    if (odds["under_2_5"]) {
      await importOdds(matchId, bookmakerId, "over_under", "under_2_5", odds["under_2_5"]);
      imported++;
    }

    // BTTS
    if (odds["btts_yes"]) {
      await importOdds(matchId, bookmakerId, "btts", "yes", odds["btts_yes"]);
      imported++;
    }
    if (odds["btts_no"]) {
      await importOdds(matchId, bookmakerId, "btts", "no", odds["btts_no"]);
      imported++;
    }
  }

  return imported;
}

async function main() {
  const dataPath = join(process.cwd(), "data/oddsharvester/latest.json");

  if (!existsSync(dataPath)) {
    console.error("❌ File non trovato:", dataPath);
    console.error("   Esegui prima: python scripts/oddsharvester-collect.py");
    process.exit(1);
  }

  console.log("📥 Import OddsHarvester Data\n");

  const raw = readFileSync(dataPath, "utf-8");
  const data: OddsHarvesterData = JSON.parse(raw);

  console.log(`Raccolto il: ${data.collected_at}`);
  console.log(`Oggi: ${data.today.data.length} match`);
  console.log(`Domani: ${data.tomorrow.data.length} match\n`);

  if (data.today.error) {
    console.error(`⚠ Errore oggi: ${data.today.error}`);
  }
  if (data.tomorrow.error) {
    console.error(`⚠ Errore domani: ${data.tomorrow.error}`);
  }

  let totalImported = 0;
  let totalMatches = 0;

  // Processa match di oggi
  console.log("=== Match di oggi ===");
  for (const match of data.today.data) {
    const imported = await processMatch(match);
    if (imported > 0) {
      console.log(`  ✓ ${match.home_team} vs ${match.away_team}: ${imported} odds`);
      totalImported += imported;
      totalMatches++;
    }
  }

  // Processa match di domani
  console.log("\n=== Match di domani ===");
  for (const match of data.tomorrow.data) {
    const imported = await processMatch(match);
    if (imported > 0) {
      console.log(`  ✓ ${match.home_team} vs ${match.away_team}: ${imported} odds`);
      totalImported += imported;
      totalMatches++;
    }
  }

  console.log(`\n✅ Import completato:`);
  console.log(`   Match processati: ${totalMatches}`);
  console.log(`   Odds importate: ${totalImported}`);
}

main().catch((err) => {
  console.error("❌ Errore:", err);
  process.exit(1);
});
