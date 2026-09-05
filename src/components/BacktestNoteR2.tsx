/**
 * Blocco "Validazione live (backtest R2)".
 *
 * Terzo blocco di trasparenza: i verdetti della validazione sui dati
 * STESSI del monitor (report: docs/BACKTEST-R2.md, rigenerabile con
 * `npx tsx scripts/backtest-r2.ts`). Stessa disciplina dei blocchi R1 e
 * R1.5: numeri col loro campione, CLV negativi pubblicati come sono,
 * nessuna promessa.
 *
 * Il CLV resta l'unica metrica di qualità: l'hit rate è informativo e
 * qui risulta ingannevole — dichiararlo è il punto del blocco.
 */
export function BacktestNoteR2() {
  return (
    <section
      aria-labelledby="validazione-live-r2"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2
        id="validazione-live-r2"
        className="mb-1 text-sm font-semibold tracking-wide text-slate-700 uppercase"
      >
        Validazione live (backtest R2)
      </h2>

      <p className="mb-3 text-xs leading-relaxed text-slate-600">
        I backtest precedenti leggevano dati storici di mercato. Questo
        misura il monitor su sé stesso:{" "}
        <span className="font-medium text-slate-800">
          57 segnali rilevati dal 20 al 25 agosto, 52 con CLV calcolabile
        </span>
        , 45 con risultato finale. Soglie dichiarate: sotto le 30
        osservazioni un confronto è inconcludente e resta tale.
      </p>

      <ul className="mb-3 space-y-2 text-xs leading-relaxed text-slate-600">
        <li>
          <span className="font-medium text-slate-800">
            1. Nessun segmento con CLV positivo.
          </span>{" "}
          Media −4,06 punti percentuali, la chiusura è stata battuta solo
          nel 7,7% dei casi: il prezzo al rilevamento è quasi sempre
          peggiore della chiusura. Il monitor vede il movimento dopo che
          il mercato lo ha già incorporato — esattamente ciò che il
          backtest storico (R1) aveva misurato: nessun edge a fine corsa.
        </li>
        <li>
          <span className="font-medium text-slate-800">
            2. L&apos;hit rate non è una metrica di qualità.
          </span>{" "}
          La versione v1 dell&apos;algoritmo ha centrato il 62,5% degli
          esiti (n=8) con il CLV peggiore in assoluto (−5,72 pp): vinceva
          più spesso, a prezzi peggiori. Il valore sta nel prezzo preso,
          non nell&apos;esito: per questo la pagina /ieri dichiara «non è
          un rendimento né un consiglio».
        </li>
        <li>
          <span className="font-medium text-slate-800">
            3. Il moltiplicatore di suspicion-v2: direzione giusta,
            verdetto in sospeso.
          </span>{" "}
          I segnali con moltiplicatore 0,75 mostrano il CLV meno negativo
          (−3,24 pp, n=38) rispetto ai comparatori — coerente con R1.5 —
          ma i confronti diretti restano sotto le 30 osservazioni:
          inconcludente. Si accumula, non si tocca.
        </li>
      </ul>

      <p className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
        <span className="font-semibold">Cosa resta vero:</span> questi
        numeri negativi sono pubblicati così come sono. Il monitor misura
        movimenti di mercato e la propria capacità di prenderne il prezzo
          — e la misura dice che oggi il prezzo al rilevamento non batte la
          chiusura. Nessun numero di questo sito è una garanzia di vincita.
      </p>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Percorso completo, tabelle per fascia/versione/tempistica e
        limiti: report{" "}
        <span className="font-mono text-slate-600">docs/BACKTEST-R2.md</span>{" "}
        nel repository (rigenerabile sui dati vivi del deploy).
      </p>
    </section>
  );
}
