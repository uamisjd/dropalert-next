/**
 * Test della risoluzione partita → eventi della fonte.
 *
 * Il test centrale è l'equivalenza con `findEvent`: la diagnosi dice «unico»
 * se e solo se il client, con la stessa risposta, troverebbe esattamente un
 * evento. Se questa equivalenza si rompe, lo strumento promette una lettura
 * che poi fallisce spendendo un credito — il difetto che questo modulo deve
 * impedire.
 */
import { findEvent } from "../odds-api-sharp";
import {
  NEAR_MISS_THRESHOLD,
  describeDiagnosis,
  diagnoseEventMatch,
  nameSimilarity,
  normalizeTeamName,
  resolveSmokeMatch,
  type OddsApiEventLite,
} from "../odds-match-resolver";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const KICKOFF = new Date("2026-09-12T18:45:00.000Z");

function lite(
  id: string,
  homeTeam: string,
  awayTeam: string,
  commenceTime: Date,
  sportKey = "soccer_italy_serie_a",
): OddsApiEventLite {
  return { id, sportKey, homeTeam, awayTeam, commenceTime };
}

/** Stessa partita nella forma grezza che arriva dalla fonte. */
function raw(events: OddsApiEventLite[]): unknown[] {
  return events.map((event) => ({
    id: event.id,
    sport_key: event.sportKey,
    home_team: event.homeTeam,
    away_team: event.awayTeam,
    commence_time: event.commenceTime.toISOString(),
    bookmakers: [],
  }));
}

const identity = { matchId: 1, homeTeam: "Inter", awayTeam: "Milan", kickoffAt: KICKOFF };

console.log("\nRisoluzione partita per The Odds API\n");

test("la normalizzazione toglie maiuscole, accenti e separanti", () => {
  assert(normalizeTeamName("Inter") === "inter", "minuscole");
  assert(normalizeTeamName("Paris Saint-Germain") === "parissaintgermain", "separanti rimossi");
  assert(normalizeTeamName("Atlético Madrid") === "atleticomadrid", "accenti rimossi");
  assert(normalizeTeamName("  Hellas   Verona ") === "hellasverona", "spazi multipli");
  assert(normalizeTeamName("") === "", "vuoto resta vuoto");
});

test("evento unico: nomi contenuti e kickoff entro la tolleranza", () => {
  const events = [lite("e1", "Inter", "AC Milan", KICKOFF)];
  const diagnosis = diagnoseEventMatch(identity, events);
  assert(diagnosis.status === "unico", `atteso unico, ottenuto ${diagnosis.status}`);
  assert(diagnosis.status === "unico" && diagnosis.event.id === "e1", "evento giusto");
});

test("due eventi con gli stessi nomi sono ambigui, non scelti a caso", () => {
  const events = [
    lite("e1", "Inter", "AC Milan", KICKOFF),
    lite("e2", "Inter", "AC Milan", new Date(KICKOFF.getTime() + 20 * 60_000)),
  ];
  const diagnosis = diagnoseEventMatch(identity, events);
  assert(diagnosis.status === "ambiguo", `atteso ambiguo, ottenuto ${diagnosis.status}`);
  assert(diagnosis.status === "ambiguo" && diagnosis.candidates.length === 2, "entrambi elencati");
});

test("nomi presenti ma kickoff lontano di 45 minuti non passano", () => {
  const events = [lite("e1", "Inter", "AC Milan", new Date(KICKOFF.getTime() + 45 * 60_000))];
  const diagnosis = diagnoseEventMatch(identity, events);
  assert(
    diagnosis.status === "kickoff_fuori_tolleranza",
    `atteso kickoff_fuori_tolleranza, ottenuto ${diagnosis.status}`,
  );
});

test("grafia diversa: nessun match, ma i candidati simili vengono mostrati", () => {
  /* "Man Utd" normalizzato non è contenuto in "Manchester United" né
     viceversa: il matching reale fallisce, e lo strumento deve dirlo PRIMA
     di spendere il credito invece di scoprirlo dopo. */
  const abbreviated = { matchId: 2, homeTeam: "Man Utd", awayTeam: "Chelsea", kickoffAt: KICKOFF };
  const events = [lite("e1", "Manchester United", "Chelsea", KICKOFF)];
  const diagnosis = diagnoseEventMatch(abbreviated, events);
  assert(
    diagnosis.status === "nomi_non_trovati",
    `atteso nomi_non_trovati, ottenuto ${diagnosis.status}`,
  );
  assert(
    diagnosis.status === "nomi_non_trovati" && diagnosis.nearMisses.length === 1,
    "il candidato simile è suggerito",
  );
  assert(
    findEvent(raw(events), abbreviated.homeTeam, abbreviated.awayTeam, abbreviated.kickoffAt) === null,
    "findEvent è d'accordo: nessun evento",
  );
});

test("una grafia più lunga della fonte resta un match: la sottostringa basta", () => {
  /* Caso opposto, per non confondere la regola: "Internazionale" CONTIENE
     "Inter", quindi il client la accetta. Il pre-check deve dire «unico»,
     altrimenti bloccherebbe una lettura legittima. */
  const events = [lite("e1", "Internazionale", "AC Milan", KICKOFF)];
  const diagnosis = diagnoseEventMatch(identity, events);
  assert(diagnosis.status === "unico", `atteso unico, ottenuto ${diagnosis.status}`);
});

test("somiglianza: token condivisi pesano, nomi estranei restano sotto soglia", () => {
  assert(nameSimilarity("Manchester United", "Manchester Utd") > NEAR_MISS_THRESHOLD, "parziale");
  assert(nameSimilarity("Inter", "Juventus") === 0, "nessun token in comune");
  assert(nameSimilarity("Inter", "Inter") === 1, "identici");
  assert(nameSimilarity("", "Inter") === 0, "vuoto non somiglia a nulla");
});

test("la diagnosi coincide con findEvent su tutti i casi", () => {
  const scenarios: Array<{ label: string; events: OddsApiEventLite[] }> = [
    { label: "unico", events: [lite("e1", "Inter", "AC Milan", KICKOFF)] },
    {
      label: "ambiguo",
      events: [
        lite("e1", "Inter", "AC Milan", KICKOFF),
        lite("e2", "Inter", "AC Milan", new Date(KICKOFF.getTime() + 10 * 60_000)),
      ],
    },
    { label: "kickoff lontano", events: [lite("e1", "Inter", "AC Milan", new Date(KICKOFF.getTime() - 90 * 60_000))] },
    { label: "nome della fonte più lungo", events: [lite("e1", "Internazionale", "AC Milan", KICKOFF)] },
    { label: "elenco vuoto", events: [] },
    { label: "altre partite", events: [lite("e1", "Roma", "Napoli", KICKOFF)] },
    {
      label: "unico fra altri",
      events: [
        lite("e1", "Roma", "Napoli", KICKOFF),
        lite("e2", "Inter", "AC Milan", KICKOFF),
        lite("e3", "Juventus", "Torino", KICKOFF),
      ],
    },
  ];

  for (const scenario of scenarios) {
    const diagnosis = diagnoseEventMatch(identity, scenario.events);
    const found = findEvent(raw(scenario.events), identity.homeTeam, identity.awayTeam, identity.kickoffAt);
    assert(
      (diagnosis.status === "unico") === (found !== null),
      `caso "${scenario.label}": diagnosi=${diagnosis.status} ma findEvent=${found === null ? "null" : "evento"}`,
    );
    if (diagnosis.status === "unico" && found !== null) {
      assert(
        diagnosis.event.id === (found as { id?: string }).id,
        `caso "${scenario.label}": evento diverso fra diagnosi e findEvent`,
      );
    }
  }
});

test("ogni diagnosi ha una descrizione leggibile", () => {
  const cases = [
    diagnoseEventMatch(identity, [lite("e1", "Inter", "AC Milan", KICKOFF)]),
    diagnoseEventMatch(identity, [
      lite("e1", "Inter", "AC Milan", KICKOFF),
      lite("e2", "Inter", "AC Milan", KICKOFF),
    ]),
    diagnoseEventMatch(identity, [lite("e1", "Inter", "AC Milan", new Date(KICKOFF.getTime() + 3 * 3_600_000))]),
    diagnoseEventMatch(identity, [lite("e1", "Roma", "Napoli", KICKOFF)]),
    diagnoseEventMatch(identity, []),
  ];
  for (const diagnosis of cases) {
    const text = describeDiagnosis(diagnosis);
    assert(text.length > 0, "descrizione non vuota");
    assert(!text.includes("undefined"), "nessun valore non risolto nella descrizione");
  }
});

/* ------------------------------------------------------------------ */
/* Dalla riga del database ai parametri                                */
/* ------------------------------------------------------------------ */

const row = {
  id: 42,
  key: "be-abc123",
  kickoffAt: new Date("2026-09-12T18:45:00.000Z"),
  status: "scheduled",
  leagueName: "Italy: Serie A",
  homeTeamName: "Inter",
  awayTeamName: "Milan",
};

test("partita futura in campionato coperto produce tutti i parametri", () => {
  const resolution = resolveSmokeMatch(row, new Date("2026-09-10T12:00:00.000Z"));
  assert(resolution.ok, "risoluzione riuscita");
  if (resolution.ok) {
    assert(resolution.params.sportKey === "soccer_italy_serie_a", "chiave sport corretta");
    assert(resolution.params.fixtureKey === "be-abc123", "fixture interna");
    assert(resolution.params.matchId === 42, "match id conservato");
    assert(resolution.params.homeTeam === "Inter", "squadra di casa");
    assert(resolution.notes.length === 0, "nessuna nota per una partita regolare");
  }
});

test("competizione non mappata rifiuta senza spendere un credito", () => {
  const resolution = resolveSmokeMatch(
    { ...row, leagueName: "Paraguay: Reserve League" },
    new Date("2026-09-10T12:00:00.000Z"),
  );
  assert(!resolution.ok, "rifiutata");
  if (!resolution.ok) assert(resolution.reason.includes("non mappata"), "motivo dichiarato");
});

test("kickoff già passato rifiuta: la fonte non espone più quote", () => {
  const resolution = resolveSmokeMatch(row, new Date("2026-09-13T09:00:00.000Z"));
  assert(!resolution.ok, "rifiutata");
  if (!resolution.ok) assert(resolution.reason.includes("già passato"), "motivo dichiarato");
});

test("partita conclusa o rinviata rifiuta", () => {
  for (const status of ["finished", "postponed", "cancelled"]) {
    const resolution = resolveSmokeMatch({ ...row, status }, new Date("2026-09-10T12:00:00.000Z"));
    assert(!resolution.ok, `${status} rifiutata`);
  }
});

test("squadre mancanti rifiutano invece di inviare nomi vuoti", () => {
  const resolution = resolveSmokeMatch(
    { ...row, awayTeamName: null },
    new Date("2026-09-10T12:00:00.000Z"),
  );
  assert(!resolution.ok, "rifiutata");
  if (!resolution.ok) assert(resolution.reason.includes("squadre"), "motivo dichiarato");
});

test("stato inatteso parte lo stesso ma lo dichiara", () => {
  const resolution = resolveSmokeMatch(
    { ...row, status: "live" },
    new Date("2026-09-10T12:00:00.000Z"),
  );
  assert(resolution.ok, "non bloccata");
  if (resolution.ok) {
    assert(resolution.notes.length === 1, "una nota");
    assert(resolution.notes[0].includes("live"), "lo stato è dichiarato");
  }
});

console.log(`\n${"─".repeat(60)}\nTest superati: ${passed} | falliti: ${failed}\n${"─".repeat(60)}\n`);
if (failed > 0) process.exit(1);
