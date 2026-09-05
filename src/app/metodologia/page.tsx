/**
 * Metodologia (Sprint lancio, punti B ed E2).
 *
 * Qui vivono, in un posto solo, le tre verifiche storiche (R1, R1.5, R2),
 * la spiegazione dell'indice e i limiti dichiarati delle fonti. In home
 * resta un rimando: gli stessi tre blocchi ripetuti su due pagine erano la
 * stessa informazione detta due volte.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { BacktestNote } from "@/components/BacktestNote";
import { BacktestNoteR15 } from "@/components/BacktestNoteR15";
import { BacktestNoteR2 } from "@/components/BacktestNoteR2";

export const metadata: Metadata = {
  title: "Metodologia — DropAlert",
  description:
    "Come DropAlert misura i movimenti di quota: indice di fiducia, CLV, verifiche storiche e limiti dichiarati delle fonti.",
  alternates: { canonical: "/metodologia" },
};

export const revalidate = 86400;

export default function MetodologiaPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-5">
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
          Copertura e giri automatici
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          La profondità pubblicata in{" "}
          <Link href="/coverage" className="font-semibold text-cyan-700 hover:underline">
            copertura
          </Link>{" "}
          conta soltanto raccolte automatiche concluse e distanziate dal gate.
          Misura quante righe della fonte sono state viste e importate: per
          questo una raccolta conclusa dalla seconda gamba conta anche quando
          analisi e chiusure restano al giro completo di GitHub Actions. Un
          collector ancora aperto non entra nella serie, e i giri chiesti a
          mano restano fuori dalla soglia di profondità.
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
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          Due soglie diverse, perché servono a due cose diverse: sotto le{" "}
          <strong>10</strong> osservazioni non pubblichiamo nemmeno
          l&apos;intervallo di confidenza al 95% (sotto quella soglia un
          intervallo è rumore vestito da precisione); sotto le{" "}
          <strong>30</strong> il valore resta marcato non concludente anche
          quando è positivo. La seconda è deliberatamente più severa della
          prima: un campione piccolo che oscilla non prova nulla.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          E una cautela che vale più delle soglie: <strong>le due metà del CLV
          non stanno sempre sulla stessa base</strong>. Il prezzo del segnale è
          sempre grezzo, margine del bookmaker incluso; la chiusura invece è
          fair no-vig dove il mercato era completo e grezza dove non lo era.
          Confrontare un prezzo con margine contro una probabilità senza
          margine deprime il CLV di un importo meccanico che non ha nulla a che
          vedere con la bravura: sull&apos;archivio congelato di questo progetto
          quell&apos;importo misura <strong>−1,86 punti percentuali</strong> di
          media, con il 20,6% delle osservazioni che cambierebbe verso
          (<code className="rounded bg-slate-100 px-1">docs/STUDIO-PARTITE-FINITE.md</code>,
          §1.1). La base usata per ogni osservazione è registrata e oggi è
          dichiarata in{" "}
          <Link href="/performance" className="font-semibold text-cyan-700 hover:underline">
            /performance
          </Link>{" "}
          accanto al numero: un riepilogo a basi miste lo dice, invece di
          lasciare che la media sembri un verdetto.
        </p>
      </section>

      <section className="mt-5">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          La quota fair senza margine, e dove si ferma
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          Una quota pubblicata contiene il margine di chi la espone. Per
          confrontare due prezzi della stessa natura — la nostra rilevazione e
          la chiusura — il margine va tolto: le probabilità implicite delle
          selezioni di un mercato vengono divise per la loro somma. È il metodo
          proporzionale, il più trasparente fra quelli che richiedono solo i
          dati che abbiamo; la scelta è nel codice
          (<code className="rounded bg-slate-100 px-1">src/lib/drop/novig.ts</code>),
          non nei marketing.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          Lo stesso metodo genera il numero della pagina{" "}
          <Link href="/value-bets" className="font-semibold text-cyan-700 hover:underline">
            divario di prezzo
          </Link>
          : lì il confronto non è con la chiusura ma con l&apos;ultima lettura, e
          serve a vedere quanto margine resta dentro la quota. La stessa linea
          completa è anche la condizione perché il numero esista: se manca una
          selezione la riga non viene pubblicata e il motivo è contato.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          Che cosa questo non autorizza a dire: un vantaggio atteso. Una linea
          no-vig dello stesso bookmaker che offre la quota non è una linea di
          mercato indipendente, e con un solo operatore in lettura non esiste il
          confronto sharp/soft da cui l&apos;+EV discenderebbe. Le pagine lo
          dichiarano e l&apos;audit che ha portato a scriverlo così è pubblico
          (<code className="rounded bg-slate-100 px-1">docs/STUDIO-VALUE-BETS.md</code>).
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          Le verifiche storiche
        </h2>
        <p className="mb-3 text-sm leading-relaxed text-slate-700">
          Tre verifiche, pubblicate con i loro campioni e con i risultati
          scomodi lasciati dove sono: la prima su dati storici di mercato, la
          seconda per segmenti, la terza sul monitor stesso.
        </p>
        <div className="space-y-4">
          <BacktestNote />
          <BacktestNoteR15 />
          <BacktestNoteR2 />
        </div>
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
          ← Torna ai movimenti
        </Link>
      </p>
    </main>
  );
}
