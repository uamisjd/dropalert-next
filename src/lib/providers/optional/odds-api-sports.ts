/**
 * Catalogo sport di The Odds API — parsing di `GET /v4/sports`.
 *
 * Perché esiste come modulo puro: l'endpoint `/v4/sports` è **gratuito** (non
 * conta quota; serve solo la chiave) e restituisce l'elenco di tutti i
 * campionati che la fonte copre. È la sonda di copertura che serve per
 * decidere, con dati reali, quali competizioni mappare in `sport-keys.ts`
 * SENZA spendere un credito e SENZA indovinare a memoria.
 *
 * Regole di onestà:
 *  - si legge SOLO `key`, `group`, `title`, `active`: nessun valore stimato;
 *  - il tipo dei campi è ristretto con `unknown` + narrowing, mai `any`;
 *  - ciò che non è leggibile (riga non oggetto, chiave mancante) si scarta e
 *    si conta, non si indovina.
 */

/** Sottoinsieme tipizzato di una riga del catalogo `/v4/sports`. */
export interface OddsApiSport {
  /** chiave della fonte, es. `soccer_epl` */
  key: string;
  /** gruppo, es. `"Soccer"` */
  group: string;
  /** etichetta leggibile, es. `"EPL"` */
  title: string;
  /** true se la competizione è in stagione */
  active: boolean;
}

export interface SportsCatalogResult {
  sports: OddsApiSport[];
  /** righe scartate perché non leggibili (mai stimate) */
  discarded: number;
  /** campionati di calcio, ordinati per chiave */
  soccer: OddsApiSport[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

/**
 * Converte la risposta `GET /v4/sports` in un elenco tipizzato.
 *
 * Una riga non oggetto o senza `key` viene scartata e contata: la copertura
 * si dichiara su ciò che è realmente leggibile, mai arrotondata per eccesso.
 */
export function parseSportsCatalog(payload: unknown): SportsCatalogResult {
  if (!Array.isArray(payload)) {
    return { sports: [], discarded: 0, soccer: [] };
  }

  const sports: OddsApiSport[] = [];
  let discarded = 0;

  for (const raw of payload) {
    const obj = asObject(raw);
    if (obj === null) {
      discarded += 1;
      continue;
    }
    const key = asString(obj.key);
    if (key === null || key.trim() === "") {
      discarded += 1;
      continue;
    }
    sports.push({
      key: key.trim(),
      group: asString(obj.group) ?? "",
      title: asString(obj.title) ?? "",
      active: asBoolean(obj.active),
    });
  }

  const soccer = sports
    .filter((s) => /soccer/i.test(s.group))
    .sort((a, b) => a.key.localeCompare(b.key));

  return { sports, discarded, soccer };
}

/** Only the soccer competitions that are actually in season. */
export function activeSoccerKeys(result: SportsCatalogResult): string[] {
  return result.soccer.filter((s) => s.active).map((s) => s.key);
}
