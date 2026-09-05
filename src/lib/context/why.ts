/**
 * «Perché il mercato si muove — lettura» (Sprint «Perché si muove»).
 *
 * Modulo PURO: nessuna rete, nessun modello, nessun database. La lettura si
 * compone con template dai soli elementi verificabili:
 *
 *  - FATTORI CON FONTE: campi del Contesto 360° che hanno un URL recuperato.
 *    Ogni riga porta il tag «da fonte» e il link. Un campo senza fonte NON
 *    entra nella lettura: resta visibile sopra come conoscenza modello.
 *  - PROFILO DEL MOVIMENTO: ciò che il monitor ha già misurato (quando è
 *    nato il movimento rispetto al kickoff, se è sostenuto o flash, se è
 *    rimbalzato, se è un solo bookmaker o un consenso). Ogni riga porta il
 *    tag «ipotesi dal profilo del movimento».
 *
 * Regola di lingua: si descrive il mercato, mai il risultato. Nessuna riga
 * può dire che un esito è più probabile nella realtà. La chiusura è fissa.
 */

/** Chiusura obbligatoria, identica ovunque compaia la lettura. */
export const WHY_CLOSING = "È una lettura del contesto, non una garanzia di vincita.";

/** Testo quando non c'è nulla: nessuna fonte e profilo neutro. */
export const WHY_NO_CAUSE =
  "Nessuna causa pubblica trovata: movimento senza spiegazione disponibile. I movimenti senza notizia sono compatibili con denaro informato, ma resta un'ipotesi.";

export type DriverTag = "da fonte" | "ipotesi dal profilo del movimento";

export interface WhyDriver {
  text: string;
  tag: DriverTag;
  /** presente solo per i driver «da fonte» */
  url: string | null;
  title: string | null;
}

export interface WhyReading {
  drivers: WhyDriver[];
  /** paragrafo pronto: 3-6 frasi, chiusura inclusa */
  paragraph: string;
  /** true quando non c'era nulla da dire e si è usata la frase dichiarata */
  empty: boolean;
}

/** Il profilo del movimento, tutto già misurato dal motore. */
export interface MovementProfile {
  /** ore fra la nascita del segnale e il calcio d'inizio; null se ignoto */
  hoursToKickoff: number | null;
  sustainedMinutes: number;
  isFlash: boolean;
  rebounded: boolean;
  booksConfirming: number;
  booksTotal: number;
  /** quota scesa (true) o salita (false); null se non misurabile */
  falling: boolean | null;
  /** classe di ampiezza già decisa dal motore */
  magnitudeClass: string;
}

/** Un campo di contesto con la sua fonte, come arriva dal registro. */
export interface SourcedField {
  key: string;
  valore: string;
  fonteUrl: string | null;
  fonteTitolo: string | null;
}

const FIELD_PHRASES: Record<string, string> = {
  livello_categorie: "il livello delle categorie in gara",
  anomalia_campo: "una particolarità del campo",
  posta_in_palo: "la posta in palio",
  rotazioni_fatica: "rotazioni e fatica di calendario",
  h2h_e_forma_recente: "scontri diretti e forma recente",
  forma_recente_5: "l'andamento delle ultime cinque partite",
  assenze_note: "le assenze dichiarate",
};

/** Soglia oltre la quale il movimento si dice «precoce». */
export const EARLY_HOURS = 24;
/** Sotto questa soglia il movimento si dice «tardivo». */
export const LATE_HOURS = 6;

/**
 * Driver ricavati dai campi con fonte. I campi senza URL sono esclusi per
 * costruzione: la lettura combina solo ciò che qualcuno ha pubblicato.
 */
export function driversFromSources(fields: SourcedField[]): WhyDriver[] {
  const out: WhyDriver[] = [];
  for (const f of fields) {
    if (f.fonteUrl === null) continue;
    const valore = f.valore.trim();
    if (valore === "" || valore.toLowerCase() === "non noto") continue;
    if (f.key === "accordo_col_drop") continue;
    const phrase = FIELD_PHRASES[f.key] ?? f.key.replace(/_/g, " ");
    out.push({
      text: `${phrase}: ${valore}`,
      tag: "da fonte",
      url: f.fonteUrl,
      title: f.fonteTitolo,
    });
  }
  return out;
}

/**
 * Driver ricavati dal profilo del movimento. Sono ipotesi dichiarate: il
 * monitor descrive la FORMA del movimento, non la sua causa.
 */
export function driversFromProfile(p: MovementProfile): WhyDriver[] {
  const out: WhyDriver[] = [];
  const add = (text: string) =>
    out.push({ text, tag: "ipotesi dal profilo del movimento", url: null, title: null });

  if (p.hoursToKickoff !== null) {
    if (p.hoursToKickoff >= EARLY_HOURS) {
      add(
        `il movimento è precoce (oltre ${EARLY_HOURS} ore dal calcio d'inizio): a quella distanza i mercati sono sottili e bastano poche giocate per spostarli`,
      );
    } else if (p.hoursToKickoff <= LATE_HOURS) {
      add(
        "il movimento è tardivo, vicino al calcio d'inizio: è la finestra in cui arrivano formazioni e ultime notizie",
      );
    }
  }

  if (p.isFlash) {
    add(
      "il movimento è concentrato in pochi minuti (flash): compatibile con una singola giocata grossa, non con un riprezzamento diffuso",
    );
  } else if (p.sustainedMinutes >= 120) {
    add(
      `il prezzo è rimasto sul nuovo livello per ${Math.round(p.sustainedMinutes / 60)} ore: il mercato ha tenuto la posizione invece di correggerla`,
    );
  }

  if (p.rebounded) {
    add(
      "la quota è poi rientrata verso il livello di partenza: parte del movimento è stata smentita dal mercato stesso",
    );
  }

  if (p.booksTotal <= 1) {
    add(
      "il movimento è visibile su una sola linea di consenso: la coordinazione fra bookmaker non è osservabile e non se ne può dedurre nulla",
    );
  } else if (p.booksConfirming >= 2 && p.booksConfirming >= p.booksTotal - 1) {
    add(
      `il movimento è confermato da ${p.booksConfirming} bookmaker su ${p.booksTotal}: è un riprezzamento condiviso, non lo scarto di un singolo operatore`,
    );
  }

  return out;
}

/** true quando il profilo non ha nulla di caratteristico da dire. */
export function isProfileNeutral(p: MovementProfile): boolean {
  return driversFromProfile(p).length === 0;
}

function directionSentence(p: MovementProfile): string {
  if (p.falling === null) {
    return "Il monitor ha registrato un movimento di quota su questa partita";
  }
  return p.falling
    ? "La quota osservata è scesa: il mercato sta prezzando quell'esito più caro di prima"
    : "La quota osservata è salita: il mercato sta prezzando quell'esito più a buon mercato di prima";
}

/**
 * Compone la lettura.
 *
 * Struttura del paragrafo: apertura sul verso del movimento, poi i fattori
 * con fonte, poi le ipotesi dal profilo, poi la chiusura fissa. Ogni frase
 * porta in chiaro da dove viene, così la lettura non si può confondere con
 * una spiegazione accertata.
 */
export function buildWhyReading(
  fields: SourcedField[],
  profile: MovementProfile,
): WhyReading {
  const sourced = driversFromSources(fields);
  const profiled = driversFromProfile(profile);
  const drivers = [...sourced, ...profiled];

  if (drivers.length === 0) {
    return {
      drivers: [],
      paragraph: `${WHY_NO_CAUSE} ${WHY_CLOSING}`,
      empty: true,
    };
  }

  const sentences: string[] = [`${directionSentence(profile)}.`];

  if (sourced.length > 0) {
    /* al massimo tre fattori con fonte: oltre, la lettura diventa un elenco */
    const list = sourced.slice(0, 3).map((d) => d.text);
    sentences.push(
      list.length === 1
        ? `Dalle fonti recuperate emerge ${list[0]}.`
        : `Dalle fonti recuperate emergono ${list.slice(0, -1).join("; ")} e ${list[list.length - 1]}.`,
    );
  } else {
    sentences.push(
      "Nessun fattore con fonte pubblica è stato recuperato per questa partita.",
    );
  }

  for (const d of profiled.slice(0, 3)) {
    sentences.push(
      `${d.text.charAt(0).toUpperCase()}${d.text.slice(1)} — ipotesi dal profilo del movimento.`,
    );
  }

  sentences.push(WHY_CLOSING);

  return { drivers, paragraph: sentences.join(" "), empty: false };
}
