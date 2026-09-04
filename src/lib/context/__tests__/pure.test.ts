/**
 * Test delle regole pure del Contesto 360°.
 * Eseguire con: npm run test:context
 *
 * Verifica le tre cose che non devono mai rompersi: la dicitura fissa,
 * la validazione che respinge i contesti monchi invece di completarli,
 * e le finestre (cache, riprova, tetto giornaliero).
 */
import {
  parseTavilyResults,
  tavilyUsageKey,
  TAVILY_DAILY_LIMIT,
  TAVILY_MAX_PER_MATCH,
  primaryQuery as tavilyPrimary,
  type TavilyResult,
} from "../tavily";
import {
  ACCORDO_VALUES,
  CONTEXT_CACHE_HOURS,
  CONTEXT_DAILY_LIMIT,
  CONTEXT_DISCLAIMER,
  CONTEXT_FIELD_KEYS,
  CONTEXT_RETRY_HOURS,
  MAX_CONTEXT_SOURCES,
  MODEL_KNOWLEDGE_TAG,
  capSources,
  dailyUsageKey,
  isContextFresh,
  isDailyBudgetExhausted,
  isLowInformationCompetition,
  parseContextDetail,
  parseContextFields,
} from "../pure";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  ✗ ${name}\n      ${msg}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label = ""): void {
  if (actual !== expected) {
    throw new Error(
      `${label ? label + ": " : ""}atteso ${String(expected)}, ottenuto ${String(actual)}`,
    );
  }
}

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    livello_categorie: "prima serie contro seconda serie",
    anomalia_campo: "campo neutro",
    posta_in_palo: "passaggio del turno",
    rotazioni_fatica: "rotazioni attese per il turno di coppa",
    accordo_col_drop: "sostiene",
    ...over,
  };
}

function main(): void {
  console.log("\n=== Contesto 360° — regole pure ===\n");

  console.log("-- Dichiarazioni fisse --\n");

  test("la dicitura fissa è quella concordata, parola per parola", () => {
    assertEqual(
      CONTEXT_DISCLAIMER,
      "Contesto generato automaticamente: non è un pronostico né una garanzia.",
    );
  });

  test("il tag della conoscenza modello è quello concordato", () => {
    assertEqual(MODEL_KNOWLEDGE_TAG, "conoscenza modello, da verificare");
  });

  console.log("\n-- Validazione della risposta --\n");

  test("payload completo e valido passa, con i cinque campi", () => {
    const f = parseContextFields(payload())!;
    assert(f !== null, "payload completo valido");
    assertEqual(f.livelloCategorie, "prima serie contro seconda serie");
    assertEqual(f.accordoColDrop, "sostiene");
  });

  test("i tre valori d'accordo sono ammessi, sinonimi no", () => {
    assertEqual(parseContextFields(payload({ accordo_col_drop: "contraddice" }))!.accordoColDrop, "contraddice");
    assertEqual(parseContextFields(payload({ accordo_col_drop: "non c'entra" }))!.accordoColDrop, "non c'entra");
    assertEqual(parseContextFields(payload({ accordo_col_drop: "favorevole" })), null);
    assertEqual(parseContextFields(payload({ accordo_col_drop: "sostenuto" })), null);
  });

  test("un campo mancante respinge tutto: nessun contesto mezzo fatto", () => {
    const senzaPosta = payload();
    delete senzaPosta.posta_in_palo;
    assertEqual(parseContextFields(senzaPosta), null);
    assertEqual(parseContextFields(payload({ anomalia_campo: "   " })), null);
    assertEqual(parseContextFields(payload({ rotazioni_fatica: null })), null);
  });

  test("campo oltre i 300 caratteri respinto, mai tagliato in silenzio", () => {
    const lungo = "x".repeat(301);
    assertEqual(parseContextFields(payload({ posta_in_palo: lungo })), null);
    assert(parseContextFields(payload({ posta_in_palo: "x".repeat(300) })) !== null, "300 caratteri passano");
  });

  test("payload non oggetto o JSON rotto respinto", () => {
    assertEqual(parseContextFields("testo"), null);
    assertEqual(parseContextFields(null), null);
    assertEqual(parseContextFields([payload()]), null);
  });

  test("gli spazi si normalizzano, il testo resta quello del modello", () => {
    const f = parseContextFields(payload({ livello_categorie: "  prima   serie  " }))!;
    assertEqual(f.livelloCategorie, "prima serie");
  });

  console.log("\n-- v2 con ricerca attiva --\n");

  const v2payload = {
    livello_categorie: { valore: "prima serie contro seconda serie", fonte_url: "https://esempio.it/leghe" },
    anomalia_campo: { valore: "campo neutro", fonte_url: "" },
    posta_in_palo: { valore: "semifinale playoff scudetto", fonte_url: "https://esempio.it/coppa" },
    rotazioni_fatica: { valore: "turno di coppa a tre giorni", fonte_url: "" },
    h2h_e_forma_recente: { valore: "ultimi tre scontri diretti in casa", fonte_url: "" },
    forma_recente_5: { valore: "casa: 3V 1N 1P; trasferta: 1V 1N 3P", fonte_url: "" },
    assenze_note: { valore: "non noto", fonte_url: "" },
    accordo_col_drop: "sostiene",
  };

  test("v2: otto chiavi, forma e assenze comprese, accordo chiuso", () => {
    assertEqual(CONTEXT_FIELD_KEYS.length, 8, "otto campi");
    const d = parseContextDetail(v2payload, true)!;
    assert(d !== null, "payload valido");
    assertEqual(d.fields.length, 8);
    assert(d.fields.some((f) => f.key === "h2h_e_forma_recente"), "h2h presente");
    assert(d.fields.some((f) => f.key === "forma_recente_5"), "forma 5 presente");
    assert(d.fields.some((f) => f.key === "assenze_note"), "assenze presenti");
  });

  test("v2: il tag nasce qui — fonte accettata solo se grounded", () => {
    const grounded = parseContextDetail(v2payload, true)!;
    const conFonte = grounded.fields.find((f) => f.key === "livello_categorie")!;
    assertEqual(conFonte.fonteUrl, "https://esempio.it/leghe");
    const noGrounding = parseContextDetail(v2payload, false)!;
    const senzaFonte = noGrounding.fields.find((f) => f.key === "livello_categorie")!;
    assertEqual(senzaFonte.fonteUrl, null, "senza ricerca ogni fonte si butta via");
  });

  test("v2: la fonte conta solo se fra i documenti recuperati, mai un URL sentito dire", () => {
    const grounded = parseContextDetail(v2payload, false, [
      "https://esempio.it/leghe",
    ])!;
    assertEqual(
      grounded.fields.find((f) => f.key === "livello_categorie")!.fonteUrl,
      "https://esempio.it/leghe",
    );
    const fuori = parseContextDetail(v2payload, false, [
      "https://altra-fonte.it/x",
    ])!;
    assertEqual(
      fuori.fields.find((f) => f.key === "livello_categorie")!.fonteUrl,
      null,
      "URL non recuperato: resta conoscenza modello",
    );
  });

  test("v2: url non http si rifiuta, mai link di facciata", () => {
    const brutto = { ...v2payload, anomalia_campo: { valore: "campo neutro", fonte_url: "javascript:alert(1)" } };
    const d = parseContextDetail(brutto, true)!;
    assertEqual(d.fields.find((f) => f.key === "anomalia_campo")!.fonteUrl, null);
  });

  test("v2: un campo mancante respinge tutto, h2h compresa", () => {
    const senzaH2h: Record<string, unknown> = { ...v2payload };
    delete senzaH2h.h2h_e_forma_recente;
    assertEqual(parseContextDetail(senzaH2h, true), null);
  });

  test("v2: le fonti consultate sono al massimo tre e deduplicate", () => {
    const capped = capSources([
      { uri: "https://a.it/x", title: "A" },
      { uri: "https://a.it/x", title: "A di nuovo" },
      { uri: "https://b.it/y", title: null },
      { uri: "https://c.it/z" },
      { uri: "https://d.it/w" },
      { uri: "non-un-url" },
    ]);
    assertEqual(capped.length, 3);
    assertEqual(MAX_CONTEXT_SOURCES, 3);
    assert(capped.every((c) => c.uri.startsWith("https://")), "solo https accettati");
  });

  console.log("\n-- Tavily: adapter e budget --\n");

  test("risposta Tavily: solo risultati con url http sopravvivono", () => {
    const payload = {
      results: [
        { title: "H2H", url: "https://flashscore.xx/m", content: "La Guaira 4-0 Yaracuyanos" },
        { title: "Senza url", url: "", content: "x" },
        { title: "url strana", url: "javascript:alert(1)", content: "x" },
        { title: "Lunga", url: "https://ok.it/a", content: "c".repeat(500) },
      ],
    };
    const r = parseTavilyResults(payload);
    assertEqual(r.length, 2, "solo i primi e il quarto");
    assertEqual(r[1].content.length, 400, "contenuto troncato a 400");
  });

  test("payload rotto o senza results: zero risultati, zero invenzioni", () => {
    assertEqual(parseTavilyResults(null).length, 0);
    assertEqual(parseTavilyResults({}).length, 0);
    assertEqual(parseTavilyResults("no").length, 0);
  });

  test("le query dichiarano squadre, competizione, H2H", () => {
    const q = tavilyPrimary("A", "B", "Coppa");
    assert(q.includes("A") && q.includes("B"), "squadre presenti");
    assert(q.includes("Coppa") && q.includes("H2H"), "competizione e H2H");
    assert(q.includes("ultime 5") && q.includes("classifica"), "forma e classifica");
  });

  test("budget condiviso dichiarato: 30 al giorno, 4 per partita, chiave per giornata italiana", () => {
    assertEqual(TAVILY_DAILY_LIMIT, 30);
    assertEqual(TAVILY_MAX_PER_MATCH, 4);
    assertEqual(
      tavilyUsageKey(new Date("2026-08-21T23:30:00Z")),
      "tavily:daily:2026-08-22",
    );
  });

  const dummy: TavilyResult = { title: "t", url: "https://a", content: "c" };
  test("il tipo risultato è quello che il modello riceve", () => {
    assert(dummy.url.startsWith("https://"), "url http(s)");
  });

  console.log("\n-- Finestre --\n");

  const NOW = new Date("2026-08-21T15:00:00Z");

  test("cache fresca se la scadenza è nel futuro, scaduta se è passata", () => {
    assertEqual(isContextFresh(new Date("2026-08-22T14:59:00Z"), NOW), true);
    assertEqual(isContextFresh(new Date("2026-08-21T14:59:00Z"), NOW), false);
    assertEqual(isContextFresh(NOW, NOW), false);
  });

  test("le finestre dichiarate sono 24h di cache e 1h di riprova", () => {
    assertEqual(CONTEXT_CACHE_HOURS, 24);
    assertEqual(CONTEXT_RETRY_HOURS, 1);
  });

  test("il tetto giornaliero scatta al limite dichiarato, non oltre", () => {
    assertEqual(CONTEXT_DAILY_LIMIT, 50);
    assertEqual(isDailyBudgetExhausted(49), false);
    assertEqual(isDailyBudgetExhausted(50), true);
    assertEqual(isDailyBudgetExhausted(51), true);
  });

  test("il contatore è chiave per giornata italiana", () => {
    const sera = new Date("2026-08-21T23:30:00Z"); /* 01:30 del 22/8 a Roma */
    assertEqual(dailyUsageKey(sera), "context:daily:2026-08-22");
    assertEqual(dailyUsageKey(NOW), "context:daily:2026-08-21");
  });

  test("i valori d'accordo sono esattamente tre", () => {
    assertEqual(ACCORDO_VALUES.length, 3);
  });

  console.log("\n-- Copertura informativa della competizione --\n");

  test("femminili e minori sono a bassa copertura, dichiarata", () => {
    assertEqual(isLowInformationCompetition("Liga MX Women"), true, "Women in chiaro");
    assertEqual(isLowInformationCompetition("Germany: Bundesliga Women"), true);
    assertEqual(isLowInformationCompetition("Italia: Serie A Femminile"), true);
    assertEqual(isLowInformationCompetition("Mexico: Liga MX W"), true, "tag «W»");
    assertEqual(isLowInformationCompetition("England: WSL"), true, "Women's Super League");
    assertEqual(isLowInformationCompetition("Italy: Serie C"), true, "minore non coperta");
    assertEqual(isLowInformationCompetition("England: Premier League Cup"), true, "coppa travestita");
  });

  test("i campionati della linea sharp restano a copertura normale", () => {
    assertEqual(isLowInformationCompetition("Italy: Serie A"), false);
    assertEqual(isLowInformationCompetition("Italy: Serie B"), false, "Serie B è coperta");
    assertEqual(isLowInformationCompetition("England: Premier League"), false);
    assertEqual(isLowInformationCompetition("Europe: UEFA Champions League"), false);
  });

  test("senza nome della lega non si dichiara nulla", () => {
    assertEqual(isLowInformationCompetition(null), false);
    assertEqual(isLowInformationCompetition("   "), false);
  });

  console.log(
    `\n${passed} superati, ${failed} non superati su ${passed + failed} totali.`,
  );
  if (failed > 0) {
    console.error("\nFallimenti:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main();
