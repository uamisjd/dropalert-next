/**
 * Dettaglio di una partita monitorata.
 *
 * Mostra solo ciò che è registrato: le rilevazioni raccolte, i segnali che ne
 * sono derivati, la loro storia e le lacune dichiarate. Dove il monitor non ha
 * guardato, la pagina lo dice; dove ha guardato poco, dichiara da quanto sta
 * osservando invece di far sembrare profonda una serie di quattro punti.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import {
  getMatchDetail,
  type DetailSignal,
  type MarketSeries,
} from "@/lib/repo/match-detail";
import {
  FreshnessBadge,
  MagnitudeBadge,
  MetaPill,
  SignalLevelBadge,
} from "@/components/Badges";
import { OddsChart } from "@/components/OddsChart";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { Context360 } from "@/components/Context360";
import { NewsBlock } from "@/components/NewsBlock";
import { getNewsForMatch } from "@/lib/repo/news";
import { getContextForMatch } from "@/lib/repo/context";
import { DATA_REVALIDATE_SECONDS, cachedRead } from "@/lib/repo/cached";
import { getSharpLine } from "@/lib/repo/sharp";
import { sportKeyFor } from "@/lib/providers/optional/sport-keys";
import { isLowInformationCompetition } from "@/lib/context/pure";
import { SharpLineBlock } from "@/components/SharpLineBlock";
import { SignalTimeline } from "@/components/SignalTimeline";
import { MatchSummary } from "@/components/MatchSummary";
import { MatchQuantPanel } from "@/components/MatchQuantPanel";
import { normalizedReachabilityScore } from "@/lib/repo/score-view";
import {
  ND,
  fmtAgo,
  fmtDateTime,
  fmtDay,
  fmtMinutes,
  fmtPct,
  fmtPp,
  fmtPrice,
  fmtTime,
} from "@/components/format";

/* ISR: il dettaglio partita si rigenera al massimo ogni 5 minuti.
   Il collector scrive su GitHub Actions e non dipende dal render, quindi una
   pagina servita dalla cache di bordo non blocca né ritarda la raccolta. La
   freschezza del dato resta dichiarata in pagina dal pannello «Stato dati». */
export const revalidate = 300;

/**
 * Anteprima social della singola partita (FIX-2).
 *
 * Titolo e descrizione dicono la stessa cosa della pagina: chi gioca, dove, e
 * come si è mosso il mercato. Se il movimento non è misurabile la descrizione
 * lo omette invece di inventarlo, e resta la sola presentazione della partita.
 * Il canonical punta all'indirizzo del match, non alla home.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const matchId = Number.parseInt(id, 10);
  if (!Number.isInteger(matchId) || matchId <= 0) return {};

  const detail = await getMatchDetail(matchId, new Date()).catch(() => null);
  if (detail === null) return {};

  const m = detail.match;
  const lead = detail.signals[0] ?? null;
  const serie = lead
    ? (detail.series.find(
        (x) => x.market === lead.market && x.selection === lead.selection,
      ) ?? null)
    : null;

  /* Titolo social: chi gioca e QUANTO si è mossa la quota, perché è
     l'informazione che distingue un link dall'altro. Senza movimento
     misurabile resta la sola presentazione: nessun numero inventato. */
  const partita = `${m.homeTeam} – ${m.awayTeam}`;
  let sintesiMovimento = "";
  if (
    lead !== null &&
    serie?.opening !== null &&
    serie?.opening !== undefined &&
    serie?.current !== null &&
    serie?.current !== undefined &&
    serie.opening > 0
  ) {
    const variazione = (serie.current / serie.opening - 1) * 100;
    const segno = variazione < 0 ? "−" : "+";
    const ore =
      lead.sustainedMinutes > 0
        ? ` in ${Math.max(1, Math.round(lead.sustainedMinutes / 60))}h`
        : "";
    sintesiMovimento = `: quota ${serie.current.toFixed(2)} ${segno}${Math.abs(variazione).toFixed(0)}%${ore}`;
  }
  const titolo = `${partita}${sintesiMovimento} | DropAlert`;

  const pezzi: string[] = [];
  if (
    lead !== null &&
    serie?.opening !== null &&
    serie?.opening !== undefined &&
    serie?.current !== null &&
    serie?.current !== undefined
  ) {
    const verso = serie.current < serie.opening ? "è scesa" : "è salita";
    const pp =
      serie.shiftPp !== null && serie.shiftPp !== undefined
        ? ` (${serie.shiftPp > 0 ? "+" : "−"}${Math.abs(serie.shiftPp).toFixed(2)} pp)`
        : "";
    pezzi.push(
      `La quota di ${lead.selectionLabel.toLowerCase()} ${verso} da ${serie.opening.toFixed(2)} a ${serie.current.toFixed(2)}${pp}.`,
    );
  }
  if (m.league !== null && m.league.trim() !== "") {
    pezzi.push(`Competizione: ${m.league}.`);
  }
  pezzi.push(
    "Terminale quantitativo per scommesse: nessuna vincita garantita.",
  );

  const url = `${SITE_URL}/matches/${matchId}`;
  const descrizione = pezzi.join(" ");

  return {
    title: titolo,
    description: descrizione,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      locale: "it_IT",
      siteName: SITE_NAME,
      title: titolo,
      description: descrizione,
      url,
      images: [
        {
          url: `${SITE_URL}/og-cover.png`,
          width: 1200,
          height: 630,
          alt: "DropAlert — osservatorio sui movimenti delle quote",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      images: [`${SITE_URL}/og-cover.png`],
      title: titolo,
      description: descrizione,
    },
  };
}

/* ------------------------------------------------------------------ */

function Metric({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] leading-tight text-slate-500" title={hint}>
        {label}
      </div>
      <div
        className={`tabular-nums ${
          emphasis
            ? "text-lg font-semibold text-slate-900"
            : "text-base text-slate-800"
        } ${value === ND ? "text-slate-400" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

/** Blocco di una singola serie: grafico + numeri che ne derivano. */
function SeriesBlock({
  series,
  featured = false,
}: {
  series: MarketSeries;
  featured?: boolean;
}) {
  const hasDistinctPeak =
    series.peak !== null &&
    series.opening !== null &&
    Math.abs(series.peak - series.opening) > 0.0005;

  return (
    <section
      className={`border border-slate-200 bg-white ${
        featured ? "rounded-2xl p-5 shadow-sm sm:p-6" : "rounded-xl p-4"
      }`}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          {series.marketLabel} · {series.selectionLabel}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {series.hasSignal && (
            <MetaPill title="Su questa selezione esiste un segnale registrato.">
              segnale registrato
            </MetaPill>
          )}
          <MetaPill
            title={
              series.isSharp
                ? "Bookmaker classificato come linea sharp."
                : "Linea di consenso: media dei bookmaker pubblicata dalla fonte, non una quota singola."
            }
          >
            {series.bookmakerName}
          </MetaPill>
        </div>
      </header>

      <OddsChart series={series} />

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric
          label="Apertura"
          value={fmtPrice(series.opening)}
          hint="Prima quota osservata dal monitor, non la quota di apertura del bookmaker."
        />
        <Metric
          label="Estremo osservato"
          value={hasDistinctPeak ? fmtPrice(series.peak) : "—"}
          hint={
            hasDistinctPeak
              ? "Quota più lontana dall'apertura nella direzione del movimento. Non è necessariamente il valore massimo."
              : "Nessun estremo distinto dall'apertura fra le rilevazioni disponibili."
          }
        />
        <Metric
          label="Corrente"
          value={fmtPrice(series.current)}
          hint="Ultima quota rilevata."
          emphasis
        />
        <Metric
          label="Variazione quota"
          value={fmtPct(series.dropPct)}
          hint="Differenza percentuale fra la prima e l'ultima rilevazione."
        />
        <Metric
          label="Spostamento probabilità"
          value={fmtPp(series.shiftPp)}
          hint="Spostamento della probabilità implicita (1/quota), in punti percentuali."
        />
        <Metric
          label="Finestra osservata"
          value={fmtMinutes(series.spanMinutes)}
          hint="Tempo che separa la prima dall'ultima rilevazione."
        />
      </div>

      {/* profondità dichiarata: mai fingere una storia che non c'è */}
      <p
        className={`mt-3 rounded border px-3 py-2 text-xs leading-relaxed ${
          series.shallow
            ? "border-orange-200 bg-orange-50 text-orange-900"
            : "border-slate-200 bg-slate-50 text-slate-600"
        }`}
      >
        {series.depthNote}
      </p>
    </section>
  );
}

/**
 * Scheda progressiva del segnale: la sintesi resta visibile, mentre formula,
 * audit trail e note del motore sono disponibili senza occupare tutta la
 * pagina al primo sguardo.
 */
function SignalPanel({ signal, now }: { signal: DetailSignal; now: Date }) {
  const score = normalizedReachabilityScore(
    signal.reachability,
    signal.confidenceScore,
  );
  const observable =
    signal.reachability.totalMax > 0
      ? Math.round(
          (signal.reachability.measurableMax / signal.reachability.totalMax) *
            100,
        )
      : null;
  const coverage =
    signal.dataCoverage === null ? null : Math.round(signal.dataCoverage * 100);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <SignalLevelBadge level={signal.level} label={signal.levelLabel} />
            <MagnitudeBadge label={signal.magnitudeLabel} />
            <MetaPill title="Stato corrente del segnale nel ciclo di vita del motore.">
              {signal.statusLabel}
            </MetaPill>
          </div>
          <h3 className="mt-2 text-base font-semibold text-slate-950">
            {signal.marketLabel} · {signal.selectionLabel}
          </h3>
          {signal.summary ? (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
              {signal.summary}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
            Qualità osservata
          </p>
          <p className="text-2xl font-semibold tabular-nums text-slate-950">
            {score ?? "—"}
            <span className="text-sm font-normal text-slate-400">/100</span>
          </p>
        </div>
      </header>

      <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric
          label="Quota rilevata"
          value={fmtPrice(signal.detectedPrice)}
          hint="Quota congelata al primo rilevamento: è il riferimento per il CLV."
        />
        <Metric
          label="Spostamento"
          value={fmtPp(signal.deltaPp)}
          hint="Spostamento della probabilità implicita registrato dal motore."
        />
        <Metric
          label="Tenuta"
          value={fmtMinutes(signal.sustainedMinutes)}
          hint="Durata per cui il nuovo livello si è mantenuto."
        />
        <Metric
          label="Confronto bookmaker"
          value={
            signal.booksTotal <= 1
              ? "Non misurabile"
              : `${signal.booksConfirming}/${signal.booksTotal}`
          }
          hint={
            signal.booksTotal <= 1
              ? "La fonte espone una sola linea di consenso, non le quote dei singoli operatori."
              : "Bookmaker che si muovono nella stessa direzione sul totale osservato."
          }
        />
      </dl>

      <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-3">
        <div>
          <span className="block text-slate-500">Base verificabile</span>
          <strong className="mt-0.5 block tabular-nums text-slate-900">
            {observable === null ? "—" : `${observable}%`}
          </strong>
        </div>
        <div>
          <span className="block text-slate-500">Copertura dello storico</span>
          <strong className="mt-0.5 block tabular-nums text-slate-900">
            {coverage === null ? "—" : `${coverage}%`}
          </strong>
        </div>
        <div>
          <span className="block text-slate-500">Linea indipendente</span>
          <strong className="mt-0.5 block text-slate-900">
            {!signal.sharpAvailable || signal.sharpConfirms === null
              ? "Non osservabile"
              : signal.sharpConfirms
                ? "Conferma"
                : "Non conferma"}
          </strong>
        </div>
      </div>

      {signal.suspicion !== null ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          <strong>Possibile iper-reazione storica.</strong> Il motore applica un
          moltiplicatore {signal.suspicion.multiplier}; è un&apos;ipotesi da
          validare, non un giudizio sull&apos;esito.
        </p>
      ) : null}

      <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
        <details className="py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-800 hover:text-slate-950">
            Come è calcolata la qualità dell&apos;osservazione
          </summary>
          <div className="mt-3">
            <ScoreBreakdown signal={signal} />
          </div>
        </details>
        <details className="py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-800 hover:text-slate-950">
            Storia del segnale ({signal.timeline.length} eventi)
          </summary>
          <div className="mt-3">
            <SignalTimeline signal={signal} />
          </div>
        </details>
        <details className="py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-800 hover:text-slate-950">
            Tracciabilità tecnica
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Motore <span className="font-mono">{signal.engineVersion}</span> ·
            rilevato {fmtDateTime(signal.detectedAt)} · ultimo ricalcolo{" "}
            {fmtAgo(signal.updatedAt, now)}.
          </p>
        </details>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */

const BANNER_STYLES: Record<string, string> = {
  live: "border-emerald-300 bg-emerald-50 text-emerald-900",
  stale: "border-amber-300 bg-amber-50 text-amber-900",
  partial: "border-orange-300 bg-orange-50 text-orange-900",
};

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const matchId = Number.parseInt(id, 10);
  if (!Number.isInteger(matchId) || matchId <= 0) notFound();

  const now = new Date();
  /* stessa logica della home: la pagina è dinamica per via del parametro,
     quindi si conserva la lettura invece della pagina */
  const bucket = Math.floor(now.getTime() / (DATA_REVALIDATE_SECONDS * 1000));
  /* il dettaglio può mancare per due motivi diversi: partita inesistente
     (404, vedi sotto) oppure registro non leggibile (errore dichiarato in
     pagina, mai un 500 con stack trace). Le due strade restano separate. */
  let detail: Awaited<ReturnType<typeof getMatchDetail>>;
  try {
    detail = await cachedRead(
      (id: number, at: number) => getMatchDetail(id, new Date(at)),
      ["match-detail", String(matchId), String(bucket)],
      ["match-detail"],
    )(matchId, bucket * DATA_REVALIDATE_SECONDS * 1000);
  } catch (error) {
    console.error(
      `[matches/${matchId}] dettaglio non leggibile:`,
      error instanceof Error ? error.message : error,
    );
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:py-8">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-950"
        >
          <span aria-hidden>←</span> Tutti i movimenti
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Partita <span className="tabular-nums">{matchId}</span>
        </h1>
        <div className="mt-4 rounded-lg border border-orange-300 bg-orange-50 p-4 text-sm text-orange-900">
          <p className="font-medium">DATI NON LEGGIBILI</p>
          <p className="mt-1 text-xs leading-relaxed">
            Il dettaglio di questa partita non è leggibile in questo momento:
            il registro non risponde. Nessun valore viene mostrato al suo
            posto e nessun esito viene ipotizzato. Riprova più tardi.
          </p>
        </div>
      </main>
    );
  }
  if (!detail) notFound();

  /* Un solo sistema di contesto e un solo sistema di notizie. La vecchia
     analisi speculativa non viene più generata all'apertura della pagina: una
     causa senza riscontri pubblici non deve diventare una sezione autorevole. */
  const [context, matchNews] = await Promise.all([
    getContextForMatch(matchId, now).catch(() => null),
    getNewsForMatch(
      matchId,
      detail.match.homeTeam,
      detail.match.awayTeam,
      now,
    ).catch((): Awaited<ReturnType<typeof getNewsForMatch>> => ({
      state: "irraggiungibile",
      itemsCount: 0,
      language: null,
      updatedAt: null,
      items: [],
    })),
  ]);

  /* profilo del movimento per la lettura: solo misure già a registro,
     prese dal segnale più forte della partita */
  const lead = detail.signals[0] ?? null;
  const leadSeries = lead
    ? (detail.series.find(
        (x) => x.market === lead.market && x.selection === lead.selection,
      ) ?? null)
    : null;
  const profile = lead
    ? {
        hoursToKickoff:
          (new Date(detail.match.kickoffAt).getTime() -
            new Date(lead.firstMoveAt).getTime()) /
          3_600_000,
        sustainedMinutes: lead.sustainedMinutes,
        isFlash: lead.isFlash,
        rebounded: lead.rebounded,
        booksConfirming: lead.booksConfirming,
        booksTotal: lead.booksTotal,
        falling:
          leadSeries?.opening !== null &&
          leadSeries?.opening !== undefined &&
          leadSeries?.current !== null &&
          leadSeries?.current !== undefined
            ? leadSeries.current < leadSeries.opening
            : null,
        magnitudeClass: lead.magnitudeClass,
      }
    : undefined;

  /* competizioni a bassa copertura informativa (femminili, minori): lo si
     dichiara in testa al blocco, così i campi «non noto» non sembrano un
     guasto. È una dichiarazione, mai un dato inventato. */
  const lowInformation = isLowInformationCompetition(detail.match.league);

  /* Linea sharp (The Odds API): solo segnali attivi, solo competizioni
     coperte, una lettura al giorno per partita e budget con hard-stop.
     Se una qualunque di queste condizioni non regge, non parte richiesta. */
  const sharp =
    lead !== null
      ? await getSharpLine(
          {
            matchId,
            sportKey: sportKeyFor(detail.match.league),
            homeTeam: detail.match.homeTeam,
            awayTeam: detail.match.awayTeam,
            selection: lead.selection,
            consensusOpening: leadSeries?.opening ?? null,
            consensusCurrent: leadSeries?.current ?? null,
            signalActive: lead.status === "active",
          },
          now,
        ).catch(() => null)
      : null;

  const { match } = detail;
  const hasResult = match.homeGoals !== null && match.awayGoals !== null;
  const primarySeries = leadSeries ?? detail.series[0] ?? null;
  const secondarySeries = primarySeries
    ? detail.series.filter((series) => series !== primarySeries)
    : [];

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:py-8">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-950"
      >
        <span aria-hidden>←</span> Tutti i movimenti
      </Link>

      <header className="relative overflow-hidden rounded-2xl bg-slate-950 px-5 py-6 text-white shadow-sm sm:px-7 sm:py-8">
        <div
          aria-hidden
          className="absolute -top-20 -right-16 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl"
        />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tracking-[0.16em] text-cyan-300 uppercase">
              {match.league ?? "Competizione non attribuita"}
            </span>
            {match.country ? (
              <span className="text-xs text-slate-400">· {match.country}</span>
            ) : null}
            <span className="ml-auto flex flex-wrap gap-1.5">
              <FreshnessBadge
                level={detail.freshness}
                label={detail.freshnessLabel}
                reason={detail.freshnessReason}
              />
              <MetaPill title="Stato della partita secondo l'ultima rilevazione della fonte.">
                {match.statusLabel}
              </MetaPill>
            </span>
          </div>

          <h1 className="mt-5 max-w-4xl text-2xl leading-tight font-semibold tracking-tight sm:text-4xl">
            {match.homeTeam}{" "}
            <span className="font-normal text-slate-500">–</span>{" "}
            {match.awayTeam}
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            {fmtDay(match.kickoffAt)} · ore {fmtTime(match.kickoffAt)}
          </p>

          {hasResult ? (
            <p className="mt-4 inline-flex rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-semibold tabular-nums">
              Risultato finale {match.homeGoals}–{match.awayGoals}
            </p>
          ) : null}
          {match.isDemo ? (
            <p className="mt-3 text-xs font-medium text-amber-300">
              Fixture di test: non è un dato reale.
            </p>
          ) : null}

          <p className="mt-5 max-w-2xl border-t border-white/10 pt-4 text-xs leading-relaxed text-slate-400">
            Osserviamo il mercato per informare le tue giocate, non per
            prevedere il risultato: nessuna vincita è garantita.
          </p>
        </div>
      </header>

      <div className="mt-5">
        <MatchSummary signal={lead} series={leadSeries} />
      </div>

      <nav
        aria-label="Sezioni della partita"
        className="mt-5 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm"
      >
        {[
          ["#movimento", "Movimento"],
          ["#quant-alpha", "Quant & Value (+EV)"],
          ["#contesto", "Contesto"],
          ["#affidabilita", "Affidabilità"],
          ["#dati", "Qualità dati"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* Sezione Quantitativa & Alpha */}
      <MatchQuantPanel
        signal={lead}
        series={leadSeries}
        allSeries={detail.series}
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
      />

      <section
        id="movimento"
        aria-labelledby="titolo-movimento"
        className="scroll-mt-20 pt-10"
      >
        <div className="mb-4">
          <p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase">
            Dati osservati
          </p>
          <h2
            id="titolo-movimento"
            className="mt-1 text-xl font-semibold tracking-tight text-slate-950"
          >
            Andamento della quota
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Ogni punto è una rilevazione registrata; i tratti servono soltanto a
            collegare un&apos;osservazione alla successiva.
          </p>
        </div>

        {primarySeries === null ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-sm leading-relaxed text-slate-600">
            Nessuna rilevazione utilizzabile per questa partita. Non viene
            ricostruita una serie al posto dei dati mancanti.
          </p>
        ) : (
          <SeriesBlock series={primarySeries} featured />
        )}

        {secondarySeries.length > 0 ? (
          <details className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <summary className="cursor-pointer text-sm font-medium text-slate-800 hover:text-slate-950">
              Altre quote della partita ({secondarySeries.length})
            </summary>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Serie dello stesso mercato che non rappresentano il movimento
              principale mostrato nella sintesi.
            </p>
            <div className="mt-4 space-y-3">
              {secondarySeries.map((series) => (
                <SeriesBlock
                  key={`${series.market}-${series.selection}-${series.bookmakerKey}`}
                  series={series}
                />
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section
        id="contesto"
        aria-labelledby="titolo-contesto"
        className="scroll-mt-20 pt-10"
      >
        <div className="mb-4">
          <p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase">
            Possibili spiegazioni
          </p>
          <h2
            id="titolo-contesto"
            className="mt-1 text-xl font-semibold tracking-tight text-slate-950"
          >
            Contesto e riscontri
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Le fonti pubbliche aiutano a leggere il movimento, ma non lo
            trasformano in una garanzia. Le ipotesi non verificate restano
            separate dai fatti.
          </p>
        </div>

        <Context360
          context={context}
          now={now}
          profile={profile}
          lowInformation={lowInformation}
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {sharp !== null ? <SharpLineBlock view={sharp} /> : null}
          <NewsBlock news={matchNews} />
        </div>
      </section>

      <section
        id="affidabilita"
        aria-labelledby="titolo-affidabilita"
        className="scroll-mt-20 pt-10"
      >
        <div className="mb-4">
          <p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase">
            Metodo
          </p>
          <h2
            id="titolo-affidabilita"
            className="mt-1 text-xl font-semibold tracking-tight text-slate-950"
          >
            Affidabilità del movimento
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            La sintesi è subito leggibile; formula, componenti e storia completa
            sono disponibili nei pannelli di approfondimento.
          </p>
        </div>

        {detail.signals.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-sm leading-relaxed text-slate-600">
            Nessun movimento ha superato la soglia di rumore di 2 punti
            percentuali di probabilità implicita.
          </p>
        ) : (
          <div className="space-y-4">
            {detail.signals.map((signal) => (
              <SignalPanel key={signal.id} signal={signal} now={now} />
            ))}
          </div>
        )}
      </section>

      <section
        id="dati"
        aria-labelledby="titolo-dati"
        className="scroll-mt-20 pt-10"
      >
        <div className="mb-4">
          <p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase">
            Trasparenza
          </p>
          <h2
            id="titolo-dati"
            className="mt-1 text-xl font-semibold tracking-tight text-slate-950"
          >
            Qualità e limiti dei dati
          </h2>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <p
            className={`rounded-lg border px-3 py-2 text-sm ${BANNER_STYLES[detail.freshness]}`}
          >
            {detail.freshnessReason}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label="Rilevazioni"
              value={String(detail.totalSnapshots)}
              hint="Righe registrate per questa partita."
            />
            <Metric
              label="Serie osservate"
              value={String(detail.series.length)}
              hint="Combinazioni di mercato, esito e fonte con almeno una rilevazione."
            />
            <Metric
              label="Ultima raccolta"
              value={fmtAgo(detail.lastSnapshotAt, now)}
              hint={
                detail.lastSnapshotAt
                  ? fmtDateTime(detail.lastSnapshotAt)
                  : "Nessuna rilevazione."
              }
            />
            <Metric
              label="Limitazioni aperte"
              value={String(detail.openGaps.length)}
              hint="Informazioni mancanti dichiarate a registro."
            />
          </div>

          {detail.openGaps.length > 0 ? (
            <details className="mt-4 border-t border-slate-100 pt-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-800 hover:text-slate-950">
                Vedi le limitazioni dichiarate ({detail.openGaps.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {detail.openGaps.map((gap) => (
                  <li
                    key={gap.id}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-amber-950">
                        {gap.reasonLabel}
                      </span>
                      <span className="text-[11px] tabular-nums text-amber-800">
                        dal {fmtDateTime(gap.observedFrom)}
                      </span>
                    </div>
                    {gap.detail ? (
                      <p className="mt-1 text-xs leading-relaxed text-amber-900">
                        {gap.detail}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Nessuna limitazione aperta a registro.
              {detail.resolvedGaps > 0
                ? ` ${detail.resolvedGaps} ${detail.resolvedGaps === 1 ? "limitazione risolta" : "limitazioni risolte"} in precedenza.`
                : ""}
            </p>
          )}
        </div>
      </section>

      <footer className="mt-10 border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-500">
        <p>
          Pagina aggiornata il {fmtDateTime(detail.generatedAt)} (ora italiana)
          · identificativo partita{" "}
          <span className="tabular-nums">{match.key}</span>.
        </p>
      </footer>
    </main>
  );
}
