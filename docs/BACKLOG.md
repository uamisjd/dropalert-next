# DropAlert — Coda di lavoro dichiarata

Ultimo aggiornamento: 04/09/2026.

Questo file è la coda ufficiale del progetto. Serve a un'unica cosa: tenere
visibile ciò che manca, invece di lasciarlo implicito nel codice o nella
memoria di chi ci lavora. Un limite scritto qui è un limite dichiarato; un
limite non scritto tende a diventare, col tempo, una funzionalità che si crede
esista.

Ordine: dal debito che oggi degrada di più la qualità della misura, al resto.

---

## 0. Revisione qualità post-produzione — chiuso 04/09/2026

**Stato:** chiuso · **Origine:** screenshot del sito in produzione

Passata di verifica su ciò che il sito mostrava davvero, con correzioni mirate:

- **Indice di copertura**: oltre la soglia la serie stampava «39/10 giri», una
  frazione impossibile. Ora sotto soglia resta il progresso `N/10`, sopra si
  legge `39 giri schedulati`.
- **Badge di livello vs indice**: la carta diceva «Segnale debole» (banda
  grezza) e insieme «Indice 63 · Media» (banda normalizzata). Il livello ora
  deriva dalla banda normalizzata, la stessa dell'indice: una sola scala letta
  dall'utente. La banda grezza resta intatta per il CLV storico.
- **Analisi 360° su partita giocata**: la cache pre-gara parlava al futuro di
  un incontro già cominciato. A kickoff superato l'analisi non si serve né si
  rigenera (si dichiara perché manca), e la chiusura del segnale cancella la
  cache (`invalidateAnalysis`).
- **Frase piana della carta**: a partita iniziata «il mercato si sta spostando»
  diventa «si è spostato». Stessa regola per l'etichetta di forza.
- **Dettaglio partita**: la scheda compatta «Contesto non disponibile» non
  compare più sopra un'analisi 360° completa già presente.
- **Gerarchia della carta**: l'intestazione accumulava sette badge in una riga
  sola (livello, tempo, freschezza, iper-reazione, contesto, notizie, drop
  ampio). Ora sono su tre righe distinte — identità del segnale, avvisi,
  contesto di contorno — e le righe vuote non compaiono. Coperto da un test di
  rendering DOM (`signal-card.test.tsx`).

Lezione: il tempo verbale e la scala di lettura devono seguire lo stato reale
della partita e l'unica scala che l'utente vede. Due scale sulla stessa carta,
o un presente su una partita giocata, sono contraddizioni anche se ogni pezzo,
preso da solo, è corretto.

---

## 1. Espansione della copertura del collector sui tornei minori

**Stato:** aperto · **Priorità:** alta · **Gap collegati:** 30 `bookmaker_missing`

I tornei minori sono il cuore dichiarato del monitor: è lì che un movimento di
quota è più informativo, perché il mercato è più sottile. Oggi il collector
BetExplorer parte dall'elenco dropping-odds e raccoglie ciò che quell'elenco
espone; la copertura non è quindi decisa da noi ma dalla vetrina della fonte.

Da fare:

- misurare la copertura reale per competizione (quante partite di un torneo
  entrano a monitor rispetto a quante se ne giocano);
- decidere se e come integrare le pagine di campionato `/results/` come
  secondo punto di ingresso per le partite non presenti nel dropping-odds;
- mantenere i vincoli già stabiliti: nessuna query string negli URL, rate
  limiting, intervallo minimo, backoff, header identificabili;
- ogni partita non raggiunta deve produrre un `data_gap`, non un silenzio.

**Vincolo:** nessuna deduzione di quote per le partite non coperte. Una partita
fuori copertura resta fuori copertura e viene dichiarata tale.

---

## 2. Fonte quote multi-bookmaker per rendere calcolabile `sharpConfirms`

**Stato:** aperto · **Priorità:** alta · **Gap collegato:** `bookmaker_missing` (30 aperti)

È il limite strutturale più pesante del sistema. BetExplorer, entro il suo
`robots.txt`, espone solo la quota di consenso: le quote per singolo bookmaker
stanno dietro chiamate AJAX con query string, che il robots vieta. La
conseguenza è già visibile in ogni pagina di dettaglio:

- `coordinationScore` non è misurabile e **non entra nel punteggio**;
- `sharpConfirms` resta `null` — "non osservabile", mai "non conferma";
- 45 punti su 100 dell'indice appartengono a componenti che i dati disponibili
  non permettono di valutare.

Da fare: individuare una fonte legittima che pubblichi quote per bookmaker
identificabile, e collegarla come adapter aggiuntivo. Il motore non va toccato:
l'architettura degli adapter esiste proprio perché una nuova fonte possa
entrare senza riscrivere lo scoring.

Candidati già valutati e da riconsiderare solo con chiave gratuita esplicita:
`football-data.org` (richiede chiave, oggi spento), `the-odds-api` (adapter
opzionale, disattivato di default, mai fonte principale).

**Vincolo:** nessun valore per-book inventato o ripartito dalla media. Finché la
fonte non esiste, il gap resta aperto e dichiarato.

---

## 3. Notifiche

**Stato:** chiuso il 04/09/2026 · **Priorità:** era media

Fatte: web push, iscrizioni anonime in `system_state`, soglia personale per
partita, una notifica al giorno per partita e per iscrizione.

Due cose sono state risolte strada facendo e vale la pena tenerle scritte:

- **la soglia si confronta con l'indice normalizzato**, lo stesso della card e
  di `/preferite`. Confrontarla con l'indice grezzo avrebbe fatto dire
  «soglia raggiunta» all'avviso e «non raggiunta» alla pagina: due scale per
  una sola promessa. `liveValueOf` in `lib/push/live.ts` è il punto unico che
  decide il numero, coperto da test;
- **l'invio sta dentro il ciclo di osservazione**, non in una rotta a parte.
  La rotta `POST /api/push/dispatch` esisteva già e nessuno scheduler la
  chiamava: le iscrizioni si salvavano, il pulsante di prova funzionava e
  nessun avviso partiva mai. Verificato end-to-end con un endpoint di prova:
  il giro invia, e al secondo giro il dedupe blocca il bis.

Il limite del punto 2 resta valido e va tenuto a mente: l'avviso descrive un
movimento il cui indice ha quasi metà dei componenti non osservabili. Il testo
dell'avviso lo dichiara, e non assomiglia a un consiglio di giocata.

Da fare, se si vuole: una pagina che mostri a chi legge **che cosa** gli è stato
inviato e quando, oggi la traccia sta solo a registro.

---

## 4. Watchlist

**Stato:** chiuso per le partite (04/09/2026), aperto per squadre e competizioni

Seguire una partita è possibile dal pulsante «☆ Segui» su ogni card: la lista
vive nel localStorage, senza account e senza inviare nulla al server, e la
pagina `/preferite` la legge. Un difetto bloccante è stato trovato e corretto
il 04/09/2026: `WatchToggle` restituiva a `useSyncExternalStore` un oggetto
nuovo a ogni lettura, e React — che confronta con `Object.is` — rilanciava il
render all'infinito. Cliccare «Segui» rompeva la pagina con «Maximum update
depth exceeded». Coperto da `npm run test:client`, che esegue il componente in
un DOM reale: nessuna funzione pura poteva accorgersene.

Resta aperto: seguire una **squadra** o una **competizione**, che richiede di
risolvere le chiavi delle partite future in voci di watchlist.

---

## 5. Contesto 360° — campi «non noto» e copertura dichiarata — chiuso 04/09/2026

**Stato:** chiuso · **Priorità:** alta/media

Tre correzioni sulla stessa regola non negoziabile: dichiarare ciò che manca,
mai mostrarlo come una scheda rotta o un valore riempito per simmetria.

### 5.1 Etichette e campi «non noto»

- `FIELD_LABELS` in `Context360.tsx` ora copre tutte le chiavi v2, comprese
  `forma_recente_5` («Forma recente (ultime cinque)») e `assenze_note`
  («Assenze e indisponibilità»); la UI non stampa mai la chiave grezza
  snake_case (`fieldLabel`).
- I campi «non noto» o vuoti non diventano più card vuote: le card restano
  solo per i valori dichiarati e per l'accordo col movimento; gli altri
  finiscono in UNA riga: «Non recuperati per questa partita: … — sono
  dichiarati, non riempiti per simmetria».
- Coperto da `npm run test:client` (`context360.test.tsx`, jsdom): nessuna
  chiave grezza, nessuna card «non noto», riga riassuntiva, card con
  contenuto e accordo.

### 5.2 Un solo retry su fallimento transiente

- `getDeepAnalysis` ripete UNA volta sola i fallimenti `timeout` ed `errore`
  (trasporto); `chiave_assente` e `risposta_invalida` non si riprovano
  (riprovarle non cambierebbe nulla); `bumpUsage` resta UNA chiamata anche
  dopo la ripetizione. Mai un loop di retry.
- Test in `test:repo-analysis` con `fetchImpl` finto: 500 poi ok (due
  chiamate, un credito), timeout poi ok, due fallimenti transienti (due
  chiamate, poi dichiarato «non disponibile»), chiave assente (zero
  chiamate), risposta invalida (una chiamata, scartata).

### 5.3 Copertura informativa dichiarata

- In testa al blocco Contesto 360°, per le competizioni a bassa copertura
  informativa (femminili/minori) compare: «Competizione a bassa copertura
  informativa: è normale che diversi campi siano dichiarati non noti».
- Euristica `isLowInformationCompetition` in `lib/context/pure.ts`: nome
  con «Women»/«W»/«Femminile», oppure competizione fuori dalla lista
  coperta dalla linea sharp (`sportKeyFor` — la stessa mappa del budget
  Odds API). È una dichiarazione, mai un dato inventato.
- **Bug trovato strada facendo**: `EXCLUDE` in `sport-keys.ts` conteneva
  `b\b|ii\b` (tag delle squadre riserve, non delle leghe) e scartava anche
  la Serie B — il campionato dichiarato coperto in `COVERED_LABEL` non
  avrebbe mai ricevuto una linea sharp. I due tag sono stati rimossi e il
  test «Serie B mappata» è stato aggiunto a `test:odds-budget`.

### 5.4 Ridurre i timeout del modello (facoltativo)

Valutata la riduzione di `maxOutputTokens` (1600) o la compressione del
prompt in `analysis-llm.ts`/`analysis.ts`: **non adottata**. Con il retry
singolo (5.2) un timeout occasionale non è più un fallimento definitivo;
ridurre i token aumenterebbe il rischio di risposta incompleta
(`risposta_invalida`) e non c'è un modo misurabile in locale di verificare
il guadagno senza una chiave live. La decisione resta aperta a un esperimento
reale su una partita campione.

---

## Debiti minori già noti

- **`/domani` non è un calendario**: legge l'archivio del monitor, cioè le
  partite che la fonte ha esposto nell'elenco dei movimenti. Le competizioni
  mai esposte non compariranno mai: dichiarato nell'empty state della
  pagina, non nascosto.
- **`/ieri` non è una misura di qualità**: gli esiti centrata/mancata sono
  letture fattuali dei gol finali, mostrate sotto la soglia delle 10 come
  «non è una tendenza» e accompagnate dall'avviso «non è un rendimento né
  un consiglio». La sola misura di validità del monitor resta il CLV.
- **Paginazione della dashboard**: oggi i segnali vengono letti con `limit(200)`
  e filtrati in memoria. Regge il volume attuale, non un volume dieci volte
  maggiore.
- **Nessun auto-refresh**: la dashboard e il dettaglio si aggiornano solo al
  ricaricamento della pagina.
- **CLV ancora vuoto**: `clv_records` è a zero perché nessun segnale rilevato ha
  ancora raggiunto il proprio kickoff con una linea di chiusura registrata. Non
  è un difetto, è il tempo che manca: il vincolo delle 30 osservazioni resta.
- **Workflow GitHub Actions mai eseguito**: `.github/workflows/collect.yml`
  esiste ma richiede un repository remoto e il secret `JOBS_TOKEN`.
- **Test sui componenti React parziali**: `test:client` copre in un DOM reale
  il toggle delle preferite, gli strumenti, la card segnale e il Contesto 360°;
  per gli altri componenti il rendering resta verificato per ispezione
  dell'HTML prodotto e screenshot.

---

## Fuori perimetro per scelta

Non sono debiti: sono cose che il progetto ha deciso di non fare.

- **Pronostici, consigli, classifiche di "partite da giocare"**. L'output è
  descrittivo: come si è mosso il mercato e quanto siamo riusciti a osservarlo.
- **Riempire i vuoti con stime, medie o interpolazioni.** Un dato mancante è un
  dato mancante e viene dichiarato.
- **Servizi a pagamento obbligatori** in qualunque punto della catena.
- **Usare l'esito della partita per valutare un segnale.** La sola misura di
  qualità è il CLV.
