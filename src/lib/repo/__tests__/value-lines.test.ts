/**
 * Test della costruzione delle linee di prezzo usate dal divario (/value-bets).
 * Runner minimale, nessuna dipendenza esterna e nessun accesso al database.
 * Eseguire con: npm run test:value-lines
 *
 * Perché un file dedicato: `groupLatestLines` è l'unica cosa che decide se una
 * «quota fair» esiste, quindi la sua regola — una linea è fatta di selezioni
 * rilevate alla STESSA ora, non della più recente di ciascuna — merita di essere
 * bloccata da un test e non dalla buona volontà di chi legge il codice.
 */
import { groupLatestLines, toInstant, type LineRow } from "../value-bets";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

const t = (iso: string): Date => new Date(iso);

function row(partial: Partial<LineRow> & Pick<LineRow, "matchId" | "selection" | "price">): LineRow {
  return {
    bookmakerId: 1,
    market: "1x2",
    collectedAt: t("2026-09-04T10:00:00.000Z"),
    source: "betexplorer",
    ...partial,
  } as LineRow;
}

console.log("\nLinee di prezzo per il divario (`groupLatestLines`)\n");

// 1 — terna completa alla stessa ora: una sola linea, tre prezzi
{
  const lines = groupLatestLines([
    row({ matchId: 7, selection: "home", price: "2.10" }),
    row({ matchId: 7, selection: "draw", price: "3.40" }),
    row({ matchId: 7, selection: "away", price: "3.55" }),
  ]);
  const list = lines.get("7|1x2") ?? [];
  assert(list.length === 1, "tre letture alla stessa ora = una linea");
  assert(
    list.length === 1 && Object.keys(list[0].prices).length === 3,
    "la linea contiene tutte e tre le selezioni",
  );
  assert(
    list.length === 1 && list[0].prices.home === 2.1,
    "il prezzo numerico è quello osservato, senza ritocchi",
  );
}

// 2 — la lettura più recente vince e NON eredita le selezioni della precedente
{
  const lines = groupLatestLines([
    // ordine come arriva dalla banca dati: collectedAt DESC
    row({ matchId: 7, selection: "home", price: "2.40", collectedAt: t("2026-09-04T11:00:00.000Z") }),
    row({ matchId: 7, selection: "draw", price: "3.40", collectedAt: t("2026-09-04T10:00:00.000Z") }),
    row({ matchId: 7, selection: "away", price: "3.55", collectedAt: t("2026-09-04T10:00:00.000Z") }),
  ]);
  const list = lines.get("7|1x2") ?? [];
  assert(list.length === 1, "una sola linea candidata per (partita, mercato, bookmaker)");
  assert(
    list.length === 1 && Object.keys(list[0].prices).length === 1,
    "l'ultima ora di lettura ha una sola selezione: la linea resta incompleta",
  );
  assert(
    list.length === 1 && list[0].prices.home === 2.4 && list[0].prices.draw === undefined,
    "le selezioni delle ore precedenti non vengono mescolate dentro",
  );
}

// 3 — bookmaker diversi restano linee separate (un no-vig misto sarebbe inventato)
{
  const lines = groupLatestLines([
    row({ matchId: 7, bookmakerId: 1, selection: "home", price: "2.10" }),
    row({ matchId: 7, bookmakerId: 1, selection: "draw", price: "3.40" }),
    row({ matchId: 7, bookmakerId: 1, selection: "away", price: "3.55" }),
    row({ matchId: 7, bookmakerId: 2, selection: "home", price: "2.05" }),
    row({ matchId: 7, bookmakerId: 2, selection: "draw", price: "3.45" }),
    row({ matchId: 7, bookmakerId: 2, selection: "away", price: "3.60" }),
  ]);
  const list = lines.get("7|1x2") ?? [];
  assert(list.length === 2, "due bookmaker = due linee, non una linea media");
  assert(
    list.every((l) => Object.keys(l.prices).length === 3),
    "entrambe complete: il divario potrà essere calcolato su una delle due",
  );
}

// 4 — mercati diversi della stessa partita non si toccano
{
  const lines = groupLatestLines([
    row({ matchId: 7, market: "1x2", selection: "home", price: "2.10" }),
    row({ matchId: 7, market: "1x2", selection: "draw", price: "3.40" }),
    row({ matchId: 7, market: "1x2", selection: "away", price: "3.55" }),
    row({ matchId: 7, market: "btts", selection: "yes", price: "1.80" }),
    row({ matchId: 7, market: "btts", selection: "no", price: "1.95" }),
  ]);
  assert((lines.get("7|1x2")?.length ?? 0) === 1, "chiave per mercato: 1X2 isolata");
  assert((lines.get("7|btts")?.length ?? 0) === 1, "chiave per mercato: GG isolata");
  assert(
    Object.keys(lines.get("7|btts")?.[0].prices ?? {}).length === 2,
    "la terna del mercato non contamina la coppia GG",
  );
}

// 4b — gli istanti che escono da un aggregato vanno normalizzati
{
  // È il difetto che ha fatto cadere la pagina su dati reali: `max(collected_at)`
  // arriva come testo e, rimandato a Postgres come parametro, fa chiamare
  // `.toISOString()` a una stringa.
  const d = toInstant("2026-09-05 01:30:00+00");
  assert(d !== null && d.toISOString() === "2026-09-05T01:30:00.000Z", "testo pg → Date");
  assert(typeof d?.toISOString === "function", "il risultato è un Date, non una stringa");
  const same = toInstant(new Date("2026-09-05T01:30:00.000Z"));
  assert(same?.toISOString() === "2026-09-05T01:30:00.000Z", "Date passa invariato");
  assert(toInstant(new Date("non-data")) === null, "Date marcio → null (riga scartata)");
  assert(toInstant("") === null && toInstant(null) === null, "stringa vuota e null → null");
  assert(toInstant(1_757_038_200_000)?.toISOString() === "2025-09-05T02:10:00.000Z", "epoch ms → Date");
}

// 5 — nessuna riga, nessuna linea (mai un finto "mercato completo")
{
  assert(groupLatestLines([]).size === 0, "input vuoto → mappa vuota");
}

console.log(`\n${passed} test superati | ${failed} falliti\n`);
if (failed > 0) process.exit(1);
