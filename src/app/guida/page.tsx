/**
 * Pagina /guida — come si legge questo sito per decidere una partita.
 *
 * Perché esiste. Il sito spiega che cos'è un drop, che cos'è l'indice e che
 * cos'è il CLV, ma non diceva in che ordine guardare le cose né — soprattutto —
 * quali domande questi dati possono rispondere e quali no. È la distanza più
 * grande fra ciò che il progetto pubblica e ciò che chi lo usa deve decidere.
 *
 * Regola editoriale, la stessa del resto del sito: ogni numero qui sotto ha il
 * suo campione accanto e la sua fonte. Nessuna cifra è arrotondata a favore,
 * nessun risultato negativo è omesso. I numeri vengono da
 * `npm run study:finished` (12 459 partite, 5 campionati, 7 stagioni, dati
 * congelati in `data/football-data/`) e da `docs/BACKTEST-R2.md` (57 segnali
 * rilevati dal monitor in produzione).
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Come si sceglie una partita con questi dati — DropAlert",
  description:
    "Che cosa questo sito può dirti su una partita, che cosa non può dirti, e in che ordine leggere i numeri. Con i campioni e i risultati negativi lasciati dove sono.",
  alternates: { canonical: "/guida" },
};

export const revalidate = 86400;

const DISCLAIMER =
  "Nessuna vincita è garantita. Questa pagina spiega come leggere delle misure, non quali partite giocare.";

function Number({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-semibold tabular-nums text-slate-950">{children}</span>
  );
}

function Sample({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-slate-500" title="campione su cui il numero è stato misurato">
      {" "}
      (n&nbsp;{children})
    </span>
  );
}

export default function GuidaPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-5">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">
        Come si sceglie una partita con questi dati
      </h1>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Che cosa questo sito può dirti, che cosa non può dirti, e in che ordine
        leggere i numeri. Ogni cifra ha il suo campione accanto e la sua fonte:
        sono misure, non promesse.
      </p>

      <p className="mt-3 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800">
        {DISCLAIMER}
      </p>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          1. La risposta breve, e perché è questa
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          Questo sito <strong>non può dirti quale partita scegliere</strong>, e
          non è timidezza editoriale: è una misura. Sui 57 segnali che il
          monitor ha rilevato in produzione, il CLV medio è{" "}
          <Number>−4,06 punti percentuali</Number> e la quota di chiusura è
          stata battuta nel <Number>7,7%</Number> dei casi
          <Sample>52 con CLV</Sample>. Nessun segmento — per fascia
          dell&apos;indice, per versione dell&apos;algoritmo, per anticipo sul
          kickoff — è risultato positivo. In altre parole: il prezzo che il
          monitor vede è quasi sempre peggiore di quello che il mercato offrirà
          alla chiusura.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          Ciò che il sito <strong>può</strong> dirti è un&apos;altra cosa, ed è
          utile: quanto si è mosso un mercato, quanto è solida
          quell&apos;osservazione, quanto margine stai pagando, e quali errori
          costano di più. Le tre sezioni seguenti sono quelle, in ordine di
          valore misurato.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          2. La cosa che vale di più, e non dipende da nessun modello
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          Su 37 374 selezioni 1X2 di 12 459 partite, comprare la{" "}
          <strong>stessa identica selezione</strong> al prezzo migliore
          disponibile invece che dal solito operatore cambia il rendimento di{" "}
          <Number>+6,53 punti percentuali di ROI</Number>: −6,60% contro
          −0,07%. Il prezzo migliore esisteva nel <Number>96,6%</Number> dei
          casi e valeva in media <Number>7,55%</Number> di quota in più
          <Sample>36 098 su 37 374</Sample>.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          È l&apos;unico risultato di tutto lo studio che non usa un modello,
          non usa la chiusura per scegliere e non richiede di indovinare nulla
          sulla partita: è margine strutturale. Prima di cercare il segnale
          giusto, la domanda che rende di più è{" "}
          <strong>«quanto sto regalando comprando sempre dallo stesso
          book?»</strong>.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          Per confronto, la stessa ricerca sugli arbitraggi fra otto operatori
          veri trova una somma delle probabilità implicite sotto il 100%
          nell&apos;<Number>1,6%</Number> delle partite
          <Sample>200 su 12 459</Sample>, con profitto medio{" "}
          <Number>1,13%</Number> — e quei prezzi non sono rilevati nello stesso
          istante, quindi non sono nemmeno eseguibili. È il motivo per cui{" "}
          <Link href="/surebet" className="font-semibold text-cyan-700 hover:underline">
            /surebet
          </Link>{" "}
          è una calcolatrice e non un elenco di occasioni.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          3. La tassa di partenza: quanto costa ogni fascia di quota
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          Se punti su <em>tutte</em> le selezioni 1X2 di tutte le partite, alla
          chiusura e senza nessun segnale, questo è il rendimento per fascia di
          quota. È l&apos;imposta che ogni strategia deve pagare prima di
          cominciare: se una fascia sta sopra lo zero senza segnale, lì il
          profitto ha una casa; se nessuna ci sta, il sito non ha niente da
          promettere.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Fascia di quota</th>
                <th className="py-1.5 pr-3 font-medium">n</th>
                <th className="py-1.5 pr-3 font-medium">Frequenza reale</th>
                <th className="py-1.5 font-medium">ROI alla chiusura</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[
                ["1,01–1,39", "1 700", "77,4%", "−2,76%"],
                ["1,40–1,99", "5 365", "58,2%", "−3,17%"],
                ["2,00–2,99", "7 370", "39,3%", "−5,71%"],
                ["3,00–4,99", "16 603", "26,0%", "−5,77%"],
                ["5,00–9,99", "5 339", "13,8%", "−14,88%"],
                ["10,00 e oltre", "997", "7,0%", "−7,72%"],
                ["tutte le quote", "37 374", "33,3%", "−6,60%"],
              ].map(([banda, n, freq, roi], i) => (
                <tr key={banda} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3 text-slate-700">{banda}</td>
                  <td className="py-1.5 pr-3 text-slate-700">{n}</td>
                  <td className="py-1.5 pr-3 text-slate-700">{freq}</td>
                  <td
                    className={`py-1.5 ${
                      i === 6 ? "font-semibold text-slate-900" : "text-slate-700"
                    }`}
                  >
                    {roi}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Nessuna fascia sta sopra lo zero. Le quote alte (5,00–9,99) sono le
          più care di tutte: è la fascia dove l&apos;«occasione grossa» costa di
          più, ed è la stessa fascia in cui la frequenza reale (13,8%) sta{" "}
          <em>sotto</em> l&apos;attesa fair (14,9%).
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          4. Il drop: quando il movimento vale qualcosa, e quando no
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          Il drop che il monitor rileva non è denaro: è denaro{" "}
          <strong>finché qualcuno è disposto a fare meglio di te</strong>. Ecco
          che cosa resta, per ampiezza del movimento, pagando il prezzo di prima
          del movimento e incassando alla chiusura.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Ampiezza</th>
                <th className="py-1.5 pr-3 font-medium">n</th>
                <th className="py-1.5 pr-3 font-medium">ROI al prezzo pre-movimento</th>
                <th className="py-1.5 font-medium">ROI alla chiusura</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[
                ["moderato (2–5 pp)", "4 169", "+0,14%", "−7,87%"],
                ["alto (5–10 pp)", "823", "+10,30%", "−5,20%"],
                ["molto alto (oltre 10 pp)", "41", "+50,37%", "+16,17%"],
              ].map(([classe, n, pre, post]) => (
                <tr key={classe} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3 text-slate-700">{classe}</td>
                  <td className="py-1.5 pr-3 text-slate-700">{n}</td>
                  <td className="py-1.5 pr-3 text-slate-700">{pre}</td>
                  <td className="py-1.5 text-slate-700">{post}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          La gerarchia è chiara e controintuitiva: il valore cresce con
          l&apos;ampiezza, ma <strong>il prezzo a cui lo ottieni cresce con
          essa</strong>. I drop molto alti rendono — su{" "}
          <Number>41</Number> casi, che è un ordine di grandezza e non un
          intervallo di confidenza. Il problema è operativo: il monitor gira
          ogni 15-45 minuti, e un movimento che si consuma in pochi minuti è già
          chiuso quando arriva la card. La corsa non è trovare il drop, è
          arrivare prima.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          5. L&apos;ordine in cui leggere una card
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
          <li>
            <strong>La base di confronto del CLV.</strong> Sta in{" "}
            <Link href="/performance" className="font-semibold text-cyan-700 hover:underline">
              /performance
            </Link>
            , sopra il numero. Se le osservazioni sono a basi miste, il CLV
            medio somma numeri non confrontabili e non va letto come un
            verdetto: il solo errore di base vale −1,86 pp, misurati
            sull&apos;archivio congelato.
          </li>
          <li>
            <strong>Il tetto dell&apos;indice.</strong> Con la fonte attuale —
            una sola linea di consenso, nessun libro sharp — 45 punti su 100 non
            sono misurabili e l&apos;indice grezzo si ferma a{" "}
            <Number>50,13</Number>. Una fascia vuota sopra quel valore non
            significa «nessun segnale abbastanza buono»: significa che non ci
            può cadere nulla.
          </li>
          <li>
            <strong>La scomposizione, non il totale.</strong> Nella pagina della
            partita ogni componente dice se è misurata o se è una lacuna
            (<code className="rounded bg-slate-100 px-1">GAP</code>). Un indice
            basso perché manca il dato è una storia diversa da un indice basso
            perché il movimento è debole, e solo la scomposizione le distingue.
          </li>
          <li>
            <strong>Il divario, in </strong>
            <Link href="/value-bets" className="font-semibold text-cyan-700 hover:underline">
              /value-bets
            </Link>
            <strong>.</strong> Quanto margine resta dentro la quota che potresti
            eseguire. Con un solo operatore in lettura è un auto-confronto ed è
            quasi sempre negativo: è la condizione normale, non un guasto.
          </li>
          <li>
            <strong>La forma del movimento, non il suo numero.</strong> Da dove
            è partito, quanto è durato, se è rientrato. Un drop rientrato è un
            falso segnale parziale e il motore lo dichiara.
          </li>
          <li>
            <strong>Il contesto per ultimo, e con diffidenza.</strong> Il
            Contesto 360° è generato da un modello linguistico su fonti
            pubbliche, è dichiarato come tale, non entra nel punteggio e va
            verificato.
          </li>
        </ol>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          6. Che cosa ignorare
        </h2>
        <p className="text-sm leading-relaxed text-slate-700">
          <strong>La percentuale di partite «centrate».</strong> È la metrica
          più ingannevole disponibile e i dati lo mostrano senza ambiguità: la
          coorte v1 del monitor ha centrato il <Number>62,5%</Number> degli
          esiti<Sample>8</Sample> con il CLV peggiore di tutte le coorti
          (−5,72 pp). Vinceva più spesso, a prezzi peggiori della chiusura. Hit
          rate e qualità del prezzo viaggiano in direzioni opposte: la metrica
          di qualità resta il CLV.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          <strong>I campioni piccoli, in entrambe le direzioni.</strong> La
          deviazione standard del profitto per puntata misurata su questi dati è{" "}
          <Number>1,59</Number> per unità puntata. Per dimostrare un ROI
          dell&apos;1% servono circa <Number>199</Number> puntate; per lo 0,5%,{" "}
          <Number>796</Number>. Una sequenza di dieci giocate vinte non prova
          nulla, e una di dieci perse nemmeno.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          <strong>Il punto di pareggio del CLV è zero.</strong> Misurato per
          bucket sull&apos;archivio: sotto 0,0 pp di CLV contro la chiusura fair
          il margine mangia tutto, sopra il vantaggio esiste sulla carta. Il
          CLV medio del monitor è −4,06 pp: non è «poco margine», è un prezzo
          che sta sotto la chiusura di un importo che nessuna gestione del
          bankroll recupera.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6">
        <h2 className="mb-1.5 text-sm font-semibold text-slate-900">
          7. Che cosa deve cambiare perché queste risposte migliorino
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
          <li>
            <strong>Una seconda linea di prezzo.</strong> È il prerequisito di
            tutto il resto: senza un secondo operatore, coordinazione (25 punti)
            e conferma sharp (20 punti) non sono misurabili e il divario resta
            un auto-confronto. La funzione che farebbe il confronto esiste già
            ed è testata; non ha un chiamante perché la fonte non c&apos;è.
          </li>
          <li>
            <strong>Il CLV sulla stessa base.</strong> Oggi la composizione è
            dichiarata in pagina; la soluzione piena è confrontare fair contro
            fair anche sullo storico.
          </li>
          <li>
            <strong>Cadenza di raccolta.</strong> Se il valore sta
            nell&apos;arrivare prima, un monitor che guarda ogni 15-45 minuti
            misura la coda del movimento, non il movimento.
          </li>
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Le tre voci sono scritte in{" "}
          <code className="rounded bg-slate-100 px-1">docs/AUDIT-CONTENUTI.md</code>{" "}
          e in{" "}
          <code className="rounded bg-slate-100 px-1">docs/RESEARCH-BACKLOG.md</code>
          , con i prerequisiti e i vincoli di budget.
        </p>
      </section>

      <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Link href="/" className="text-slate-600 underline underline-offset-2 hover:text-slate-900">
          ← Torna ai movimenti
        </Link>
        <Link
          href="/metodologia"
          className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
        >
          Metodologia e verifiche storiche →
        </Link>
        <Link
          href="/gioco-responsabile"
          className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
        >
          Gioco responsabile →
        </Link>
      </p>
    </main>
  );
}
