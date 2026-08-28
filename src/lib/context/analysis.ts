/**
 * «Analisi 360° completa» — parte pura (Sprint analisi on-demand).
 *
 * Divisione del lavoro, dichiarata:
 *  - le PARTI DISCORSIVE (matrice dei fattori, tre punti, scenario) arrivano
 *    dal modello, che lavora solo sui fatti già recuperati (campi del
 *    Contesto 360° con fonte, documenti Tavily, profilo del movimento);
 *  - la validazione respinge qualunque raccomandazione: se compare un pick,
 *    l'analisi non si pubblica.
 *
 * Niente qui dentro entra nel punteggio.
 */

/** Chiusura fissa, identica ovunque compaia l'analisi. */
export const ANALYSIS_CLOSING =
  "È una lettura basata su fonti pubbliche e sul profilo del movimento: non è una certezza né un consiglio.";

/** Testo unico quando il budget è finito. */
export const ANALYSIS_BUDGET_MESSAGE = "analisi non disponibile per budget";

/** Durata della cache di un'analisi riuscita. */
export const ANALYSIS_CACHE_HOURS = 24;

/**
 * Espressioni vietate: qualunque forma di consiglio o di pick.
 * La lista è volutamente larga — meglio respingere un'analisi innocua che
 * pubblicarne una che suggerisce una giocata.
 */
export const FORBIDDEN_PATTERNS: RegExp[] = [
  /esito\s+consigliat/i,
  /mercato\s+gol/i,
  /risultato\s+esatto/i,
  /\bpronostic/i,
  /consigli(?:o|amo|ato|abile)\s+(?:di\s+)?(?:giocare|puntare|scommettere)/i,
  /\b(?:si\s+)?consiglia\b/i,
  /\bpuntare\s+su\b/i,
  /\bgiocare\s+(?:l['a]|il|la|su)\b/i,
  /\bscommetter/i,
  /\bvalue\s*bet\b/i,
  /\bquota\s+da\s+giocare\b/i,
  /\bover\s*\d/i,
  /\bunder\s*\d/i,
  /\bgoal\/nogoal\b/i,
  /\bmulti(?:pla)?\b/i,
  /\bbanker\b/i,
  /\bconsiglio\s+finale\b/i,
];

/** true se il testo contiene una raccomandazione: allora si respinge. */
export function containsPick(text: string): boolean {
  return FORBIDDEN_PATTERNS.some((r) => r.test(text));
}

/* ------------------------------------------------------------------ */
/* Dati d'ingresso                                                     */
/* ------------------------------------------------------------------ */

export interface AnalysisFacts {
  homeTeam: string;
  awayTeam: string;
  league: string | null;
  country: string | null;
  kickoffAt: string;
  /** fase della competizione, se recuperata (dal campo posta_in_palo) */
  fase: string | null;
  stadio: string | null;
  citta: string | null;
  /** campi del Contesto 360° con la loro fonte, già a registro */
  fields: Array<{
    key: string;
    valore: string;
    fonteUrl: string | null;
    fonteTitolo: string | null;
  }>;
  /** documenti recuperati (Tavily/Wikipedia/feed): titolo + url */
  docs: Array<{ titolo: string; url: string }>;
  /** profilo del movimento, già misurato dal motore */
  movimento: {
    selezione: string;
    apertura: number | null;
    corrente: number | null;
    oreAlKickoff: number | null;
    sostenutoMinuti: number;
    flash: boolean;
    rimbalzato: boolean;
    bookConfermano: number;
    bookTotali: number;
    scesa: boolean | null;
  };
}

/* ------------------------------------------------------------------ */
/* Intestazione                                                        */
/* ------------------------------------------------------------------ */

const ROME = "Europe/Rome";

const longDayFmt = new Intl.DateTimeFormat("it-IT", {
  timeZone: ROME,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const hourFmt = new Intl.DateTimeFormat("it-IT", {
  timeZone: ROME,
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Intestazione della sezione. Ogni pezzo compare solo se il dato esiste:
 * niente stadio inventato, niente fase dedotta.
 */
/**
 * Ripulisce la «fase» prima di infilarla nell'intestazione.
 *
 * Il campo di provenienza (`posta_in_palo`) è una frase libera scritta dal
 * modello: a volte è davvero una fase («fase a gironi»), a volte è un
 * periodo intero («Trattandosi dell'amichevole estiva, la posta è bassa»).
 * Concatenarlo produceva «La sfida valevole per Trattandosi dell'…».
 *
 * Regola: si accetta solo un sintagma breve, senza verbo coniugato di
 * apertura e senza punteggiatura di frase. Tutto il resto si omette — la
 * frase resta corretta e il dato completo si legge nei campi del contesto.
 */
export function sanitizeFase(raw: string | null): string | null {
  if (raw === null) return null;
  let t = raw.trim().replace(/\s+/g, " ");
  if (t === "" || t.toLowerCase() === "non noto") return null;

  /* una frase intera non è una fase: si taglia alla prima interruzione */
  t = t.split(/[.;:]/)[0].trim();
  /* incisi introduttivi tipici del modello */
  t = t.replace(
    /^(trattandosi|essendo|poiché|siccome|dato che|visto che|in quanto)\b[^,]*,\s*/i,
    "",
  );
  t = t.replace(/^(si tratta d[ei'][^,]*,\s*)/i, "");
  t = t.replace(/^(la|il|lo|l')\s+(partita|sfida|gara)\b[^,]*,\s*/i, "");
  t = t.trim().replace(/^[,–—-]\s*/, "");

  if (t === "") return null;
  /* nessun verbo coniugato, né in apertura né dentro: una fase è un
     sintagma nominale, «la posta in palio è bassa» è un giudizio */
  if (/(^|\s)(è|sono|era|erano|sarà|saranno|resta|restano|rappresenta|vale|valgono|si\s+gioca|arriva|arrivano)(\s|$)/i.test(t)) {
    return null;
  }
  /* una fase è breve: oltre, è un commento */
  const parole = t.split(" ").length;
  if (parole > 9 || t.length > 70) return null;
  return t;
}

export function buildHeadline(f: AnalysisFacts): string {
  const parts: string[] = ["La sfida"];
  const fase = sanitizeFase(f.fase) ?? "";
  const lega = f.league?.trim() ?? "";
  /* la fase recuperata spesso nomina già la competizione: ripeterla
     produrrebbe «fase a gironi della Coppa di Paese: Coppa». Si confronta
     sui token, e in caso di sovrapposizione si tiene la sola fase. */
  const legaTokens = lega
    .toLowerCase()
    .split(/[^a-zà-ù0-9]+/)
    .filter((w) => w.length >= 4);
  const faseCitaLega =
    fase !== "" &&
    legaTokens.length > 0 &&
    legaTokens.filter((w) => fase.toLowerCase().includes(w)).length >=
      Math.ceil(legaTokens.length / 2);

  if (fase !== "") parts.push(`valevole per ${fase}`);
  if (lega !== "" && !faseCitaLega) {
    parts.push(`${fase !== "" ? "di" : "valevole per"} ${lega}`);
  }
  parts.push(`tra ${f.homeTeam} e ${f.awayTeam}`);

  const d = new Date(f.kickoffAt);
  if (Number.isFinite(d.getTime())) {
    parts.push(
      `si disputerà ${longDayFmt.format(d)} alle ore ${hourFmt.format(d)}`,
    );
  }
  if (f.stadio !== null && f.stadio.trim() !== "") {
    parts.push(
      f.citta !== null && f.citta.trim() !== ""
        ? `presso ${f.stadio.trim()} di ${f.citta.trim()}`
        : `presso ${f.stadio.trim()}`,
    );
  }
  /* senza stadio non si scrive la sede: il paese non è una città e
     «a Scotland» è un dato sbagliato, non un dato parziale */
  return `${parts.join(" ")}.`;
}

/* ------------------------------------------------------------------ */
/* Schemi ASCII, disegnati qui: ≤ 32 colonne per costruzione            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Parti discorsive: contratto col modello                             */
/* ------------------------------------------------------------------ */

/**
 * Verdetto di coerenza fra contesto e movimento.
 *
 * È la domanda per cui questa sezione esiste: ciò che sappiamo della partita
 * SPIEGA il movimento della quota, oppure il movimento resta senza causa
 * visibile? Le tre risposte sono chiuse, perché una scala aperta finirebbe
 * per essere un giudizio mascherato da misura.
 *
 * «non spiegato» non è un fallimento: un movimento senza causa pubblica è
 * un'informazione, ed è spesso la più interessante.
 */
export const COERENZA_VALUES = ["spiegato", "parziale", "non spiegato"] as const;
export type CoerenzaValue = (typeof COERENZA_VALUES)[number];

export const COERENZA_LABELS: Record<CoerenzaValue, string> = {
  spiegato: "Il contesto spiega il movimento",
  parziale: "Il contesto lo spiega solo in parte",
  "non spiegato": "Il movimento resta senza causa pubblica",
};

/**
 * Natura del movimento: la domanda operativa che segue la coerenza.
 *
 * «reale» = esiste una notizia pesante e documentata che giustifica il
 * crollo (assenze gravi, crisi societaria, campo cambiato).
 * «speculativo» = nessuna causa pubblica, profilo compatibile con liquidità
 * o con una trappola: il movimento c'è ma non ha spiegazione visibile.
 * «incerto» = elementi contrastanti, o troppo pochi per dire.
 *
 * Non è un consiglio: è una classificazione di ciò che sappiamo, e va letta
 * insieme al fatto che «speculativo» NON significa «da evitare» né il
 * contrario. Significa solo: nessuno ha scritto perché.
 */
export const NATURA_VALUES = ["reale", "speculativo", "incerto"] as const;
export type NaturaValue = (typeof NATURA_VALUES)[number];

export const NATURA_LABELS: Record<NaturaValue, string> = {
  reale: "Drop reale: una notizia documentata lo giustifica",
  speculativo: "Drop speculativo: nessuna causa pubblica, solo movimento di mercato",
  incerto: "Natura incerta: elementi insufficienti o contrastanti",
};

export interface AnalysisProse {
  /** verdetto di coerenza fra i fatti recuperati e il movimento osservato */
  coerenza: CoerenzaValue;
  /** natura del movimento: reale, speculativo o incerto */
  natura: NaturaValue;
  /** perché quella natura, in una frase */
  naturaMotivo: string;
  /** perché quel verdetto, in una frase */
  coerenzaMotivo: string;
  matrice: string;
  punti: Array<{ titolo: string; testo: string; tag: "fonte" | "ipotesi" }>;
  /** che cosa servirebbe sapere e non sappiamo: dichiarato, non nascosto */
  cosaManca: string;
  scenario: string;
}

/**
 * Fotografia del movimento al momento della generazione.
 *
 * Serve a due cose: capire se il testo è invecchiato rispetto ai numeri veri
 * e, quando è invecchiato di poco, rimettere al posto giusto i valori vivi
 * invece di lasciare in pagina una quota di ieri.
 */
export interface MovementStamp {
  apertura: number | null;
  corrente: number | null;
  shiftPp: number | null;
  stampedAt: string;
}

export interface DeepAnalysis extends AnalysisProse {
  headline: string;
  closing: string;
  generatedAt: string;
  /** valori del movimento al momento in cui il testo è stato scritto */
  stamp?: MovementStamp;
}

/* ------------------------------------------------------------------ */
/* Deriva temporale                                                    */
/* ------------------------------------------------------------------ */

/** Oltre questo scostamento di probabilità implicita il testo va rifatto. */
export const STALE_SHIFT_PP = 2;
/** Oltre questa età il testo va rifatto comunque. */
export const STALE_AGE_HOURS = 1;

/** Probabilità implicita in punti percentuali, o null se la quota manca. */
function impliedPp(price: number | null): number | null {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  return (1 / price) * 100;
}

/**
 * true se l'analisi in cache non regge più il confronto con i dati vivi:
 * la quota si è mossa oltre due punti percentuali oppure è passata più di
 * un'ora. In quel caso si rigenera invece di correggere a mano un racconto
 * che parlava di un altro prezzo.
 */
export function isAnalysisStale(
  stamp: MovementStamp | undefined,
  live: { corrente: number | null },
  now: Date,
): boolean {
  if (stamp === undefined) return true;
  const t = new Date(stamp.stampedAt).getTime();
  if (!Number.isFinite(t)) return true;
  if ((now.getTime() - t) / 3_600_000 > STALE_AGE_HOURS) return true;

  const before = impliedPp(stamp.corrente);
  const after = impliedPp(live.corrente);
  if (before === null || after === null) return before !== after;
  return Math.abs(after - before) > STALE_SHIFT_PP;
}

function fmtOddIt(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

/**
 * Rimette i valori vivi dentro il testo già scritto.
 *
 * Il modello, nonostante il divieto, può citare una quota: se quel numero è
 * esattamente quello fotografato alla generazione e nel frattempo è cambiato
 * di poco, lo si sostituisce con il valore corrente. Non è una riscrittura:
 * è impedire che testo e dati in pagina si contraddicano.
 */
export function reinjectLiveValues(
  text: string,
  stamp: MovementStamp | undefined,
  live: { apertura: number | null; corrente: number | null },
): string {
  if (stamp === undefined) return text;
  let out = text;
  const pairs: Array<[number | null, number | null]> = [
    [stamp.corrente, live.corrente],
    [stamp.apertura, live.apertura],
  ];
  for (const [old, fresh] of pairs) {
    if (old === null || fresh === null || Math.abs(old - fresh) < 0.005) continue;
    /* tutte le grafie con cui un numero può comparire: 6.4 / 6,4 / 6.40 */
    const varianti = new Set([
      old.toFixed(2),
      old.toFixed(2).replace(".", ","),
      String(Number(old.toFixed(2))),
      String(Number(old.toFixed(2))).replace(".", ","),
      old.toFixed(1),
      old.toFixed(1).replace(".", ","),
    ]);
    for (const v of varianti) {
      const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`(?<![\\d,.])${esc}(?![\\d,.])`, "g"), fmtOddIt(fresh));
    }
  }
  return out;
}

/** Applica la reiniezione a tutte le parti discorsive dell'analisi. */
export function withLiveValues(
  a: DeepAnalysis,
  live: { apertura: number | null; corrente: number | null },
): DeepAnalysis {
  const fix = (t: string) => reinjectLiveValues(t, a.stamp, live);
  return {
    ...a,
    matrice: fix(a.matrice),
    scenario: fix(a.scenario),
    punti: a.punti.map((p) => ({ ...p, testo: fix(p.testo), titolo: fix(p.titolo) })),
  };
}

/** Prompt: solo prosa, nessuno schema, nessun saluto, nessun pick. */
export function buildAnalysisPrompt(f: AnalysisFacts): string {
  const m = f.movimento;
  const fatti = f.fields
    .filter((x) => x.valore.trim() !== "" && x.valore.toLowerCase() !== "non noto")
    .map(
      (x) =>
        `- ${x.key}: ${x.valore}${x.fonteUrl !== null ? ` [FONTE: ${x.fonteUrl}]` : " [SENZA FONTE]"}`,
    );
  const docs = f.docs.slice(0, 6).map((d, i) => `${i + 1}. ${d.titolo} — ${d.url}`);

  /* la forma del movimento, tradotta in parole: al modello serve il PROFILO,
     non i numeri, perché i numeri invecchiano e il profilo no */
  const quando =
    m.oreAlKickoff === null
      ? "distanza dal calcio d'inizio non nota"
      : m.oreAlKickoff >= 24
        ? "movimento PRECOCE, oltre un giorno prima del calcio d'inizio (mercati sottili, poche giocate bastano a spostarli)"
        : m.oreAlKickoff <= 6
          ? "movimento TARDIVO, a ridosso del calcio d'inizio (finestra di formazioni e ultime notizie)"
          : "movimento a distanza intermedia dal calcio d'inizio";
  const forma = m.flash
    ? "FLASH: concentrato in pochi minuti, compatibile con una singola giocata grossa"
    : m.sostenutoMinuti >= 120
      ? `SOSTENUTO: il prezzo ha tenuto il nuovo livello per ore, il mercato non ha corretto`
      : "di durata breve ma non istantanea";
  const conferme =
    m.bookTotali <= 1
      ? "UNA SOLA linea di consenso: la concordanza fra bookmaker non è osservabile, e da un solo operatore non si deduce coordinazione"
      : `${m.bookConfermano} bookmaker su ${m.bookTotali} concordi`;

  return [
    "Sei l'analista di un osservatorio statistico sui movimenti delle quote nel calcio.",
    "Scrivi in italiano, in prosa densa e concreta. Nessun preambolo, nessun saluto,",
    "nessuna descrizione di come raccogli i dati. Rispondi SOLO con un oggetto JSON.",
    "",
    "LA DOMANDA A CUI DEVI RISPONDERE, e nessun'altra:",
    "ciò che sappiamo di questa partita SPIEGA il movimento della quota, oppure no?",
    "Non ti si chiede di prevedere la partita. Ti si chiede di dire se il contesto",
    "regge il movimento osservato, e dove non lo regge.",
    "",
    `Partita: ${f.homeTeam} contro ${f.awayTeam}${f.league ? ` — ${f.league}` : ""}.`,
    `Calcio d'inizio: ${f.kickoffAt}.`,
    "",
    "FATTI RECUPERATI. Sono gli unici che puoi usare: non cercarne altri, non",
    "inventarne, non completarli con ciò che credi di sapere sul campionato.",
    ...(fatti.length > 0 ? fatti : ["- nessun campo di contesto disponibile"]),
    "",
    "DOCUMENTI CONSULTATI:",
    ...(docs.length > 0 ? docs : ["- nessun documento"]),
    "",
    "PROFILO DEL MOVIMENTO, misurato dal monitor (non da te, non discuterlo):",
    `- esito che si è mosso: ${m.selezione}`,
    `- direzione: ${m.scesa === null ? "non misurabile" : m.scesa ? "quota in DISCESA (il mercato prezza quell'esito più caro)" : "quota in SALITA (il mercato lo prezza meno caro)"}`,
    `- tempistica: ${quando}`,
    `- forma: ${forma}`,
    `- ampiezza del consenso: ${conferme}`,
    m.rimbalzato ? "- ATTENZIONE: la quota è poi RIENTRATA verso il livello di partenza: parte del movimento è stata smentita dal mercato stesso" : "",
    "",
    "Chiavi richieste:",
    '- "coerenza": esattamente una fra "spiegato", "parziale", "non spiegato".',
    "  Scegli in base a QUANTO i fatti recuperati giustificano il movimento:",
    "  «spiegato» solo se esiste un fatto CON FONTE che lo giustifica da solo;",
    "  «parziale» se i fatti sono compatibili ma non sufficienti;",
    "  «non spiegato» se non c'è nulla di pubblico che regga il movimento.",
    "  Nel dubbio scegli il verdetto PIÙ PRUDENTE: «non spiegato» non è un fallimento,",
    "  è un'informazione preziosa, perché un movimento senza causa pubblica è",
    "  compatibile con informazione non ancora pubblica — ma resta un'ipotesi.",
    '- "coerenzaMotivo": UNA frase che spiega quel verdetto, citando il fatto decisivo',
    "  (o dichiarando che manca). Massimo 240 caratteri.",
    '- "natura": esattamente una fra "reale", "speculativo", "incerto".',
    "  «reale» SOLO se una notizia documentata giustifica il crollo: assenze pesanti,",
    "  formazione rimaneggiata o squadra B, crisi societaria (stipendi non pagati,",
    "  spogliatoio spaccato, dimissioni), campo cambiato o squalificato, porte chiuse.",
    "  «speculativo» se nessuna causa pubblica regge il movimento: resta compatibile",
    "  con liquidità di mercato o con una trappola, e va detto senza giri di parole.",
    "  «incerto» se gli elementi sono contrastanti o troppo pochi.",
    '- "naturaMotivo": UNA frase sul perché di quella natura. Massimo 240 caratteri.',
    '- "matrice": UNA frase d\'impatto che condensa la tensione del confronto. Max 220 caratteri.',
    '- "punti": esattamente TRE oggetti {"titolo","testo","tag"}, nell\'ordine:',
    "  (a) INDISCREZIONI E FORMAZIONI: assenze pesanti, squalifiche, turnover massiccio,",
    "      schieramento di riserve o U19, spogliatoio in crisi, stipendi non pagati.",
    "      Se le fonti non ne parlano, dillo apertamente invece di riempire con altro;",
    "  (b) LOGISTICA E AMBIENTE: stadio squalificato o cambiato, campo neutro, porte",
    "      chiuse, campo impraticabile, viaggio lungo, fattore campo reale;",
    "  (c) POSTA IN PALIO E FRESCHEZZA: chi ha più da perdere in classifica, calendario",
    "      congestionato, chi arriva stanco.",
    "  Ogni punto deve CHIUDERE collegandosi al movimento: se quel fattore lo sostiene,",
    "  lo contraddice o non c'entra. Un punto che non tocca il movimento è inutile.",
    '  "titolo": d\'impatto, max 60 caratteri. "testo": 3-5 frasi, max 700 caratteri.',
    '  "tag": "fonte" SOLO se poggia su un fatto con [FONTE] qui sopra; altrimenti "ipotesi".',
    '- "cosaManca": UNA frase su quale informazione, se l\'avessimo, cambierebbe la lettura',
    "  (formazioni, infortuni, motivazioni di classifica...). Max 240 caratteri. Dichiarare",
    "  il buco vale più che riempirlo con supposizioni.",
    '- "scenario": 3-5 frasi che tengono insieme contesto e profilo del movimento,',
    "  formulate esplicitamente COME IPOTESI di lettura del mercato.",
    "",
    "COME SCRIVERE, perché un'analisi vaga non serve a nulla:",
    "- usa i nomi delle squadre e i fatti concreti che hai, non formule generiche;",
    "- se un fattore è debole DILLO invece di gonfiarlo con aggettivi;",
    "- non ripetere fra i punti la stessa osservazione con parole diverse;",
    "- distingui sempre ciò che è documentato da ciò che stai supponendo.",
    "",
    "DIVIETI ASSOLUTI, la risposta viene scartata se li violi:",
    "- non citare quote, percentuali, punti percentuali, orari o conteggi esatti: il testo resta valido",
    "  mentre i numeri cambiano, quindi parla di direzione e intensità («la quota è scesa nettamente»,",
    "  «il movimento è durato alcune ore»), mai di valori precisi;",
    "- non scrivere mai esito consigliato, mercato gol, risultato esatto, over, under, pronostico, value bet;",
    "- non consigliare né suggerire alcuna giocata, in nessuna forma;",
    "- non affermare chi vincerà: descrivi come si muove il mercato, non come finirà la partita;",
    "- metafore tattiche ammesse, certezze no: usa condizionale e forme dubitative.",
  ]
    .filter((r) => r !== "")
    .join("\n");
}

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  if (t.length === 0 || t.length > max) return null;
  return t;
}

/**
 * Valida la prosa del modello. Respinge tutto se manca un pezzo, se i punti
 * non sono tre o se compare una raccomandazione: meglio nessuna analisi che
 * un'analisi che consiglia.
 */
export function parseAnalysisProse(payload: unknown): AnalysisProse | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  const matrice = cleanStr(p.matrice, 260);
  const scenario = cleanStr(p.scenario, 1200);
  if (matrice === null || scenario === null) return null;

  /* il verdetto è una classificazione chiusa: nessuna sinonimia a occhio */
  const coerenzaRaw = cleanStr(p.coerenza, 40);
  const coerenza = COERENZA_VALUES.find(
    (v) => v === (coerenzaRaw ?? "").toLowerCase(),
  );
  if (coerenza === undefined) return null;
  const coerenzaMotivo = cleanStr(p.coerenzaMotivo, 300);
  if (coerenzaMotivo === null) return null;

  const naturaRaw = cleanStr(p.natura, 40);
  const natura = NATURA_VALUES.find((v) => v === (naturaRaw ?? "").toLowerCase());
  if (natura === undefined) return null;
  const naturaMotivo = cleanStr(p.naturaMotivo, 300);
  if (naturaMotivo === null) return null;
  /* «cosa manca» può essere assente: in quel caso lo si dichiara, non si
     inventa un buco che il modello non ha saputo nominare */
  const cosaManca = cleanStr(p.cosaManca, 300) ?? "Non dichiarato.";

  if (!Array.isArray(p.punti) || p.punti.length !== 3) return null;
  const punti: AnalysisProse["punti"] = [];
  for (const raw of p.punti) {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const titolo = cleanStr(r.titolo, 90);
    const testo = cleanStr(r.testo, 800);
    if (titolo === null || testo === null) return null;
    const tag = r.tag === "fonte" ? "fonte" : "ipotesi";
    punti.push({ titolo, testo, tag });
  }

  const tutto = [
    matrice,
    scenario,
    coerenzaMotivo,
    naturaMotivo,
    cosaManca,
    ...punti.map((x) => `${x.titolo} ${x.testo}`),
  ].join(" ");
  if (containsPick(tutto)) return null;

  return {
    coerenza,
    coerenzaMotivo,
    natura,
    naturaMotivo,
    matrice,
    punti,
    cosaManca,
    scenario,
  };
}

/** Assembla l'analisi completa: prosa validata + schemi disegnati qui. */
export function assembleAnalysis(
  facts: AnalysisFacts,
  prose: AnalysisProse,
  now: Date,
): DeepAnalysis {
  return {
    headline: buildHeadline(facts),
    ...prose,
    closing: ANALYSIS_CLOSING,
    generatedAt: now.toISOString(),
    stamp: {
      apertura: facts.movimento.apertura,
      corrente: facts.movimento.corrente,
      shiftPp: null,
      stampedAt: now.toISOString(),
    },
  };
}
