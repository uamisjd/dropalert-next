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
import { getMatchDetail, type MarketSeries } from "@/lib/repo/match-detail";
import { FreshnessBadge, MagnitudeBadge, MetaPill, SignalLevelBadge } from "@/components/Badges";
import { OddsChart } from "@/components/OddsChart";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { Context360 } from "@/components/Context360";
import { NewsBlock } from "@/components/NewsBlock";
import { getNewsForMatch } from "@/lib/repo/news";
import { getContextForMatch } from "@/lib/repo/context";
import { getDeepAnalysis } from "@/lib/repo/analysis";
import { DATA_REVALIDATE_SECONDS, cachedRead } from "@/lib/repo/cached";
import { getSharpLine } from "@/lib/repo/sharp";
import { sportKeyFor } from "@/lib/providers/optional/sport-keys";
import { SharpLineBlock } from "@/components/SharpLineBlock";
import { DeepAnalysis360 } from "@/components/DeepAnalysis360";
import { fetchTeamNews } from "@/lib/context/rss";
import { SignalTimeline } from "@/components/SignalTimeline";
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
    ? detail.series.find(
        (x) => x.market === lead.market && x.selection === lead.selection,
      ) ?? null
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
    "Osservatorio statistico sui movimenti delle quote: non è un pronostico.",
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
function SeriesBlock({ series }: { series: MarketSeries }) {
  const hasDistinctPeak =
    series.peak !== null &&
    series.opening !== null &&
    Math.abs(series.peak - series.opening) > 0.0005;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
          label="Picco"
          value={hasDistinctPeak ? fmtPrice(series.peak) : "—"}
          hint={
            hasDistinctPeak
              ? "Estremo realmente registrato nella direzione del movimento."
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
  const detail = await cachedRead(
    (id: number, at: number) => getMatchDetail(id, new Date(at)),
    ["match-detail", String(matchId), String(bucket)],
    ["match-detail"],
  )(matchId, bucket * DATA_REVALIDATE_SECONDS * 1000);
  if (!detail) notFound();

  /* Contesto 360°: cache 24h, una sola chiamata al modello per visita a
     cache scaduta, mai un campo inventato. Le notizie RSS, quando ci
     sono, citano la fonte. */
  const [context, news, matchNews] = await Promise.all([
    getContextForMatch(matchId, now).catch(() => null),
    fetchTeamNews(detail.match.homeTeam, detail.match.awayTeam).catch(() => []),
    getNewsForMatch(
      matchId,
      detail.match.homeTeam,
      detail.match.awayTeam,
      now,
    ).catch(
      (): Awaited<ReturnType<typeof getNewsForMatch>> => ({
        state: "irraggiungibile",
        itemsCount: 0,
        language: null,
        updatedAt: null,
        items: [],
      }),
    ),
  ]);

  /* profilo del movimento per la lettura: solo misure già a registro,
     prese dal segnale più forte della partita */
  const lead = detail.signals[0] ?? null;
  const leadSeries = lead
    ? detail.series.find(
        (x) => x.market === lead.market && x.selection === lead.selection,
      ) ?? null
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

  /* Analisi 360° completa: on-demand alla prima apertura, sui fatti GIÀ
     recuperati (campi di contesto con fonte, documenti, profilo del
     movimento). Nessuna ricerca nuova, nessun budget speso su partite mai
     aperte; cache 24h. Se qualcosa va storto, la sezione lo dichiara. */
  const analysis =
    profile !== undefined
      ? await getDeepAnalysis(
          matchId,
          {
            homeTeam: detail.match.homeTeam,
            awayTeam: detail.match.awayTeam,
            league: detail.match.league,
            country: detail.match.country,
            kickoffAt: detail.match.kickoffAt,
            fase:
              context?.detail?.fields.find((f) => f.key === "posta_in_palo")
                ?.valore ?? null,
            stadio: null,
            citta: null,
            fields: context?.detail?.fields ?? [],
            docs: (context?.sources ?? []).map((s) => ({
              titolo: s.title ?? s.uri,
              url: s.uri,
            })),
            movimento: {
              selezione: lead!.selectionLabel,
              apertura: leadSeries?.opening ?? null,
              corrente: leadSeries?.current ?? null,
              oreAlKickoff: profile.hoursToKickoff,
              sostenutoMinuti: profile.sustainedMinutes,
              flash: profile.isFlash,
              rimbalzato: profile.rebounded,
              bookConfermano: profile.booksConfirming,
              bookTotali: profile.booksTotal,
              scesa: profile.falling,
            },
          },
          now,
        ).catch(() => null)
      : null;

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

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
      <nav className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/"
          className="text-xs text-slate-600 underline underline-offset-2 hover:text-slate-900"
        >
          ← Torna all&apos;elenco dei movimenti
        </Link>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
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
            Domani — programma
          </Link>
        </span>
      </nav>

      {/* ---------------- intestazione della partita ---------------- */}
      <header className="mb-4">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <FreshnessBadge
            level={detail.freshness}
            label={detail.freshnessLabel}
            reason={detail.freshnessReason}
          />
          <MetaPill title="Stato della partita secondo l'ultima rilevazione della fonte.">
            {match.statusLabel}
          </MetaPill>
          {match.isDemo && (
            <MetaPill title="Record di prova: non è un dato reale.">
              FIXTURE DI TEST — non è un dato reale
            </MetaPill>
          )}
        </div>

        <h1 className="text-xl leading-snug font-bold tracking-tight text-slate-900">
          {match.homeTeam} <span className="text-slate-400">–</span>{" "}
          {match.awayTeam}
        </h1>

        <p className="mt-1 text-sm text-slate-600">
          {match.league ?? "Competizione non attribuita"}
          {match.country && (
            <span className="text-slate-500"> ({match.country})</span>
          )}
          <span className="mx-1.5 text-slate-300">|</span>
          {fmtDay(match.kickoffAt)} ore {fmtTime(match.kickoffAt)}
        </p>

        {hasResult ? (
          <p className="mt-2 inline-block rounded border border-slate-300 bg-slate-100 px-3 py-1 text-sm font-semibold tabular-nums text-slate-900">
            Risultato finale {match.homeGoals}–{match.awayGoals}
            <span className="ml-2 text-xs font-normal text-slate-600">
              (registrato, non usato per valutare il segnale)
            </span>
          </p>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            Risultato non ancora registrato. La qualità di un segnale si misura
            sul CLV, cioè sul confronto con la quota di chiusura, non sull&apos;esito
            della partita.
          </p>
        )}
      </header>

      {/* ---------------- contesto 360 ---------------- */}
      <section aria-labelledby="contesto-360-wrap" className="mb-5">
        <Context360
          context={context}
          news={news}
          now={now}
          profile={profile}
        />
      </section>

      {/* ---------------- linea sharp ---------------- */}
      {sharp !== null ? (
        <section aria-labelledby="linea-sharp-wrap" className="mb-5">
          <SharpLineBlock view={sharp} />
        </section>
      ) : null}

      {/* ---------------- analisi 360 completa ---------------- */}
      {analysis !== null ? (
        <section aria-labelledby="analisi-360-wrap" className="mb-5">
          <DeepAnalysis360 view={analysis} />
        </section>
      ) : null}

      {/* ---------------- notizie pubbliche ---------------- */}
      <section aria-labelledby="notizie-wrap" className="mb-5">
        <NewsBlock news={matchNews} />
      </section>

      {/* ---------------- banner stato dati ---------------- */}
      <section aria-labelledby="stato-dati-partita" className="mb-5">
        <h2
          id="stato-dati-partita"
          className="mb-2 text-sm font-semibold tracking-wide text-slate-900 uppercase"
        >
          Stato dei dati di questa partita
        </h2>
        <p
          className={`mb-2 rounded border px-3 py-2 text-sm ${BANNER_STYLES[detail.freshness]}`}
        >
          {detail.freshnessReason}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="Rilevazioni totali"
            value={String(detail.totalSnapshots)}
            hint="Righe registrate in odds_snapshots per questa partita."
          />
          <Metric
            label="Serie osservate"
            value={String(detail.series.length)}
            hint="Combinazioni di mercato, esito e bookmaker con almeno una rilevazione."
          />
          <Metric
            label="Ultima raccolta"
            value={fmtAgo(detail.lastSnapshotAt, now)}
            hint={
              detail.lastSnapshotAt
                ? fmtDateTime(detail.lastSnapshotAt)
                : "Nessuna rilevazione registrata."
            }
          />
          <Metric
            label="Lacune aperte"
            value={String(detail.openGaps.length)}
            hint="Informazioni mancanti dichiarate a registro per questa partita."
          />
        </div>
      </section>

      {/* ---------------- serie storiche ---------------- */}
      <section aria-labelledby="serie" className="mb-5">
        <h2
          id="serie"
          className="mb-2 text-sm font-semibold tracking-wide text-slate-900 uppercase"
        >
          Serie storica delle quote
        </h2>

        {detail.series.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm leading-relaxed text-slate-600">
            Nessuna rilevazione di quota registrata per questa partita. La
            partita risulta a monitor ma il collector non ha ancora prodotto
            osservazioni utilizzabili: non c&apos;è nulla da mostrare e nulla
            viene ricostruito.
          </p>
        ) : (
          <div className="space-y-4">
            {detail.series.map((s) => (
              <SeriesBlock
                key={`${s.market}-${s.selection}-${s.bookmakerKey}`}
                series={s}
              />
            ))}
          </div>
        )}
      </section>

      {/* ---------------- segnali ---------------- */}
      <section aria-labelledby="segnali" className="mb-5">
        <h2
          id="segnali"
          className="mb-2 text-sm font-semibold tracking-wide text-slate-900 uppercase"
        >
          Segnali registrati
        </h2>

        {detail.signals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm leading-relaxed text-slate-600">
            Nessun segnale registrato su questa partita. Il monitor sta
            raccogliendo le quote, ma nessun movimento ha superato la soglia di
            rumore di 2 punti percentuali di probabilità implicita.
          </p>
        ) : (
          <div className="space-y-4">
            {detail.signals.map((s) => (
              <article
                key={s.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <header className="mb-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <SignalLevelBadge level={s.level} label={s.levelLabel} />
                    <MagnitudeBadge label={s.magnitudeLabel} />
                    <MetaPill title="Stato corrente del segnale nel ciclo di vita del motore.">
                      {s.statusLabel}
                    </MetaPill>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {s.marketLabel} · {s.selectionLabel}
                  </h3>
                  {s.summary && (
                    <p className="mt-1.5 border-l-2 border-slate-200 pl-3 text-xs leading-relaxed text-slate-600">
                      {s.summary}
                    </p>
                  )}
                  {/* versione dell'algoritmo e, se applicato, il
                      moltiplicatore con i suoi motivi: chi legge può
                      sempre risalire a come è stato calcolato il punteggio */}
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    Algoritmo:{" "}
                    <span className="font-mono text-slate-600">
                      {s.engineVersion}
                    </span>
                  </p>
                  {s.suspicion !== null ? (
                    <div className="mt-1.5 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                      <p className="font-semibold">
                        ⚠ Possibile iper-reazione (storico): moltiplicatore{" "}
                        {s.suspicion.multiplier} applicato al punteggio
                        (prima: {s.suspicion.scoreBefore.toFixed(0)}/100,
                        dopo: {s.confidenceScore !== null ? s.confidenceScore.toFixed(0) : "n/d"}/100).
                      </p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {s.suspicion.reasons.map((r) => (
                          <li key={r.code}>
                            <span className="font-medium">{r.label}</span> —{" "}
                            {r.detail}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-[11px] text-amber-800">
                        Il moltiplicatore è un valore iniziale dichiarato,
                        da validare in R2. Il segnale resta in elenco: la
                        fiducia si riduce, la misura no.
                      </p>
                    </div>
                  ) : null}
                </header>

                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric
                    label="Quota al rilevamento"
                    value={fmtPrice(s.detectedPrice)}
                    hint="Quota congelata al primo rilevamento: è il riferimento per il CLV e non viene mai riscritta."
                  />
                  <Metric
                    label="Spostamento"
                    value={fmtPp(s.deltaPp)}
                    hint="Spostamento della probabilità implicita registrato dal motore."
                  />
                  <Metric
                    label="Sostenuto per"
                    value={fmtMinutes(s.sustainedMinutes)}
                    hint="Durata per cui il movimento si è mantenuto."
                  />
                  <Metric
                    label="Bookmaker concordi"
                    value={`${s.booksConfirming}/${s.booksTotal}`}
                    hint="Bookmaker che si muovono nella stessa direzione sul totale osservato."
                  />
                </div>

                <div className="mb-4 space-y-1 text-xs text-slate-700">
                  <div>
                    Linea sharp:{" "}
                    {!s.sharpAvailable || s.sharpConfirms === null ? (
                      <span
                        className="text-slate-500"
                        title="La fonte non pubblica le quote dei singoli bookmaker: la conferma sharp non è osservabile, il che è diverso da una smentita."
                      >
                        non osservabile
                      </span>
                    ) : (
                      <span className="font-medium text-slate-900">
                        {s.sharpConfirms ? "conferma" : "non conferma"}
                      </span>
                    )}
                  </div>
                  {s.isFlash && (
                    <div className="text-slate-600">
                      Movimento flash: completato in meno di 30 minuti, la tenuta
                      non è verificabile.
                    </div>
                  )}
                  {s.rebounded && (
                    <div className="text-slate-600">
                      Movimento rimbalzato: la quota è rientrata verso il livello
                      di apertura.
                    </div>
                  )}
                </div>

                <div className="mb-4 border-t border-slate-100 pt-3">
                  <ScoreBreakdown signal={s} />
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <SignalTimeline signal={s} />
                </div>

                <footer className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                  <MetaPill title="Versione dell'algoritmo che ha prodotto il record.">
                    motore {s.engineVersion}
                  </MetaPill>
                  <MetaPill>
                    rilevato {fmtDateTime(s.detectedAt)}
                  </MetaPill>
                  <MetaPill>
                    ultimo ricalcolo {fmtAgo(s.updatedAt, now)}
                  </MetaPill>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- lacune dichiarate ---------------- */}
      <section aria-labelledby="lacune" className="mb-5">
        <h2
          id="lacune"
          className="mb-2 text-sm font-semibold tracking-wide text-slate-900 uppercase"
        >
          Dati mancanti
        </h2>

        {detail.openGaps.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            Nessuna lacuna aperta a registro per questa partita.
            {detail.resolvedGaps > 0 &&
              ` ${detail.resolvedGaps} ${detail.resolvedGaps === 1 ? "lacuna risolta" : "lacune risolte"} in precedenza.`}
          </p>
        ) : (
          <ul className="space-y-2">
            {detail.openGaps.map((g) => (
              <li
                key={g.id}
                className="rounded border border-orange-200 bg-orange-50 px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-sm font-medium text-orange-900">
                    {g.reasonLabel}
                  </span>
                  <span className="text-[11px] tabular-nums text-orange-800">
                    aperta dal {fmtDateTime(g.observedFrom)}
                  </span>
                </div>
                {g.detail && (
                  <p className="mt-1 text-xs leading-relaxed text-orange-900">
                    {g.detail}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
        <p className="mb-2">
          Questa pagina descrive come si è mossa una quota e quanto di quel
          movimento il monitor è riuscito a osservare. Non contiene pronostici
          né consigli di scommessa, e un movimento ampio non implica alcun
          vantaggio.
        </p>
        <p className="text-slate-400">
          Pagina generata il {fmtDateTime(detail.generatedAt)} (ora italiana) ·
          chiave partita <span className="tabular-nums">{match.key}</span>
        </p>
      </footer>
    </main>
  );
}
