# DropAlert — Coda di lavoro dichiarata

Ultimo aggiornamento: 18/08/2026, fine Sprint 5B.

Questo file è la coda ufficiale del progetto. Serve a un'unica cosa: tenere
visibile ciò che manca, invece di lasciarlo implicito nel codice o nella
memoria di chi ci lavora. Un limite scritto qui è un limite dichiarato; un
limite non scritto tende a diventare, col tempo, una funzionalità che si crede
esista.

Ordine: dal debito che oggi degrada di più la qualità della misura, al resto.

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

**Stato:** aperto · **Priorità:** media

Avvisare quando un segnale supera una soglia. Da progettare dopo il punto 2:
notificare oggi significherebbe mandare avvisi costruiti su un indice di cui
quasi metà dei componenti non è misurabile.

Da definire: canale (nessun servizio a pagamento obbligatorio), soglia di
attivazione, deduplicazione, e soprattutto il testo — una notifica è il luogo
dove il tono da osservatorio si perde più facilmente. Nessuna formulazione che
somigli a un consiglio di giocata.

---

## 4. Watchlist

**Stato:** aperto · **Priorità:** media

Permettere di seguire partite, squadre o competizioni specifiche. Richiede una
nozione di utente o quantomeno di sessione persistente, che oggi non esiste.
Da valutare se risolverla lato client (senza account) prima di introdurre
autenticazione.

---

## Debiti minori già noti

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
