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
import { getCalendar } from "@/lib/repo/calendar";
import { withoutTracked } from "@/lib/calendar/football-data";
import { UpcomingFixtures } from "@/components/UpcomingFixtures";
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
  groupByDay,
  matchesTimeChip,
  parseTimeChip,
  recentMovements,
  romeDayDiff,
} from "@/lib/view/timeline";

/* ISR: la dashboard si rigenera al massimo ogni 5 minuti.
   Il collector scrive su GitHub Actions e non dipende dal render, quindi una
   pagina servita dalla cache di bordo non blocca né ritarda la raccolta. La
   freschezza del dato resta dichiarata in pagina dal pannello «Stato dati». */
export const revalidate = 300;

/* titolo e descrizione arrivano dal layout; qui canonical + regola sui filtri.
   La home legge i filtri dalla query string (?level=, ?league=, ?when= …):
   quelle varianti sono fette duplicate della stessa lista, quindi non si
   indicizzano (ma si seguono i link). Solo la home pulita resta indicizzata. */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<import("next").Metadata> {
  const sp = await searchParams;
  const filtered = ["level", "league", "team", "sort", "when"].some(
    (k) => sp[k] !== undefined,
  );
  return {
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
    alternates: { canonical: "/" },
  };
}

const VALID_LEVELS: SignalLevel[] = ["forte", "reale", "debole", "nessuno"];

function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): DashboardFilters {
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

  /* calendario di oggi: radar delle partite senza quote, mai una giocata */
  const calendario = await getCalendar(0, now).catch(() => null);
  const inArrivoOggi =
    calendario === null
      ? []
      : withoutTracked(calendario.fixtures, data.signals).filter(
          (f) => romeDayDiff(now, f.kickoffAt) === 0,
        );

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
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-5">
      <header className="relative mb-5 overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-lg sm:px-8 sm:py-10">
        <div
          aria-hidden
          className="absolute -top-24 -right-20 h-72 w-72 rounded-full bg-cyan-400/15 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-20 -left-16 h-60 w-60 rounded-full bg-emerald-500/10 blur-3xl"
        />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300 uppercase">
              Quantitative Betting & Trading Terminal
            </p>
          </div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-5xl">
            Intelligence Quantitativa sul Calcio.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Monitoraggio dei flussi di mercato in tempo reale: apertura, picco e ultima
            lettura di ogni quota, {" "}
            <strong className="text-emerald-400">divario contro la linea senza margine</strong>{" "}
            (no-vig proporzionale, lo stesso della chiusura usata per il CLV) e{" "}
            <strong>escursione in tick</strong> dei movimenti. Sono misure, con i loro buchi
            dichiarati, per informare le tue giocate: nessuna vincita garantita,
            gioca responsabilmente.
          </p>

          <nav
            aria-label="Accesso rapido ai moduli terminale"
            className="mt-6 flex flex-wrap gap-2 text-xs"
          >
            <Link
              href="/value-bets"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 font-bold text-slate-950 shadow-sm transition-colors hover:bg-emerald-400"
            >
              <span>💎</span>
              <span>Divario di prezzo (no-vig)</span>
            </Link>
            <Link
              href="/trading"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 font-semibold text-white transition-colors hover:bg-white/20"
            >
              <span>⚡</span>
              <span>Escursione &amp; Green-Up</span>
            </Link>
            <Link
              href="/surebet"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 font-semibold text-white transition-colors hover:bg-white/20"
            >
              <span>⚖️</span>
              <span>Surebet &amp; Dutching (calcolo)</span>
            </Link>
            <Link
              href="/simulator"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 px-3.5 py-2 font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span>📊</span>
              <span>Simulatore xG</span>
            </Link>
          </nav>
        </div>
      </header>

      <div className="mb-5">
        <GuideBanner />
      </div>

      <div className="mb-5">
        <RecentStrip signals={recent} now={now} />
      </div>

      {/* ciò che sta arrivando: partite in calendario ancora senza quote */}
      {inArrivoOggi.length > 0 ? (
        <div className="mb-5">
          <UpcomingFixtures
            fixtures={inArrivoOggi}
            now={now}
            title="Oggi — quote in arrivo"
          />
        </div>
      ) : null}

      <section aria-labelledby="movimenti" className="mt-7">
        <p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase">
          Monitor live
        </p>
        <h2
          id="movimenti"
          className="mt-1 mb-3 text-xl font-semibold tracking-tight text-slate-950"
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

      <details className="mt-7 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-medium text-slate-800 hover:text-slate-950">
          Stato e copertura del monitor
        </summary>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Informazioni tecniche sulla raccolta: utili per verificare la qualità
          del dato, ma secondarie rispetto ai movimenti.
        </p>
        <div className="mt-4 space-y-4">
          <StatusPanel
            status={data.status}
            now={now}
            sharpBudget={sharpBudget}
            withSignals={
              groupByMatch(
                data.signals.filter(
                  (signal) => romeDayDiff(now, signal.kickoffAt) === 0,
                ),
              ).length
            }
          />
          {coverage !== null ? <CoverageSummary view={coverage} /> : null}
        </div>
      </details>

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
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Link
            href="/metodologia"
            className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            Leggi la metodologia →
          </Link>
          <Link
            href="/performance"
            className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            Evoluzione del CLV nel tempo →
          </Link>
        </p>
      </section>

      <footer className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
        <p className="mb-2 font-medium text-slate-700">
          DropAlert è un terminale quantitativo per scommettitori.
        </p>
        <p className="mb-2">
          I movimenti di quota descrivono il comportamento del mercato, non la
          probabilità reale che un evento accada. Un drop non implica alcun
          vantaggio garantito: la sola metrica di qualità applicata è il CLV,
          che confronta il segnale con la quota di chiusura e non con
          l&apos;esito della partita. Usa queste misure per informare le tue
          giocate, mai come promesse di vincita.
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
