/**
 * Lettura di CONTROLLO sul percorso di produzione, per un campionato coperto.
 *
 *   npm run odds:control                     # archivio; se vuoto, ripiego dalla fonte
 *   npm run odds:control -- --match-id 123   # partita specifica (deve essere in archivio)
 *   npm run odds:control -- --sport-key K    # ripiego limitato a una chiave (es. soccer_italy_serie_a)
 *   npm run odds:control -- --solo-archivio  # mai uscire dall'archivio (0 crediti garantiti)
 *
 * A differenza dello smoke test (che usa il client direttamente), qui si passa
 * da `getSharpLine` — lo STESSO percorso della pagina partita: vista budget,
 * fotografia del giorno, mappa di budget (`sportKeyFor`), decisione `decide`,
 * lettura reale, conteggio crediti in `system_state`, scrittura snapshot.
 *
 * Serve a validare, su un campionato coperto, mapping + contatori + matching
 * PRIMA di impostare ODDS_ADAPTER_IMPLEMENTED=true.
 *
 * RIPIEGO «DALLA FONTE» (06/09/2026): l'archivio BetExplorer può non avere il
 * turno corrente pur essendoci partite coperte in programma (Serie A in campo
 * con archivio vuoto). In quel caso la partita viene scelta dall'endpoint
 * GRATUITO `/sports/{key}/events` — fuori quota, dichiarato dalla fonte —
 * limitato alle chiavi coperte, e la lettura vera passa comunque da
 * `getSharpLine` con un id sintetico negativo (nessun vincolo esterno: le
 * fotografie vivono in `system_state`). Costo del ripiego: 0 crediti per la
 * scelta + 1 credito per la lettura, dichiarati nel log. Con `--solo-archivio`
 * il ripiego è disattivato e senza partite coperte non si spende nulla.
 *
 * `signalActive` è passato true in modo dichiarato: è una lettura di controllo
 * voluta, non un segnale prodotto dal monitor. Il budget resta l'autorità su
 * tetti mensili/giornalieri e sul conteggio dei crediti.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { leagues, matches, teams } from "@/db/schema";
import { sportKeyFor, COVERED_SPORT_KEYS } from "@/lib/providers/optional/sport-keys";
import { fetchOddsApiEvents } from "@/lib/providers/optional/the-odds-api-events";
import { describeDiagnosis, diagnoseEventMatch } from "@/lib/providers/optional/odds-match-resolver";
import { pickUpcomingEvent, syntheticMatchId } from "@/lib/repo/control-fallback";
import { getSharpLine } from "@/lib/repo/sharp";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

const HORIZON_HOURS = Math.max(1, Number(argument("--ore") ?? 168) || 168);
const SPORT_KEY_ARG = argument("--sport-key");
const SOLO_ARCHIVIO = flag("--solo-archivio");

const romeTime = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

interface Target {
  id: number;
  kickoffAt: Date;
  leagueLabel: string;
  home: string;
  away: string;
  sportKey: string;
  /** id evento della fonte quando la partita nasce dal ripiego, altrimenti null */
  eventId: string | null;
}

async function main(): Promise<number> {
  const now = new Date();
  const until = new Date(now.getTime() + HORIZON_HOURS * 3_600_000);

  console.log("\nLettura di controllo — percorso di produzione (getSharpLine)");
  console.log(`finestra: da adesso a ${romeTime.format(until)} (ora italiana)`);

  const rows = await db
    .select({
      id: matches.id,
      key: matches.key,
      kickoffAt: matches.kickoffAt,
      status: matches.status,
      leagueName: leagues.name,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
    })
    .from(matches)
    .innerJoin(leagues, eq(leagues.id, matches.leagueId))
    .where(and(gte(matches.kickoffAt, now), lte(matches.kickoffAt, until), eq(matches.status, "scheduled")))
    .orderBy(matches.kickoffAt)
    .limit(200);

  const teamIds = [...new Set(rows.flatMap((r) => [r.homeTeamId, r.awayTeamId]))];
  const names = new Map<number, string>();
  if (teamIds.length > 0) {
    const teamRows = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, teamIds));
    for (const t of teamRows) names.set(t.id, t.name);
  }

  const covered: Target[] = rows
    .map((r) => ({
      id: r.id,
      kickoffAt: r.kickoffAt,
      leagueLabel: r.leagueName,
      home: names.get(r.homeTeamId) ?? "",
      away: names.get(r.awayTeamId) ?? "",
      sportKey: sportKeyFor(r.leagueName),
      eventId: null as string | null,
    }))
    .filter((r): r is Target => r.sportKey !== null && r.home !== "" && r.away !== "");

  const matchArg = argument("--match-id");

  let target: Target | undefined;

  if (covered.length > 0) {
    target = matchArg !== null ? covered.find((r) => r.id === Number(matchArg)) : covered[0];
    if (target === undefined) {
      console.error(`Partita ${matchArg} non trovata fra quelle coperte in archivio.`);
      return 2;
    }
    console.log(`\norigine: ARCHIVIO — partita #${target.id} ${romeTime.format(target.kickoffAt)} ${target.home} — ${target.away}`);
    console.log(`lega: ${target.leagueLabel} → chiave sport: ${target.sportKey}`);
  } else if (SOLO_ARCHIVIO) {
    console.log(
      "\nNESSUNA PARTITA DI CAMPIONATO COPERTO IN ARCHIVIO nella finestra.\n" +
        "(--solo-archivio: ripiego dalla fonte disattivato.)\n" +
        "Crediti spesi: 0.",
    );
    return 0;
  } else if (matchArg !== null) {
    console.error(
      `Archivio vuoto nella finestra: --match-id ${matchArg} non può esistere. ` +
        "Senza --match-id il ripiego sceglie la partita dalla fonte.",
    );
    return 2;
  } else {
    console.log(
      "\nArchivio senza partite coperte nella finestra → RIPIEGO DALLA FONTE.\n" +
        "Scelta con /sports/{key}/events (endpoint GRATUITO, fuori quota),\n" +
        "limitata alle chiavi coperte; la lettura vera costa 1 credito.",
    );
    const keys = SPORT_KEY_ARG !== null ? [SPORT_KEY_ARG] : [...COVERED_SPORT_KEYS];
    let eventsCredits = 0;
    for (const key of keys) {
      const outcome = await fetchOddsApiEvents({ sportKey: key });
      if (outcome.creditsUsed !== null && outcome.creditsUsed > 0) {
        eventsCredits += outcome.creditsUsed;
        console.log(`  ATTENZIONE: /events ha addebitato ${outcome.creditsUsed} crediti su [${key}] (dovrebbe essere 0).`);
      }
      if (!outcome.result.ok) {
        console.log(`  [${key}] fonte non disponibile — ${outcome.result.error.message}`);
        continue;
      }
      const pick = pickUpcomingEvent(outcome.result.data, now, until);
      console.log(`  [${key}] ${outcome.result.data.length} eventi in programma, ${pick === null ? "nessuno" : "almeno uno"} nella finestra`);
      if (pick !== null) {
        target = {
          id: syntheticMatchId(pick.id),
          kickoffAt: pick.commenceTime,
          leagueLabel: key,
          home: pick.homeTeam,
          away: pick.awayTeam,
          sportKey: key,
          eventId: pick.id,
        };
        break;
      }
    }
    if (target === undefined) {
      console.log(
        "\nNé l'archivio né la fonte espongono partite coperte in programma nella finestra.\n" +
          `Crediti spesi: ${eventsCredits}.`,
      );
      return 0;
    }
    console.log(`\norigine: FONTE (ripiego) — ${romeTime.format(target.kickoffAt)} ${target.home} — ${target.away}`);
    console.log(`chiave sport: ${target.sportKey} — id evento: ${target.eventId} — id sintetico: ${target.id}`);
  }

  console.log("percorso: getSharpLine (budget → mappa → decisione → lettura → contatori)\n");

  const view = await getSharpLine(
    {
      matchId: target.id,
      sportKey: target.sportKey,
      homeTeam: target.home,
      awayTeam: target.away,
      kickoffAt: target.kickoffAt,
      market: "1x2",
      selection: "home",
      consensusOpening: null,
      consensusCurrent: null,
      signalActive: true, // lettura di controllo dichiarata
    },
    now,
  );

  console.log("budget dopo la lettura:");
  console.log(`  mese  : ${view.budget.usedThisMonth}/${view.budget.monthlyCap}`);
  console.log(`  oggi  : ${view.budget.usedToday} (quota odierna ${view.budget.allowanceToday}, tetto ${view.budget.dailyHardCap})`);

  if (view.snapshot === null) {
    console.error(`\nESITO: nessuna linea sharp — ${view.unavailableReason}`);
    return 1;
  }

  /* Lettura pagata ma VUOTA: nessun evento corrisponde ai nomi di questa
     partita sulla chiave sport usata. Primo caso (06/09/2026, run
     34046688765): «Brazil: Serie A» collideva con la regex della Serie A
     italiana e il credito è stato speso sulla chiave sbagliata. Secondo caso
     (06/09/2026, dopo il merge della correzione): chiave giusta
     (Portugal: Liga Portugal → soccer_portugal_primeira_liga) ma l'archivio
     chiama la squadra «Academico Viseu» e la fonte «Academico de Viseu»:
     matching fallito, credito speso, fotografia vuota. Il credito è già
     contato: qui si dichiara l'anomalia, la si spiega gratis e si esce in
     errore, perché un controllo che dicesse «linea letta» su una fotografia
     vuota nasconderebbe il guasto che deve trovare. */
  if (view.snapshot.book === null && view.snapshot.books.length === 0) {
    console.error(
      "\nESITO: lettura pagata ma NESSUNA linea — l'evento non risulta" +
        ` sulla chiave sport usata (${target.sportKey}).` +
        "\n  Credito speso e fotografia vuota. Diagnosi gratuita qui sotto.",
    );
    /* Diagnosi GRATUITA: /events è fuori quota per dichiarazione della
       fonte. Dice PERCHÉ la linea non c'è — nomi che non combaciano (con i
       nomi reali della fonte), orario oltre la tolleranza, o davvero nessun
       evento — senza spendere un altro credito. */
    const events = await fetchOddsApiEvents({ sportKey: target.sportKey });
    if (events.result.ok) {
      const diagnosis = diagnoseEventMatch(
        {
          matchId: target.id,
          homeTeam: target.home,
          awayTeam: target.away,
          kickoffAt: target.kickoffAt,
        },
        events.result.data,
      );
      console.log(`\ndiagnosi gratuita (/events, 0 crediti): ${describeDiagnosis(diagnosis)}`);
      if (events.creditsUsed !== null && events.creditsUsed > 0) {
        console.log(`  ATTENZIONE: /events ha addebitato ${events.creditsUsed} crediti (dovrebbe essere 0).`);
      }
    } else {
      console.log(
        `\ndiagnosi gratuita non disponibile: /events ha risposto — ${events.result.error.message}`,
      );
    }
    return 1;
  }

  console.log("\nESITO: linea sharp letta sul percorso di produzione");
  console.log(`  book sharp : ${view.snapshot.book ?? "nessuno"}`);
  console.log(`  prezzo     : ${view.snapshot.price ?? "n.d."}`);
  console.log(`  verdetto   : ${view.snapshot.verdict}`);
  console.log(`  book osservati: ${view.snapshot.books.length}`);
  console.log(`  letti alle : ${view.snapshot.readAt}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("LETTURA DI CONTROLLO FALLITA — errore non previsto.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
  });
