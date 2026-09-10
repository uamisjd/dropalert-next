import { createTheOddsApiProvider } from "./the-odds-api";
import { writeProviderSnapshots, type ProviderSnapshotWriteReport } from "../ingest-snapshots";
import type { ProviderResult, OddsQuoteDTO } from "../types";

export const THE_ODDS_API_SNAPSHOT_SOURCE = "the-odds-api";

export interface CollectTheOddsApiParams {
  matchId: number;
  fixtureKey: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  runId?: number | null;
  /**
   * Sorgente scritta su `odds_snapshots`. Default: la sorgente di produzione
   * dell'adapter. Lo smoke test la cambia (`the-odds-api-wire-smoke`) per non
   * mescolare una verifica ai dati reali, come già fa `smoke:odds-api`.
   */
  source?: string;
}

export interface CollectTheOddsApiResult {
  result: ProviderResult<OddsQuoteDTO[]>;
  persistence: ProviderSnapshotWriteReport | null;
  /**
   * Errore di persistenza, quando la lettura è riuscita ma la scrittura in
   * `odds_snapshots` è fallita. La lettura è un fatto avvenuto (il credito
   * è stato addebitato dalla fonte) e va contato comunque: separare la
   * scrittura dalla lettura evita di perdere la contabilità del budget
   * quando il database è momentaneamente non raggiungibile.
   */
  persistenceError: string | null;
}

/**
 * Confine esplicito adapter → persistenza.
 *
 * È intenzionalmente separato dal collector BetExplorer: finché l'adapter
 * non supera lo smoke test live non entra nel ciclo principale e non consuma
 * crediti. Quando sarà attivato, questo è il solo percorso autorizzato a
 * trasformare la risposta per-bookmaker in `odds_snapshots`.
 */
export async function collectAndPersistTheOddsApiOdds(
  params: CollectTheOddsApiParams,
): Promise<CollectTheOddsApiResult> {
  const provider = createTheOddsApiProvider();
  const result = await provider.fetchOdds({
    key: params.fixtureKey,
    providerMatchId: null,
    sourceUrl: null,
    kickoffAt: params.kickoffAt,
    sportKey: params.sportKey,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
  });

  if (!result.ok || result.data.length === 0) {
    return { result, persistence: null, persistenceError: null };
  }

  try {
    const persistence = await writeProviderSnapshots(
      params.matchId,
      result.data,
      params.runId ?? null,
      params.source ?? THE_ODDS_API_SNAPSHOT_SOURCE,
    );
    return { result, persistence, persistenceError: null };
  } catch (err) {
    return {
      result,
      persistence: null,
      persistenceError: err instanceof Error ? err.message : String(err),
    };
  }
}
