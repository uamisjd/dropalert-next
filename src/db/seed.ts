/**
 * Seed del database.
 *
 * Due livelli, tenuti separati di proposito:
 *  1. ANAGRAFICHE — dati di riferimento reali e stabili (bookmaker, campionati).
 *  2. DATI DIMOSTRATIVI — serie storiche sintetiche, marcate con source
 *     "seed-demo" e con chiavi prefissate "demo-", così che siano sempre
 *     distinguibili dai dati raccolti sul campo e cancellabili in blocco.
 *
 * Uso:
 *   npm run db:seed            → solo anagrafiche
 *   npm run db:seed -- --demo  → anagrafiche + dati dimostrativi
 *   npm run db:seed -- --clean-demo → rimuove i soli dati dimostrativi
 */
import { eq, inArray, like } from "drizzle-orm";
import { db, sql } from "./client";
import {
  bookmakers,
  leagues,
  matches,
  oddsSnapshots,
  teams,
  type MarketType,
  type SelectionCode,
} from "./schema";
import { impliedProbability, round } from "@/lib/drop/math";

/* ------------------------------------------------------------------ */
/* 1. Anagrafiche                                                      */
/* ------------------------------------------------------------------ */

/**
 * Bookmaker di riferimento.
 * `isSharp` marca i libri a bassa marginalità e limiti alti, la cui linea è
 * usata come conferma indipendente. Il peso influenza la coordinazione.
 */
const BOOKMAKER_SEED = [
  { key: "pinnacle", name: "Pinnacle", isSharp: true, weight: "1.000" },
  { key: "betfair-ex", name: "Betfair Exchange", isSharp: true, weight: "1.000" },
  { key: "smarkets", name: "Smarkets", isSharp: true, weight: "0.900" },
  { key: "bet365", name: "bet365", isSharp: false, weight: "0.800" },
  { key: "williamhill", name: "William Hill", isSharp: false, weight: "0.700" },
  { key: "unibet", name: "Unibet", isSharp: false, weight: "0.700" },
  { key: "betsson", name: "Betsson", isSharp: false, weight: "0.600" },
  { key: "marathonbet", name: "Marathonbet", isSharp: false, weight: "0.800" },
  { key: "1xbet", name: "1xBet", isSharp: false, weight: "0.600" },
  { key: "betclic", name: "Betclic", isSharp: false, weight: "0.600" },
];

const LEAGUE_SEED = [
  { key: "it-serie-a", name: "Serie A", country: "Italia", tier: 1 },
  { key: "it-serie-b", name: "Serie B", country: "Italia", tier: 2 },
  { key: "en-premier-league", name: "Premier League", country: "Inghilterra", tier: 1 },
  { key: "en-championship", name: "Championship", country: "Inghilterra", tier: 2 },
  { key: "es-laliga", name: "LaLiga", country: "Spagna", tier: 1 },
  { key: "de-bundesliga", name: "Bundesliga", country: "Germania", tier: 1 },
  { key: "fr-ligue-1", name: "Ligue 1", country: "Francia", tier: 1 },
  { key: "pt-primeira-liga", name: "Primeira Liga", country: "Portogallo", tier: 1 },
  { key: "nl-eredivisie", name: "Eredivisie", country: "Paesi Bassi", tier: 1 },
  { key: "uefa-champions-league", name: "UEFA Champions League", country: "Europa", tier: 1 },
];

async function seedReference(): Promise<void> {
  console.log("→ Anagrafiche bookmaker…");
  for (const b of BOOKMAKER_SEED) {
    await db
      .insert(bookmakers)
      .values(b)
      .onConflictDoUpdate({
        target: bookmakers.key,
        set: { name: b.name, isSharp: b.isSharp, weight: b.weight },
      });
  }
  console.log(`  ${BOOKMAKER_SEED.length} bookmaker (${BOOKMAKER_SEED.filter((b) => b.isSharp).length} sharp)`);

  console.log("→ Anagrafiche campionati…");
  for (const l of LEAGUE_SEED) {
    await db
      .insert(leagues)
      .values(l)
      .onConflictDoUpdate({
        target: leagues.key,
        set: { name: l.name, country: l.country, tier: l.tier },
      });
  }
  console.log(`  ${LEAGUE_SEED.length} campionati`);
}

/* ------------------------------------------------------------------ */
/* 2. Dati dimostrativi                                                */
/* ------------------------------------------------------------------ */

const DEMO_SOURCE = "seed-demo";
const DEMO_PREFIX = "demo-";

interface DemoScenario {
  key: string;
  label: string;
  home: string;
  away: string;
  league: string;
  hoursToKickoff: number;
  market: MarketType;
  /** selezione su cui è costruita la dinamica */
  selection: SelectionCode;
  /** quota di apertura del consenso */
  openPrice: number;
  /** [oreDaApertura, moltiplicatore rispetto all'apertura] */
  curve: Array<[number, number]>;
  /** rumore per bookmaker, in percentuale di prezzo */
  spread: number;
  /** quanti bookmaker forniscono dati */
  books: number;
  /** se lo sharp segue la curva o resta fermo */
  sharpFollows: boolean;
}

/**
 * Scenari costruiti per coprire i casi che il motore deve saper distinguere.
 * Nessuno di questi rappresenta una partita reale.
 */
const DEMO_SCENARIOS: DemoScenario[] = [
  {
    key: "coordinato-sostenuto",
    label: "Drop molto alto, coordinato, sharp conferma, sostenuto",
    home: "Demo Alfa", away: "Demo Beta", league: "it-serie-a",
    hoursToKickoff: 6, market: "1x2", selection: "home",
    openPrice: 2.6,
    curve: [[0, 1], [2, 0.9], [5, 0.79], [12, 0.75], [20, 0.74]],
    spread: 0.02, books: 8, sharpFollows: true,
  },
  {
    key: "flash-rientrato",
    label: "Movimento flash poi rientrato: falso segnale parziale",
    home: "Demo Gamma", away: "Demo Delta", league: "en-premier-league",
    hoursToKickoff: 9, market: "1x2", selection: "away",
    openPrice: 3.2,
    curve: [[0, 1], [0.2, 0.85], [0.4, 0.87], [3, 0.97], [8, 0.99]],
    spread: 0.02, books: 6, sharpFollows: false,
  },
  {
    key: "moderato-senza-sharp",
    label: "Drop moderato senza linea sharp disponibile",
    home: "Demo Epsilon", away: "Demo Zeta", league: "es-laliga",
    hoursToKickoff: 14, market: "ou_2_5", selection: "over",
    openPrice: 2.05,
    curve: [[0, 1], [4, 0.95], [10, 0.93], [16, 0.92]],
    spread: 0.015, books: 4, sharpFollows: false,
  },
  {
    key: "rumore",
    label: "Oscillazione sotto la soglia di rumore",
    home: "Demo Eta", away: "Demo Theta", league: "de-bundesliga",
    hoursToKickoff: 20, market: "1x2", selection: "home",
    openPrice: 1.95,
    curve: [[0, 1], [6, 0.995], [14, 1.005], [22, 0.99]],
    spread: 0.01, books: 7, sharpFollows: true,
  },
  {
    key: "isolato",
    label: "Movimento su un solo bookmaker, non coordinato",
    home: "Demo Iota", away: "Demo Kappa", league: "fr-ligue-1",
    hoursToKickoff: 30, market: "btts", selection: "yes",
    openPrice: 1.85,
    curve: [[0, 1], [5, 0.99], [12, 0.985]],
    spread: 0.01, books: 5, sharpFollows: false,
  },
  {
    key: "alto-sharp-guida",
    label: "Drop alto guidato dalla linea sharp",
    home: "Demo Lambda", away: "Demo Mu", league: "uefa-champions-league",
    hoursToKickoff: 4, market: "1x2", selection: "home",
    openPrice: 2.2,
    curve: [[0, 1], [1, 0.94], [4, 0.88], [10, 0.86]],
    spread: 0.018, books: 9, sharpFollows: true,
  },
];

/** Genera un valore pseudo-casuale deterministico da una stringa. */
function seededNoise(seed: string, index: number): number {
  let h = 2166136261;
  const s = `${seed}:${index}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2000) / 1000 - 1; // -1..1
}

async function ensureTeam(name: string): Promise<number> {
  const key = `${DEMO_PREFIX}${name.toLowerCase().replace(/\s+/g, "-")}`;
  const [row] = await db
    .insert(teams)
    .values({ key, name, shortName: name.split(" ").pop() ?? name })
    .onConflictDoUpdate({ target: teams.key, set: { name } })
    .returning({ id: teams.id });
  return row.id;
}

async function seedDemo(): Promise<void> {
  console.log("→ Dati dimostrativi (marcati seed-demo)…");

  const bookRows = await db.select().from(bookmakers);
  const leagueRows = await db.select().from(leagues);
  const leagueByKey = new Map(leagueRows.map((l) => [l.key, l.id]));

  const now = new Date();
  let snapshotCount = 0;

  for (const sc of DEMO_SCENARIOS) {
    const leagueId = leagueByKey.get(sc.league);
    if (!leagueId) continue;

    const homeId = await ensureTeam(sc.home);
    const awayId = await ensureTeam(sc.away);
    const kickoffAt = new Date(now.getTime() + sc.hoursToKickoff * 3600_000);

    const [match] = await db
      .insert(matches)
      .values({
        key: `${DEMO_PREFIX}${sc.key}`,
        leagueId,
        homeTeamId: homeId,
        awayTeamId: awayId,
        kickoffAt,
        status: "scheduled",
        externalRef: null,
      })
      .onConflictDoUpdate({
        target: matches.key,
        set: { kickoffAt, updatedAt: new Date() },
      })
      .returning({ id: matches.id });

    // pulizia snapshot demo precedenti per questa partita
    await db.delete(oddsSnapshots).where(eq(oddsSnapshots.matchId, match.id));

    // selezione dei bookmaker che coprono lo scenario
    const sharpBooks = bookRows.filter((b) => b.isSharp);
    const softBooks = bookRows.filter((b) => !b.isSharp);
    const chosen = sc.sharpFollows
      ? [...sharpBooks.slice(0, 2), ...softBooks.slice(0, sc.books - 2)]
      : softBooks.slice(0, sc.books);

    // la curva parte da (ore prima del kickoff) e arriva a ora
    const curveSpanHours = sc.curve[sc.curve.length - 1][0];
    const startAt = new Date(now.getTime() - curveSpanHours * 3600_000);

    for (const [bookIdx, book] of chosen.entries()) {
      const bookBias = seededNoise(`${sc.key}-${book.key}`, 0) * sc.spread;
      const isIsolatedMover = sc.key === "isolato" && bookIdx === 0;

      for (const [pointIdx, [hours, mult]] of sc.curve.entries()) {
        // il book isolato si muove molto, gli altri restano quasi fermi
        const effectiveMult = isIsolatedMover
          ? 1 - (1 - mult) * 8
          : sc.key === "isolato"
            ? 1
            : mult;

        // lo sharp anticipa il movimento se guida il mercato
        const sharpLead =
          book.isSharp && sc.sharpFollows && sc.key === "alto-sharp-guida"
            ? (1 - effectiveMult) * 0.4
            : 0;

        const jitter = seededNoise(`${sc.key}-${book.key}`, pointIdx + 1) * sc.spread * 0.4;
        const price = round(
          sc.openPrice * (effectiveMult - sharpLead) * (1 + bookBias + jitter),
          2,
        );
        const prob = impliedProbability(price);
        if (prob === null) continue;

        const collectedAt = new Date(startAt.getTime() + hours * 3600_000);

        await db
          .insert(oddsSnapshots)
          .values({
            matchId: match.id,
            bookmakerId: book.id,
            market: sc.market,
            selection: sc.selection,
            price: price.toFixed(3),
            impliedProb: prob.toFixed(6),
            collectedAt,
            source: DEMO_SOURCE,
            isStale: false,
          })
          .onConflictDoNothing();
        snapshotCount += 1;
      }
    }

    console.log(`  • ${sc.key}: ${chosen.length} book — ${sc.label}`);
  }

  console.log(`  ${snapshotCount} snapshot dimostrativi scritti`);
}

async function cleanDemo(): Promise<void> {
  console.log("→ Rimozione dati dimostrativi…");
  const demoMatches = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.key, `${DEMO_PREFIX}%`));
  if (demoMatches.length > 0) {
    await db.delete(matches).where(
      inArray(
        matches.id,
        demoMatches.map((m) => m.id),
      ),
    );
  }
  await db.delete(teams).where(like(teams.key, `${DEMO_PREFIX}%`));
  console.log(`  ${demoMatches.length} partite dimostrative rimosse`);
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantDemo = args.includes("--demo");
  const wantClean = args.includes("--clean-demo");

  console.log("DropAlert — seed database\n");

  if (wantClean) {
    await cleanDemo();
    await sql.end();
    return;
  }

  await seedReference();
  if (wantDemo) await seedDemo();
  else console.log("\n(dati dimostrativi non caricati: usa --demo per includerli)");

  console.log("\nSeed completato.");
  await sql.end();
}

main().catch(async (err) => {
  console.error("Seed fallito:", err);
  await sql.end();
  process.exit(1);
});
