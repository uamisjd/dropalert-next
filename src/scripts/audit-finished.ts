/**
 * Audit della sezione «partite finite» — lettura dello storico senza scrivere nulla.
 *
 *   npm run audit:finished              (markdown su stdout)
 *   npm run audit:finished > docs/AUDIT-PARTITE-FINITE.md
 *
 * Perché esiste: l'archivio dei segnali chiusi è la sola parte del sito che
 * può dire se il monitor vale qualcosa, ma rispondere «scheda per scheda» a
 * mano non è un metodo — è un lavoro che sfugge. Questo script legge lo
 * storico e risponde a sei domande di fatto, tutte con il conteggio di ciò
 * che manca e nessuna stima di ciò che non c'è:
 *
 *   A. quante partite finite hanno davvero un esito (e l'elenco di quelle
 *      che ne sono prive: la lista da verificare, non un numero);
 *   B. quanto è «chiusura» la closing line acquisita (distanza dal kickoff,
 *      casi in cui il CLV confronta due volte lo stesso prezzo);
 *   C. se le due quote del CLV stanno sulla stessa base (grezza vs fair
 *      senza margine) e quanto vale la differenza;
 *   D. ROI realizzato sui segnali con esito, per segmento — diagnostico,
 *      non pubblicabile: è la domanda «dove si può fare profitto» posta ai
 *      nostri dati, con la potenza che i nostri dati hanno;
 *   E. se la scala dell'indice può fisicamente arrivare dove il riepilogo del
 *      CLV la vorrebbe;
 *   F. profondità reale della serie per partita (quante rilevazioni, quale
 *      ultimo istante prima del kickoff).
 *
 * Solo letture: nessuna scrittura, nessuna chiamata di rete.
 */
import { eq, inArray, sql as raw } from "drizzle-orm";
import { db, sql } from "@/db/client";
import {
  closingLines,
  clvRecords,
  dropSignals,
  leagues,
  matches,
  oddsSnapshots,
  teams,
  type MarketType,
  type SelectionCode,
} from "@/db/schema";
import { num } from "@/lib/drop/math";
import {
  MIN_OUTCOMES_FOR_TREND,
  RESULT_GRACE_HOURS,
  outcomeOf,
  type SettleMarket,
  type SettleSelection,
} from "@/lib/settle/outcome";

/* ------------------------------------------------------------------ */
/* Piccole statistiche locali (lo studio serio è altrove, qui fatti)   */
/* ------------------------------------------------------------------ */

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

function se(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs) as number;
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1)) / Math.sqrt(xs.length);
}

function wilson(k: number, n: number): string {
  if (n === 0) return "n/d";
  const z = 1.959964;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / denom;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return `${((c - h) * 100).toFixed(1)}–${((c + h) * 100).toFixed(1)}%`;
}

const pc = (v: number | null, d = 2): string => (v === null ? "n/d" : `${(v * 100).toFixed(d)}%`);
const signed = (v: number | null, d = 2): string =>
  v === null ? "n/d" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;

function oddsBand(p: number): string {
  if (p < 1.4) return "1.01–1.39";
  if (p < 2.0) return "1.40–1.99";
  if (p < 3.0) return "2.00–2.99";
  if (p < 5.0) return "3.00–4.99";
  if (p < 10.0) return "5.00–9.99";
  return "10.00+";
}

const NOW = new Date();
const OVERDUE_MS = RESULT_GRACE_HOURS * 3_600_000;

/* ------------------------------------------------------------------ */
/* Lettura                                                             */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const signalRows = await db
    .select({
      id: dropSignals.id,
      matchId: dropSignals.matchId,
      market: dropSignals.market,
      selection: dropSignals.selection,
      status: dropSignals.status,
      magnitude: dropSignals.magnitudeClass,
      deltaPp: dropSignals.deltaPp,
      detectedPrice: dropSignals.detectedPrice,
      openingPrice: dropSignals.openingPrice,
      currentPrice: dropSignals.currentPrice,
      confidenceScore: dropSignals.confidenceScore,
      engineVersion: dropSignals.engineVersion,
      sustainedMinutes: dropSignals.sustainedMinutes,
      rebounded: dropSignals.rebounded,
      booksTotal: dropSignals.booksTotal,
      booksConfirming: dropSignals.booksConfirming,
      kickoffAt: matches.kickoffAt,
      matchStatus: matches.status,
      homeGoals: matches.homeGoals,
      awayGoals: matches.awayGoals,
      settledAt: matches.settledAt,
      league: leagues.name,
      country: leagues.country,
      homeTeam: teams.name,
      awayTeam: teams.name,
    })
    .from(dropSignals)
    .innerJoin(matches, eq(matches.id, dropSignals.matchId))
    .leftJoin(leagues, eq(leagues.id, matches.leagueId))
    .leftJoin(teams, eq(teams.id, matches.homeTeamId))
    .where(raw`${matches.key} not like 'demo-%'`);

  const clvRows = await db.select().from(clvRecords);

  const matchIds = [...new Set(signalRows.map((s) => s.matchId))];
  const closingRows = matchIds.length
    ? await db
        .select()
        .from(closingLines)
        .where(inArray(closingLines.matchId, matchIds))
    : [];
  const closingKey = (m: number, k: MarketType, s: SelectionCode) => `${m}|${k}|${s}`;
  const closingBy = new Map<string, typeof closingRows>();
  for (const r of closingRows) {
    const k = closingKey(r.matchId, r.market, r.selection);
    closingBy.set(k, [...(closingBy.get(k) ?? []), r]);
  }

  /* serie per partita: quante rilevazioni e a che ora l'ultima */
  const seriesRows = matchIds.length
    ? await db
        .select({
          matchId: oddsSnapshots.matchId,
          at: oddsSnapshots.collectedAt,
          price: oddsSnapshots.price,
          market: oddsSnapshots.market,
          selection: oddsSnapshots.selection,
        })
        .from(oddsSnapshots)
        .where(inArray(oddsSnapshots.matchId, matchIds))
        .orderBy(oddsSnapshots.matchId)
    : [];
  const seriesByMatch = new Map<number, typeof seriesRows>();
  for (const r of seriesRows) {
    seriesByMatch.set(r.matchId, [...(seriesByMatch.get(r.matchId) ?? []), r]);
  }

  console.log("# Audit «partite finite» — storico letto dal database\n");
  console.log(
    `Generato: ${NOW.toISOString()} · segnali (escluso demo): **${signalRows.length}** · ` +
      `record CLV: ${clvRows.length} · righe closing_lines: ${closingRows.length} · ` +
      `snapshot letti: ${seriesRows.length.toLocaleString("it-IT")}.`,
  );

  /* ============================================================== */
  console.log("\n## A — Esiti: quante schede sono davvero verificabili\n");
  const past = signalRows.filter(
    (s) => new Date(s.kickoffAt).getTime() < NOW.getTime() - OVERDUE_MS,
  );
  const withGoals = past.filter((s) => s.homeGoals !== null && s.awayGoals !== null);
  const missing = past.filter((s) => s.homeGoals === null || s.awayGoals === null);
  const overdueMatches = [...new Set(missing.map((s) => s.matchId))];
  console.log(
    `Segnali su partite oltre il kickoff (+${RESULT_GRACE_HOURS} h di grazia): ${past.length}. ` +
      `Con gol registrati: **${withGoals.length}**. Senza: **${missing.length}** ` +
      `(${overdueMatches.length} partite distinte).\n`,
  );
  if (overdueMatches.length > 0) {
    console.log("Partite senza esito — la lista da verificare (o da far rincorrere al collector risultati):");
    console.log("");
    const byLeague = new Map<string, number>();
    for (const s of missing) {
      const k = s.league ?? "lega ignota";
      byLeague.set(k, (byLeague.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...byLeague.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`- ${k}: ${n}`);
    }
    console.log("");
    console.log(
      `Id partita da rincorrere (primi 40): ${overdueMatches.slice(0, 40).join(", ")}` +
        (overdueMatches.length > 40 ? ` … (+${overdueMatches.length - 40})` : ""),
    );
  }

  const verdicts = withGoals.map((s) =>
    outcomeOf({
      market: s.market as SettleMarket,
      selection: s.selection as SettleSelection,
      homeGoals: s.homeGoals,
      awayGoals: s.awayGoals,
    }),
  );
  const centrata = verdicts.filter((v) => v === "centrata").length;
  const mancata = verdicts.filter((v) => v === "mancata").length;
  console.log(
    `\nVerdetti dai gol finali: centrate ${centrata}, mancate ${mancata}, ` +
      `frequenza ${pc(centrata / Math.max(1, centrata + mancata))} (IC 95% ${wilson(
        centrata,
        Math.max(1, centrata + mancata),
      )}).`,
  );
  if (centrata + mancata < MIN_OUTCOMES_FOR_TREND) {
    console.log(`Sotto ${MIN_OUTCOMES_FOR_TREND} esiti risolti: non è una tendenza.`);
  }

  /* ============================================================== */
  console.log("\n## B — Che cosa è, davvero, la «chiusura»\n");
  const minutes = closingRows
    .map((r) => r.minutesBeforeKickoff)
    .filter((v): v is number => v !== null);
  const samePrice = clvRows.filter((r) => num(r.signalPrice) === num(r.closingPrice)).length;
  const tinyWindow = clvRows.filter((r) => {
    const s = signalRows.find((x) => x.id === r.signalId);
    if (!s) return false;
    const snap = seriesByMatch.get(r.matchId) ?? [];
    return snap.length <= 2;
  }).length;
  console.log(
    `- \`closing_lines.minutes_before_kickoff\` — mediana ${quantile(minutes, 0.5) ?? "n/d"} min, ` +
      `P90 ${quantile(minutes, 0.9) ?? "n/d"} min, ` +
      `oltre 60 min: ${pc((minutes.filter((m) => m > 60).length / Math.max(1, minutes.length)) * 1)} ` +
      `(${minutes.filter((m) => m > 60).length}/${minutes.length}).`,
  );
  console.log(
    `- CLV con \`signalPrice == closingPrice\` (il prezzo del rilevamento è anche la «chiusura»: ` +
      `nessun movimento successivo osservato): **${samePrice} su ${clvRows.length}** ` +
      `(${pc(samePrice / Math.max(1, clvRows.length), 1)}).`,
  );
  console.log(
    `- segnali la cui partita ha ≤ 2 rilevazioni in tutto: ${tinyWindow} ` +
      `(${pc(tinyWindow / Math.max(1, signalRows.length), 1)}).`,
  );
  console.log(
    `\nUna «chiusura» presa un'ora prima del kickoff e un CLV calcolato sullo stesso ` +
      `snapshot non sono misure dello stesso fenomeno: qui si vede quanti dei record ` +
      `sono nell'uno o nell'altro caso. Il campo per decidere esiste già in schema ` +
      `(\`minutes_before_kickoff\`) e non è mai letto da nessuna pagina.`,
  );

  /* ============================================================== */
  console.log("\n## C — Le due quote del CLV stanno sulla stessa base?\n");
  const byBasis = new Map<string, number[]>();
  for (const r of clvRows) {
    byBasis.set(r.closingBasis, [...(byBasis.get(r.closingBasis) ?? []), num(r.clvPp) ?? NaN]);
  }
  console.log("| Base di chiusura dichiarata | n | CLV medio (pp) | Batte la chiusura |");
  console.log("|---|---|---|---|");
  for (const [basis, xs] of byBasis) {
    const ok = xs.filter(Number.isFinite);
    const beat = clvRows.filter((r) => r.closingBasis === basis && r.beatClose).length;
    console.log(
      `| \`${basis}\` | ${ok.length} | ${signed(mean(ok), 2)} | ${pc(beat / Math.max(1, ok.length), 1)} |`,
    );
  }

  /* Ricalcolo sulla stessa base, dove è possibile farlo con i dati a registro. */
  const corrected: { id: number; before: number; after: number; flip: boolean }[] = [];
  for (const r of clvRows) {
    if (r.closingBasis !== "fair_novig") continue;
    const sig = num(r.signalPrice);
    const margin = num(r.marketMargin);
    if (sig === null || margin === null) continue;
    const raws = (closingBy.get(closingKey(r.matchId, "1x2", "home")) ?? [])
      .map((c) => num(c.closingPrice))
      .filter((v): v is number => v !== null);
    if (raws.length === 0) continue;
    /* chiusura grezza dello stesso consenso del prezzo di rilevamento */
    const rawClose = medianOf(raws);
    const fairClose = num(r.closingPrice);
    if (rawClose === null || fairClose === null) continue;
    const before = ((1 / rawClose - 1 / sig) * 100);
    /* e la versione coerente fair-contro-fair: il prezzo di segnale depurato
       con lo stesso margine usato per la chiusura (approssimazione dichiarata) */
    const sigFairProb = 1 / (sig * (1 + margin));
    const after = ((1 / fairClose - sigFairProb) * 100);
    corrected.push({ id: r.signalId, before, after, flip: before <= 0 !== after <= 0 });
  }
  if (corrected.length > 0) {
    console.log("");
    console.log(
      `Sui ${corrected.length} record con base \`fair_novig\`, il CLV \`raw-vs-fair\` ` +
        `(quello oggi salvato) vale in media **${signed(mean(corrected.map((c) => c.before)), 2)} pp**, ` +
        `contro un confronto coerente pari a **${signed(mean(corrected.map((c) => c.after)), 2)} pp**: ` +
        `differenza ${signed(
          mean(corrected.map((c) => c.after - c.before)),
          2,
        )} pp, e ${corrected.filter((c) => c.flip).length} record (${pc(
          corrected.filter((c) => c.flip).length / corrected.length,
          1,
        )}) cambierebbero verso.`,
    );
    console.log("");
    console.log(
      "Nota: `rawClose` qui è la mediana delle chiusure grezze registrate per la stessa " +
        "(partita, mercato, selezione); `marketMargin` è quello rimosso alla chiusura, " +
        "usato anche per depurare il prezzo di segnale — è un'approssimazione dichiarata, " +
        "perché il margine dell'istante di rilevamento non è salvato. Serve a dimensionare " +
        "l'effetto, non a pubblicare un numero.",
    );
  } else {
    console.log("\nNessun record con base `fair_novig`: il confronto non è calcolabile qui.");
  }

  /* ============================================================== */
  console.log("\n## D — ROI realizzato sui segnali con esito (diagnostico, non pubblicabile)\n");
  console.log(
    "Domanda posta ai nostri dati, con la potenza dei nostri dati. Punto la selezione " +
      "del segnale alla `detected_price` (il prezzo congelato al rilevamento): +quota−1 " +
      "se centrata, −1 se mancata.\n",
  );
  const bets = withGoals
    .map((s) => {
      const price = num(s.detectedPrice);
      const v = outcomeOf({
        market: s.market as SettleMarket,
        selection: s.selection as SettleSelection,
        homeGoals: s.homeGoals,
        awayGoals: s.awayGoals,
      });
      if (price === null || v === "in_attesa") return null;
      return {
        s,
        price,
        profit: v === "centrata" ? price - 1 : -1,
        won: v === "centrata",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const report = (label: string, xs: { profit: number; won: boolean; price: number }[]) => {
    const profits = xs.map((x) => x.profit);
    const roi = mean(profits);
    const e = se(profits);
    console.log(
      `| ${label} | ${xs.length} | ${pc(
        xs.filter((x) => x.won).length / Math.max(1, xs.length),
        1,
      )} | ${pc(roi)} | ${e === null ? "n/d" : `±${(e * 100).toFixed(1)} pp`} | ${
        e === null || roi === null ? "n/d" : (roi / e).toFixed(2)
      } | ${xs.length < MIN_OUTCOMES_FOR_TREND ? "non concludente" : ""} |`,
    );
  };
  console.log("| Segmento | n | Frequent. | ROI | IC 95% (±) | t | nota |");
  console.log("|---|---|---|---|---|---|---|");
  report("tutti i segnali con esito", bets);
  const groups = new Map<string, typeof bets>();
  const push = (k: string, v: (typeof bets)[number]) => groups.set(k, [...(groups.get(k) ?? []), v]);
  for (const b of bets) {
    const sc = num(b.s.confidenceScore) ?? 0;
    push(`indice ${sc < 25 ? "0–24" : sc < 50 ? "25–49" : sc < 75 ? "50–74" : "75–100"}`, b);
    push(`ampiezza ${b.s.magnitude}`, b);
    push(`quota ${oddsBand(b.price)}`, b);
    push(`coorte ${b.s.engineVersion ?? "v1"}`, b);
    push(`book ${b.s.booksTotal > 1 ? ">1 bookmaker" : "1 solo bookmaker"}`, b);
    if (b.s.country) push(`paese ${b.s.country}`, b);
  }
  for (const [k, xs] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (xs.length < 3) continue;
    report(k, xs);
  }

  /* ============================================================== */
  console.log("\n## E — La scala dell'indice: dove può fisicamente arrivare\n");
  const scores = signalRows.map((s) => num(s.confidenceScore)).filter((v): v is number => v !== null);
  console.log(
    `- indice massimo osservato: ${scores.length ? Math.max(...scores).toFixed(2) : "n/d"} · ` +
      `mediana ${signed(quantile(scores, 0.5), 2)} · oltre 55/100: ${
        scores.filter((v) => v > 55).length
      } · oltre 75/100: ${scores.filter((v) => v > 75).length}.`,
  );
  console.log(
    `- \`booksTotal == 1\`: ${signalRows.filter((s) => s.booksTotal <= 1).length}/${signalRows.length} ` +
      `(coordinazione 25 punti e linea sharp 20 punti non sono misurabili con la sola fonte di ` +
      `consenso: il tetto raggiungibile è 55/100).`,
  );
  console.log(
    `\nLe fasce del riepilogo CLV (\`${"0–24"}\`, \`25–49\`, \`50–74\`, \`75–100\`) sono lette ` +
      `sull'indice grezzo: le ultime due non possono che essere quasi vuote. Un ricalcolo su ` +
      `base misurabile (la stessa che mostrano le card) è l'unico modo di usare quelle fasce ` +
      `per la calibrazione di R3.`,
  );

  /* ============================================================== */
  console.log("\n## F — Profondità della serie per partita\n");
  const depths = [...seriesByMatch.values()].map((v) => v.length);
  const lastGap: number[] = [];
  for (const [matchId, rows] of seriesByMatch) {
    const s = signalRows.find((x) => x.matchId === matchId);
    if (!s) continue;
    const last = rows.reduce((a, b) => (a.at > b.at ? a : b));
    lastGap.push((new Date(s.kickoffAt).getTime() - new Date(last.at).getTime()) / 60000);
  }
  console.log(
    `- rilevazioni per partita: mediana ${quantile(depths, 0.5) ?? "n/d"} · P10 ${
      quantile(depths, 0.1) ?? "n/d"
    } · P90 ${quantile(depths, 0.9) ?? "n/d"}.`,
  );
  console.log(
    `- minuti fra l'ultima rilevazione e il kickoff: mediana ${
      quantile(lastGap, 0.5)?.toFixed(0) ?? "n/d"
    } · P90 ${quantile(lastGap, 0.9)?.toFixed(0) ?? "n/d"} · ` +
      `oltre 120 min: ${pc((lastGap.filter((g) => g > 120).length / Math.max(1, lastGap.length)) * 1, 1)}.`,
  );
  console.log(
    `\nIl collector osserva una partita finché è nell'elenco dei movimenti: quando il movimento ` +
      `si esaurisce la partita sparisce dall'elenco e non ci sono altre rilevazioni. È per questo ` +
      `che l'«ultima quota prima del kickoff» può essere, per molte partite, solo la «quota ` +
      `dell'ultimo momento in cui la fonte ne parlava».`,
  );

  console.log("\n---\n");
  console.log(
    "Nessun numero di questo audit è un rendimento né un consiglio. I segmenti sotto le " +
      `${MIN_OUTCOMES_FOR_TREND} osservazioni sono marcati non concludenti e restano tali anche ` +
      `se letti in fila.`,
  );

  await sql.end();
}

function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

main().catch(async (err) => {
  console.error("Audit fallito:", err);
  await sql.end();
  process.exit(1);
});
