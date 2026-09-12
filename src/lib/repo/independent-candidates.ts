import { sql } from "@/db/client";
import { evaluateIndependentCandidate, type CandidateSnapshot, type Outcome, type ExecutionConfirmation } from "@/lib/decision/independent-candidate";
import { THE_ODDS_API_SNAPSHOT_SOURCE } from "@/lib/providers/snapshot-sources";

/** Confine DB in transazione READ ONLY: nessuna raccolta e nessuna spesa. */
export async function readIndependentCandidate(input: {
  matchId: number; bookmaker: string; selection: Outcome;
  execution?: ExecutionConfirmation | null;
}, now = new Date()) {
  if (!Number.isSafeInteger(input.matchId) || input.matchId <= 0 || input.matchId > 2147483647 ||
      !/^[a-z0-9_-]{1,80}$/.test(input.bookmaker) || !["home", "draw", "away"].includes(input.selection) || !Number.isFinite(now.getTime())) throw new Error("Parametri scanner non validi");
  return sql.begin("isolation level repeatable read read only", async tx => {
    const [match] = await tx`select id, key, status, kickoff_at from matches where id = ${input.matchId}`;
    if (!match) throw new Error("Partita non presente in archivio");
    const [signal] = await tx`select confidence_score from drop_signals where match_id = ${input.matchId}
      and market = '1x2' and selection = ${input.selection} and status = 'active'
      order by confidence_score desc limit 1`;
    // Non filtrare is_stale prima del raggruppamento: nascondere l'ultima
    // linea incompleta/stale farebbe riemergere un prezzo vecchio.
    const rows = await tx`select s.match_id, s.market, s.selection, b.key as bookmaker,
      s.source, s.collected_at, s.price, s.is_stale, s.timestamp_origin from odds_snapshots s
      join bookmakers b on b.id = s.bookmaker_id
      where s.match_id = ${input.matchId} and s.market = '1x2'
      and b.key in (${input.bookmaker}, 'pinnacle') and s.source = ${THE_ODDS_API_SNAPSHOT_SOURCE}
      and s.collected_at >= ${new Date(now.getTime() - 30 * 60_000).toISOString()}
      order by s.collected_at desc, s.id desc limit 5001`;
    if (rows.length > 5000) throw new Error("Troppe letture: analisi interrotta, nessun campione troncato");
    const snapshots: CandidateSnapshot[] = rows.map(r => ({ matchId: r.match_id, market: r.market,
      selection: r.selection, bookmaker: r.bookmaker, source: r.source,
      at: new Date(r.collected_at), price: Number(r.price), isStale: r.is_stale,
      // Solo provenienza esplicita; storico e fallback non vengono promossi.
      providerTimestampVerified: r.timestamp_origin === "provider_market" || r.timestamp_origin === "provider_bookmaker" }));
    return {
      matchId: input.matchId, selection: input.selection, generatedAt: now,
      snapshotsRead: snapshots.length, policyVersion: "independent-1x2-research-v1",
      result: evaluateIndependentCandidate({ matchId: input.matchId, matchKey: match.key,
        matchStatus: match.status, kickoffAt: new Date(match.kickoff_at),
        selection: input.selection, targetBookmaker: input.bookmaker,
        confidenceScore: signal ? Number(signal.confidence_score) : 0,
        now, snapshots, execution: input.execution ?? null }),
    };
  });
}
