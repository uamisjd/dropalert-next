/**
 * Gioco responsabile (Sprint lancio, punto B).
 *
 * Pagina di sola informazione, senza numeri del monitor: qui non si parla di
 * quote. Il messaggio è uno solo e non va annacquato — il gioco può causare
 * dipendenza, e chi ha bisogno di aiuto deve trovare subito un contatto.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { HELPLINE } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Gioco responsabile — DropAlert",
  description:
    "Avvertenze sul gioco d'azzardo, segnali di rischio e contatti di aiuto. DropAlert è un osservatorio statistico, non un servizio di pronostici.",
};

export const revalidate = 86400;

export default function GiocoResponsabilePage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-5">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">
        Gioco responsabile
      </h1>

      <p className="mt-3 rounded border border-slate-800 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
        +18 · Il gioco può causare dipendenza · Gioca responsabilmente · Numero
        Verde{" "}
        <a
          href={`tel:+39${HELPLINE.replace(/\s/g, "")}`}
          className="underline underline-offset-2"
        >
          {HELPLINE}
        </a>
      </p>

      <section className="mt-5">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          Che cosa è DropAlert, e che cosa non è
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          DropAlert osserva come si muovono le quote pubblicate dai bookmaker e
          misura quanto quel movimento è ampio, confermato e affidabile.{" "}
          <strong>
            Non fornisce pronostici, non indica giocate e non promette alcun
            vantaggio.
          </strong>{" "}
          Un movimento di quota descrive il comportamento del mercato, non la
          probabilità reale che un evento accada.
        </p>
      </section>

      <section className="mt-5">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          Nessun sistema batte il banco
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          Le quote incorporano un margine a favore dell&apos;operatore: sul
          lungo periodo il saldo atteso di chi gioca è negativo. Nessuna
          statistica, nessun indice e nessun modello — compresi quelli
          pubblicati qui — cambia questo fatto. La sola metrica di qualità che
          pubblichiamo, il CLV, confronta il segnale con la quota di chiusura:
          non misura vincite e non è un rendimento.
        </p>
      </section>

      <section className="mt-5">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          Segnali di rischio
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
          <li>giocare somme più alte di quelle che avevi deciso;</li>
          <li>rincorrere le perdite con nuove giocate;</li>
          <li>giocare per gestire ansia, noia o umore basso;</li>
          <li>nascondere a familiari o amici quanto e quando giochi;</li>
          <li>
            togliere tempo o denaro a lavoro, studio, famiglia o cure mediche;
          </li>
          <li>sentirsi irritabili quando si prova a smettere.</li>
        </ul>
      </section>

      <section className="mt-5">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          Dove trovare aiuto
        </h2>
        <ul className="space-y-1.5 text-sm leading-relaxed text-slate-700">
          <li>
            <strong>Numero Verde Nazionale per il gioco d&apos;azzardo</strong>{" "}
            <a
              href={`tel:+39${HELPLINE.replace(/\s/g, "")}`}
              className="underline underline-offset-2"
            >
              {HELPLINE}
            </a>{" "}
            — gratuito e anonimo, attivo dal lunedì al venerdì.
          </li>
          <li>
            <strong>Servizi per le dipendenze (Ser.D.)</strong> della tua ASL:
            offrono consulenza e presa in carico gratuita.
          </li>
          <li>
            <strong>Giocatori Anonimi Italia</strong> —{" "}
            <a
              href="https://www.giocatorianonimi.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              giocatorianonimi.org
            </a>
            , gruppi di mutuo aiuto in tutta Italia.
          </li>
          <li>
            <strong>Autoesclusione</strong>: puoi chiedere l&apos;esclusione dal
            gioco a distanza tramite il Registro Unico degli Auto-esclusi
            dell&apos;Agenzia delle Dogane e dei Monopoli.
          </li>
        </ul>
      </section>

      <section className="mt-5">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          Riservato ai maggiorenni
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          I contenuti di questo sito riguardano i mercati delle scommesse
          sportive e sono riservati a chi ha compiuto 18 anni.
        </p>
      </section>

      <p className="mt-6 text-xs">
        <Link
          href="/"
          className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
        >
          ← Torna all&apos;osservatorio
        </Link>
      </p>
    </main>
  );
}
