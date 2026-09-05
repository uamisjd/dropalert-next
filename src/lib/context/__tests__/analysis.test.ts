/**
 * Test dell'«Analisi 360° completa»: verdetto di coerenza col movimento,
 * intestazione, divieto di pick e deriva temporale.
 * Funzioni pure, nessuna rete e nessun database.
 * Eseguire con: npm run test:analysis
 */
import {
  ANALYSIS_CACHE_HOURS,
  ANALYSIS_CLOSING,
  COERENZA_LABELS,
  COERENZA_VALUES,
  NATURA_LABELS,
  NATURA_VALUES,
  assembleAnalysis,
  buildAnalysisPrompt,
  buildHeadline,
  containsPick,
  parseAnalysisProse,
  isAnalysisStale,
  reinjectLiveValues,
  sanitizeFase,
  withLiveValues,
  STALE_SHIFT_PP,
  STALE_AGE_HOURS,
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

/* --- divieto di pick --- */
check("esito consigliato vietato", containsPick("L'esito consigliato è la vittoria interna"));
check("mercato gol vietato", containsPick("occhio al mercato gol"));
check("risultato esatto vietato", containsPick("risultato esatto 2-1"));
check("over descrittivo ammesso", !containsPick("si va verso l'over 2.5 del primo tempo"));
check("under descrittivo ammesso", !containsPick("la linea dell'under 3.5 ha tenuto per ore"));
check("vincita garantita vietata", containsPick("con questo segnale è una vincita garantita"));
check("profitto certo vietato", containsPick("profitto certo al 100% di vincita"));
check("guadagno garantito vietato", containsPick("un guadagno garantito senza rischio"));
check("consiglio di giocata vietato", containsPick("consigliamo di puntare sui padroni di casa"));
check("pronostico vietato", containsPick("il nostro pronostico"));
check("testo descrittivo ammesso", !containsPick("Il mercato ha riprezzato l'esito interno e la linea ha tenuto per quattro ore."));

/* --- parsing della prosa --- */
const buona = {
  coerenza: "parziale",
  natura: "speculativo",
  naturaMotivo: "Nessuna fonte riporta assenze, crisi societarie o cambi di campo: il movimento resta senza causa documentata.",
  coerenzaMotivo: "Il divario di categoria è documentato, ma nessuna fonte spiega perché il mercato si sia mosso ora.",
  cosaManca: "Le formazioni ufficiali: senza quelle non si distingue un turnover programmato da un'assenza dell'ultima ora.",
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
check("gli schemi ASCII non esistono più", !("schemaAlbero" in full) && !("schemaVettore" in full));
check("nessun pick nel prodotto finito", !containsPick(
  [full.headline, full.matrice, full.scenario, ...full.punti.map((p) => `${p.titolo} ${p.testo}`)].join(" "),
));
eq("cache dichiarata a 24h", ANALYSIS_CACHE_HOURS, 24);

/* --- il verdetto di coerenza: è il punto della sezione --- */
eq("verdetto conservato", prose.coerenza, "parziale");
eq("tre verdetti possibili, non una scala", COERENZA_VALUES.length, 3);
check("ogni verdetto ha un'etichetta in italiano",
  COERENZA_VALUES.every((v) => (COERENZA_LABELS[v] ?? "").length > 10));
eq("verdetto ignoto: respinta", parseAnalysisProse({ ...buona, coerenza: "molto probabile" }), null);
eq("verdetto mancante: respinta", parseAnalysisProse({ ...buona, coerenza: undefined }), null);
eq("motivo mancante: respinta", parseAnalysisProse({ ...buona, coerenzaMotivo: "" }), null);
eq(
  "«non spiegato» è un esito valido, non un errore",
  parseAnalysisProse({ ...buona, coerenza: "non spiegato" })!.coerenza,
  "non spiegato",
);
eq(
  "«cosa manca» assente si dichiara, non si inventa",
  parseAnalysisProse({ ...buona, cosaManca: undefined })!.cosaManca,
  "Non dichiarato.",
);
/* --- natura del drop: reale vs speculativo --- */
eq("natura conservata", prose.natura, "speculativo");
eq("tre nature possibili", NATURA_VALUES.length, 3);
check("ogni natura ha un'etichetta parlante",
  NATURA_VALUES.every((v) => (NATURA_LABELS[v] ?? "").length > 15));
eq("natura ignota: respinta", parseAnalysisProse({ ...buona, natura: "fortissimo" }), null);
eq("natura mancante: respinta", parseAnalysisProse({ ...buona, natura: undefined }), null);
eq("motivo della natura mancante: respinta", parseAnalysisProse({ ...buona, naturaMotivo: "" }), null);
eq("drop reale accettato", parseAnalysisProse({ ...buona, natura: "reale" })!.natura, "reale");
eq("pick dentro il motivo della natura: respinta",
  parseAnalysisProse({ ...buona, naturaMotivo: "Da giocare l'over 2.5." }), null);

eq("pick dentro il motivo: respinta",
  parseAnalysisProse({ ...buona, coerenzaMotivo: "Da giocare l'over 2.5." }), null);
eq("pick dentro «cosa manca»: respinta",
  parseAnalysisProse({ ...buona, cosaManca: "Il nostro pronostico." }), null);

/* --- A3: deriva temporale --- */
eq("soglia di scostamento dichiarata", STALE_SHIFT_PP, 2);
eq("soglia di età dichiarata", STALE_AGE_HOURS, 1);
const stamp = { apertura: 8, corrente: 6.4, shiftPp: null, stampedAt: now.toISOString() };
eq("senza fotografia si rigenera", isAnalysisStale(undefined, { corrente: 6.4 }, now), true);
eq("numeri fermi e testo fresco: si tiene", isAnalysisStale(stamp, { corrente: 6.4 }, now), false);
eq(
  "scostamento piccolo: si tiene",
  isAnalysisStale(stamp, { corrente: 6.3 }, now),
  false,
);
eq(
  "scostamento oltre 2pp: si rigenera",
  isAnalysisStale(stamp, { corrente: 4.0 }, now),
  true,
);
eq(
  "oltre un'ora: si rigenera comunque",
  isAnalysisStale(stamp, { corrente: 6.4 }, new Date(now.getTime() + 70 * 60000)),
  true,
);

eq(
  "valore vivo reiniettato al posto di quello vecchio",
  reinjectLiveValues("La quota è scesa a 6.4 nelle ultime ore.", stamp, { apertura: 8, corrente: 6.3 }),
  "La quota è scesa a 6,30 nelle ultime ore.",
);
eq(
  "riconosce anche la grafia italiana",
  reinjectLiveValues("da 8,00 a 6,40", stamp, { apertura: 7.5, corrente: 6.3 }),
  "da 7,50 a 6,30",
);
eq(
  "numeri estranei non toccati",
  reinjectLiveValues("Le ultime 5 partite e i 3 punti.", stamp, { apertura: 8, corrente: 6.3 }),
  "Le ultime 5 partite e i 3 punti.",
);
const conStamp = { ...assembleAnalysis(facts, prose, now) };
check("la fotografia viene registrata", conStamp.stamp?.corrente === 2.17);
const vivo = withLiveValues(
  { ...conStamp, matrice: "Il crollo da 2.31 a 2.17 pesa." },
  { apertura: 2.31, corrente: 2.05 },
);
check("testo e dati live non si contraddicono", vivo.matrice.includes("2,05") && !vivo.matrice.includes("2.17"));

/* --- prompt --- */
const prompt = buildAnalysisPrompt(facts);
check("prompt vieta i preamboli", prompt.includes("Nessun preambolo"));
check("prompt vieta la fase di raccolta visibile", prompt.includes("nessuna descrizione di come raccogli"));
check("prompt elenca i divieti", prompt.includes("esito consigliato") && prompt.includes("value bet"));
check("prompt chiede il verdetto di coerenza", prompt.includes('"coerenza"') && prompt.includes("non spiegato"));
check("prompt chiede la natura del drop", prompt.includes('"natura"') && prompt.includes("speculativo"));
check("prompt elenca le cause di un drop reale",
  prompt.includes("stipendi non pagati") && prompt.includes("squalificato"));
check("prompt chiede indiscrezioni e formazioni", prompt.includes("INDISCREZIONI E FORMAZIONI"));
check("prompt chiede logistica e ambiente", prompt.includes("LOGISTICA E AMBIENTE"));
check("prompt chiede di dichiarare cosa manca", prompt.includes('"cosaManca"'));
check("prompt impone di collegare ogni punto al movimento", prompt.includes("CHIUDERE collegandosi al movimento"));
check("prompt traduce il profilo in parole, non in numeri", /PRECOCE|TARDIVO|FLASH|SOSTENUTO/.test(prompt));
check("prompt vieta di completare i fatti a memoria", prompt.includes("non completarli con ciò che credi di sapere"));
check("prompt passa i fatti con fonte", prompt.includes("[FONTE: https://a.it/x]"));
check("prompt esclude i campi «non noto»", !prompt.includes("assenze_note: non noto"));
check("prompt non chiede schemi al modello", !/schema\s*1|ascii/i.test(prompt));
check("prompt passa il profilo senza numeri di quota", !prompt.includes("2.31") && prompt.includes("4 bookmaker su 6"));
check("prompt dice la direzione a parole", prompt.includes("quota in DISCESA"));
check("prompt vieta i numeri esatti nel testo", prompt.includes("non citare quote, percentuali"));

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (analisi 360° completa)`);
