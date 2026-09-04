/**
 * Ricerca nella LINGUA DEL PAESE in cui si gioca (Sprint ricerca locale).
 *
 * PERCHÉ ESISTE, con l'evidenza che l'ha motivato: fino a oggi le query
 * partivano in italiano («infortuni squalifiche formazioni») anche per una
 * partita di seconda divisione paraguaiana. Il risultato, verificato in
 * produzione il 28/08/2026 su General Caballero JLM – Dep. Capiatá, erano
 * wincomparator.com e aiscore.com: aggregatori di statistiche fredde, zero
 * notizie. Chi scrive davvero di quella partita — ABC Color, Última Hora,
 * Versus — non compariva, perché nessuno cerca «infortuni» in Paraguay.
 *
 * Qui si risolve alla radice: per ogni paese si dichiarano la lingua, le
 * parole che i tifosi e i cronisti usano davvero, e le testate nazionali.
 * Niente traduzione automatica: un dizionario scritto a mano, verificabile
 * riga per riga, perché una parola sbagliata in una query non dà un errore
 * — dà silenzio, che è peggio.
 *
 * Modulo PURO: nessuna rete, nessuna chiave, tutto testabile.
 */
import { isWomensFixture, womenSearchTerms } from "./match-scope";

/** Le parole che contano, nella lingua di chi scrive la notizia. */
export interface LocaleProfile {
  /** codice lingua per la ricerca */
  lang: string;
  /** «assenze, infortunati»: chi non gioca */
  assenze: string;
  /** «formazione, convocati»: chi gioca */
  formazione: string;
  /** «vigilia, dichiarazioni»: cosa si dice prima */
  vigilia: string;
  /** testate nazionali che coprono davvero il calcio locale */
  testate: string[];
}

/**
 * Profili per paese. La chiave è il nome del paese come arriva
 * dall'archivio (BetExplorer usa l'inglese), in minuscolo.
 *
 * L'elenco copre i paesi che compaiono davvero nel nostro archivio, non
 * tutti quelli del mondo: un dizionario che nessuno verifica è peggio di
 * un dizionario corto.
 */
export const LOCALE_PROFILES: Record<string, LocaleProfile> = {
  /* --- spagnolo: Sudamerica e Spagna --- */
  paraguay: {
    lang: "es",
    assenze: "bajas lesionados suspendidos",
    formazione: "alineación convocados titulares",
    vigilia: "previa declaraciones",
    testate: ["abc.com.py", "ultimahora.com", "versus.com.py", "lanacion.com.py"],
  },
  argentina: {
    lang: "es",
    assenze: "bajas lesionados suspendidos",
    formazione: "formación probable convocados",
    vigilia: "previa declaraciones",
    testate: ["ole.com.ar", "tycsports.com", "lanacion.com.ar", "clarin.com"],
  },
  bolivia: {
    lang: "es",
    assenze: "bajas lesionados suspendidos",
    formazione: "alineación convocados",
    vigilia: "previa declaraciones",
    testate: ["eldeber.com.bo", "lostiempos.com", "paginasiete.bo"],
  },
  ecuador: {
    lang: "es",
    assenze: "bajas lesionados suspendidos",
    formazione: "alineación convocados",
    vigilia: "previa declaraciones",
    testate: ["eluniverso.com", "elcomercio.com", "expreso.ec"],
  },
  venezuela: {
    lang: "es",
    assenze: "bajas lesionados suspendidos",
    formazione: "alineación convocados",
    vigilia: "previa declaraciones",
    testate: ["meridiano.net", "lider.com.ve", "elnacional.com"],
  },
  chile: {
    lang: "es",
    assenze: "bajas lesionados suspendidos",
    formazione: "formación convocados",
    vigilia: "previa declaraciones",
    testate: ["latercera.com", "emol.com", "aldia.cl"],
  },
  peru: {
    lang: "es",
    assenze: "bajas lesionados suspendidos",
    formazione: "alineación convocados",
    vigilia: "previa declaraciones",
    testate: ["depor.com", "libero.pe", "elcomercio.pe"],
  },
  colombia: {
    lang: "es",
    assenze: "bajas lesionados suspendidos",
    formazione: "alineación convocados",
    vigilia: "previa declaraciones",
    testate: ["futbolred.com", "eltiempo.com", "antena2.com"],
  },
  uruguay: {
    lang: "es",
    assenze: "bajas lesionados suspendidos",
    formazione: "formación convocados",
    vigilia: "previa declaraciones",
    testate: ["ovaciondigital.com.uy", "elpais.com.uy", "referi.uy"],
  },
  mexico: {
    lang: "es",
    assenze: "bajas lesionados suspendidos",
    formazione: "alineación convocados",
    vigilia: "previa declaraciones",
    testate: ["record.com.mx", "mediotiempo.com", "esto.com.mx"],
  },
  guatemala: {
    lang: "es",
    assenze: "bajas lesionados",
    formazione: "alineación convocados",
    vigilia: "previa",
    testate: ["prensalibre.com", "soy502.com"],
  },
  spain: {
    lang: "es",
    assenze: "bajas lesionados sancionados",
    formazione: "alineación probable convocatoria",
    vigilia: "previa rueda de prensa",
    testate: ["marca.com", "as.com", "mundodeportivo.com", "sport.es"],
  },

  /* --- portoghese --- */
  brazil: {
    lang: "pt",
    assenze: "desfalques lesionados suspensos",
    formazione: "escalação provável relacionados",
    vigilia: "pré-jogo coletiva",
    testate: ["ge.globo.com", "lance.com.br", "uol.com.br"],
  },
  portugal: {
    lang: "pt",
    assenze: "lesionados castigados ausências",
    formazione: "onze provável convocados",
    vigilia: "antevisão conferência",
    testate: ["record.pt", "abola.pt", "ojogo.pt"],
  },

  /* --- resto d'Europa --- */
  italy: {
    lang: "it",
    assenze: "infortunati squalificati assenze",
    formazione: "formazioni probabili convocati",
    vigilia: "vigilia conferenza stampa",
    testate: ["gazzetta.it", "corrieredellosport.it", "tuttosport.com"],
  },
  england: {
    lang: "en",
    assenze: "injuries suspensions absentees",
    formazione: "predicted lineup team news squad",
    vigilia: "press conference preview",
    testate: ["bbc.co.uk", "skysports.com", "theguardian.com"],
  },
  scotland: {
    lang: "en",
    assenze: "injuries suspensions",
    formazione: "team news squad lineup",
    vigilia: "press conference preview",
    testate: ["bbc.co.uk", "dailyrecord.co.uk", "heraldscotland.com"],
  },
  germany: {
    lang: "de",
    assenze: "verletzte gesperrte ausfälle",
    formazione: "aufstellung kader startelf",
    vigilia: "pressekonferenz vorbericht",
    testate: ["kicker.de", "bild.de", "sport1.de"],
  },
  france: {
    lang: "fr",
    assenze: "blessés suspendus absents",
    formazione: "compo probable groupe convoqué",
    vigilia: "avant-match conférence de presse",
    testate: ["lequipe.fr", "rmcsport.bfmtv.com", "footmercato.net"],
  },
  netherlands: {
    lang: "nl",
    assenze: "blessures geschorst afwezig",
    formazione: "opstelling selectie",
    vigilia: "persconferentie voorbeschouwing",
    testate: ["vi.nl", "ad.nl", "telegraaf.nl"],
  },
  sweden: {
    lang: "sv",
    assenze: "skador avstängda frånvarande",
    formazione: "startelva truppen laguppställning",
    vigilia: "inför matchen presskonferens",
    testate: ["fotbollskanalen.se", "aftonbladet.se", "expressen.se"],
  },
  norway: {
    lang: "no",
    assenze: "skader utestengt",
    formazione: "lagoppstilling troppen",
    vigilia: "før kampen",
    testate: ["nrk.no", "vg.no", "tv2.no"],
  },
  denmark: {
    lang: "da",
    assenze: "skader karantæne",
    formazione: "startopstilling trup",
    vigilia: "før kampen",
    testate: ["bold.dk", "tipsbladet.dk", "dr.dk"],
  },
  finland: {
    lang: "fi",
    assenze: "loukkaantumiset pelikielto",
    formazione: "avauskokoonpano kokoonpano",
    vigilia: "ennakko",
    testate: ["is.fi", "hs.fi"],
  },
  turkey: {
    lang: "tr",
    assenze: "sakatlık cezalı eksikler",
    formazione: "muhtemel 11 kadro",
    vigilia: "maç öncesi basın toplantısı",
    testate: ["fanatik.com.tr", "sabah.com.tr", "ntvspor.net"],
  },
  greece: {
    lang: "el",
    assenze: "τραυματίες τιμωρημένοι απουσίες",
    formazione: "ενδεκάδα αποστολή",
    vigilia: "συνέντευξη τύπου",
    testate: ["sport24.gr", "gazzetta.gr", "sdna.gr"],
  },
  poland: {
    lang: "pl",
    assenze: "kontuzje zawieszeni",
    formazione: "skład kadra",
    vigilia: "przed meczem konferencja",
    testate: ["sport.pl", "przegladsportowy.onet.pl", "meczyki.pl"],
  },
  romania: {
    lang: "ro",
    assenze: "accidentări suspendați",
    formazione: "echipa probabilă lot",
    vigilia: "conferință de presă",
    testate: ["gsp.ro", "digisport.ro", "prosport.ro"],
  },
  croatia: {
    lang: "hr",
    assenze: "ozljede suspenzije",
    formazione: "sastav popis igrača",
    vigilia: "najava utakmice",
    testate: ["sportske.jutarnji.hr", "index.hr"],
  },
  serbia: {
    lang: "sr",
    assenze: "povrede suspenzije",
    formazione: "sastav spisak igrača",
    vigilia: "najava meča",
    testate: ["sportklub.rs", "mozzartsport.com"],
  },
  slovenia: {
    lang: "sl",
    assenze: "poškodbe kazni",
    formazione: "postava seznam igralcev",
    vigilia: "napoved tekme",
    testate: ["ekipa.svet24.si", "rtvslo.si"],
  },
  ukraine: {
    lang: "uk",
    assenze: "травми дискваліфікація",
    formazione: "склад заявка",
    vigilia: "прес-конференція",
    testate: ["football.ua", "champion.com.ua"],
  },
  russia: {
    lang: "ru",
    assenze: "травмы дисквалификация",
    formazione: "состав заявка",
    vigilia: "пресс-конференция",
    testate: ["sport-express.ru", "championat.com"],
  },
  georgia: {
    lang: "ka",
    assenze: "ტრავმები დისკვალიფიკაცია",
    formazione: "შემადგენლობა",
    vigilia: "მატჩის წინ",
    testate: ["sportall.ge", "gfc.ge"],
  },
  albania: {
    lang: "sq",
    assenze: "dëmtime pezullime",
    formazione: "formacioni lista",
    vigilia: "para ndeshjes",
    testate: ["panoramasport.al", "supersport.al"],
  },
  "north macedonia": {
    lang: "mk",
    assenze: "повреди суспензии",
    formazione: "состав",
    vigilia: "пред натпреварот",
    testate: ["sport.mk", "sportmedia.mk"],
  },
  kosovo: {
    lang: "sq",
    assenze: "dëmtime pezullime",
    formazione: "formacioni lista",
    vigilia: "para ndeshjes",
    testate: ["telegrafi.com", "kallxo.com"],
  },
  "bosnia & herzegovina": {
    lang: "bs",
    assenze: "povrede suspenzije",
    formazione: "sastav spisak",
    vigilia: "najava utakmice",
    testate: ["sportsport.ba", "klix.ba"],
  },
  luxembourg: {
    lang: "fr",
    assenze: "blessés suspendus",
    formazione: "compo probable",
    vigilia: "avant-match",
    testate: ["wort.lu", "rtl.lu"],
  },
  "faroe islands": {
    lang: "da",
    assenze: "skador",
    formazione: "trup",
    vigilia: "undan dysti",
    testate: ["portal.fo", "in.fo"],
  },
  estonia: {
    lang: "et",
    assenze: "vigastused",
    formazione: "koosseis",
    vigilia: "enne mängu",
    testate: ["soccernet.ee", "delfi.ee"],
  },
  "northern ireland": {
    lang: "en",
    assenze: "injuries suspensions",
    formazione: "team news squad",
    vigilia: "preview",
    testate: ["bbc.co.uk", "belfasttelegraph.co.uk"],
  },
  wales: {
    lang: "en",
    assenze: "injuries suspensions",
    formazione: "team news squad",
    vigilia: "preview",
    testate: ["bbc.co.uk", "walesonline.co.uk"],
  },
  ireland: {
    lang: "en",
    assenze: "injuries suspensions",
    formazione: "team news squad",
    vigilia: "preview",
    testate: ["rte.ie", "the42.ie"],
  },

  /* --- Asia, Africa, Oceania --- */
  japan: {
    lang: "ja",
    assenze: "負傷者 出場停止 欠場",
    formazione: "スタメン メンバー",
    vigilia: "試合前 会見",
    testate: ["soccer-king.jp", "jleague.jp", "nikkansports.com"],
  },
  "south korea": {
    lang: "ko",
    assenze: "부상 결장 징계",
    formazione: "선발 명단",
    vigilia: "경기 전 기자회견",
    testate: ["sports.news.naver.com", "interfootball.co.kr"],
  },
  china: {
    lang: "zh",
    assenze: "伤病 停赛 缺阵",
    formazione: "首发 名单",
    vigilia: "赛前 发布会",
    testate: ["sina.com.cn", "sohu.com"],
  },
  "united arab emirates": {
    lang: "ar",
    assenze: "إصابات إيقاف غياب",
    formazione: "التشكيلة المتوقعة قائمة",
    vigilia: "المؤتمر الصحفي",
    testate: ["alkhaleej.ae", "alittihad.ae", "emaratalyoum.com"],
  },
  "saudi arabia": {
    lang: "ar",
    assenze: "إصابات إيقاف غياب",
    formazione: "التشكيلة المتوقعة قائمة",
    vigilia: "المؤتمر الصحفي",
    testate: ["arriyadiyah.com", "okaz.com.sa"],
  },
  egypt: {
    lang: "ar",
    assenze: "إصابات إيقاف غياب",
    formazione: "التشكيلة المتوقعة قائمة",
    vigilia: "المؤتمر الصحفي",
    testate: ["filgoal.com", "yallakora.com", "kingfut.com"],
  },
  iraq: {
    lang: "ar",
    assenze: "إصابات إيقاف",
    formazione: "التشكيلة قائمة",
    vigilia: "المؤتمر الصحفي",
    testate: ["winwin.iq", "alsumaria.tv"],
  },
  israel: {
    lang: "he",
    assenze: "פציעות הרחקות",
    formazione: "הרכב סגל",
    vigilia: "לפני המשחק",
    testate: ["one.co.il", "sport5.co.il"],
  },
  uzbekistan: {
    lang: "uz",
    assenze: "jarohat diskvalifikatsiya",
    formazione: "tarkib",
    vigilia: "o'yin oldidan",
    testate: ["championat.asia", "sports.uz"],
  },
  singapore: {
    lang: "en",
    assenze: "injuries suspensions",
    formazione: "team news squad",
    vigilia: "preview",
    testate: ["straitstimes.com", "channelnewsasia.com"],
  },
  australia: {
    lang: "en",
    assenze: "injuries suspensions",
    formazione: "team news squad lineup",
    vigilia: "preview",
    testate: ["theroar.com.au", "abc.net.au", "smh.com.au"],
  },
  usa: {
    lang: "en",
    assenze: "injuries suspensions availability report",
    formazione: "projected lineup roster",
    vigilia: "preview press conference",
    testate: ["mlssoccer.com", "espn.com", "theathletic.com"],
  },
};

/** Profilo di riserva: inglese, nessuna testata dichiarata. */
export const DEFAULT_PROFILE: LocaleProfile = {
  lang: "en",
  assenze: "injuries suspensions absentees",
  formazione: "predicted lineup team news squad",
  vigilia: "preview press conference",
  testate: [],
};

/**
 * Trova il profilo dal paese, o dal nome della competizione quando il paese
 * non è dichiarato («Paraguay: Division Intermedia» porta il paese in testa).
 */
export function profileFor(
  country: string | null,
  league: string | null = null,
): LocaleProfile {
  const candidati = [country, league?.split(":")[0]]
    .map((x) => (x ?? "").trim().toLowerCase())
    .filter((x) => x !== "");

  for (const c of candidati) {
    const diretto = LOCALE_PROFILES[c];
    if (diretto !== undefined) return diretto;
  }
  return DEFAULT_PROFILE;
}

/** true quando il paese ha un profilo dichiarato (non il ripiego inglese). */
export function hasLocaleProfile(
  country: string | null,
  league: string | null = null,
): boolean {
  return profileFor(country, league) !== DEFAULT_PROFILE;
}

/* ------------------------------------------------------------------ */
/* Costruzione delle query                                             */
/* ------------------------------------------------------------------ */

/** Aggregatori di quote e statistiche: rumore, mai notizie. */
export const JUNK_DOMAINS = [
  "wincomparator.com",
  "aiscore.com",
  "forebet.com",
  "sofascore.com",
  "flashscore.com",
  "footystats.org",
  "betexplorer.com",
  "oddspedia.com",
  "predictz.com",
  "scorebat.com",
  "zerozero.pt",
  "soccerway.com",
  "adibet.com",
  "windrawwin.com",
  "betclan.com",
  "soccervista.com",
];

/**
 * Le quattro domande che contano davvero prima di una partita, nella lingua
 * di chi le scriverebbe. L'ordine è di importanza decrescente: se il budget
 * finisce, si perdono le ultime.
 *
 * 1. ASSENZE E FORMAZIONI sulle testate nazionali — la notizia pesante
 *    (spogliatoio, stipendi, turnover) esce lì, non sugli aggregatori.
 * 2. SOCIAL UFFICIALI — nelle serie minori i convocati escono solo lì,
 *    prima e a volte invece che sui giornali.
 * 3. LOGISTICA E CAMPO — stadio squalificato, campo neutro, porte chiuse,
 *    rinvio per impraticabilità: fattori che spostano una quota da soli.
 * 4. VIGILIA — dichiarazioni e clima intorno alla partita.
 */
export function localQueries(
  homeTeam: string,
  awayTeam: string,
  country: string | null,
  league: string | null,
): Array<{ query: string; scopo: string; lang: string }> {
  const p = profileFor(country, league);
  const scope = isWomensFixture(homeTeam, awayTeam, league)
    ? ` ${womenSearchTerms(p.lang)}`
    : "";
  const squadre = `${homeTeam} ${awayTeam}${scope}`;
  const siti =
    p.testate.length > 0
      ? " " + p.testate.slice(0, 4).map((d) => `site:${d}`).join(" OR ")
      : "";

  return [
    {
      scopo: "assenze e formazioni sulle testate nazionali",
      lang: p.lang,
      query: `${squadre} ${p.assenze} ${p.formazione}${siti}`.trim(),
    },
    {
      scopo: "convocati e comunicati sui canali ufficiali",
      lang: p.lang,
      query:
        `("${homeTeam}" OR "${awayTeam}")${scope} ${p.formazione} ${p.assenze} ` +
        `(site:x.com OR site:twitter.com OR site:facebook.com OR site:instagram.com)`,
    },
    {
      scopo: "logistica: campo, sede, rinvii",
      lang: p.lang,
      query: `${squadre} ${logisticsTerms(p.lang)}`,
    },
    {
      scopo: "vigilia e clima intorno alla partita",
      lang: p.lang,
      query: `${squadre} ${p.vigilia} ${crisisTerms(p.lang)}`.trim(),
    },
  ];
}

/**
 * Termini di logistica e impraticabilità, per lingua.
 * Sono i fattori che spostano una quota senza che nessuno «giochi male»:
 * stadio squalificato, campo neutro, porte chiuse, viaggio massacrante.
 */
export function logisticsTerms(lang: string): string {
  switch (lang) {
    case "es":
      return "estadio cambio de sede clausurado puertas cerradas cancha suspendido";
    case "pt":
      return "estádio mudança de local portões fechados campo interditado adiado";
    case "it":
      return "stadio campo neutro porte chiuse impraticabile rinviata squalifica campo";
    case "de":
      return "stadion ortswechsel geisterspiel platz gesperrt verlegt";
    case "fr":
      return "stade huis clos terrain impraticable report délocalisé";
    case "nl":
      return "stadion zonder publiek afgelast veld onbespeelbaar";
    case "sv":
      return "arena flyttad match inställd planen obrukbar";
    case "tr":
      return "stat kapalı gişe saha kapatma erteleme";
    case "ar":
      return "الملعب تغيير الملعب دون جمهور تأجيل المباراة";
    case "ja":
      return "スタジアム 変更 無観客 延期 中止";
    default:
      return "stadium venue change behind closed doors postponed pitch unplayable";
  }
}

/**
 * Termini di crisi societaria: stipendi non pagati, spogliatoio spaccato,
 * dimissioni. Sono le notizie che giustificano un crollo «reale».
 */
export function crisisTerms(lang: string): string {
  switch (lang) {
    case "es":
      return "crisis sueldos impagos huelga renuncia vestuario";
    case "pt":
      return "crise salários atrasados greve demissão vestiário";
    case "it":
      return "crisi stipendi non pagati sciopero dimissioni spogliatoio";
    case "de":
      return "krise gehälter streik rücktritt kabine";
    case "fr":
      return "crise salaires impayés grève démission vestiaire";
    case "sv":
      return "kris löner strejk avgår";
    case "tr":
      return "kriz ödenmeyen maaş istifa soyunma odası";
    case "ar":
      return "أزمة رواتب متأخرة إضراب استقالة";
    default:
      return "crisis unpaid wages strike resignation dressing room";
  }
}

/**
 * Query per il contesto statistico (H2H, classifica, forma).
 * Resta utile, ma è la MENO importante: gli aggregatori la coprono già e
 * non spiega mai un movimento.
 */
export function statsQuery(
  homeTeam: string,
  awayTeam: string,
  league: string | null,
  country: string | null,
): string {
  const p = profileFor(country, league);
  const l = league === null || league.trim() === "" ? "" : ` ${league.trim()}`;
  const termini =
    p.lang === "es"
      ? "historial posiciones últimos partidos"
      : p.lang === "pt"
        ? "histórico classificação últimos jogos"
        : p.lang === "it"
          ? "precedenti classifica ultime partite"
          : "head to head standings recent form";
  const scope = isWomensFixture(homeTeam, awayTeam, league)
    ? ` ${womenSearchTerms(p.lang)}`
    : "";
  return `${homeTeam} ${awayTeam}${l}${scope} ${termini}`;
}
