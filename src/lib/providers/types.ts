/**
 * Contratto unico delle fonti dati (Sprint 3A).
 *
 * Regole non negoziabili incorporate in questi tipi:
 *
 * 1. Nessuna eccezione silenziosa. Una fonte che fallisce restituisce un
 *    `ProviderResult` con `ok: false`; una fonte che risponde a metà
 *    restituisce `ok: true, partial: true` con l'elenco di cosa manca.
 *    L'esito parziale è un VALORE, non un errore da intercettare.
 *
 * 2. Mai dedurre valori. I DTO hanno campi opzionali `null`-abili: un dato
 *    assente resta assente e viaggia fino a `data_gaps`. Non esiste alcun
 *    campo "stimato".
 *
 * 3. Il motore non conosce le fonti. Questi tipi non importano nulla da
 *    `@/lib/drop/*`: la normalizzazione verso `BookmakerSeries` avviene
 *    nello strato di ingest, non dentro il provider.
 *
 * Aggiungere una fonte = implementare questa interfaccia e registrarla.
 * Nessuna modifica al motore, nessuna modifica allo schema.
 */
import type { MarketType, SelectionCode } from "@/db/schema";

/* ------------------------------------------------------------------ */
/* Finestre temporali e riferimenti                                    */
/* ------------------------------------------------------------------ */

/** Intervallo temporale richiesto a una fonte. */
export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Riferimento a una partita presso una fonte specifica.
 * `providerMatchId` è l'identificatore nativo della fonte (per BetExplorer
 * il codice tipo `n3QkY7yJ`), `key` è la chiave stabile interna.
 */
export interface FixtureRef {
  /** chiave interna stabile, es. "be-n3QkY7yJ" */
  key: string;
  /** id nativo presso la fonte, se disponibile */
  providerMatchId: string | null;
  /** URL della pagina di origine, per tracciabilità e debug */
  sourceUrl: string | null;
  kickoffAt: Date;
}

/* ------------------------------------------------------------------ */
/* DTO restituiti dalle fonti                                          */
/* ------------------------------------------------------------------ */

/**
 * Una partita così come la vede la fonte, prima della normalizzazione.
 * I nomi delle squadre sono grezzi: la risoluzione verso `teams` è compito
 * dello strato di ingest, che può fallire e dichiarare il buco.
 */
export interface FixtureDTO {
  key: string;
  providerMatchId: string | null;
  sourceUrl: string | null;
  /** nome squadra di casa così come pubblicato dalla fonte */
  homeTeamRaw: string;
  awayTeamRaw: string;
  /** nome campionato così come pubblicato, es. "England: EFL Trophy" */
  leagueRaw: string;
  /** paese, se la fonte lo distingue dal nome del campionato */
  countryRaw: string | null;
  kickoffAt: Date;
  /**
   * true se l'orario è stato letto senza fuso esplicito e assunto UTC.
   * Chi consuma il dato deve poter sapere che l'istante è approssimato
   * al fuso, invece di scoprirlo troppo tardi.
   */
  kickoffIsAssumedUtc: boolean;
}

/**
 * Una quotazione osservata.
 *
 * `bookmakerKey` può riferirsi a un book reale oppure a una serie di
 * consenso dichiarata (es. "betexplorer-consensus"): in quel caso
 * `isConsensus` è true e il consumatore SA che non si tratta di un
 * singolo operatore. Non si spaccia mai un consenso per un book.
 */
export interface OddsQuoteDTO {
  fixtureKey: string;
  bookmakerKey: string;
  isConsensus: boolean;
  market: MarketType;
  selection: SelectionCode;
  /** quota decimale osservata adesso */
  price: number;
  /** quota di apertura dichiarata dalla fonte, se pubblicata */
  openingPrice: number | null;
  /** istante di osservazione dichiarato dalla fonte, o di raccolta */
  observedAt: Date;
  /**
   * Numero di bookmaker che secondo la FONTE concordano sul movimento,
   * es. "17/21". Dato osservato e riportato, mai calcolato da noi.
   * `null` se la fonte non lo pubblica.
   */
  agreement: { confirming: number; total: number } | null;
}

/** Risultato finale di una partita. */
export interface ResultDTO {
  fixtureKey: string;
  providerMatchId: string | null;
  homeGoals: number;
  awayGoals: number;
  /** stato dichiarato dalla fonte, normalizzato */
  status: "finished" | "postponed" | "cancelled";
  observedAt: Date;
}

/* ------------------------------------------------------------------ */
/* Esito delle chiamate                                                */
/* ------------------------------------------------------------------ */

/** Categorie di errore, per decidere se e come ritentare. */
export type ProviderErrorKind =
  | "network" // timeout, DNS, connessione rifiutata
  | "http" // status >= 400
  | "parse" // HTML/JSON cambiato o illeggibile
  | "rate_limited" // 429 o limite locale raggiunto
  | "blocked" // 403, captcha, bot detection
  | "disabled" // provider spento per configurazione
  | "unsupported"; // capacità non offerta da questa fonte

export interface ProviderError {
  kind: ProviderErrorKind;
  message: string;
  /** status HTTP, quando applicabile */
  httpStatus?: number;
  /** URL che ha prodotto l'errore, per la diagnostica */
  url?: string;
}

/**
 * Esito di una chiamata a una fonte.
 * Tre casi espliciti: completo, parziale, fallito. Nessuna via di mezzo
 * implicita, nessun array vuoto che significa "boh".
 */
export type ProviderResult<T> =
  | {
      ok: true;
      data: T;
      latencyMs: number;
      partial: false;
      /** dimensione del payload grezzo, per collector_runs */
      payloadBytes: number;
    }
  | {
      ok: true;
      data: T;
      latencyMs: number;
      partial: true;
      /** descrizione puntuale di cosa non è stato letto */
      missing: string[];
      payloadBytes: number;
    }
  | {
      ok: false;
      error: ProviderError;
      latencyMs: number;
      retryable: boolean;
      payloadBytes: number;
    };

/** Esito di un controllo di raggiungibilità. */
export interface ProviderHealth {
  reachable: boolean;
  latencyMs: number;
  /** messaggio leggibile, mostrato nella diagnostica */
  detail: string;
  checkedAt: Date;
}

/* ------------------------------------------------------------------ */
/* Capacità e interfaccia                                              */
/* ------------------------------------------------------------------ */

/**
 * Cosa sa fare una fonte. Dichiararlo evita di chiamare metodi che
 * restituirebbero sempre `unsupported`, e permette al registry di
 * scegliere la fonte giusta per ogni compito.
 */
export interface ProviderCapabilities {
  fixtures: boolean;
  odds: boolean;
  results: boolean;
  /**
   * true se la fonte espone quote per singolo bookmaker.
   * false se espone soltanto una linea di consenso: in quel caso
   * coordinazione e conferma sharp NON sono calcolabili e vanno
   * dichiarate mancanti, non stimate.
   */
  perBookmakerOdds: boolean;
}

/** Limiti di cortesia verso la fonte. */
export interface RateLimitConfig {
  requestsPerMinute: number;
  minIntervalMs: number;
}

/**
 * Contratto che ogni fonte deve rispettare.
 *
 * I metodi non lanciano per errori previsti (rete, parsing, blocco):
 * restituiscono `ProviderResult` con `ok: false`. Un'eccezione da questi
 * metodi è un bug, e come tale viene registrata dal runner.
 */
export interface OddsProvider {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly capabilities: ProviderCapabilities;
  readonly rateLimit: RateLimitConfig;

  fetchFixtures(window: DateRange): Promise<ProviderResult<FixtureDTO[]>>;
  fetchOdds(fixture: FixtureRef): Promise<ProviderResult<OddsQuoteDTO[]>>;
  /**
 * Risultati finali per competizione. `leagues` è l'elenco
 * "paese/lega" da interrogare: chi chiama decide quali tornei
 * controllare (il giro corrente più le partite in attesa di esito),
 * così i campionati minori restano coperti anche quando escono
 * dall'elenco dei movimenti.
 */
fetchResults(
  window: DateRange,
  leagues?: string[],
): Promise<ProviderResult<ResultDTO[]>>;
  healthCheck(): Promise<ProviderHealth>;

  /**
   * Ultimo elenco grezzo scaricato, per la misura di copertura.
   *
   * FACOLTATIVO: una fonte che non sa dire cosa ha visto semplicemente non
   * lo implementa, e la copertura per quella fonte resta non misurata
   * invece di essere stimata.
   *
   * Serve a contare le righe che l'adapter ha scartato PRIMA di produrre i
   * DTO: quelle righe non arrivano mai al chiamante, quindi senza questo
   * metodo la differenza fra "visto" e "importato" è invisibile dall'interno
   * del giro di raccolta. Non deve MAI fare una richiesta di rete: restituisce
   * ciò che è già stato scaricato, o `null`.
   */
  lastListing?(): ProviderListing | null;
}

/** Elenco grezzo così com'è stato scaricato, senza rielaborazioni. */
export interface ProviderListing {
  /** corpo della risposta, identico a quello letto dal parser */
  body: string;
  fetchedAt: Date;
  url: string;
}

/* ------------------------------------------------------------------ */
/* Costruttori di esito                                                */
/* ------------------------------------------------------------------ */

/** Esito completo. */
export function ok<T>(
  data: T,
  latencyMs: number,
  payloadBytes = 0,
): ProviderResult<T> {
  return { ok: true, data, latencyMs, partial: false, payloadBytes };
}

/**
 * Esito parziale: sono arrivati dei dati, ma qualcosa manca.
 * `missing` non può essere vuoto, altrimenti l'esito sarebbe completo.
 */
export function partial<T>(
  data: T,
  latencyMs: number,
  missing: string[],
  payloadBytes = 0,
): ProviderResult<T> {
  return {
    ok: true,
    data,
    latencyMs,
    partial: true,
    missing: missing.length > 0 ? missing : ["dettaglio non specificato"],
    payloadBytes,
  };
}

/** Esito fallito. */
export function fail<T>(
  error: ProviderError,
  latencyMs: number,
  retryable: boolean,
  payloadBytes = 0,
): ProviderResult<T> {
  return { ok: false, error, latencyMs, retryable, payloadBytes };
}

/** Errore standard per una capacità non offerta dalla fonte. */
export function unsupported<T>(
  providerKey: string,
  capability: string,
): ProviderResult<T> {
  return fail<T>(
    {
      kind: "unsupported",
      message: `La fonte "${providerKey}" non offre ${capability}.`,
    },
    0,
    false,
  );
}

/** Errore standard per una fonte spenta da configurazione. */
export function disabledResult<T>(providerKey: string): ProviderResult<T> {
  return fail<T>(
    {
      kind: "disabled",
      message: `La fonte "${providerKey}" è disattivata da configurazione.`,
    },
    0,
    false,
  );
}

/* ------------------------------------------------------------------ */
/* Traduzione verso l'osservabilità                                    */
/* ------------------------------------------------------------------ */

/**
 * Traduce un esito nel vocabolario di `source_health`.
 * Un solo punto di verità: nessun adapter decide da sé come chiamare
 * il proprio stato.
 */
export function outcomeOf<T>(
  result: ProviderResult<T>,
): "ok" | "partial" | "error" | "disabled" {
  if (result.ok) return result.partial ? "partial" : "ok";
  return result.error.kind === "disabled" ? "disabled" : "error";
}

/** Descrizione leggibile di un esito, per log e diagnostica. */
export function describeResult<T>(result: ProviderResult<T>): string {
  if (result.ok && !result.partial) {
    return `completo in ${result.latencyMs}ms`;
  }
  if (result.ok) {
    return `PARZIALE in ${result.latencyMs}ms — mancano: ${result.missing.join("; ")}`;
  }
  return `ERRORE ${result.error.kind} in ${result.latencyMs}ms — ${result.error.message}`;
}
