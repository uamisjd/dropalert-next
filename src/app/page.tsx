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
import { getSharpBudget } from "@/lib/repo/sharp";
import { DATA_REVALIDATE_SECONDS, cachedRead } from "@/lib/repo/cached";
import { buildCoverageView, type CoverageView } from "@/lib/cov/view";
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
import { groupByMatch, matchIdentityKey } from "@/lib/view/plain";
import {
  chipCounts,
  dayBucketOf,
  groupByDay,
  matchesTimeChip,
  parseTimeChip,
  recentMovements,
} from "@/lib/view/timeline";

/* ISR: la dashboard si rigenera al massimo ogni 5 minuti.
   Il collector scrive su GitHub Actions e non dipende dal render, quindi una
   pagina servita dalla cache di bordo non blocca né ritarda la raccolta. La
   freschezza del dato resta dichiarata in pagina dal pannello «Stato dati». */
export const revalidate = 300;

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
  /* La pagina è dinamica (legge i filtri dalla query), quindi la CDN non la
     conserva: la cache sta sulla lettura, con la stessa finestra dell'ISR.
     L'istante è arrotondato al blocco di 5 minuti perché due visite vicine
     condividano la stessa chiave invece di ricalcolare a ogni secondo. */
  const bucket = Math.floor(now.getTime() / (DATA_REVALIDATE_SECONDS * 1000));
  const data = await cachedRead(
    (f: DashboardFilters, at: number) => getDashboardData(f, new Date(at)),
    ["dashboard", JSON.stringify(filters), String(bucket)],
    ["dashboard"],
  )(filters, bucket * DATA_REVALIDATE_SECONDS * 1000);

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
  const recent = recentMovements(
    data.signals,
    now,
    undefined,
    matchIdentityKey,
  ).slice(0, 8);

  /* budget della linea sharp: sola lettura dei contatori, non spende nulla */
  const sharpBudget = await getSharpBudget(now).catch(() => undefined);

  /* la copertura è un'informazione accessoria alla dashboard: se non è
     leggibile si omette il riquadro, senza far cadere la pagina e senza
     mostrare numeri al posto della misura mancante */
  let coverage: CoverageView | null = null;
  try {
    const history = await cachedRead(
      (at: number) => getCoverageHistory(50, new Date(at)),
      ["coverage-history", String(bucket)],
      ["coverage"],
    )(bucket * DATA_REVALIDATE_SECONDS * 1000);
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
        <StatusPanel
          status={data.status}
          now={now}
          sharpBudget={sharpBudget}
          withSignals={
            groupByMatch(
              data.signals.filter((s) => dayBucketOf(s.kickoffAt, now) === "oggi"),
            ).length
          }
        />
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
                    <MatchCard
                      key={s.group.matchId}
                      group={s.group}
                      now={now}
                      entryKey={matchIdentityKey(s.group.primary)}
                    />
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

      {/* le tre verifiche storiche vivono in /metodologia: qui resta il
          rimando, per non ripetere la stessa informazione su due pagine */}
      <section
        aria-labelledby="rimando-metodologia"
        className="mt-5 rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2
          id="rimando-metodologia"
          className="mb-1 text-sm font-semibold tracking-wide text-slate-700 uppercase"
        >
          Come si misura tutto questo
        </h2>
        <p className="text-xs leading-relaxed text-slate-600">
          L&apos;indice di fiducia, il CLV come unica metrica di qualità e le
          tre verifiche storiche (R1 su sette stagioni, R1.5 per segmenti, R2
          sul monitor stesso) sono spiegati per esteso, con i loro campioni e
          con i risultati negativi lasciati dove sono, nella pagina di
          metodologia.
        </p>
        <p className="mt-2 text-xs">
          <Link
            href="/metodologia"
            className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            Leggi la metodologia →
          </Link>
        </p>
      </section>

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
