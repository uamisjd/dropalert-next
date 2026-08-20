/**
 * Blocco "Verifica empirica (backtest R1)".
 *
 * Pubblica nel sito, in forma dichiarativa, i risultati del backtest
 * storico su dati football-data.co.uk (report completo nel repository:
 * docs/BACKTEST-R1.md, rigenerabile con `npm run backtest:r1`).
 *
 * Vincoli non negoziabili, gli stessi del resto del sito:
 *  1. nessuna promessa: questi numeri descrivono il passato di un
 *     mercato, non un rendimento futuro né un metodo per vincere;
 *  2. i numeri viaggiano con il loro campione (n) e la direzione della
 *     differenza, mai da soli;
 *  3. il blocco sta accanto al CLV, nella zona metodologica della
 *     pagina: non è una vetrina e non filtra i segnali.
 */
export function BacktestNote() {
  return (
    <section
      aria-labelledby="verifica-empirica"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2
        id="verifica-empirica"
        className="mb-1 text-sm font-semibold tracking-wide text-slate-700 uppercase"
      >
        Verifica empirica (backtest R1)
      </h2>

      <p className="mb-3 text-xs leading-relaxed text-slate-600">
        Prima di fidarsi di un monitor di movimenti, è giusto chiedersi se i
        movimenti significhino qualcosa. Abbiamo misurato sette stagioni di
        gocce reali su dati pubblici e congelati:{" "}
        <span className="font-medium text-slate-800">
          football-data.co.uk, 5 leghe (Premier League, Serie A, La Liga,
          Bundesliga, Ligue 1), stagioni 2019/20–2025/26, 12.459 partite
        </span>
        , quote pre-movimento e di chiusura di Pinnacle e Bet365.
      </p>

      {/* tre letture, nell'ordine: che cosa è vero, che cosa non resta, dove sta il valore */}
      <ul className="mb-3 space-y-2 text-xs leading-relaxed text-slate-600">
        <li>
          <span className="font-medium text-slate-800">
            1. Il drop è informazione reale.
          </span>{" "}
          L&apos;esito che scende vince poi più spesso di quanto la sua
          quota di partenza faceva credere — e più il calo è ampio, più il
          divario cresce: sui drop ≥10% la frequenza reale è 28,9% contro
          un&apos;attesa pre-movimento del 25,9% (Pinnacle; n=2.008), e sui
          drop ≥15% è 23,4% contro 19,9% (n=704).
        </li>
        <li>
          <span className="font-medium text-slate-800">
            2. A fine corsa non resta margine.
          </span>{" "}
          La stessa frequenza reale resta sotto la probabilità dichiarata
          dalla chiusura senza margine (fair no-vig Pinnacle) in ogni
          fascia: 33,1% contro 34,3% sui drop ≥5% (n=5.800). Il fair di
          chiusura è calibrato anche sulle partite senza movimenti (45,9%
          reale contro 46,1% atteso, n=734): non è il drop a essere mal
          prezzato — è già nel prezzo finale.
        </li>
        <li>
          <span className="font-medium text-slate-800">
            3. Il valore, quando c&apos;è, sta nell&apos;ingresso precoce.
          </span>{" "}
          Nei dati, chi prendeva il prezzo prima del movimento batteva la
          chiusura fair dell&apos;8–23% a seconda della fascia: ma è un
          limite superiore misurato col senno di poi, non un rendimento
          ottenibile — nessuno sa in anticipo quale esito scenderà. Chi
          arriva dopo il movimento compiuto, nei nostri dati, non trova
          nulla da prendere.
        </li>
      </ul>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Percorso completo, tabelle per lega e per stagione, limiti e
        metodologia: report{" "}
        <span className="font-mono text-slate-600">docs/BACKTEST-R1.md</span>{" "}
        nel repository. Anche qui vale la regola del sito: questi numeri non
        sono un consiglio di scommessa né una promessa di rendimento, e la
        sola misura di qualità del monitor resta il CLV.
      </p>
    </section>
  );
}
