/**
 * Pagina /strumenti — strumenti di calcolo sul lato betting.
 *
 * È la prima parte del sito che tocca il betting dichiaratamente, e resta
 * dentro l'identità dell'osservatorio: qui si misura quanto costa un prezzo e
 * quanto è ampia la distribuzione dei risultati. Nessuno dei due strumenti
 * sceglie una selezione, confronta operatori, collega a un concessionario o
 * promette un vantaggio.
 *
 * Scelta di conformità, dichiarata anche qui: l'art. 9 del d.l. 87/2018
 * vieta ogni forma di pubblicità, anche indiretta, dei giochi con vincita in
 * denaro. Questa pagina non contiene promozioni, bonus, link a operatori né
 * inviti a giocare: contiene aritmetica e avvisi.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { MarginCalculator } from "@/components/tools/MarginCalculator";
import { VarianceSimulator } from "@/components/tools/VarianceSimulator";
import { HELPLINE } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Strumenti di calcolo — DropAlert",
  description:
    "Margine del bookmaker, quote fair no-vig e peso della varianza: calcolatori trasparenti e riproducibili. Non dicono cosa giocare e non sono un consiglio di scommessa.",
  alternates: { canonical: "/strumenti" },
};

/* La pagina calcola tutto nel browser: nessun dato personale, nessuna
   chiamata al server, niente da conservare. */
export const dynamic = "force-static";

export default function StrumentiPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-5">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Strumenti di calcolo
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Due calcolatori che rispondono a domande aritmetiche sul prezzo di
          una scommessa: quanto margine contiene e quanto è ampia la
          distribuzione dei risultati quando si ripete.
        </p>
      </header>

      <section
        aria-labelledby="cosa-non-e"
        className="mt-4 rounded-lg border border-slate-300 bg-white p-4"
      >
        <h2
          id="cosa-non-e"
          className="text-sm font-semibold tracking-wide text-slate-900 uppercase"
        >
          Che cosa questa pagina non fa
        </h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-700">
          <li>
            <span className="font-medium">Non indica una giocata.</span> Nessuno
            dei due strumenti seleziona una partita, un mercato o un esito. I
            numeri li inserisci tu.
          </li>
          <li>
            <span className="font-medium">Non confronta operatori</span> e non
            contiene link, bonus né promozioni: su questo sito non compaiono, in
            nessuna pagina.
          </li>
          <li>
            <span className="font-medium">Non promette un vantaggio.</span> La
            quota fair è una convenzione di calcolo su numeri che fornisci, non
            una stima della realtà e non una previsione.
          </li>
          <li>
            <span className="font-medium">Non conserva nulla.</span> Tutto il
            calcolo avviene nel browser: nessun dato viene inviato o
            registrato.
          </li>
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          Il gioco è riservato ai maggiori di 18 anni e può causare dipendenza.
          Numero Verde nazionale{" "}
          <a
            href={`tel:+39${HELPLINE.replace(/\s/g, "")}`}
            className="font-medium text-slate-800 underline underline-offset-2"
          >
            {HELPLINE}
          </a>
          .
        </p>
      </section>

      <div className="mt-5 space-y-5">
        <MarginCalculator />
        <VarianceSimulator />
      </div>

      <section
        aria-labelledby="perche"
        className="mt-5 rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2
          id="perche"
          className="text-sm font-semibold tracking-wide text-slate-700 uppercase"
        >
          Perché questi strumenti stanno qui
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          DropAlert misura i movimenti delle quote e ne verifica la qualità con
          il CLV, che confronta il prezzo rilevato con la quota di chiusura. Per
          leggere quel confronto serve sapere che ogni quota contiene un
          margine, e che toglierlo è una scelta di metodo e non una verità: per
          questo la rimozione del margine usata nella chiusura fair no-vig è la
          stessa, proporzionale, dichiarata qui accanto alle alternative.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          Il secondo strumento esiste perché il rendimento atteso, da solo, non
          descrive quasi niente: una sequenza breve è dominata dal caso. È la
          stessa ragione per cui il sito non pubblica intervalli di confidenza
          sotto le dieci osservazioni.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Link
            href="/metodologia"
            className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            Come si misura il CLV →
          </Link>
          <Link
            href="/performance"
            className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            Evoluzione del CLV →
          </Link>
          <Link
            href="/gioco-responsabile"
            className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            Gioco responsabile →
          </Link>
        </p>
      </section>

      <footer className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
        <p>
          DropAlert è un osservatorio statistico. Anche questa pagina descrive e
          misura: non fornisce pronostici, non consiglia giocate e non invita a
          giocare.
        </p>
      </footer>
    </main>
  );
}
