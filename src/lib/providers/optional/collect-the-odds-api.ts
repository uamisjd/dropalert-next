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
}

export interface CollectTheOddsApiResult {
  result: ProviderResult<OddsQuoteDTO[]>;
  persistence: ProviderSnapshotWriteReport | null;
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
    return { result, persistence: null };
  }

  const persistence = await writeProviderSnapshots(
    params.matchId,
    result.data,
    params.runId ?? null,
    THE_ODDS_API_SNAPSHOT_SOURCE,
  );
  return { result, persistence };
}
