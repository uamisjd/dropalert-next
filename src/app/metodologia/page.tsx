/**
 * Metodologia (Sprint lancio).
 *
 * In questo punto (B) la pagina nasce perché il footer legale la linka e un
 * link che porta a un 404 è peggio di un link assente. Il contenuto completo
 * — accorpamento dei backtest R1/R1.5/R2 e limiti delle fonti — arriva al
 * punto E2: qui c'è già la sostanza essenziale, non un segnaposto vuoto.
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Metodologia — DropAlert",
  description:
    "Come DropAlert misura i movimenti di quota: indice di fiducia, CLV, verifiche storiche e limiti dichiarati delle fonti.",
};

export const revalidate = 86400;

export default function MetodologiaPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">
        Metodologia
      </h1>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Come si misura un movimento di quota, che cosa significa il numero che
        vedi sulle card e — soprattutto — che cosa questi numeri non dicono.
      </p>

      <section className="mt-5">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          Che cosa osserviamo
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          Il monitor registra le quote pubblicate dalle fonti configurate e
          confronta ogni rilevazione con la prima osservata. Un «drop» è il calo
          della quota di un esito rispetto a quel punto di partenza: descrive
          come si sta muovendo il mercato, non quanto è probabile un risultato.
        </p>
      </section>

      <section className="mt-5">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          L&apos;indice di fiducia
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          L&apos;indice va da 0 a 100 e riassume quattro cose già misurate:
          ampiezza del movimento, conferme fra bookmaker, persistenza sul nuovo
          livello e completezza dei dati disponibili. Non è una probabilità di
          vittoria e non è un rendimento atteso: è una misura di quanto il
          movimento sia solido come osservazione.
        </p>
      </section>

      <section className="mt-5">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          Il CLV, unica metrica di qualità
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          Il CLV confronta la quota al momento del segnale con la quota di
          chiusura. Misura il tempismo rispetto al mercato, non l&apos;esito
          della partita. Sotto le 30 osservazioni lo dichiariamo non
          concludente, e i valori negativi restano pubblicati come sono.
        </p>
      </section>

      <section className="mt-5">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          Limiti dichiarati
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
          <li>
            i dati mancanti restano mancanti: nessuna stima, nessuna
            interpolazione;
          </li>
          <li>
            quando la fonte espone una sola linea di consenso, la coordinazione
            fra bookmaker non è osservabile e non entra nel punteggio;
          </li>
          <li>
            i contenuti generati automaticamente sono dichiarati come tali e
            vanno verificati.
          </li>
        </ul>
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
