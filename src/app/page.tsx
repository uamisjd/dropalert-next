/**
 * Dashboard dell'osservatorio.
 *
 * Server component: legge dal database a ogni richiesta e non conserva nulla
 * in cache, perché un dato di quota vecchio è peggio di un dato assente.
 * Ordine della pagina — stato dei dati, poi i movimenti, e solo in fondo la
 * sezione di performance, che non deve mai fare da vetrina.
 */
import { Suspense } from "react";
import Link from "next/link";
import {
  getDashboardData,
  type DashboardFilters,
  type SignalLevel,
} from "@/lib/repo/dashboard";
import { getCoverageHistory } from "@/lib/repo/coverage-history";
import { buildCoverageView, type CoverageView } from "@/lib/cov/view";
import { BacktestNote } from "@/components/BacktestNote";
import { BacktestNoteR15 } from "@/components/BacktestNoteR15";
import { BacktestNoteR2 } from "@/components/BacktestNoteR2";
import { ClvSection } from "@/components/ClvSection";
import { CoverageSummary } from "@/components/CoverageSummary";
import { EmptyState } from "@/components/EmptyState";
import { SignalFilters } from "@/components/SignalFilters";
import { TimeChips } from "@/components/TimeChips";
import { RecentStrip } from "@/components/RecentStrip";
import { StatusPanel } from "@/components/StatusPanel";
import { fmtDateTime } from "@/components/format";
import { GuideBanner } from "@/components/GuideBanner";
import { BadgeLegend } from "@/components/BadgeLegend";
import { MatchCard } from "@/components/MatchCard";
import { groupByMatch } from "@/lib/view/plain";
import {
  chipCounts,
  groupByDay,
  matchesTimeChip,
  parseTimeChip,
  recentMovements,
} from "@/lib/view/timeline";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_LEVELS: SignalLevel[] = ["forte", "reale", "debole", "nessuno"];

function parseFilters(sp: Record<string, string | string[] | undefined>): DashboardFilters {
  const one = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const levels = (one("level") ?? "")
    .split(",")
    .filter((l): l is SignalLevel => VALID_LEVELS.includes(l as SignalLevel));

  const sortRaw = one("sort");
  const sort =
    sortRaw === "drop" || sortRaw === "kickoff" || sortRaw === "score"
      ? sortRaw
      : "score";

  return {
    level: levels.length ? levels : undefined,
    league: one("league") || undefined,
    team: one("team") || undefined,
    sort,
  };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const now = new Date();
  const data = await getDashboardData(filters, now);

  /* Sprint UX-1 — lettura temporale della lista.
     Il filtro per tempo è applicato qui, sopra alla lista già filtrata dai
     criteri di segnale: la chip decide solo cosa è ancora rilevante adesso. */
  const chip = parseTimeChip(Array.isArray(sp.when) ? sp.when[0] : sp.when);
  /* i conteggi delle chip si calcolano UNA volta per partita, non per
     segnale: la lista mostra una card per match, quindi il numero sulla chip
     e il numero di card visibili sono lo stesso numero. */
  const perMatch = groupByMatch(data.signals).map((g) => g.primary);
  const timeCounts = chipCounts(perMatch, now);
  const visible = data.signals.filter((s) =>
    matchesTimeChip(s.kickoffAt, chip, now),
  );
  /* una card per partita: in vista il segnale più forte, gli altri espandibili */
  const visibleMatches = groupByMatch(visible);
  const groups = groupByDay(
    visibleMatches.map((g) => ({ ...g.primary, group: g })),
    now,
  );
  const recent = recentMovements(data.signals, now).slice(0, 8);

  /* la copertura è un'informazione accessoria alla dashboard: se non è
     leggibile si omette il riquadro, senza far cadere la pagina e senza
     mostrare numeri al posto della misura mancante */
  let coverage: CoverageView | null = null;
  try {
    const history = await getCoverageHistory(50, now);
    coverage = buildCoverageView({
      latest: history.latest,
      latestRunId: history.latestRunId,
      latestStartedAt: history.latestStartedAt,
      stats: history.stats,
      depth: history.depth,
      runsWithoutMeasure: history.runsWithoutMeasure,
      scheduler: history.scheduler,
      actions: { lastScheduledRun: history.lastScheduledRun, now },
    });
  } catch {
    coverage = null;
  }

  const hasFilters = Boolean(
    filters.level?.length || filters.league || filters.team,
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          DropAlert
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Osservatorio statistico sui movimenti delle quote nel calcio. Registra
          come si muove il mercato e quanto è affidabile la misura.{" "}
          <span className="font-medium text-slate-800">
            Non fornisce pronostici né consigli di scommessa.
          </span>
        </p>
        {/* scorciatoie alle due letture cronologiche del monitor */}
        <nav
          aria-label="Letture del monitor"
          className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"
        >
          <Link
            href="/ieri"
            className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            Ieri — segnali ed esiti
          </Link>
          <Link
            href="/domani"
            className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            Domani — programma dall&apos;archivio
          </Link>
        </nav>
      </header>

      <div className="mb-5">
        <GuideBanner />
      </div>

      <div className="mb-5">
        <RecentStrip signals={recent} now={now} />
      </div>

      <div className="mb-5">
        <StatusPanel status={data.status} now={now} />
      </div>

      {coverage !== null ? (
        <div className="mb-5">
          <CoverageSummary view={coverage} />
        </div>
      ) : null}

      <section aria-labelledby="movimenti">
        <h2
          id="movimenti"
          className="mb-2 text-sm font-semibold tracking-wide text-slate-900 uppercase"
        >
          Movimenti rilevati
        </h2>

        <div className="mb-3">
          <Suspense
            fallback={
              <div className="text-xs text-slate-500">Caricamento filtri…</div>
            }
          >
            <TimeChips counts={timeCounts} />
          </Suspense>
        </div>

        <div className="mb-3">
          <Suspense
            fallback={
              <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
                Caricamento filtri…
              </div>
            }
          >
            <SignalFilters
              leagues={data.leagues}
              shown={visibleMatches.length}
              total={data.totalSignals}
            />
          </Suspense>
        </div>

        {visibleMatches.length === 0 ? (
          <EmptyState
            status={data.status}
            filtered={
              (hasFilters || data.signals.length > 0) && data.totalSignals > 0
            }
            now={now}
          />
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.key}>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {g.label}{" "}
                  <span className="font-normal text-slate-400">
                    ({g.items.length})
                  </span>
                </h3>
                <div className="space-y-3">
                  {g.items.map((s) => (
                    <MatchCard key={s.group.matchId} group={s.group} now={now} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-5">
        <BadgeLegend />
      </div>

      <div className="mt-6">
        <ClvSection clv={data.clv} />
      </div>

      {/* verifica empirica sui dati storici: stessa zona metodologica del CLV */}
      <div className="mt-5">
        <BacktestNote />
      </div>

      {/* verdetti segmentati del backtest R1.5: accanto al primo blocco,
          stessa disciplina — e il legame con suspicion-v2 dichiarato */}
      <div className="mt-5">
        <BacktestNoteR15 />
      </div>

      {/* validazione live del monitor su sé stesso (R2): CLV negativi
          pubblicati come sono, hit rate dichiarato non-metrica */}
      <div className="mt-5">
        <BacktestNoteR2 />
      </div>

      <footer className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
        <p className="mb-2 font-medium text-slate-700">
          DropAlert è un osservatorio statistico, non un servizio di pronostici.
        </p>
        <p className="mb-2">
          I movimenti di quota descrivono il comportamento del mercato, non la
          probabilità reale che un evento accada. Un drop non è una previsione e
          non implica alcun vantaggio: la sola metrica di qualità applicata è il
          CLV, che confronta il segnale con la quota di chiusura e non con
          l&apos;esito della partita. Nessun contenuto di questo sito
          costituisce un consiglio di scommessa o un invito a giocare.
        </p>
        <p className="mb-2">
          I dati provengono dal polling delle fonti pubbliche configurate e
          possono essere incompleti o non aggiornati. Le informazioni mancanti
          sono sempre dichiarate come tali e non vengono mai sostituite da
          stime, medie o interpolazioni.
        </p>
        <p className="text-slate-400">
          Pagina generata il {fmtDateTime(data.generatedAt)} (ora italiana).
        </p>
      </footer>
    </main>
  );
}
