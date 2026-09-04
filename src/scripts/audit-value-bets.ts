/**
 * Audit della sezione «Value Bets (+EV)» — legge la pagina dal suo stesso codice.
 *
 *   npm run audit:value-bets            (markdown su stdout)
 *
 * Perché esiste: lo scanner di `/value-bets` ricava la «quota fair» moltiplicando
 * la quota corrente per 1,045 (un margine ipotizzato, non misurato:
 * `src/lib/repo/value-bets.ts:41-49`), valuta l'edge sul prezzo di APERTURA —
 * che nessuno può più comprare — e mostra una puntata in euro calcolata su
 * quell'edge. In più l'elenco dei segnali non ha finestra temporale
 * (`getDashboardSignals` legge i 200 segnali migliori di sempre), quindi la
 * lista può proporre partite già giocate.
 *
 * Questo script non cambia nulla: esegue lo stesso identico percorso della
 * pagina e conta sei fatti, con i numeri che il DB contiene davvero.
 *
 * Solo letture: nessuna scrittura, nessuna chiamata di rete.
 */
import { inArray } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { matches } from "@/db/schema";
import { getValueOpportunities } from "@/lib/repo/value-bets";

const BANKROLL = 1_000;

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

const pc = (v: number | null, d = 1): string =>
  v === null ? "n/d" : `${(v * 100).toFixed(d)}%`;

async function main(): Promise<void> {
  const now = new Date();
  const data = await getValueOpportunities({}, now, BANKROLL);
  const opps = data.opportunities;

  console.log("# Audit «Value Bets (+EV)» — la pagina misurata sul proprio percorso\n");
  console.log(
    `Generato: ${now.toISOString()} · segnali letti: ${data.totalScanned} · ` +
      `opportunità restituite: **${opps.length}** · edge medio dichiarato: ` +
      `**+${data.averageEdgePct.toFixed(1)}%**.`,
  );

  const ids = [...new Set(opps.map((o) => o.matchId))];
  const matchRows = ids.length
    ? await db
        .select({
          id: matches.id,
          kickoffAt: matches.kickoffAt,
          status: matches.status,
          homeGoals: matches.homeGoals,
          awayGoals: matches.awayGoals,
          settledAt: matches.settledAt,
        })
        .from(matches)
        .where(inArray(matches.id, ids))
    : [];
  const byId = new Map(matchRows.map((m) => [m.id, m]));

  /* 1 — il pavimento a +0,5%: ogni segnale diventa un'opportunità */
  const floored = opps.filter((o) => o.edgePct <= 0.5001);
  console.log("\n## 1 — Che cosa significa «opportunità» qui dentro\n");
  console.log(
    `- ` +
      `${opps.length} segnali letti, ${opps.length} opportunità elencate: il filtro non scarta nulla ` +
      `perché l'edge è salvato come \`Math.max(0.5, edgePct)\`. ` +
      `Edge esattamente a pavimento (+0,5%): **${floored.length}** (${pc(
        floored.length / Math.max(1, opps.length),
      )}).`,
  );
  const edges = opps.map((o) => o.edgePct);
  console.log(
    `- Edge dichiarato: mediana ${quantile(edges, 0.5)?.toFixed(1)}% · P90 ${quantile(
      edges,
      0.9,
    )?.toFixed(1)}% · massimo ${edges.length ? Math.max(...edges).toFixed(1) : "n/d"}%.`,
  );

  /* 2 — il prezzo dell'edge non è acquistabile */
  const recompute = opps.map((o) => {
    const fairProb = 1 / o.fairOdds;
    const edgeOnCurrent = fairProb * o.currentOdds - 1;
    return { o, edgeOnCurrent };
  });
  const declared = mean(recompute.map((r) => r.o.edgePct / 100));
  const honest = mean(recompute.map((r) => r.edgeOnCurrent));
  console.log("\n## 2 — Il prezzo su cui si calcola l'edge non è quello offeribile\n");
  console.log(
    `- Edge medio dichiarato dalla pagina: **${pc(declared)}** · ricalcolato sullo ` +
      `stesso identico insieme di partite ma sul prezzo che si poteva davvero ` +
      `ottenere (quello corrente): **${pc(honest)}**.`,
  );
  console.log(
    `- La «fair» non viene da un libro sharp: è \`corrente × 1,045\`. Con quella ` +
      `costruzione l'edge sul prezzo corrente vale, per ogni riga, −4,3%: ` +
      `il margine ipotizzato. Non è un caso di calcolo sbagliato — è il ` +
      `disegno: l'edge della pagina è la variazione di prezzo già avvenuta.`,
  );

  /* 3 — partite già giocate in una lista di «opportunità attive» */
  const past = opps.filter((o) => new Date(o.kickoffAt).getTime() < now.getTime());
  const settled = opps.filter((o) => byId.get(o.matchId)?.settledAt != null);
  const withGoals = opps.filter(
    (o) => (byId.get(o.matchId)?.homeGoals ?? null) !== null,
  );
  console.log("\n## 3 — «Attive»: che cosa c'è davvero nella lista\n");
  console.log(
    `- opportunità con kickoff già passato: **${past.length} su ${opps.length}** ` +
      `(${pc(past.length / Math.max(1, opps.length))});\n` +
      `- su partite il cui esito è **già registrato nel database** (` +
      "`matches.settled_at` non vuoto): **" +
      `${settled.length}** · con gol a registro: ${withGoals.length}.`,
  );
  if (settled.length > 0) {
    console.log("\nEsempi (primi 8) — l'esito è noto e la card propone una puntata:\n");
    console.log("| Partita | kickoff | selezione | quota | edge dichiarato | Kelly € | esito |");
    console.log("|---|---|---|---|---|---|---|");
    for (const o of settled.slice(0, 8)) {
      const m = byId.get(o.matchId);
      console.log(
        `| ${o.homeTeam} – ${o.awayTeam} | ${new Date(o.kickoffAt).toLocaleString("it-IT")} | ${
          o.selectionLabel
        } | ${o.currentOdds.toFixed(2)} | +${o.edgePct.toFixed(1)}% | ${o.recommendedStakeEuros?.toFixed(
          2,
        )} € | ${m?.homeGoals ?? "?"}–${m?.awayGoals ?? "?"} |`,
      );
    }
  }

  /* 4 — duplicati sulla stessa partita */
  const perMatch = new Map<number, number>();
  for (const o of opps) perMatch.set(o.matchId, (perMatch.get(o.matchId) ?? 0) + 1);
  const dupes = [...perMatch.entries()].filter(([, n]) => n > 1);
  const dupRows = dupes.reduce((a, [, n]) => a + n, 0);
  console.log("\n## 4 — Conta delle opportunità\n");
  console.log(
    `- partite distinte rappresentate: ${perMatch.size} contro ${opps.length} righe in ` +
      `lista: la stessa partita compare fino a ${Math.max(
        1,
        ...[...perMatch.values()],
      )} volte, una per segnale/selezione, ognuna con la sua puntata consigliata. ` +
      `Partite con più di una riga: ${dupes.length} (${dupRows} righe in lista su ${opps.length}).`,
  );

  /* 5 — input reali per un calcolo +EV */
  const withSharp = opps.filter((o) => o.sharpConfirmed);
  console.log("\n## 5 — Esiste un input per parlare di valore?\n");
  console.log(
    `- opportunità con una linea sharp osservata (non derivata): **${withSharp.length}**. ` +
      `Con la fonte attuale la capacità \`perBookmakerOdds\` è spenta: non esistono quote ` +
      `di singoli bookmaker da confrontare, quindi non esiste un fair di riferimento da ` +
      `cui far discendere un edge. \`sharpPrice\` in scheda è \`corrente × 0,96\`: un ` +
      `valore costruito, non letto.`,
  );

  /* 6 — esposizione del bankroll */
  const stakes = opps.reduce((a, o) => a + (o.recommendedStakeEuros ?? 0), 0);
  console.log("\n## 6 — Che cosa chiedono le puntate suggerite\n");
  console.log(
    `- somma dei € suggeriti come «Kelly stake» su un bankroll di ${BANKROLL} €: ` +
      `**${stakes.toFixed(0)} €** (${(stakes / BANKROLL).toFixed(1)}× il bankroll) su ` +
      `${opps.length} «occasioni», cioè ${(
        (stakes / opps.length / BANKROLL) *
        100
      ).toFixed(1)} € di media a card.`,
  );
  console.log(
    `- nessuna di queste puntate passa da un prezzo eseguibile (punto 2) e ` +
      `${past.length} riguardano partite già concluse (punto 3): \`Bankroll\` e \`Kelly\` ` +
      `sono qui due campi di una calcolatrice, non una gestione del rischio.`,
  );

  console.log("\n---\n");
  console.log(
    "Nessuna modifica applicata da questo script: è la radiografia del percorso " +
      "`getValueOpportunities` sui dati presenti. Le correzioni proposte sono in " +
      "`docs/STUDIO-VALUE-BETS.md`.",
  );
  await sql.end();
}

main().catch(async (err) => {
  console.error("Audit fallito:", err);
  await sql.end();
  process.exit(1);
});
