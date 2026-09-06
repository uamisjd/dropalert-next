# Contratto decisionale — DropAlert

Ultimo aggiornamento: **2026-09-06**. Questo documento è la specifica stabile del
passaggio da osservazione del mercato a eventuale valutazione di una giocata. È
vincolante per UI, repository, adapter e sessioni future.

## 1. Regola principale

DropAlert non deve trasformare automaticamente un drop in una giocata. La catena è:

```text
dato grezzo
  → qualità e freshness
  → forma del movimento
  → mercato completo
  → fair indipendente
  → prezzo eseguibile
  → contesto/news
  → validazione storica fuori campione
  → stato decisionale
```

Un campo assente è `non misurabile`, non zero e non una stima. Un numero positivo
non è sufficiente per autorizzare un ordine.

## 2. Stati e hard gate

| Stato | Significato | Requisiti minimi |
|---|---|---|
| `NON AZIONABILE` | Non si può valutare una giocata | kickoff passato/non valido, errore, prezzo assente o stale, mercato incompleto, fonte non eseguibile |
| `OSSERVAZIONE` | Movimento o divario degno di studio, ma non decisione | dati pre-gara utilizzabili, però manca fair indipendente, edge sufficiente, conferma sharp o forma coerente |
| `CANDIDATA` | Tutti i gate operativi sono soddisfatti, ma l’ipotesi non è ancora dimostrata | prezzo reale di bookmaker/exchange, mercato completo, freshness entro soglia, fair indipendente, edge sopra soglia, movimento e sharp coerenti |
| `VALORE VERIFICATO` | Ipotesi sostenuta da evidenza storica indipendente | tutti i requisiti di `CANDIDATA` + campione minimo + out-of-sample superato + CLV positivo misurato + calibrazione superata |

`VALORE VERIFICATO` non significa vincita garantita e non autorizza automaticamente
Kelly o sizing. Sizing e stake richiedono un contratto separato e non sono output
operativi finché la base matematica non è dimostrata.

Il modulo puro che applica questi gate è
`src/lib/decision/contract.ts`; restituisce sempre motivi e avvisi. Il contratto tiene
separati anche segno del drop, durata, flash/rimbalzo, direzione, timing, stato
context/news e numero di notizie: nessuno di questi campi viene riutilizzato come
probabilità fair. I test sono in `src/lib/decision/__tests__/contract.test.ts`.

## 3. Semantica delle fonti attuale

### BetExplorer

- È la fonte reale del monitor.
- Salva una riga sintetica con chiave `betexplorer-consensus`.
- Fornisce drop, apertura, massimo/minimo quando osservabili, ultima rilevazione,
  accordo pubblicato e risultati secondo la copertura della fonte.
- **Non fornisce una quota di un singolo bookmaker.** Il consenso non è un prezzo
  eseguibile e non può produrre da solo +EV, stake o Kelly.
- `/value-bets` calcola soltanto il divario osservato contro il no-vig della linea
  completa della stessa fonte. Le righe sono marcate `priceSource: consensus`,
  `priceExecutable: false` e passano a `NON AZIONABILE`.

### The Odds API

- `src/lib/providers/optional/the-odds-api.ts` ha ancora
  `ADAPTER_IMPLEMENTED = false`: non dichiarare la capacità di ingest multi-book
  come disponibile. Il client HTTP, il parser, il percorso di persistenza e le
  fixture sono ora implementati e testabili, ma manca ancora uno smoke test live
  con chiave reale e database raggiungibile.
- Esistono parser puri e un percorso sharp con budget in
  `src/lib/providers/optional/odds-api-odds.ts`,
  `odds-api-sharp.ts` e `src/lib/repo/sharp.ts`. Il percorso ora conserva, quando
  la risposta lo permette, le linee complete per bookmaker e il no-vig della
  prima linea sharp completa.
- Questo non equivale a una integrazione completa del collector o a un prezzo
  eseguibile per l'utente: la fotografia viene usata nella scheda partita, il
  prezzo sharp è un riferimento e non viene promosso automaticamente a quota
  acquistabile. La chiave, la copertura, il matching, la freshness e la
  disponibilità del bookmaker devono essere verificati separatamente.
- Il percorso sharp attuale ha budget conservativo e una lettura al giorno. Un
  risultato `non osservabile` non è una smentita. Una fair sharp completa resta
  comunque una fair di riferimento: non promuove da sola una riga a `CANDIDATA`.

## 4. Numeri e soglie dichiarate

- Freshness del monitor: la soglia generale del dato è 90 minuti
  (`STALE_SNAPSHOT_MINUTES`). Un prezzo destinato all’esecuzione dovrà avere una
  soglia propria concordata con il provider; non si può riusare automaticamente
  la freshness del consenso.
- Linea completa: tutte le selezioni necessarie allo stesso mercato, bookmaker e
  istante. Non si mescolano letture di orari diversi.
- No-vig: proporzionale (`fairMarket` / `computeValueGap`) solo quando la linea
  completa è presente. Il no-vig della stessa linea non è fair indipendente.
- Edge minimo operativo provvisorio nel gate puro: `2%`, come soglia esplicita e
  modificabile. Non è una prova statistica e non promuove una riga da solo.
- Validazione minima nel gate: 30 osservazioni; la soglia non sostituisce
  intervalli di confidenza, calibrazione o analisi della coorte.

## 5. Cosa mostrare e cosa non mostrare

La UI può mostrare apertura, massimo/minimo, ultima rilevazione, drop, durata,
rimbalzi, freshness, completezza, book osservati, sharp, news e contesto solo con
la loro provenienza e con `non noto` quando mancano.

Non deve mostrare come operativo:

- una quota di consenso con etichetta «eseguibile»;
- una fair derivata dallo stesso prezzo che valuta;
- +EV, «giocata consigliata», stake, bankroll o Kelly su una riga consensus;
- una conferma sharp quando la linea indipendente non è stata realmente letta;
- una promozione a `VALORE VERIFICATO` senza coorte fuori campione e CLV.

Il divario positivo della pagina attuale è quindi una misura di auto-confronto, non
un edge commerciale. La pagina deve poter dire `NO BET` anche quando la lista ha
righe numeriche.

## 6. Roadmap vincolata

1. Mantenere il gate puro e collegarlo a ogni vista che ordina o filtra segnali.
2. Integrare una fonte per-bookmaker/sharp solo dopo contratto, costi, copertura,
   rate limit, persistenza, matching di partite, freshness e fixture di test.
3. Separare nel database e nei DTO prezzo osservato, bookmaker, consenso, exchange,
   istante della quota e istante della raccolta.
4. Salvare e visualizzare la forma del movimento, qualità del dato, news/context e
   lacune senza trasformarle in punteggio favorevole.
5. Aggiungere backtest temporale senza leakage, CLV, calibrazione, ROI e intervalli
   di confidenza. Nessun peso o soglia va ricampionato guardando il risultato.
6. Solo dopo i punti precedenti discutere se una riga `CANDIDATA` può diventare
   `VALORE VERIFICATO`; Kelly e sizing restano fuori dal flusso operativo.

## 7. Verifiche minime prima di una modifica futura

```bash
npm run typecheck
npm run test:decision
npm run test:value-lines
npm run lint
```

`test:pipeline` e `build` richiedono il database/configurazione locale: se non sono
presenti, l’errore va dichiarato e non sostituito con dati fittizi.
