# Studio — Cablaggio di The Odds API nel ciclo di raccolta

> Documento di lavoro per la decisione (punti 1 e 2 della sessione).
> Data: 2026-09-09. Non è una promessa di risultato: è il ragionamento
> verificato sul codice e sui dati, con i numeri accanto.

---

## 0. Domanda posta

> «Abbiamo collegato più API, perché osserviamo solo le quote di BetExplorer?»

**Risposta breve (verificata nel codice, non presunzione).** Il ciclo di raccolta
del monitor (`src/lib/pipeline/scheduler.ts`, `src/scripts/run-collect.ts`)
chiama **direttamente** `collectBetexplorer`. Non passa dal registry dei
provider. The Odds API è registrato e accesso in produzione, ma **non entra mai
nel ciclo di raccolta**: l'unico uso in produzione è la linea sharp di
riferimento nella scheda partita (`getSharpLine`, 1 lettura/partita/giorno).

Di conseguenza:
- tutti i segnali pubblicati restano su **consenso singolo** (`booksTotal=1`);
- coordinazione (25 punti) e conferma sharp (20 punti) restano **non misurabili**;
- il buco `bookmaker_missing` (959 aperti) resta aperto.

---

## 1. Stato attuale della fonte per-bookmaker (verificato)

| Percorso | File | Stato | Costo |
|---|---|---|---|
| Registry/adapter | `optional/the-odds-api.ts` | `enabled=true`, `ADAPTER_IMPLEMENTED=true` in prod | 0 |
| Client HTTP + parser | `the-odds-api-client.ts` + `the-odds-api-odds.ts` | implementato e testato (fixture) | 1 credito/chiamata |
| Persistenza adapter→snapshots | `collect-the-odds-api.ts` | implementato, **non cablato** | 0 in più |
| Linea sharp per scheda partita | `repo/sharp.ts` + `odds-api-sharp.ts` | **unico uso in produzione** | 1 partita/giorno |
| Budget | `odds-api-budget.ts` | 490/mese · 14/gg · 1 lettura/partita/gg · solo segnali attivi | — |
| Mappa competizioni | `sport-keys.ts` | 12 campionati maggiori (vedi sotto) | — |

### 1.1 Mappa competizioni coperte (`sport-keys.ts`) — È UNA SCELTA, NON UN LIMITE

**Scoperta importante (09/09/2026).** La mappa `sport-keys.ts` contiene solo
12 competizioni:

Serie A e B, Premier League e Championship, Liga, Bundesliga, Ligue 1,
Eredivisie, Primeira Liga, Champions League, Europa League, Conference League.

**Ma The Odds API copre moltissimi altri campionati.** L'endpoint pubblico
`GET /v4/sports` (gratuito, non conta quota, serve solo la chiave) elenca il
catalogo completo. Dal suo elenco, il gruppo **Soccer** include, tra gli altri:
Argentina Primera División, Australia A-League, Belgio First Div, Brasile
Série A, Cina Super League, Copa Libertadores, Danimarca Superliga, EFL
Championship/League 1/League 2, FA Cup, EFL Cup, Finlandia Veikkausliiga,
Ligue 2, Bundesliga 2, Giappone J-League, Corea K-League 1, League of
Ireland, Liga MX, MLS, Norvegia Eliteserien, Russia Premier League, Scozia
Premiership, Spagna Segunda División, Svezia Allsvenskan/Superettan, Svizzera
Super League, Turchia Süper Lig, UEFA Nations League, FIFA World Cup, ecc.

Quindi la mappa corta **non** è il tetto dell'API: è una **scelta di budget**
("si spende solo dove la fonte copre davvero il campionato"). Tuttavia è stata
resa troppo corta: esclude campionati che The Odds API **copre davvero** e che
nel monitor BetExplorer sono presenti e rilevanti.

**La conseguenza per l'incongruenza segnalata.** BetExplorer (monitor) e
The Odds API (per-bookmaker) hanno **coperture diverse, non sovrapposte**:
- BetExplorer copre un numero enorme di tornei, **inclusi i minori** (è il
  cuore dichiarato del monitor) e alcuni maggiori;
- The Odds API copre i campionati **principali e una fascia media**
  (Argentina, Brasile, Giappone, ecc.) ma **non** i tornei minuscoli che
  BetExplorer espone copiosamente (es. Algeria Ligue 1, Ecuador Serie B…).

Non è un bug: è la natura delle due fonti. Il monitor guarda BetExplorer
(consenso, tutto il mondo), la linea per-bookmaker guarda The Odds API
(operatori reali, campionati liquidi). La sovrapposizione è **parziale**.
Il lavoro di cablaggio deve quindi: (a) mappare i campionati che The Odds API
**copre davvero** (allargando `sport-keys.ts` dove ha senso), e (b) dichiarare
i tornei minori fuori copertura come **buco aperto**, non colmarli con stime.

### 1.2 Endpoint di scoperta gratuito

`GET /v4/sports?apiKey=...` restituisce l'elenco dei campionati con `key`,
`group`, `title`, `active`. **Non conta quota** (come `GET /v4/sports/{sport}/events`,
anch'esso gratuito). Serve solo a non spendere crediti per scegliere cosa
mappare: è la prima difesa del budget, prima ancora dei contatori.

### 1.3 Regole di budget bloccate (`odds-api-budget.ts`)

```
ODDS_MONTHLY_CAP = 490        // 10 di margine sul limite reale (500)
ODDS_DAILY_HARD_CAP = 14
ODDS_DAILY_FLOOR = 12
ODDS_MAX_PER_MATCH_PER_DAY = 1
// una sola lettura per partita al giorno, e SOLO per segnali attivi
```

`decide()` è un HARD-STOP: se non restituisce `allowed`, non esiste un percorso
alternativo verso la rete. Non si può aggirare dal chiamante.

### 1.4 Strumento di scoperta costruito (dati reali, non a memoria)

Per non ripetere l'errore già fatto con "Brazil: Serie A" (mappare a memoria),
è stato costruito un piccolo strumento che risponde alla domanda di copertura
**con il catalogo reale della fonte**, a costo zero crediti:

- `src/lib/providers/optional/odds-api-sports.ts` — parser puro del catalogo
  `/v4/sports`: legge solo `key`, `group`, `title`, `active`; righe non
  leggibili scartate e contate, mai stimate.
- `src/lib/providers/optional/the-odds-api-sports-client.ts` — HTTP client del
  catalogo (endpoint gratuito), legge e riporta i crediti dichiarati negli
  header per accorgersi se un giorno smettesse di essere gratuito.
- `src/scripts/scopri-copertura-odds.ts` — confronta i campionati in archivio
  (monitor) col catalogo reale della fonte: classifica in **mappati** (chiave
  esatta), **candidati per somiglianza** (da verificare a mano, mai usati
  così), **fuori copertura** (buchi dichiarati). Uso: `npm run odds:scopri`
  (richiede chiave + DB), oppure offline con `--catalogo <file>.json` e
  `--leagues <file>.json` (nessuna rete, nessun DB). Non esiste una modalità
  «solo archivio senza catalogo»: senza catalogo non c'è nulla da confrontare.
- test con fixture congelata: `npm run test:odds-sports`.

Questo strumento **non scrive nulla nel database e non stampa mai la chiave**,
ed è il modo corretto per decidere se e dove allargare la mappa: prima si
osserva il catalogo reale, poi si aggiunge la riga a `sport-keys.ts` solo per
il campionato in cui la fonte espone davvero gli eventi.

---

## 2. Costo reale del cablaggio — stimato sui dati di produzione

Dal `/api/health` di produzione (2026-09-09):

```
signals.byStatus = { forming: 1, active: 4, closed: 300 }   → 5 non-chiusi
```

Quindi i segnali non chiusi (active + forming) sono **circa 5**. Con la regola
"1 lettura/partita/giorno, solo segnali attivi", il tetto teorico giornaliero
del cablaggio è sull'ordine del **numero di segnali attivi**, che oggi è
**molto sotto i 14/giorno garantiti dal budget**.

**Attenzione a non confondere il potenziale col reale:** la maggior parte dei
segnali attivi in produzione è su **tornei minori** (es. Algeria, Brasile C,
Ecuador…), che NON sono nella mappa `sport-keys.ts`. Quindi `sportKeyFor()`
restituirebbe `null` e **non si spenderebbe un credito** per quelli. Il costo
reale del cablaggio, con la mappa attuale, è limitato ai rari segnali attivi su
**campionati maggiori coperti**.

**Conclusione economica:** il cablaggio, se fatto con la regola di budget già
esistente (solo segnali attivi + 1/giorno/partita + mappa corta), è **sostenibile
e dentro i tetti**. Non è questo il collo di bottiglia.

---

## 3. Cosa manca davvero al cablaggio (il vero lavoro)

Per far sì che coordinazione e sharp diventino **osservabili** nel monitor
(cioè che `booksTotal > 1` e `sharp_available = true` nei segnali), serve
collegare la fonte per-bookmaker alla pipeline. Il lavoro tecnico è:

1. **Chiamare** `collectAndPersistTheOddsApiOdds` (o `getSharpLine`) per i
   segnali attivi, **non** per tutte le partite.
2. **Scegliere quali partite**: solo segnali attivi su leghe coperte
   (`sportKeyFor != null`).
3. **Persistire le linee per-bookmaker** in `odds_snapshots` (il DTO
   `OddsQuoteDTO` è già pronto in `the-odds-api-odds.ts`).
4. **Riusare il budget** `decide()` per non sforare i tetti.
5. **Collegare il motore**: in `detect.ts`/`engine.ts`, la coordinazione e la
   conferma sharp si calcolano già se entrano serie per-bookmaker (`isSharp`).
   Serve solo alimentarle.

### 3.1 Il punto delicato: l'interruttore

Il cablaggio deve stare **dietro un flag di default SPENTO**, come già fatto
per l'attivazione del 06/09. In questo modo:
- in produzione **non cambia nulla** finché l'umano non accende il flag;
- il codice, i test e la CI restano verdi e sicuri;
- l'attivazione resta una scelta deliberata, non un effetto collaterale.

**Questo è l'approccio necessariamente prudente** e coerente con la dottrina
del progetto ("una capacità prevista non deve comparire come disponibile").

---

## 4. Scelta della fonte (punto 2)

### 4.1 Requisiti reali

Per rendere osservabili coordinazione e sharp servono, per ciascuna partita
segnalata: **quote per singolo operatore identificabile**, su **mercati
multipli** (per coerenza cross-mercato) e con una **copertura** che includa
tornei minori (il cuore del monitor).

### 4.2 Opzioni (da `docs/AUDIT-CONTENUTI.md` §3.3, misurate non da memoria)

| Fonte | Piano gratuit | Sharp incluso | Nota per questo progetto |
|---|---|---|---|
| **The Odds API** | 500 crediti/mese | no (Pinnacle solo EU, con ritardo) | già presente come adapter; mappa corta → poca copertura tornei minori |
| **SportsGameOdds** | 2 500 oggetti/mese, 10 req/min | **sì, Pinnacle diretto** | oggetti = eventi; book dentro l'evento non costano extra |
| **OddsPapi** | 250 richieste/mese | **sì, 350+ book** | storico incluso senza moltiplicatore |
| **pinnapi / pinnodds** | 100 richieste/giorno | solo Pinnacle | nati per il drop-alerting |

### 4.3 Valutazione

- **The Odds API** è già cablato (client, parser, persistenza, budget, test).
  Ma: mappa corta **esclude i tornei minori** (il cuore del monitor), Pinnacle
  solo EU con ritardo, e 500 crediti coprono ~16 chiamate/giorno. Con ~5
  segnali attivi/giorno basta; con più copertura **non basta da sola** a
  leggere i tornei minori (non mappati).
- **SportsGameOdds** ha la copertura migliore (Pinnacle diretto) ma richiede
  **un adapter nuovo** e una chiave.
- **OddsPapi** idem (adapter nuovo, storico incluso).

### 4.4 Raccomandazione provvisoria

Dato che The Odds API è **già integrato** e il costo del cablaggio è
sostenibile, la scelta immediata è: **cablaggio di The Odds API** (costo quasi
zero di sviluppo, budget dentro i tetti), **dichiarando esplicitamente** che la
copertura resta sui **campionati maggiori mappati** e che i tornei minori
restano scoperti (buco dichiarato, non colmato). Se in futuro si vogliono i
tornei minori, l'opzione da valutare è SportsGameOdds (adapter nuovo).

**Vincoli da rispettare in ogni caso:**
- nessun consenso presentato come prezzo eseguibile (**NO BET** finché manca un
  prezzo individuale fresco) — già garantito da `price-evidence.ts`/`contract.ts`;
- per-bookmaker senza inventare dati: il motore non va toccato, gli adapter
  entrano dall'architettura già pronta;
- budget bloccato in `odds-api-budget.ts`, mai aggirato.

---

## 5. Cosa NON fare

- **Non** interrogare The Odds API per ogni partita (contro il budget).
- **Non** aggiungere fare/linea sharp per partite non segnalate.
- **Non** modificare il percorso BetExplorer (il core del monitor) per
  aggiungere la nuova fonte: si aggiunge una **fase parallela**, non si tocca
  il flusso esistente.
- **Non** presentare una capacità per-bookmaker come disponibile nel monitor
  se poi i segnali restano a consenso.

---

### 4.5 Scoperta decisiva: il monitor è GIÀ onesto (NO BET = nessun prezzo individuale)

Analizzando il contratto decisionale (`src/lib/decision/contract.ts`) ho trovato
il punto che spiega L'INTERA incongruenza, e la chiarisce:

`PRICE_NOT_EXECUTABLE` è un **hard gate**. Se `priceSource !== "bookmaker"` e
`priceSource !== "exchange"`, la decisione è bloccata a **NON_AZIONABILE**,
prima ancora di guardare edge, movimento o sharp. E in `value-bets.ts`
(`scanValueGaps`) la `priceSource` è **impostata a `"consensus"`** per
costruzione:

```ts
/* s.currentPrice nasce dalla dashboard BetExplorer: è il consenso della fonte,
   non il prezzo di un operatore che il lettore possa eseguire. ... */
const priceSource: PriceSource = "consensus";
```

Quindi la pagina /valore (l'elenco dei segnali) **non può MAI produrre un
BET**: con una fonte consensus, il gate `PRICE_NOT_EXECUTABLE` scatta sempre e
la riga resta NON_AZIONABILE. Questo è **corretto e voluto** — è la dottrina
«NO BET finché non c'è un prezzo individuale fresco» applicata all'elenco.

L'unico percorso che può arrivare a CANDIDATA / VALORE_VERIFICATO è la **pagina
partita** (`src/app/matches/[id]/page.tsx`), dove
`priceSource = executablePrice?.source ?? "consensus"`: qui, se esiste una
linea per-bookmaker fresca (dalla linea sharp via `getSharpLine`, cioè
The Odds API), `priceSource` diventa `bookmaker`/`exchange` e il gate può
passare.

**### 4.6 Errore evitato: la somiglianza NON è copertura (precisone)**

Nella prima versione dello strumento di scoperta, il match per "somiglianza"
produceva abbagli di nazione: "Mexico — Liga MX" veniva avvicinato a
"soccer_denmark_superliga", "Japan — J-League" a "soccer_australia_aleague".
Era esattamente l'errore che la dottrina vieta (presentare l'incerto come
certo). Corretto con una regola esplicita:

- **ancoraggio sulla nazione**: il titolo della fonte DEVE nominare la stessa
  nazione del campionato (un titolo di un altro paese non è mai un candidato);
- **competizioni internazionali** (Europa / coppe): servono due token distintivi
  del nome della competizione;
- tutto il resto resta **fuori copertura**, dichiarato, mai stimato.

Test con fixture congelata (`odds-coverage.test.ts`) blocca il comportamento:
niente abbagli tra paesi, le coppe internazionali riconosciute, i tornei non
coperti restano buchi.

**Conclusione strutturale.** Il monitor è già onesto: l'elenco è un livello di
*osservazione* (consenso → NON_AZIONABILE), la partita è il livello di
*decisione* (per-bookmaker → può diventare BET). Non è un bug: è l'architettura
che applica la dottrina. La sensazione di «incongruenza» nasce dal fatto che
i due livelli usano fonti con coperture diverse (BetExplorer minori vs The Odds
API maggiori/media) — ma è proprio la complementarità che consente osservazione
ampia + verificabilità sul sottoinsieme coperto.

Copertura reale della fonte per-bookmaker sul sottoinsieme che genera I SEGNALI:
i drop più ricchi nascono nei campionati **minori** (dove i bookmaker divergono),
che The Odds API **non** copre. Quindi la fonte per-bookmaker conferma solo un
sottoinsieme MAGRO (le leghe maggiori/media, efficienti, con meno drop). Questo
è il passaggio che va dichiarato e deciso, non nascosto.

---

### 4.7 Correzione IMPORTANTE: il cablaggio "ingenuo" INQUINA il consenso

**Verificato sul codice (09/09/2026).** C'è un difetto nel modo più ovvio di
cablaggio, e va detto prima di scrivere codice.

Il motore (`analyzeDrop` in `src/lib/drop/engine.ts`) è **già pronto** per la
fonte per-bookmaker: `getSeriesForMatch` espone `isSharp` e `computeSharp`
filtra su di esso. Ma ci sono due punti che **non** distinguono una linea di
consenso da un bookmaker reale:

1. **`consensusAt(series)`** (la base su cui si misura TUTTO il segnale) fa la
   **mediana di TUTTE le serie**, senza escludere il consenso.
2. **`computeCoordination(series, ...)`** conta **ogni serie come un "book"**,
   sempre senza escludere il consenso.

Il problema: `odds_snapshots` è un **unico tavolo condiviso**. BetExplorer vi
scrive `betexplorer-consensus` (`isConsensus=true`, `isSharp=false`, peso
neutro) e The Odds API vi scriverebbe i bookmaker reali (`pinnacle`,
`betfair_ex_eu`, `smarkets`). Se per la stessa (partita, mercato, selezione)
convivono entrambi, il motore:

- calcola il consenso come **mediana di (consenso + N book)** → il livello di
  riferimento del drop **cambia** rispetto a oggi (inquinato dai singoli book);
- conta il consenso **come un book** in `booksConfirming`/`booksTotal` → la
  coordinazione diventa falsa (il consenso è un aggregato, non un operatore).

In altre parole: **scrivere The Odds API in `odds_snapshots` senza distinguere
il consenso dal per-book altererebbe la misura dei segnali esistenti**, che
oggi è corretta proprio perché lì c'è UN SOLO bookmaker (il consenso). Questo è
esattamente il tipo di "dato inventato" che la dottrina vieta: non inventa
numeri, ma **distorce una misura già buona**.

**Alternativa che evita il difetto.** La linea sharp per la scheda partita
(`getSharpLine` in `src/lib/repo/sharp.ts`) **NON scrive in `odds_snapshots`**:
salva in `system_state` (cache per partita/giorno). Quindi oggi la sharp
**non inquina** il consenso. È il percorso "a parte" corretto.

**Conseguenza per il piano.** Il cablaggio "leggere le quote per-bookmaker e
metterle in `odds_snapshots` per i segnali attivi" NON è un'aggiunta neutra:
va accompagnato da una modifica al motore (escludere le serie `isConsensus`
da `consensusAt` e `computeCoordination`), altrimenti degrada i segnali
esistenti. Il motore non va toccato SOLO se non si scrive in `odds_snapshots`;
se invece si vuole la coordinazione/sharp **dentro i segnali**, il motore va
istruito a distinguere consenso da per-book. Questa è la vera scelta da fare.

**Stato della correzione (09/09/2026, implementata e testata).** Il motore è
**già preparato** a distinguere consenso da per-book, senza cambiare il
comportamento dei dati attuali:

- `BookmakerSeries` ha il discriminante **`isConsensus?`** (`src/lib/drop/types.ts`);
  quando assente/false la serie è un bookmaker reale, quindi la misura odierna
  resta identica.
- `consensusAt` (`engine.ts`) calcola la mediana **solo sui book reali**; se a
  quell'istante non esiste alcun book reale, fa fallback sulla mediana di tutte
  le serie (così la sola linea di consenso continua a produrre un'ampiezza, senza
  inventare book).
- `computeCoordination` (`engine.ts`) conta **solo i book reali** in
  `booksTotal`/`booksConfirming`/`booksOpposing`/`booksFlat` e nel dettaglio
  `perBook`. Con la **sola** linea di consenso (marcata `isConsensus`) si ha
  `booksTotal = 0` → coordinazione "non osservabile", mai presentata come
  conferma di un book. Oggi, finché `getSeriesForMatch` non marca il consenso,
  quella riga è ancora vista come un book reale: è il comportamento che il
  cablaggio dovrà spegnere (punto "Resta da fare" sotto).
- Guard-rail in `src/lib/drop/__tests__/engine.test.ts` (sezione **[4b]**):
  mediana che esclude il consenso quando esistono book reali, fallback senza
  book reali, coordinazione che non conta il consenso, `booksTotal 0` con solo
  consenso, e non-regressione sui book reali. Test motore: **66/66 verde**;
  `npm run typecheck`: pulito.

**Resta da fare al momento del cablaggio (dietro flag + smoke test live):**
- il cablaggio in `getSeriesForMatch` è **già pronto** (`src/lib/repo/odds.ts`):
  se l'env `DROP_EXCLUDE_CONSENSUS_BOOKS=true`, la riga di consenso (chiave
  `betexplorer-consensus`) viene marcata `isConsensus` e il motore la esclude
  davvero dai dati di produzione. **Default `false`**: finché il flag è spento,
  il comportamento dei segnali esistenti resta identico a oggi;
- **Aggiornamento 2026-09-10: la fase di cablaggio è ora implementata** in
  `src/lib/providers/optional/odds-collect-wire.ts` e inserita nel ciclo
  (`src/lib/pipeline/scheduler.ts`, fase «1b», solo modalità `full`, mai
  `collect_only` e mai con `--no-collect`). È governata da `wireGate()`: si
  accende **solo con entrambi** `ODDS_WIRE_COLLECT=true` e
  `DROP_EXCLUDE_CONSENSUS_BOOKS=true`, altrimenti resta spenta dichiarando
  il motivo. Regole applicate (tutte con motivo in italiano): solo segnali
  `active` con indice ≥ 45, mai partite demo o non giocabili, mai kickoff
  passato, mai competizioni fuori copertura, una lettura per partita al
  giorno (marcatore dedicato + cache della linea sharp), budget via
  `decide()` come unico gate di rete, credito contato quando la richiesta
  esce davvero. Test puri: `npm run test:odds-wire` (24 asserzioni).

  Completata anche la **chiusura del cerchio** attorno alla fase:
  - **una sola lettura al giorno, su entrambi i percorsi**: la regola
    condivisa `alreadyReadToday` (in `odds-api-budget.ts`) fa sì che il
    cablaggio non rilegga una partita già letta dalla scheda partita e
    viceversa (`getSharpLine` ora controlla il marcatore del cablaggio,
    `wireMatchKey`): niente doppio credito sulla stessa partita;
  - **osservabilità**: `/api/jobs/analyze` restituisce il report della fase
    (`wire`), e `/api/health` dichiara `wire.enabled`/`wire.reason` e, quando
    è accesa, il budget condiviso; la nota `capabilities.note` distingue i tre
    casi reali (fonte per-book assente / cablaggio pronto ma spento / attivo);
  - **smoke test dell'attivazione**: `npm run smoke:odds-wire` elenca i
    candidati del ciclo a zero crediti con la STESSA selezione (`listWireSignalRows`
    + `pickWireCandidates`), e `npm run smoke:odds-wire -- --read <id>` esegue
    la lettura reale (1 credito) con la stessa persistenza del ciclo
    (sorgente `the-odds-api-wire-smoke`, separata dai dati reali).
  Restano quindi, come da dottrina, **solo** i passi umani: smoke test live
  del cablaggio e confronto prima/dopo sui punteggi in modalità mista
  (consenso + per-book) prima di accendere i due flag su Vercel.

---

### 4.8 Scoperta decisiva: il "radar dei sospetti" NON è una nuova pagina

**Verificato sul codice + evidenza a runtime (09/09/2026).** La richiesta «uno
step 4: radar dei match sospetti» è stata studiata a fondo prima di scrivere
codice, perché la dottrina impone di non duplicare e di non presentare come
eseguibile ciò che non lo è. La conclusione è netta: **non va costruita una
nuova pagina radar**, ed ecco perché. (Il concetto dell'utente è già inquadrato
in `docs/STUDIO-CONCETTO-MATCH-SOSPETTE.md`; qui se ne risolve la forma di
presentazione e si separa la correzione al motore necessaria per renderla onesta.)

**1. La homepage è GIÀ il radar di osservazione.** `src/app/page.tsx` raggruppa
i segnali per partita (`groupByMatch`), mostra una card per match con il
segnale più forte (`MatchCard` → `SignalCard`) e ha **già** un selettore di
ordinamento (`SignalFilters`): `score` (Indice di fiducia = `confidenceScore`),
`drop` (variazione quota), `kickoff` (orario). La `SignalCard` espone **già**
`confidenceScore`, `dropPct`, `wideDrop` (>15%), `booksConfirming/booksTotal`
(dichiarando onestamente **«Linea osservata»** quando `booksTotal ≤ 1`), la
sharp («non osservabile» quando la fonte non pubblica i singoli book) e il
contesto (`contextCompact`). Quindi un "radar ordinato per `confidenceScore`"
è **letteralmente la homepage con l'ordinamento di default (`sort=score`)**:
aggiungerla da zero sarebbe ridondanza, non valore.

**2. Una radar con flag BET su quell'elenco è l'ANTI-pattern già rimosso.**
`src/app/smart-bets/page.tsx` è stato **deliberatamente sostituito** da un
`redirect("/value-bets")` con commento esplicativo: la vecchia pagina
«trasformava un no-vig della stessa linea in un punteggio con Kelly e in una
priorità operativa. Non è una decisione difendibile: il consenso BetExplorer
non è una quota eseguibile». Mettere su un elenco di sola osservazione un
punteggio di sospetto etichettato come BET è **esattamente** quell'errore. Il
gate `PRICE_NOT_EXECUTABLE` (§4.5) lo blocca già: con `priceSource =
"consensus"` ogni riga resta NON_AZIONABILE — e così deve restare.

**3. Il lavoro vero è un altro, e resta quello di §4.7.** La misura onesta a
livello per-book esiste (il motore calcola `coordination`, `sharp`,
`coverage`), ma oggi `odds_snapshots` ha UN SOLO bookmaker (il consenso), quindi
`computeCoordination` è banalmente `booksTotal=1`. Il valore aggiunto del
"sospetto" arriverà solo quando ci sarà una **fonte per-bookmaker reale**
sui campionati minori (FASE B, §6), e **solo dopo** la correzione del motore
(§4.7) che impedisce al consenso di contaminare la misura. A quel punto il
livello giusto per mostrarla **non è una nuova pagina**, ma il **dettaglio
partita** (`src/app/matches/[id]/page.tsx`), che è l'unico livello di decisione
(§4.5) e che già usa `DecisionStatusBlock`.

**Evidenza a runtime (script `src/scripts/diagnosi-consenso-misto.ts`**, che
usa le funzioni PURE del motore, non tocca DB né modifica codice):
- *Scenario A — solo consenso (stato attuale):* consenso 2.00→1.70, `deltaPp`
  8.82 pp, `coordination booksTotal=1 confirming=1`, `sharp available=false`.
- *Scenario B — consenso + book reali (cablaggio naïf):* consenso di
  riferimento 2.05→1.72 (la mediana cambia perché ora include Pinnacle),
  `deltaPp` 9.36 pp, `coordination booksTotal=3` con **`betexplorer-consensus`
  contato come un book**, `sharp available=true confirms=true`.

Conferma in cifre §4.7: mescolare il consenso al per-book cambia la base del
drop e gonfia la coordinazione. Finché non c'è correzione, il per-book non va
messo in `odds_snapshots`.

**Corollario operativo (cosa fare / non fare):**
- **NON costruire** una pagina `/sospetti` che riordini i segnali con flag BET:
  duplica la homepage e reintroduce l'anti-pattern di `/smart-bets`.
- **NESSUN codice di radar** finché non c'è una fonte per-bookmaker reale sui
  campionati minori.
- **Quando** quella fonte viene cablata: PRIMA correggere il motore (§4.7,
  dietro flag default OFF), POI fare smoke test live, POI (solo se la fonte
  copre davvero i minori) esporre la coordinazione per-book nel dettaglio
  partita a fianco di `DecisionStatusBlock`, gated.
- Il guard-rail di §4.7 è **già scritto** in `src/lib/drop/__tests__/engine.test.ts`
  (sezione **[4b]**): dimostra che con la fonte per-book attiva le serie
  `isConsensus` NON compaiono in `booksTotal`/`booksConfirming` né nella mediana
  di `consensusAt`, e che in assenza di book reali il consenso resta l'unica
  base usabile (fallback, non book). Al momento del cablaggio basta accendere
  `isConsensus` in `getSeriesForMatch` per renderlo operativo.

---

## 6. Decisione presa (umano, 09/09/2026) e piano a DUE FASI

L'umano ha scelto: **"entrambi, ma in due fasi"** — prima si dichiara il quadro
(capitoli 0–5, già corretto), poi si valuta la seconda fonte per i minori;
The Odds API resta conferma parziale sul sottoinsieme coperto.

Dunque il piano è:

**FASE A (subito, a costo zero, niente cablaggio).**
Dichiarare e verificare il quadro già onesto. Il monitor è corretto:
- l'elenco /valore resta su consenso → NON_AZIONABILE (per dottrina);
- la pagina partita è l'unico livello che può produrre un BET, e solo con una
  linea per-bookmaker fresca (The Odds API via `getSharpLine`).
Misurare la copertura reale con lo strumento di scoperta (vedi sotto), così la
decisione sulla seconda fonte parte da dati reali, non da memoria.

**FASE B (decisione deliberata dell'umano).**
Se dal confronto la copertura reale sui campionati del monitor risulta sottile
(come da catalogo: The Odds API copre una fascia media, non i minori dove
nascono i drop), la mossa per avere la per-bookmaker sui MINORI è una **seconda
fonte** (SportsGameOdds o OddsPapi, con Pinnacle diretto): adapter nuovo +
chiave + budget. Non forzare The Odds API a fare un lavoro che non può fare.

**Regole che restano valide in entrambe le fasi:**
- nessun consenso presentato come prezzo eseguibile (**NO BET** finché manca un
  prezzo individuale fresco) — già garantito dal gate `PRICE_NOT_EXECUTABLE`;
- per-bookmaker senza inventare dati: il motore non va toccato;
- budget `decide()` come unico gate, mai aggirato;
- cablaggio sempre **dietro flag default OFF**.

---

## 7. Strumento di scoperta — come usarlo (a costo zero)

Lo strumento risponde «quali dei campionati del monitor sono davvero coperti da
The Odds API?» con dati reali. **Non scrive nel DB e non stampa la chiave.**

```bash
# Misura reale (chiave + DB in produzione):
npm run odds:scopri

# Offline, con file (nessuna rete, nessun DB):
npm run odds:scopri -- --catalogo <file>.json --leagues <file>.json
```

L'output classifica ogni campionato in tre gruppi:
- **mappati** (chiave esatta dalla mappa), **candidati per somiglianza**
  (verificare a mano, mai usati così), **fuori copertura** (buchi dichiarati).

Su una fixture congelata del catalogo, il risultato è stabile e testato:
12 mappati esatti, 9 candidati corretti (Brazil, Argentina, Japan, Mexico,
Denmark, Norway, Sweden, Switzerland, Turkey), 4 fuori copertura (Algeria,
Ecuador, Chad + USA-MLS per titolo ambiguo). Test:
`npm run test:odds-sports`.
