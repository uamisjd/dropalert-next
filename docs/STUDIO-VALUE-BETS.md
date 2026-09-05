# «Value Bets (+EV)»: da dove vengono quei numeri

> Audit della sezione mostrata nello screenshot: **Opportunità attive 199**, **Edge medio
> rilevato +19,8%**, card `Kyoto – Maruyasu Okazaki` con quota 8,81, Fair 9,21,
> **edge +196,7%**, Kelly 1,9% = **18,70 €** su un bankroll di 1 000 €.
> Commit sotto esame: `b43dcf6` — *Quantitative Prediction Terminal*. Metodo: lettura del
> percorso della pagina (repo → motore → tabella) e ricostruzione della sua formula sui dati
> congelati del repo. Data: 2026-09-04.

**Verdetto in tre righe.** L'edge della pagina non è un vantaggio atteso: è **la variazione di
prezzo già avvenuta** (apertura → ora), ribattezzata «edge» e confrontata con una «quota fair»
che non è una fair — è il prezzo corrente moltiplicato per un margine ipotizzato (1,045). La
pagina non ha modo di sapere se quell'offerta esista ancora: legge i 200 segnali migliori di
sempre, **senza finestra temporale**, e infatti propone puntate su partite già giocate. Il
metodo pubblicizzato nell'header — *Shin / Power No-Vig* — in questo percorso **non viene mai
invocato**.

---

## 1. Che cosa calcola, riga per riga

Percorso: `src/app/value-bets/page.tsx` (server, `revalidate = 60`) → `getValueOpportunities`
(`src/lib/repo/value-bets.ts`)
→ `getDashboardData({}, now)` (ossia: **nessun filtro**, i 200 segnali migliori di sempre,
`src/lib/repo/dashboard.ts:591-617`) → `calculateKellyStake`.

| Campo della card | Come viene prodotto | Che cosa misura davvero |
|---|---|---|
| `QUOTA ATTUALE 8,81` | `s.currentPrice`, ultima lettura del consenso | l'unico numero eseguibile |
| `Fair: 9,21` | `fairProb = min(0.95, (1/currentPrice) / 1.045)`, `fairOdds = 1/fairProb` → **`currentPrice × 1,045`** (`value-bets.ts:41-44`) | il prezzo corrente ribassato di un margine **ipotizzato**: nessuna devig, nessun libro sharp |
| `EDGE +196,7%` | `priceToEvaluate = (apertura > corrente ? apertura : corrente × 1,05)`, `edge = fairProb × priceToEvaluate − 1` (`:46-53`) | **quanto è caduta la quota**. 8,81 × 1,045 = 9,206; +196,7% ⇒ prezzo valutato ≈ 27,3: è il confronto fra l'apertura del venerdì e l'oggi, non un'offerta acquistabile |
| `PROB 10,9%` | `1 / (quota × 1,045)` | 1/9,206: la probabilità implicita **del numero qui sopra**. La «True Prob No-Vig» del titolo non esiste |
| `KELLY 1,9% · 18,70 €` | `calculateKellyStake({ offeredOdds: priceToEvaluate, trueProbability: fairProb })`, quarter Kelly, tetto 5% (`:53-60`, `src/lib/quant/kelly.ts:65-75`) | Kelly con `p` **derivata dallo stesso prezzo** che si sta valutando: circolo chiuso. Nessun margine di sicurezza, nessun bankroll reale |
| `FIDUCIA 97` | `s.normalizedScore ?? s.confidenceScore ?? 50` (`:86`) | l'indice del drop sull'unica scala dove è misurabile (capped 55): lo stesso 97 che `/metodologia` dichiara non paragonabile a un'accuratezza |
| `Sharp: 8,46` (se `sharpConfirms`) | `currentPrice × 0,96` (`:85`) | **costruito, non letto**. Non è la linea di un bookmaker sharp |
| `Opportunità attive: 199` | numero delle righe prodotte (`:119-122`), con `edgePct: Math.max(0.5, edgePct)` (`:82`) | **quanti segnali sono stati letti**, non quante occasioni esistono: con il pavimento a +0,5% nessuna riga può risultare scartata. 200 è il `limit` dell'elenco, e 199 = 200 meno le righe senza prezzo |
| `Edge medio +19,8%` | media dei `edgePct` sulle righe ordinate (`:111-118`) | media dell'ampiezza dei cali di prezzo nell'archivio |
| `Market Lag`, `Sfrutta la lentezza dei bookmaker` | etichette (`ValueScannerTable.tsx:134,194`) | nessun ritardo di mercato è mai misurato: `minutesBeforeKickoff` non viene letto da nessun calcolo (studio §2, `STUDIO-PARTITE-FINITE.md`) |

Aritmetica verificata sui numeri dello screenshot: `8,81 × 1,045 = 9,206` (la card legge 9,21),
`1/9,206 = 10,86%` (legge 10,9%), Kelly: `b = 26,31`, `f = (0,10863×26,31 − 0,89137)/26,31 =
7,48%`, quarto di Kelly = **1,87%** → **18,70 €** su 1 000. Tutto torna: i numeri sono coerenti
fra loro. Il problema non è il calcolo — è che **il prezzo usato nel calcolo non è più
disponibile**.

## 2. Sei difetti, in ordine di gravità

**2.1 L'edge è retrospettivo, presentato come opportunità.** `priceToEvaluate` è l'apertura,
cioè il prezzo di quando il movimento è cominciato. L'unica cosa che si può comprare è la
colonna accanto (`QUOTA ATTUALE`), e quella — con la «fair» costruita così — dà un edge di
**−4,3%** su ogni riga: il margine ipotizzato. Il `× 1,05` del ramo alternativo garantisce da solo
un "+0,5%" a ogni segnale.

**2.2 Il pavimento che trasforma i segnali in «occasioni».** `Math.max(0.5, edgePct)` e
`expectedValue: Math.max(0.005, …)`: la pagina non può mai mostrare «−EV». Un monitor che non può
dire «niente da vedere» non è un monitor.

**2.3 Nessuna finestra temporale, nessuna esclusione delle partite giocate.**
`getDashboardSignals` ordina per `confidenceScore` e prende 200 righe **di qualsiasi data**
(`dashboard.ts:591-617`); lo stato diventa `"active"` o `"live"` (`value-bets.ts:91`) anche a partita
conclusa. Prova in casa: la card `Saoura – Horoya · ven 04/09 ore 20:00 · SELEZIONE 2 (Trasferta)
· +182,6% · 21,20 €` è la stessa partita che `/ieri` elenca come **«mancata — gol finali 1–0»**. Il
database ha il risultato e la pagina chiede di puntarci sopra.

**2.4 Il metodo dichiarato non è quello usato.** Header: «Metodo di stima: **Shin / Power
No-Vig**» (`src/app/value-bets/page.tsx:63-64`), e subito sopra «Sfrutta la lentezza dei bookmaker
e ottieni un **vantaggio matematico di lungo periodo**» (`:45-46`). Nel percorso `/value-bets` non c'è nessuna chiamata a `getBestFairOdds`
né a `src/lib/quant/devig-advanced.ts`, che pure Shin lo implementa per bene (`devigShin`,
`:19-97`: risolve il parametro *z* degli insider per bisezione e rinormalizza le probabilità). C'è una divisione per 1,045. Nel repo esiste la
funzione giusta e la pagina ne pubblicizza il nome usando un'altra.

**2.5 Le puntate.** Un bankroll inseribile, una stake in euro e una selezione nominata
(«2 (Trasferta)») violano il contratto del progetto — README: «nessun consiglio di scommessa,
nessuna selezione indicata» (regola ribadita in `/strumenti`: *«nessuna selezione indicata»*), e
`/gioco-responsabile`. Un grep di `disclaimer|consiglio|responsab` su `value-bets`, `trading`,
`surebet` restituisce **zero risultati**: le tre pagine quant non hanno una riga di cautela, mentre
`SiteNav.tsx:8` mette `/value-bets` in **evidenza** come prima voce.

**2.6 Stessa classe di errore nelle pagine sorelle.** `/trading`:
`src/lib/repo/trading-opportunities.ts:46-56` calcola il green-up con *back all'apertura* e
*lay all'oggi* (stesso vizio del punto 2.1) e presenta `exampleNetProfitEuros` come profitto
dell'opportunità, con commissione 4,5% assunta. `/surebet`: «profitto matematico certo al 100%»
contro la misura dello studio (§S6): arbitraggi veri fra 8 libri (Pinnacle **e** exchange)
nell'**1,6%** delle partite, con profitto medio 1,13% e prezzi non simultanei; sul solo soft
sono lo **0,18%** con un "profittino" che nasce dal confrontare Friday con Friday.

## 3. La formula, misurata (S9 dello studio sulle 12 459 partite)

Non argomenti: la formula di `getValueOpportunities` applicata dov'è possibile applicarla, cioè
dove i due prezzi esistono (apertura e chiusura dello stesso libro soft, che è la famiglia di prezzi
che la pagina usa), e confrontata con l'esito reale.

- la pagina chiamerebbe «opportunità» **15 378** selezioni; il 45,1% sopra il +1,5% (la soglia
  `isActionableValue` di `ev-engine.ts:173`, che peraltro **questo percorso non usa**: il repo
  chiama solo `calculateEV` e si fa la lista da sé), il 44,6% sotto lo 0,5% — che il pavimento
  riscrive comunque in «+0,5%»;
- per decile di edge dichiarato, il ROI **realizzato** sul prezzo eseguibile:

| Decile dell'edge dichiarato | n | edge medio | Frequent. reale | ROI realizzato | ROI fuori campione |
|---|---|---|---|---|---|
| D1 | 1 537 | −2,8% | 47,2% | −2,23% | −5,79% |
| D2 | 1 538 | −1,7% | 42,5% | −1,61% | −7,38% |
| D3 | 1 538 | −1,3% | 33,7% | −8,37% | −5,56% |
| D4 | 1 538 | −0,3% | 41,0% | −3,80% | +3,48% |
| D5 | 1 538 | +0,6% | 31,9% | −11,03% | −17,46% |
| D6 | 1 537 | +1,6% | 34,5% | −7,79% | −6,63% |
| D7 | 1 538 | +3,0% | 35,0% | −9,52% | −22,69% |
| D8 | 1 538 | +5,0% | 33,3% | −9,07% | −17,91% |
| D9 | 1 538 | +8,1% | 29,6% | −13,53% | −16,58% |
| D10 | 1 538 | +18,5% | 23,7% | −12,92% | −20,16% |

**La graduatoria è invertita**: più alto l'edge dichiarato, più basso il risultato reale (la
frequent. scende dal 47% al 24%). L'«Elevato» della tabella — edge ≥ +5% — conta 3 822 righe con
ROI **−11,06%**. La coda estrema (≥ +20%, 415 righe) va in utile (+8,79%): sono i cali veri di
informazione, e sono lo 0,5% del campione, quindi ordine di grandezza e non intervallo.

- **se qualcuno la seguisse**: bankroll 1 000 €, puntata = Kelly frazionaria (quarter) con la
  probabilità dichiarata dalla pagina, tetto 5%, incasso al prezzo eseguibile, in ordine
  cronologico, su tutto l'archivio → **3 693 puntate, 14 886 € impegnati, bankroll finale 60 €,
  drawdown massimo 94,4%, ROI −6,31%**. Il numero non è una condanna del Kelly: è la prova che
  la size dipende da una costante (1,045) che nessuno ha misurato.

## 4. Le correzioni, nell'ordine in cui le applicherei

**Stato: applicate** nel turno successivo (le P0–P6 sono nel codice di questo branch; il §4bis
dice che cosa è cambiato davvero e dove il testo qui sotto è stato superato dall'implementazione).
Il testo resta così com'era, perché la diagnosi non si riscrive a posteriori.

**P0 — la pagina, intanto, non è un terminale di valore.** Due strade, non una via di mezzo:
(a) fuori dalla nav e in «in costruzione» (la dizione che il repo già usa per `/xg`);
(b) rinominata in **«Divario di prezzo (apertura → ora)»**, che è ciò che i dati contengono.

```diff
-  { href: "/value-bets", label: "Value Bets (+EV)", highlight: true },
+  { href: "/value-bets", label: "Divario di prezzo (studio)", highlight: false },
```

**P1 — si legge solo ciò che è ancora giocabile, e mai ciò che è già deciso.**

```diff
-  for (const s of dashboard.signals) {
+  const settled = await db
+    .select({ id: matches.id })
+    .from(matches)
+    .where(and(isNotNull(matches.settledAt), inArray(matches.id, ids)));
+  const playedAway = new Set(settled.map((r) => r.id));
+  for (const s of dashboard.signals) {
+    // solo kickoff futuro: i segnali di partite concluse appartengono a /ieri
+    if (new Date(s.kickoffAt).getTime() <= now.getTime()) continue;
+    if (s.minutesBeforeKickoff !== null && s.minutesBeforeKickoff < 0) continue;
+    if (playedAway.has(s.matchId)) continue;
```

**P2 — via i pavimenti, e il contatore dice la verità.** `edgePct: Math.max(0.5, edgePct)` →
`edgePct: round(edgePct, 1)` senza minimo, e `totalScanned` esposto come «segnali letti» accanto a
«opportunità con edge > 0». Se il pavimento serve a non far sparire la tabella, il problema è
della tabella.

**P3 — la fair da un input reale, o niente fair.** Il margine ipotizzato (1,045) sparisce e si usa
la funzione che il titolo già promette. Nota tecnica, perché cambia il da farsi: `getBestFairOdds`
riceve **i prezzi di tutte le selezioni dello stesso mercato** (`prices: number[]`,
`devig-advanced.ts:178`), non «la stessa selezione da più libri» — quindi il devig onesto è
**fattibile oggi**, sulle tre quote 1X2 che `oddsSnapshots` conserva già:

```diff
-      const impliedCurrent = 1 / currentPrice;
-      const fairProb = Math.min(0.95, impliedCurrent / 1.045);
-      const fairOdds = 1 / fairProb;
+      // la fair è il no-vig della linea completa dello stesso mercato, non un numero fisso
+      const line = pricesOfMarket(s.matchId, s.marketLabel); // [h, d, a] all'ultima lettura
+      const fair = line && line.length >= 2 ? getBestFairOdds(line) : null;
+      if (!fair) {
+        skipped.push({ id: s.id, reason: "nessuna linea completa per il devig" });
+        continue;
+      }
+      const fairProb = fair.fairProbabilities[s.selectionIndex];
+      const fairOdds = 1 / fairProb;
```

e il prezzo valutato diventa quello **eseguibile**:

```diff
-      const priceToEvaluate =
-        s.openingPrice && s.openingPrice > currentPrice ? s.openingPrice : currentPrice * 1.05;
+      const priceToEvaluate = currentPrice; // ciò che un lettore potrebbe trovare, oggi
```

Il risultato atteso è onesto e quasi vuoto: l'edge rispetto al no-vig **dello stesso bookmaker**
è vicino a zero per costruzione, e il campo «variazione di prezzo» (apertura → ora) va mostrato
con il suo nome. È comunque il passaggio che rende eseguibili R2/R3 del backlog: oggi il devig
lavora su **due prezzi dello stesso libro**, e la soglia `isActionableValue` risulterebbe vera per
il 45,1% delle selezioni del dataset — non è un filtro, è un generatore di candidati.

**P4 — nessun `sharpPrice` costruito** (`× 0,96`) e nessuna «Fiducia» presa dall'indice
normalizzato: `?? 50`, `× 0,96`, `normalizedScore` come probabilità escono dal tipo
(`ValueOpportunity`), non solo dalla pagina.

**P5 — euro e Kelly restano calcolatrice, non output.** Se la puntata resta, i prezzi li inserisce chi
legge (come `/strumenti`: «nessun dato dal database, nessun numero precaricato»), e finché
l'edge non viene da una fair reale la card mostra il solo **divario di prezzo**, senza «PUNTATA
CONSIGLIATA».

**P6 — copy.** Fuori: «vantaggio matematico di lungo periodo», «Sfrutta la lentezza dei bookmaker
che non hanno ancora aggiornato le loro linee», «Market Lag», «Risk-Free» (`/surebet`), «certo al
100%». Dentro: una riga di stato dati (fonte, età dell'ultimo snapshot, `booksTotal`) e un link a
`/gioco-responsabile`. Nel mio turno restano anche i **9 errori di lint** nelle pagine quant
(`react/no-unescaped-entities`, apici non escapati) che `b43dcf6` ha portato in `main`: `npm run lint`
oggi è rosso su quelle pagine e sui due script di studio lo è a zero.

## 4bis. Applicato: che cosa è cambiato, e cosa no

| | file | che cosa è successo |
|---|---|---|
| P0 | `src/components/SiteNav.tsx`, `src/app/page.tsx` | la pagina si chiama **Divario di prezzo** e non è più in evidenza; l'hero della home non promette più «rilevamento automatico di Value Bets (+EV)» né «quote fair No-Vig (Shin / Power)» |
| P1 | `src/lib/repo/value-bets.ts` | filtro `kickoff > now` **più** `matches.status = 'scheduled'` e `settled_at IS NULL` (`loadPlayableMatchIds`): una riga su partita conclusa non può comparire, anche se l'elenco del dashboard la contiene |
| P2 | idem + `src/lib/quant/types.ts` | via `Math.max(0.5, …)`, via `expectedValue: Math.max(0.005, …)`, via `?? 50` e `|| 1.5`; i contatori di scarto (`signalsRead`, `skipped.*`) sono nel tipo di ritorno e la pagina li stampa |
| P3 | **nuovo** `src/lib/quant/value-gap.ts` + test `[2b]` in `quant.test.ts` | la fair viene da `fairMarket` sulla **linea completa dello stesso bookmaker alla stessa ora**, letta da `odds_snapshots`; il prezzo valutato è `currentPrice`. Il divario può essere negativo e viene mostrato |
| P4 | `types.ts`, `value-bets.ts` | `sharpPrice` (×0,96) e `confidenceScore` escono dal tipo; restano `lineMarginPct`, `booksWithLine`, `lineAgeMinutes`, `lineSource`: quattro campi che dicono **da dove** arriva il numero |
| P5 | `ValueScannerTable.tsx` | l'input «Il tuo Bankroll (€)» e la card «Kelly stake · €» non esistono più; la calcolatrice con i numeri inseriti a mano resta in `/strumenti` e nel pannello partita |
| P6 | `page.tsx`, `/trading`, `/surebet` | via «vantaggio matematico di lungo periodo», «Sfrutta la lentezza dei bookmaker», «Market Lag», «Risk-Free», «certo al 100%», «profitto garantito»; le 9 lint error sono a **0** (`npm run lint`: 0 errori, 7 warning preesistenti) |

Tre cose trovate **durante** l'applicazione, che l'audit non elencava:

- **la formula era altrove, ed è la parte più vista.** `src/components/SignalCard.tsx` (le card del
  dashboard) e `src/components/MatchQuantPanel.tsx` (pannello della partita) ripetevano lo stesso
  `implied / 1.045` con `priceToEvaluate = apertura`, e la card mostrava `edgePct > 0 ? +x : "0.0%"`:
  i negativi erano **renderizzati come zero**. Entrambi i blocchi sono usciti; la card conserva i
  tick del movimento, che sono una misura.
- `evaluateDroppingSignalValue` (`ev-engine.ts:128-177`) era **richiamata solo dai test**: funzione
  morta che fabbrica il margine di comodo. Rimossa, con un commento al suo posto che dice perché e
  dove sta la sostituzione.
- Il pannello quantitativo aveva una simulazione Dixon-Coles con `lambdaHome: 1.55 / muAway: 1.15`
  **costanti hardcoded** (mai mostrate, mai usate) e le quote sintetiche con fallback `?? 2.2`,
  `?? 3.3`, `?? 3.4`: quando la terna mancava, inventava i prezzi per riempire. Ora le sintetiche
  esistono solo con la terna reale, e la simulazione fantasma non c'è più.

**Il punto 3 dell'audit («la regola della terna simultanea potrebbe azzerare la lista
per un motivo tecnico») è chiuso sui dati, non in linea di principio.** `loadLines` è
passata a una query in due passi (prima l'istante più recente per
(partita, mercato, bookmaker), poi solo le righe di quegli istanti): il `limit` globale
precedente poteva affamare una partita con molte letture; le letture marcate
`isStale` dalla fonte restano fuori. La catena parser → `toQuoteDTOs` → raggruppamento
→ divario è verificata su HTML reale congelato da **`npm run test:line-shape`** (40
asserzioni): sull'elenco drop dell'18/08 ogni riga pubblica **le tre colonne con lo
stesso `observedAt`**, quindi 6/6 terne simultanee e 6/6 divari calcolabili — la lista
vuota in produzione vuol dire «non c'è nulla da misurare», non «la regola è troppo
stretta». Lo stesso test blocca il caso contrario: un giro che porta una sola colonna
non eredita le altre due.

Un numero che vale da solo, misurato da quello stesso test: le terne reali dell'elenco
hanno overround **8,66% – 11,58% (mediana 10,04%)**. Il margine che il vecchio codice
assumeva per tutte le quote del mondo era 4,5%: non era sbagliato di segno, era
sbagliato **di ordine di grandezza**, e su leghe periferiche — le stesse che questo sito
osserva — lo scarto è il doppio.

**Che cosa resta com'era (e non è un dettaglio minore):**

- **il guard ora è a sette controlli**, il nuovo dice se sono i dati a non permettere la
  misura (`istanti con linea completa: X su Y`, calcolato sulle sole partite giocabili).
- **la linea sharp vera non c'è.** `perBookmakerOdds` è spento: il divario è auto-confronto dello
  stesso bookmaker, non un +EV. Con questi dati la lista sarà quasi sempre corta e negativa — è il
  risultato atteso, non un guasto. Rimuovere il limite significa R2/R3 del backlog, cioè la seconda
  fonte di quote.
- **il CLV è ancora a basi miste** (`closing.ts:477-480`, studio partite finite §2/patch A): la
  patch P3 qui sopra usa la stessa `fairMarket`, quindi *avvicina* le due scale, non le unifica.
- `minutesBeforeKickoff` continua a non essere letto da nessun calcolo; l'età della riga ora è
  esposta (`lineAgeMinutes`), ma non è ancora un filtro sulla qualità della lettura.
- `/trading` è stato rinominato nella sostanza (due prezzi di consenso, green-up **a ritroso**,
  commissione dichiarata come assunta): un vero terminale exchange resta fuori portata finché non
  esiste una fonte di prezzi di bancata.

### 4ter — Che cosa ha dato il primo sguardo sui dati reali (05/09/2026)

La pagina è andata in produzione con la PR #7 e la prima lettura reale ha dato una
soddisfazione e una batosta, entrambe istruttive.

**Soddisfazione: il guard ha funzionato come doveva.** Con i dati non leggibili la pagina
NON ha mostrato «0 opportunità» né zeri di ripiego: ha scritto `Lettura dei dati non
riuscita`, il dettaglio dell'errore e la ragione. È il comportamento deciso in P2
(niente pavimenti): senza di esso il difetto qui sotto avrebbe prodotto una lista vuota
scambiata per «nessun valore».

**Batosta: un difetto che nessun fixture poteva vedere.** `loadLines` passa gli istanti
dell'aggregato `max(collected_at)` dentro `inArray(...)`. postgres-js serializza i
parametri `timestamptz` chiamando `.toISOString()` — ma su un aggregato il valore arriva
dal driver **come testo**, non come `Date`. In produzione: `a.toISOString is not a
function`. Con i fixture (Date costruite a mano) e con `tsc` (che leggeva `sql<Date>`
dichiarato) il difetto non era osservabile: solo il DB reale lo mostra. Corretto con
`toInstant()` in `src/lib/repo/value-bets.ts` (normalizza testo pg / epoch / `Date`,
scarta ciò che non è interpretabile) + 6 asserzioni in `npm run test:value-lines`.

**Secondo difetto trovato, stessa origine (nessun fixture lo vede).** La pagina, letta di
nuovo dopo la correzione, rispondeva «Nessuna riga passa i filtri scelti» con 0 righe — ma
i divari c'erano: erano tutti negativi, e l'opzione **«Mostra tutto, anche i negativi»
valeva `0`** mentre il filtro scartava `edgePct < 0`. Un pavimento travestito da filtro,
cioè esattamente la classe di difetto che §2 rimproverava al codice vecchio: la promessa
dell'etichetta non era scritta da nessuna parte in forma verificabile. Corretto
estrarrendo i filtri in `src/lib/view/scanner-filters.ts` (funzione pura) e bloccandola
con `npm run test:filters` (21 asserzioni: default = tutti e tre i negativi restano,
soglia sentinella `−∞`, e i messaggi di elenco vuoto distinguono «nessuna misura» da
«misura filtrata via»). Il messaggio vuoto ora dice anche *quanti* divari sono stati
esclusi e quanto valevano in media: «non c'è nulla» e «non te lo faccio vedere» non
devono somigliarsi.

**Lezione per chi toccherà queste pagine:** qualunque valore esca da una funzione SQL
(aggregati, `case`, cast) va trattato come testo anche se il tipo dichiarato è un altro,
e non va rimandato a Postgres senza normalizzarlo.

## 5. Come si verifica

> Le decisioni che restano aperte — CLV a basi miste, seconda fonte, finestre di
> raccolta — sono spiegate in modo piano, con i comandi e il «chi fa che cosa», in
> `docs/DECISIONI-APERTE.md`.Qui solo i comandi di verifica.

```bash
npm run audit:value-bets    # VERIFICA a 7 controlli della pagina, oggi: dopo la patch è un guard
                            # (esito OK/ATTENZIONE per proprietà), non più una radiografia
npm run test:quant          # include [2b]: «linea incompleta → nessun numero», «nessun pavimento»
npm run test:value-lines    # 12 asserzioni sulla costruzione della linea (stessa ora, stesso libro)
npm run test:line-shape     # 40 asserzioni: la forma reale delle linee (HTML congelato) + i margini
npm run study:finished > /tmp/studio.md && sed -n '/## S9/,$p' /tmp/studio.md   # la misura della §3
npm run lint && npm run typecheck && npm run build
```

I controlli di `src/scripts/audit-value-bets.ts`, ora che la pagina è sistemata, sono sette proprietà
da mantenere: solo kickoff futuri; nessuna partita con verdetto a registro; nessuna riga con
`fair = quota × 1,045`; divari negativi visibili; media dei divari nell'ordine del margine di una
linea (non oltre); contatori di scarto coerenti con i segnali letti. Ognuno ha `OK` o
`ATTENZIONE`, quindi un regresso si vede senza rileggere il codice. `npm run audit:value-bets`
richiede `DATABASE_URL`; in questo ambiente non c'è Postgres, e la §3 è infatti calcolata sul
dataset congelato (`study:finished` → S9), che contiene la stessa famiglia di prezzi.

Le pagine verificano anche da sole: `/value-bets` costruita **senza** database acceso rende lo
stato vuoto con la frase «nessun segnale letto dall'elenco» invece di un finto «0 opportunità»:
la lista vuota e l'errore di lettura sono due cose diverse, e la pagina le distingue
(`ValueScannerResult.error`).

---

## Appendice — output integrale di S9 (`npm run study:finished`, 2026-09-04)

```
## S9 — Che cosa vale davvero l'«edge» dello scanner +EV

Ricostruzione fedele della formula di `getValueOpportunities` su 12 459 partite reali: due prezzi veri (apertura e chiusura dello stesso libro), la «fair» costruita come corrente × 1,045, l'edge come rapporto fra i due. Poi: che cosa incassa chi quel prezzo lo paga davvero.

- Opportunità che la pagina mostrerebbe: 15378 · con edge ≥ +1,5% (soglia isActionableValue): 6933 (45.1%) · edge medio dichiarato: **+3.1 pp** (la scala dello screenshot legge +19,8%).
- Con il pavimento a +0,5% ogni selezione scesa diventa un'«opportunità»: quelle con edge sotto lo 0,5% sono 6861 (44.6%) e comparirebbero in lista comunque, con +0,5% scritto accanto.

| Decile dell'edge dichiarato dalla pagina | n | edge medio | Frequent. reale | ROI realizzato sul prezzo ottenibile | ROI solo fuori campione |
|---|---|---|---|---|---|
| D1 | 1537 | -2.8% | 47.2% | -2.23% | -5.79% |
| D2 | 1538 | -1.7% | 42.5% | -1.61% | -7.38% |
| D3 | 1538 | -1.3% | 33.7% | -8.37% | -5.56% |
| D4 | 1538 | -0.3% | 41.0% | -3.80% | 3.48% |
| D5 | 1538 | 0.6% | 31.9% | -11.03% | -17.46% |
| D6 | 1537 | 1.6% | 34.5% | -7.79% | -6.63% |
| D7 | 1538 | 3.0% | 35.0% | -9.52% | -22.69% |
| D8 | 1538 | 5.0% | 33.3% | -9.07% | -17.91% |
| D9 | 1538 | 8.1% | 29.6% | -13.53% | -16.58% |
| D10 | 1538 | 18.5% | 23.7% | -12.92% | -20.16% |

Lettura: se l'edge della pagina misurasse valore, il ROI realizzato dovrebbe salire con i decili. Guarda le ultime due colonne: il gradiente è piatto o rovesciato, e il livello resta sotto zero. L'edge è la fotografia di un movimento già chiuso: nessuno può più comprarlo a quel prezzo, e questo lo si vede nel numero, non nell'argomentazione.
- con l'etichetta «Elevato» della pagina (edge ≥ 5%): 3822 righe · frequent. reale 28.2% · ROI realizzato -11.06% · righe in utile: 28.2%.
- con l'etichetta «Elevato» della pagina (edge ≥ 20%): 415 righe · frequent. reale 23.4% · ROI realizzato 8.79% · righe in utile: 23.4%.
- con l'etichetta «Elevato» della pagina (edge ≥ 50%): 19 righe · frequent. reale 15.8% · ROI realizzato 26.32% · righe in utile: 15.8%.
Il codice di ValueScannerTable assegna l'etichetta «Elevato» a partire da +5%: è la fascia col peggior risultato realizzato. La coda estrema (edge ≥ +20%) va invece in utile, ma è un campione piccolo: ordine di grandezza, non intervallo di confidenza.

### 9.1 — Che cosa succede a seguirla, davvero

Simulazione deterministica, nessun casofortismo: bankroll 1 000 €, puntata = Kelly frazionaria (quarter) con la probabilità dichiarata dalla pagina, tetto 5% del bankroll per giocata — esattamente i numeri che la card mostra («Kelly stake», «€ del bankroll»). Si incassa però al prezzo che era ottenibile (quello corrente), perché l'apertura del venerdì nessuno la compra più. Ordine cronologico, nessuna ribasatura dei prezzi.

- puntate eseguite: 3693 · capitale totale impegnato: 14.886 € · bankroll finale: **60 €** (partenza 1 000 €) · drawdown massimo: 94.4%.
- ROI complessivo di chi ha eseguito la pagina: -6.31% sul capitale impegnato.

Questa è la differenza fra un numero e un consiglio: la pagina calcola l'edge con un prezzo e ne propone la puntata, ma il prezzo eseguibile è l'altro. Su 12 459 partite il risultato è scritto sopra; la parte preoccupante non è il segno, è che il bankroll finale dipenda da una costante (1,045) che nessuno ha misurato.
```
