/**
 * Pagina "Copertura della raccolta" — indirizzo pubblico /coverage.
 *
 * Server component: legge dal database a ogni richiesta, senza cache. La
 * copertura è un dato di qualità del monitor e mostrarla vecchia sarebbe
 * peggio che non mostrarla.
 *
 * Il file sta in `app/cov/` e non in `app/coverage/` perché l'ambiente di
 * lavoro esclude dai salvataggi le cartelle chiamate `coverage`. L'URL
 * visibile resta `/coverage`, riscritto in `next.config.ts`.
 */
import Link from "next/link";
import { getCoverageHistory } from "@/lib/repo/coverage-history";
import {
  readRateLimitNotice,
  type RateLimitNotice,
} from "@/lib/repo/source-rate-limit";
import { buildCoverageView } from "@/lib/cov/view";
import { CoveragePanel } from "@/components/CoveragePanel";
import { CollectNowButton } from "@/components/CollectNowButton";
import { fmtDateTime } from "@/components/format";

/* ISR: la copertura si rigenera al massimo ogni 5 minuti.
   Il collector scrive su GitHub Actions e non dipende dal render, quindi una
   pagina servita dalla cache di bordo non blocca né ritarda la raccolta. La
   freschezza del dato resta dichiarata in pagina dal pannello «Stato dati». */
export const revalidate = 300;

export const metadata = {
  title: "Copertura della raccolta — DropAlert",
  description:
    "Quante righe dell'elenco della fonte diventano dato utile, e dove finiscono quelle che non ci arrivano.",
};

export default async function CoveragePage() {
  const now = new Date();

  let view = null;
  let failure: string | null = null;

  /* il rate-limit della fonte si legge in un try/catch separato: se
     `source_health` non è leggibile, la misura di copertura resta valida
     e la riga semplicemente non compare */
  let rateLimit: RateLimitNotice | null = null;
  try {
    rateLimit = await readRateLimitNotice();
  } catch {
    rateLimit = null;
  }

  try {
    const history = await getCoverageHistory(50, now);
    view = buildCoverageView({
      latest: history.latest,
      latestRunId: history.latestRunId,
      latestStartedAt: history.latestStartedAt,
      stats: history.stats,
      depth: history.depth,
      runsWithoutMeasure: history.runsWithoutMeasure,
      scheduler: history.scheduler,
      actions: { lastScheduledRun: history.lastScheduledRun, now },
    });
  } catch (error) {
    /* il guasto si dichiara, non si nasconde dietro una pagina vuota */
    failure =
      error instanceof Error
        ? error.message
        : "Errore non identificato nella lettura della copertura.";
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
          Copertura della raccolta
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Misura di completezza del dato: quante righe di calcio pubblicate
          dalla fonte diventano una partita osservata.{" "}
          <span className="font-medium text-slate-800">
            Non dice nulla sulla bontà dei segnali e non è un consiglio di
            scommessa.
          </span>
        </p>
      </header>

      {failure !== null ? (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 text-sm text-orange-900">
          <p className="font-medium">DATI PARZIALI</p>
          <p className="mt-1 text-xs leading-relaxed">
            La copertura non è leggibile in questo momento: {failure}. Nessun
            valore viene mostrato al suo posto.
          </p>
        </div>
      ) : view !== null ? (
        <CoveragePanel view={view} rateLimit={rateLimit}>
          <CollectNowButton />
        </CoveragePanel>
      ) : null}

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-900 uppercase">
          Come si legge
        </h2>
        <ol className="space-y-2 text-xs leading-relaxed text-slate-600">
          <li>
            <span className="font-medium text-slate-800">
              1. La misura c&apos;è?
            </span>{" "}
            Se la copertura risulta <em>non misurata</em>, la fonte non ha
            saputo dire cosa aveva davanti. Non è uno zero: è assenza di
            misura.
          </li>
          <li>
            <span className="font-medium text-slate-800">
              2. Quante righe di calcio c&apos;erano?
            </span>{" "}
            È il denominatore. Su una decina di righe, una partita persa vale
            quasi dieci punti percentuali: il numero assoluto delle perse è
            più onesto della percentuale.
          </li>
          <li>
            <span className="font-medium text-slate-800">
              3. Dove sono finite le non importate?
            </span>{" "}
            Altri sport e fixture dimostrative sono fuori perimetro; il dato
            per singolo bookmaker è un limite della fonte. Solo{" "}
            <em>senza quote</em> e <em>non raggiunte</em> sono perdite nostre.
          </li>
          <li>
            <span className="font-medium text-slate-800">
              4. Quanti giri ci sono dietro?
            </span>{" "}
            Sotto dieci giri strumentati la serie è dichiarata insufficiente e
            non va letta come tendenza. Un giro solo è una fotografia.
          </li>
        </ol>
      </section>

      <footer className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
        <p className="mb-2">
          I dati mancanti sono sempre dichiarati e non vengono mai sostituiti
          da stime, medie o interpolazioni. La quota per singolo bookmaker non
          è raccolta: il robots.txt della fonte non ne consente la lettura.
        </p>
        <p className="text-slate-400">
          Pagina generata il {fmtDateTime(now.toISOString())} (ora italiana).
        </p>
      </footer>
    </main>
  );
}
