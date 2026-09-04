/**
 * Pagina "Domani — programma dall'archivio" — indirizzo pubblico /domani.
 *
 * Server component: legge dal database a ogni richiesta, senza cache.
 * L'elenco non è un calendario: sono le partite con calcio d'inizio
 * domani che l'archivio del monitor ha già incontrato passando
 * dall'elenco dei movimenti della fonte. Ciò che la fonte non espone
 * qui non c'è, e l'empty state lo dichiara.
 *
 * Le partite senza quote in archivio restano in elenco con la nota
 * «quote in arrivo»: sono già osservazioni, non ancora misure.
 */
import Link from "next/link";
import { getTomorrowView, type TomorrowMatch } from "@/lib/repo/tomorrow";
import { fmtDay, fmtPrice, fmtTime } from "@/components/format";
import { getCalendar } from "@/lib/repo/calendar";
import { withoutTracked } from "@/lib/calendar/football-data";
import { romeDayDiff } from "@/lib/view/timeline";
import { UpcomingFixtures } from "@/components/UpcomingFixtures";

/* ISR: il programma di domani si rigenera al massimo ogni 5 minuti.
   Il collector scrive su GitHub Actions e non dipende dal render, quindi una
   pagina servita dalla cache di bordo non blocca né ritarda la raccolta. La
   freschezza del dato resta dichiarata in pagina dal pannello «Stato dati». */
export const revalidate = 300;

export const metadata = {
  title: "Domani — programma dall'archivio — DropAlert",
  description:
    "Le partite di domani che l'archivio del monitor ha già incontrato, con le ultime quote osservate. Non è un calendario completo.",
};

function OddsRow({ match }: { match: TomorrowMatch }) {
  if (match.awaitingOdds) {
    return (
      <p className="mt-1 text-xs leading-relaxed text-amber-800">
        <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-semibold">
          Quote in arrivo
        </span>{" "}
        la partita è in archivio ma la fonte non ha ancora pubblicato quote
        osservabili: nessun valore stimato al loro posto.
      </p>
    );
  }

  const last = match.odds[match.odds.length - 1];

  return (
    <p className="mt-1 text-xs leading-relaxed text-slate-700">
      {match.odds.map((o, i) => (
        <span key={`${o.market}-${o.selection}`} className="whitespace-nowrap">
          {i > 0 ? <span className="mx-1.5 text-slate-300">·</span> : null}
          <span className="text-slate-500">{o.selectionLabel}</span>{" "}
          <span className="font-semibold tabular-nums text-slate-900">
            {fmtPrice(o.price)}
          </span>
        </span>
      ))}
      <span className="ml-2 text-[11px] text-slate-500">
        quota di consenso, ultima rilevazione {fmtTime(last.collectedAt)} ·{" "}
        {match.snapshotCount} rilevazioni in archivio
      </span>
    </p>
  );
}

function MatchRow({ match }: { match: TomorrowMatch }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Link
          href={`/matches/${match.id}`}
          className="text-sm font-semibold text-slate-900 underline-offset-2 hover:underline"
        >
          {match.homeTeam} <span className="text-slate-400">–</span>{" "}
          {match.awayTeam}
        </Link>
        <span className="text-xs font-semibold tabular-nums text-slate-700">
          {fmtTime(match.kickoffAt)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {match.league ?? "Competizione non attribuita"}
        {match.country ? (
          <span className="text-slate-500"> ({match.country})</span>
        ) : null}
        {match.hasSignal ? (
          <span className="ml-2 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
            segnale registrato
          </span>
        ) : null}
      </p>
      <OddsRow match={match} />
    </li>
  );
}

export default async function TomorrowPage() {
  const now = new Date();

  let view = null;
  let failure: string | null = null;

  /* calendario di domani: le partite che il monitor non ha ancora visto.
     Il radar completa l'archivio, non lo sostituisce. */
  const calendario = await getCalendar(1, now).catch(() => null);

  try {
    view = await getTomorrowView(now);
  } catch (error) {
    failure =
      error instanceof Error
        ? error.message
        : "Errore non identificato nella lettura del programma di domani.";
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-5">
      <header className="mb-5">
        <nav className="mb-2 text-xs text-slate-500">
          <Link href="/" className="underline hover:text-slate-800">
            ← Torna ai movimenti
          </Link>
        </nav>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Domani — programma dall&apos;archivio
          {view !== null ? (
            <span className="ml-2 text-sm font-normal text-slate-500">
              {fmtDay(view.dayIso)}
            </span>
          ) : null}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Le partite con calcio d&apos;inizio domani che l&apos;archivio del
          monitor ha già incontrato.{" "}
          <span className="font-medium text-slate-800">
            Non è un calendario completo
          </span>
          : l&apos;elenco nasce dai movimenti esposti dalla fonte. Le partite
          delle competizioni coperte dal calendario compaiono qui sotto anche
          senza quote, con l&apos;etichetta «quote in arrivo».
        </p>
      </header>

      {/* radar: partite di domani non ancora coperte dall'archivio */}
      {(() => {
        const noti = (view?.matches ?? []).map((i) => ({
          homeTeam: i.homeTeam,
          awayTeam: i.awayTeam,
          kickoffAt: i.kickoffAt,
        }));
        const inArrivo =
          calendario === null
            ? []
            : withoutTracked(calendario.fixtures, noti).filter(
                (f) => romeDayDiff(now, f.kickoffAt) === 1,
              );
        if (inArrivo.length === 0 && calendario?.unavailableReason == null) {
          return null;
        }
        return (
          <div className="mb-5">
            <UpcomingFixtures
              fixtures={inArrivo}
              now={now}
              unavailableReason={calendario?.unavailableReason ?? null}
              title="Domani — quote in arrivo"
            />
          </div>
        );
      })()}

      {failure !== null ? (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 text-sm text-orange-900">
          <p className="font-medium">DATI PARZIALI</p>
          <p className="mt-1 text-xs leading-relaxed">
            Il programma di domani non è leggibile in questo momento:{" "}
            {failure}. Nessun valore viene mostrato al suo posto.
          </p>
        </div>
      ) : view !== null ? (
        <>
          {view.matches.length > 0 ? (
            <p className="mb-3 text-xs text-slate-600">
              <span className="font-semibold tabular-nums text-slate-900">
                {view.matches.length}
              </span>{" "}
              partite in archivio con kickoff domani ·{" "}
              <span className="font-semibold tabular-nums text-slate-900">
                {view.withOdds}
              </span>{" "}
              con quote osservate ·{" "}
              <span className="font-semibold tabular-nums text-amber-800">
                {view.withoutOdds}
              </span>{" "}
              in attesa di quote.
            </p>
          ) : null}

          <section aria-labelledby="programma-domani">
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-900 uppercase">
              Programma
            </h2>
            {view.matches.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm leading-relaxed text-slate-600">
                <p className="font-medium text-slate-900">
                  Nessuna partita di domani in archivio, per ora.
                </p>
                <p className="mt-1 text-xs">
                  Questo elenco legge l&apos;archivio dei movimenti del
                  monitor — cioè ciò che la fonte espone nell&apos;elenco
                  delle quote in calo — non un calendario completo delle
                  competizioni. Se la fonte non ha ancora esposto nessun
                  movimento su partite di domani, qui non c&apos;è nulla: è
                  un&apos;assenza di osservazioni, non un&apos;assenza di
                  calcio. Le partite compariranno man mano che la raccolta le
                  incontra.
                </p>
                <p className="mt-2 text-xs">
                  Quanto della fonte diventa osservazione è misurato nella{" "}
                  <Link
                    href="/coverage"
                    className="underline hover:text-slate-900"
                  >
                    copertura della raccolta
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {view.matches.map((m) => (
                  <MatchRow key={m.id} match={m} />
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <footer className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
        <p>
          Le quote mostrate sono l&apos;ultima rilevazione di consenso per
          selezione, non una media né una stima. Le partite senza quote restano
          senza quote, dichiarate.
        </p>
      </footer>
    </main>
  );
}
