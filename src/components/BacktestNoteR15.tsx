/**
 * Blocco "Verifica empirica 2 — segmenti (backtest R1.5)".
 *
 * Secondo blocco di trasparenza: pubblica i verdetti del backtest
 * segmentato con validazione out-of-sample (report completo nel
 * repository: docs/BACKTEST-R1.5.md, rigenerabile con
 * `npm run backtest:r15`). Stessa disciplina del blocco R1: numeri col
 * loro campione, direzione dichiarata, nessuna promessa.
 *
 * Il legame con suspicion-v2 è esplicito: le due classi che riducono la
 * fiducia nel badge ambra derivano dai verdetti T1 e T3 di questo
 * backtest — la ricerca letta nel prodotto, non due etichette a caso.
 */
export function BacktestNoteR15() {
  return (
    <section
      aria-labelledby="verifica-empirica-2"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2
        id="verifica-empirica-2"
        className="mb-1 text-sm font-semibold tracking-wide text-slate-700 uppercase"
      >
        Verifica empirica 2 — segmenti (backtest R1.5)
      </h2>

      <p className="mb-3 text-xs leading-relaxed text-slate-600">
        Le stesse partite del backtest R1 (football-data.co.uk, 5 leghe,
        2019/20–2025/26, Pinnacle), lette per segmenti con una regola
        dichiarata: le ipotesi si stimano su{" "}
        <span className="font-medium text-slate-800">
          2019/20–2022/23
        </span>{" "}
        e si validano{" "}
        <span className="font-medium text-slate-800">
          out-of-sample su 2023/24–2025/26
        </span>
        . Ciò che non regge fuori dal campione si scarta e si dichiara
        scartato.
      </p>

      <ul className="mb-3 space-y-2 text-xs leading-relaxed text-slate-600">
        <li>
          <span className="font-medium text-slate-800">
            1. I drop sugli sfavoriti sopravvalutano l&apos;esito.
          </span>{" "}
          Sull&apos;esito sceso con quota di partenza oltre 3.0, la
          frequenza reale resta 4,0 punti sotto l&apos;attesa fair fuori
          dal campione (20,0% contro 24,0%, n=1.190). I favoriti scesi
          restano calibrati: 63,3% reale contro 63,3% atteso.
        </li>
        <li>
          <span className="font-medium text-slate-800">
            2. Nessuna lega produce vantaggio.
          </span>{" "}
          Fuori dal campione, tutte le cinque leghe restano sotto o in
          linea con l&apos;attesa fair: per questo non esistono segmenti
          per lega nel prodotto, e non ne verranno finché i numeri non
          diranno altro.
        </li>
        <li>
          <span className="font-medium text-slate-800">
            3. Casa e trasferta non sono equivalenti.
          </span>{" "}
          Il pattern dei drop sulla casa non regge fuori dal campione: da
          +0,3 punti in-sample a −4,9 out-of-sample. La trasferta resta
          stabile e calibrata. L&apos;equivalenza è scartata e dichiarata
          scartata.
        </li>
        <li>
          <span className="font-medium text-slate-800">
            4. Più ampio il calo, più valore portava il prezzo di prima.
          </span>{" "}
          Il CLV per campione del prezzo pre-movimento cresce in modo
          monotono con l&apos;ampiezza del drop ed è stabile fuori dal
          campione, fino alla fascia ≥15%. È un limite misurato col senno
          di poi, non un rendimento ottenibile.
        </li>
      </ul>

      <p className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
        <span className="font-semibold">
          Questi verdetti vivono nel prodotto.
        </span>{" "}
        Le due classi che attivano il badge ambra «possibile
        iper-reazione (storico)» — il drop sulla casa e il drop
        sull&apos;esito sfavorito con quota oltre 3.0 — derivano dai
        verdetti 1 e 3 di questo backtest: riducono la fiducia del
        punteggio, senza mai nascondere il segnale. Il moltiplicatore è un
        valore iniziale, e la prova che funzioni verrà dal confronto
        previsto in R2, non da questi numeri.
      </p>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Percorso completo, tabelle per segmento, in-sample e
        out-of-sample: report{" "}
        <span className="font-mono text-slate-600">
          docs/BACKTEST-R1.5.md
        </span>{" "}
        nel repository. Anche qui vale la regola del sito: questi numeri
        non sono un consiglio di scommessa né una promessa di rendimento.
      </p>
    </section>
  );
}
