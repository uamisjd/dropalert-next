# DropAlert — Coda di lavoro dichiarata

Ultimo aggiornamento: 18/08/2026, fine Sprint 5B.

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
- **Nessun test sui componenti React**: i test coprono le funzioni pure
  (`view.test.ts`, 68 test). Il rendering dei componenti è verificato solo per
  ispezione dell'HTML prodotto e screenshot.

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
