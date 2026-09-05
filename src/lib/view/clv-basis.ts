/**
 * Base di confronto del CLV — resa visibile a chi legge.
 *
 * Il problema che questo modulo risolve è misurato, non teorico: il CLV è
 * `(probChiusura − probSegnale) × 100`, ma le due probabilità non stanno
 * sempre sulla stessa base. La colonna `closing_basis` registra quale:
 *
 *  - `fair_novig`    → chiusura depurata dal margine (confronto corretto);
 *  - `raw_consensus` → chiusura grezza, margine incluso: il segnale (prezzo
 *                      grezzo) viene confrontato con un numero di natura
 *                      diversa, e il CLV esce depresso di un importo
 *                      meccanico.
 *
 * Lo studio sulle partite finite quantifica quell'importo: **−1,86 pp di CLV
 * bruciati dal solo errore di base**, media su 37 362 osservazioni, con il
 * 20,6% dei casi che cambierebbe verso (`docs/STUDIO-PARTITE-FINITE.md` §1.1).
 * Il CLV medio pubblicato dal sito è dello stesso ordine di grandezza, quindi
 * un riepilogo che mescola le due basi senza dichiararlo non è leggibile.
 *
 * Regola applicata qui: la base non si corregge in lettura (riscrivere il
 * passato non è compito della vista), si **conta e si dichiara**. Un
 * riepilogo con basi miste lo dice, con quanti casi per ciascuna base, e dice
 * anche che i due gruppi non sono confrontabili fra loro.
 *
 * Modulo puro: nessun database, nessuna rete.
 */

/** Le basi registrate in `clv_records.closing_basis`, più il caso assente. */
export type ClvBasisKey = "fair_novig" | "raw_consensus" | "sconosciuta";

export const CLV_BASIS_KEYS: readonly ClvBasisKey[] = [
  "fair_novig",
  "raw_consensus",
  "sconosciuta",
] as const;

export const CLV_BASIS_LABELS: Record<ClvBasisKey, string> = {
  fair_novig: "chiusura senza margine contro segnale grezzo",
  raw_consensus: "chiusura grezza come il segnale",
  sconosciuta: "base non registrata",
};

/**
 * Su quali basi le due metà del CLV stanno davvero sullo stesso piano.
 *
 * Il prezzo del segnale (`signalPrice`) è sempre un prezzo grezzo di mercato,
 * margine incluso: non esiste nel registro una sua versione depurata. Quindi:
 *
 *  - `raw_consensus` → grezzo contro grezzo: **allineato**. Include il
 *    margine in entrambe le metà, e questo va dichiarato, ma il confronto è
 *    omogeneo;
 *  - `fair_novig` → chiusura depurata contro segnale grezzo: **non
 *    allineato**. È la coppia che lo studio §1.1 misura a −1,86 pp di CLV
 *    bruciati dal solo errore di base, con il 20,6% dei casi che cambia verso.
 *
 * Questa tabella corregge un'affermazione che il modulo sosteneva in senso
 * opposto («fair = confronto corretto»). L'algebra è banale e verificabile:
 * depurare il margine ALZA il prezzo, quindi ABBASSA la probabilità implicita
 * di chiusura, quindi ABBASSA `clvPp` — meccanicamente, senza che il mercato
 * si sia mosso. Confrontare una probabilità con il margine contro una senza è
 * l'unico modo di ottenere quello spostamento.
 */
export const CLV_BASIS_ALIGNED: Record<ClvBasisKey, boolean> = {
  fair_novig: false,
  raw_consensus: true,
  sconosciuta: false,
};

/**
 * Normalizza il valore letto dalla colonna.
 *
 * `sconosciuta` esiste perché le righe scritte prima che la colonna esistesse
 * hanno il default `raw_consensus`, ma una lettura difensiva non deve
 * trasformare un valore inatteso in una base inventata: lo dichiara.
 */
export function clvBasisOf(raw: string | null | undefined): ClvBasisKey {
  if (raw === "fair_novig" || raw === "raw_consensus") return raw;
  return "sconosciuta";
}

export interface ClvBasisMix {
  /** osservazioni per base, chiavi sempre presenti (anche a zero) */
  counts: Record<ClvBasisKey, number>;
  /** quante basi distinte con almeno un'osservazione */
  distinct: number;
  /** true quando il riepilogo mescola basi diverse: non è confrontabile */
  mixed: boolean;
  /** osservazioni totali */
  total: number;
  /** quota 0–1 sulla base `fair_novig`: la parte NON allineata del riepilogo */
  fairShare: number;
}

/** Conta le osservazioni per base. Non scarta nulla: anche l'ignoto è un dato. */
export function clvBasisMix(
  rows: Array<{ closingBasis?: string | null }>,
): ClvBasisMix {
  const counts: Record<ClvBasisKey, number> = {
    fair_novig: 0,
    raw_consensus: 0,
    sconosciuta: 0,
  };
  for (const r of rows) counts[clvBasisOf(r.closingBasis)] += 1;

  const total = rows.length;
  const present = CLV_BASIS_KEYS.filter((k) => counts[k] > 0);

  return {
    counts,
    distinct: present.length,
    mixed: present.length > 1,
    total,
    fairShare: total > 0 ? counts.fair_novig / total : 0,
  };
}

/**
 * Frase di stato per la pagina.
 *
 * Non commenta il CLV: dichiara solo su quali basi è stato misurato, perché
 * è l'informazione che decide se il numero successivo si può leggere.
 */
export function describeClvBasisMix(mix: ClvBasisMix): string {
  if (mix.total === 0) {
    return "Nessuna osservazione di CLV a registro: la base di confronto non è ancora dichiarabile.";
  }

  const parti = CLV_BASIS_KEYS.filter((k) => mix.counts[k] > 0).map(
    (k) => `${mix.counts[k]} su ${CLV_BASIS_LABELS[k]}`,
  );

  if (!mix.mixed) {
    const sola = CLV_BASIS_KEYS.find((k) => mix.counts[k] > 0)!;
    if (sola === "fair_novig") {
      /* Tutte sulla stessa colonna non vuol dire confronto omogeneo: il
         segnale resta grezzo, quindi ogni riga mescola le due basi. */
      return (
        `Tutte le ${mix.total} osservazioni usano la ${CLV_BASIS_LABELS.fair_novig}. ` +
        `Il prezzo del segnale è grezzo e include il margine, la chiusura no: ` +
        `le due metà del CLV non stanno sullo stesso piano e il numero risulta ` +
        `depresso di un importo meccanico (−1,86 pp in media, studio §1.1), ` +
        `non di mercato.`
      );
    }
    return (
      `Tutte le ${mix.total} osservazioni sono su ${CLV_BASIS_LABELS[sola]}: ` +
      `grezzo contro grezzo, le due metà stanno sullo stesso piano. ` +
      `Il margine del bookmaker è incluso in entrambe, quindi un CLV negativo ` +
      `qui non distingue il movimento di mercato dall'imposta.`
    );
  }

  return (
    `Basi miste: ${parti.join("; ")}. ` +
    `Le due metà del CLV non stanno sullo stesso piano — il prezzo del segnale è grezzo, la chiusura a volte no — ` +
    `e la media che segue somma numeri non confrontabili. ` +
    `Misurato sull'archivio congelato, il solo errore di base vale −1,86 pp di CLV (studio §1.1).`
  );
}
