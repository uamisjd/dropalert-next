/**
 * Verifica della pagina «Divario di prezzo» (/value-bets): il percorso della pagina,
 * contato a voce alta.
 *
 *   npm run audit:value-bets            (markdown su stdout, solo letture)
 *
 * È il guard dell'audit `docs/STUDIO-VALUE-BETS.md`: i sette controlli sotto sono le
 * proprietà che la pagina deve mantenere perché i suoi numeri siano una misura e non
 * un'opinione. Ognuna ha un verdetto esplicito (OK / ATTENZIONE), così non serve
 * rileggere il codice per sapere se qualcosa è tornato indietro.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, sql as raw } from "@/db/client";
import { matches, oddsSnapshots } from "@/db/schema";
import { getValueOpportunities } from "@/lib/repo/value-bets";

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

const quantile = (xs: number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

const pc = (v: number | null, d = 1): string =>
  v === null ? "n/d" : `${(v * 100).toFixed(d)}%`;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const now = new Date();
  const data = await getValueOpportunities({}, now);
  const rows = data.opportunities;
  const ids = [...new Set(rows.map((o) => o.matchId))];

  const matchRows = ids.length
    ? await db
        .select({
          id: matches.id,
          kickoffAt: matches.kickoffAt,
          status: matches.status,
          settledAt: matches.settledAt,
        })
        .from(matches)
        .where(inArray(matches.id, ids))
    : [];
  const byId = new Map(matchRows.map((m) => [m.id, m]));

  const pastKickoff = rows.filter(
    (o) => new Date(o.kickoffAt).getTime() <= now.getTime(),
  ).length;
  const settledInList = rows.filter((o) => {
    const m = byId.get(o.matchId);
    return m ? m.settledAt !== null || m.status === "finished" : false;
  }).length;
  const edges = rows.map((o) => o.edgePct);

  /* 7 — la regola della terna simultanea è stretta, o i dati non la permettono? */
  const playable = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(gt(matches.kickoffAt, now), eq(matches.status, "scheduled")));
  const playableIds = playable.map((r) => r.id);
  let instants = 0;
  let completeInstants = 0;
  if (playableIds.length > 0) {
    const groups = await db
      .select({
        market: oddsSnapshots.market,
        collectedAt: oddsSnapshots.collectedAt,
        selections: sql<number>`count(distinct ${oddsSnapshots.selection})::int`,
      })
      .from(oddsSnapshots)
      .where(inArray(oddsSnapshots.matchId, playableIds))
      .groupBy(oddsSnapshots.matchId, oddsSnapshots.market, oddsSnapshots.collectedAt);
    instants = groups.length;
    completeInstants = groups.filter(
      (g) => g.selections >= (g.market === "1x2" ? 3 : 2),
    ).length;
  }
  const fakeFair = rows.filter(
    (o) => Math.abs(o.fairOdds / o.currentOdds - 1.045) < 0.0005,
  ).length;
  const noFloor = rows.filter((o) => o.edgePct < 0).length;
  const books = rows.map((o) => o.booksWithLine);
  const ages = rows
    .map((o) => o.lineAgeMinutes)
    .filter((x): x is number => x !== null);

  const checks: Check[] = [
    {
      name: "solo partite non ancora al kickoff",
      ok: pastKickoff === 0,
      detail: `${pastKickoff} righe su ${rows.length} con kickoff già passato (atteso 0)`,
    },
    {
      name: "nessuna partita con verdetto a registro",
      ok: settledInList === 0,
      detail: `${settledInList} righe su partite già concluse nel database (atteso 0)`,
    },
    {
      name: "la fair viene da una linea, non da 1,045",
      ok: fakeFair === 0,
      detail: `${fakeFair} righe con fair = quota × 1,045 esatto (atteso 0: il margine si misura, non si presume)`,
    },
    {
      name: "nessun pavimento a +0,5%: i divari negativi si vedono",
      ok: rows.length === 0 || noFloor > 0 || Math.min(...edges) < 0.5,
      detail: `${noFloor} righe sotto zero su ${rows.length}`,
    },
    {
      name: "il divario medio non è un margine di comodo",
      ok: Math.abs(data.averageEdgePct) < 12,
      detail: `media ${data.averageEdgePct.toFixed(2)} pp — un valore intorno a −4/+5 pp è il margine della linea; un ordine di grandezza diverso qui significa una formula reinventata`,
    },
    {
      name: "la terna simultanea esiste nei dati (non è la regola a azzerare la lista)",
      ok: rows.length > 0 || completeInstants > 0,
      detail:
        `${playableIds.length} partite giocabili in archivio · ${instants} istanti di ` +
        `lettura · ${completeInstants} con linea completa per il no-vig. Se questo è 0 ` +
        `mentre gli istanti sono molti, il problema è la scrittura del collettore: ` +
        `npm run test:line-shape dice se la forma della fonte è cambiata.`,
    },
    {
      name: "contatori di scarto esposti",
      ok: Object.values(data.skipped).reduce((a, b) => a + b, 0) + rows.length <=
        data.signalsRead,
      detail: `${data.signalsRead} segnali letti, ${rows.length} elencati, ${Object.entries(
        data.skipped,
      )
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ")}`,
    },
  ];

  console.log("# Verifica «Divario di prezzo» (/value-bets)\n");
  console.log(
    `Eseguito: ${now.toISOString()} · metodo ${data.method} · ${data.dataNote}\n`,
  );
  console.log("| controllo | esito | dettaglio |");
  console.log("|---|---|---|");
  for (const c of checks) {
    console.log(`| ${c.name} | ${c.ok ? "OK" : "ATTENZIONE"} | ${c.detail} |`);
  }

  console.log("\n## Distribuzione dei divari elencati\n");
  console.log(
    `- righe: ${rows.length} · mediana ${quantile(edges, 0.5)?.toFixed(2)} pp · ` +
      `min ${edges.length ? Math.min(...edges).toFixed(2) : "n/d"} pp · ` +
      `max ${edges.length ? Math.max(...edges).toFixed(2) : "n/d"} pp · ` +
      `sopra zero ${pc(rows.length === 0 ? null : rows.filter((o) => o.edgePct > 0).length / rows.length)}`,
  );
  console.log(
    `- bookmaker con terna completa per riga: media ${(mean(books) ?? 0).toFixed(2)} · ` +
      `massimo ${books.length ? Math.max(...books) : "n/d"} (con un solo operatore in ` +
      `fonte questo numero non può salire: è il limite da rimuovere per parlare di valore)`,
  );
  console.log(
    `- età delle letture usate: mediana ${quantile(ages, 0.5)?.toFixed(0)} min · ` +
      `massimo ${ages.length ? Math.max(...ages).toFixed(0) : "n/d"} min`,
  );
  console.log(
    `- scarti: ${data.skipped.kickoffPassed} già al kickoff · ` +
      `${data.skipped.notPlayable} non più giocabili · ` +
      `${data.skipped.incompleteLine} senza terna completa · ` +
      `${data.skipped.noLine} senza lettura della linea · ` +
      `${data.skipped.noCurrentPrice} senza prezzo corrente`,
  );

  const worst = [...rows].sort((a, b) => a.edgePct - b.edgePct).slice(0, 5);
  if (worst.length > 0) {
    console.log("\n## I cinque divari più negativi\n");
    console.log("| partita | selezione | quota | fair | divario | margine rimosso |");
    console.log("|---|---|---|---|---|---|");
    for (const o of worst) {
      console.log(
        `| ${o.homeTeam} – ${o.awayTeam} | ${o.selectionLabel} | ${o.currentOdds.toFixed(
          2,
        )} | ${o.fairOdds.toFixed(2)} | ${o.edgePct.toFixed(2)} pp | ${o.lineMarginPct.toFixed(2)}% |`,
      );
    }
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log("\n---\n");
  console.log(
    failed === 0
      ? "Tutti i controlli passano: la pagina espone solo divari calcolati su letture reali."
      : `${failed} controlli da leggere: niente è stato modificato da questo script, che fa solo letture.`,
  );
  await raw.end();
}

main().catch(async (err) => {
  console.error("Verifica fallita:", err);
  await raw.end();
  process.exit(1);
});
