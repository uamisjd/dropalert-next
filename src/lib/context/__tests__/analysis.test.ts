/**
 * Test dell'«Analisi 360° completa»: schemi, intestazione, divieto di pick.
 * Funzioni pure, nessuna rete e nessun database.
 * Eseguire con: npm run test:analysis
 */
import {
  ANALYSIS_CACHE_HOURS,
  ANALYSIS_CLOSING,
  SCHEMA_MAX_COLS,
  assembleAnalysis,
  buildAnalysisPrompt,
  buildHeadline,
  buildTreeSchema,
  buildVectorSchema,
  containsPick,
  fit,
  parseAnalysisProse,
  sanitizeFase,
  schemaWithinWidth,
  type AnalysisFacts,
} from "../analysis";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}
function eq(name: string, a: unknown, b: unknown) {
  check(`${name} — atteso ${String(b)}, ottenuto ${String(a)}`, Object.is(a, b));
}

const now = new Date("2026-08-25T18:00:00Z");

const facts: AnalysisFacts = {
  homeTeam: "Cove Rangers FC",
  awayTeam: "Dundee United FC B",
  league: "Scottish Challenge Cup",
  country: "Scozia",
  kickoffAt: "2026-08-25T18:45:00.000Z",
  fase: "fase a gironi",
  stadio: "Balmoral Stadium",
  citta: "Aberdeen",
  fields: [
    { key: "posta_in_palo", valore: "fase a gironi", fonteUrl: "https://a.it/x", fonteTitolo: "A" },
    { key: "assenze_note", valore: "non noto", fonteUrl: null, fonteTitolo: null },
  ],
  docs: [{ titolo: "Match sheet", url: "https://transfermarkt.com/x" }],
  movimento: {
    selezione: "Vittoria casa",
    apertura: 2.31,
    corrente: 2.17,
    oreAlKickoff: 30,
    sostenutoMinuti: 240,
    flash: false,
    rimbalzato: false,
    bookConfermano: 4,
    bookTotali: 6,
    scesa: true,
  },
};

/* --- intestazione --- */
const head = buildHeadline(facts);
check("intestazione con squadre", head.includes("tra Cove Rangers FC e Dundee United FC B"));
check("intestazione con fase e competizione", head.includes("fase a gironi") && head.includes("Scottish Challenge Cup"));
check("giorno e data italiani", /marted|25 agosto 2026/i.test(head));
check("ora italiana (20:45 locale)", head.includes("20:45"));
check("stadio e città", head.includes("presso Balmoral Stadium di Aberdeen"));
check("chiude con punto", head.endsWith("."));

const magro = buildHeadline({ ...facts, fase: null, stadio: null, citta: null });
check("dato mancante omesso, non inventato", !magro.includes("presso") && !magro.includes("undefined") && !magro.includes("null"));
check("resta leggibile senza stadio", magro.includes("si disputerà"));
check("nessuna sede senza stadio", !magro.includes(" a Aberdeen"));
const doppia = buildHeadline({
  ...facts,
  fase: "fase a gironi della Scottish League Challenge Cup",
  league: "Scotland: Challenge Cup",
});
check("competizione non ripetuta", (doppia.match(/Challenge Cup/g) ?? []).length === 1);

/* --- A1: la fase è un sintagma, non una frase --- */
eq("fase breve accettata", sanitizeFase("fase a gironi"), "fase a gironi");
eq("inciso «Trattandosi dell'» rimosso",
  sanitizeFase("Trattandosi dell'amichevole estiva, la posta in palio è bassa"), null);
eq("frase con verbo respinta", sanitizeFase("È una partita valida per la salvezza"), null);
eq("periodo tagliato alla prima interruzione",
  sanitizeFase("semifinale playoff. Le due squadre arrivano bene"), "semifinale playoff");
eq("«non noto» respinto", sanitizeFase("non noto"), null);
eq("vuoto respinto", sanitizeFase("   "), null);
eq("null resta null", sanitizeFase(null), null);
eq("commento lungo respinto",
  sanitizeFase("turno preliminare di una competizione che assegna un posto nella fase successiva del torneo continentale"), null);
const rotta = buildHeadline({
  ...facts,
  fase: "Trattandosi dell'amichevole estiva, la posta in palio resta contenuta",
});
check("intestazione mai concatenata male", !rotta.includes("valevole per Trattandosi"));
check("intestazione resta una frase corretta", rotta.startsWith("La sfida valevole per") || rotta.startsWith("La sfida tra"));
check("nessun doppio spazio", !rotta.includes("  "));

/* --- schemi: il vincolo è di codice --- */
const albero = buildTreeSchema(facts);
const vettore = buildVectorSchema(facts);
eq("larghezza massima dichiarata", SCHEMA_MAX_COLS, 32);
check("schema 1 entro 32 colonne", schemaWithinWidth(albero));
check("schema 2 entro 32 colonne", schemaWithinWidth(vettore));
check("schema 1 ha i due rami squadra", albero.includes("Cove Rangers FC") && albero.includes("Dundee"));
check("schema 2 converge a destra", vettore.includes("-->"));
check("schema 2 ha rami che confluiscono", vettore.includes("\\") && vettore.includes("/"));
check("nomi lunghi accorciati, mai sfondati", schemaWithinWidth(buildTreeSchema({
  ...facts,
  homeTeam: "Associazione Sportiva Dilettantistica Nome Lunghissimo",
  awayTeam: "Altra Squadra Dal Nome Interminabile United",
})));
check("prezzi non noti non rompono lo schema", schemaWithinWidth(buildTreeSchema({
  ...facts,
  movimento: { ...facts.movimento, apertura: null, corrente: null, scesa: null },
})));
eq("fit accorcia con punto", fit("abcdefghij", 5), "abcd.");
eq("fit non tocca ciò che entra", fit("abc", 5), "abc");

/* --- divieto di pick --- */
check("esito consigliato vietato", containsPick("L'esito consigliato è la vittoria interna"));
check("mercato gol vietato", containsPick("occhio al mercato gol"));
check("risultato esatto vietato", containsPick("risultato esatto 2-1"));
check("over vietato", containsPick("si va verso l'over 2.5"));
check("consiglio di giocata vietato", containsPick("consigliamo di puntare sui padroni di casa"));
check("pronostico vietato", containsPick("il nostro pronostico"));
check("testo descrittivo ammesso", !containsPick("Il mercato ha riprezzato l'esito interno e la linea ha tenuto per quattro ore."));

/* --- parsing della prosa --- */
const buona = {
  matrice: "Un fortino che non concede sconti contro una squadra B in rodaggio: il mercato lo ha sentito prima del fischio.",
  punti: [
    { titolo: "Il fortino di Balmoral", testo: "In casa il Cove Rangers concede poco. Il precedente pesa sul piano psicologico.", tag: "fonte" },
    { titolo: "Asimmetria di rodaggio", testo: "Una prima squadra contro una formazione B: impianti tattici distanti.", tag: "ipotesi" },
    { titolo: "Calendario corto", testo: "Il turno infrasettimanale potrebbe pesare sulle gambe.", tag: "ipotesi" },
  ],
  scenario: "L'ipotesi di lettura è che il mercato abbia riprezzato il fattore campo. Resta una lettura. Il movimento potrebbe rientrare.",
};
const prose = parseAnalysisProse(buona)!;
check("prosa valida accettata", prose !== null);
eq("tre punti", prose.punti.length, 3);
eq("tag conservato", prose.punti[0].tag, "fonte");
eq("tag ignoto diventa ipotesi", parseAnalysisProse({ ...buona, punti: buona.punti.map((p) => ({ ...p, tag: "boh" })) })!.punti[0].tag, "ipotesi");

eq("due punti soli: respinta", parseAnalysisProse({ ...buona, punti: buona.punti.slice(0, 2) }), null);
eq("matrice mancante: respinta", parseAnalysisProse({ ...buona, matrice: "" }), null);
eq("scenario mancante: respinto", parseAnalysisProse({ ...buona, scenario: undefined }), null);
eq(
  "prosa con pick: respinta",
  parseAnalysisProse({ ...buona, scenario: "Il nostro consiglio finale è l'over 2.5." }),
  null,
);
eq(
  "pick dentro un punto: respinta",
  parseAnalysisProse({
    ...buona,
    punti: [{ ...buona.punti[0], testo: "Da giocare l'1 secco." }, buona.punti[1], buona.punti[2]],
  }),
  null,
);

/* --- assemblaggio --- */
const full = assembleAnalysis(facts, prose, now);
eq("chiusura fissa", full.closing, ANALYSIS_CLOSING);
check("entrambi gli schemi presenti", full.schemaAlbero.length > 0 && full.schemaVettore.length > 0);
check("entrambi entro il limite", schemaWithinWidth(full.schemaAlbero) && schemaWithinWidth(full.schemaVettore));
check("nessun pick nel prodotto finito", !containsPick(
  [full.headline, full.matrice, full.scenario, ...full.punti.map((p) => `${p.titolo} ${p.testo}`)].join(" "),
));
eq("cache dichiarata a 24h", ANALYSIS_CACHE_HOURS, 24);

/* --- prompt --- */
const prompt = buildAnalysisPrompt(facts);
check("prompt vieta i preamboli", prompt.includes("Nessun preambolo"));
check("prompt vieta la fase di raccolta visibile", prompt.includes("nessuna descrizione di come raccogli"));
check("prompt elenca i divieti", prompt.includes("esito consigliato") && prompt.includes("value bet"));
check("prompt passa i fatti con fonte", prompt.includes("[FONTE: https://a.it/x]"));
check("prompt esclude i campi «non noto»", !prompt.includes("assenze_note: non noto"));
check("prompt non chiede schemi al modello", !/schema\s*1|ascii/i.test(prompt));
check("prompt passa il profilo del movimento", prompt.includes("2.31") && prompt.includes("4 bookmaker su 6"));

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (analisi 360° completa)`);
