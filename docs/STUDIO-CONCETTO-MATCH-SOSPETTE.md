# Studio — "Match sospetti" (il concetto che l'utente ha spiegato)

> Documento di lavoro. Data: 2026-09-09.
> L'utente ha descritto, in modo esplicito e grezzo, il concetto che vuole:
> il sito deve mostrare **le partite più sospette**, es:
> «una partita dove c'è stato un calo di quota in TUTTI i bookmaker, con a
> favore anche delle notizie o statistiche importanti → il sito la segnala
> come BET».
> Questo studio inquadra il concetto contro la realtà del sistema esistente.

---

## 1. Il concetto dell'utente, tradotto nel lessico del progetto

Il termine "calo di quota in tutti i bookmaker" ha un nome nel dominio: è una
**STEAM MOVE** (movimento coordinato e sincronizzato su più operatori).
"Notizie/statistiche a favore" è il **contesto** (il sistema lo chiama
"Contesto 360°" / notizie). "Segnalarla come BET" è la **decisione**.

Quindi il concetto dell'utente si decompone in tre ingredienti, già presenti
nel lessico del sistema:

| Concetto utente | Nome nel dominio | Cosa serve per misurarlo |
|---|---|---|
| Calo di quota in tutti i bookmaker | **Coordinazione / steam move** | quote per singolo bookmaker (per confrontare chi si muove e quanto) |
| Quanto è grande il calo | **Ampiezza (magnitude)** | quota apertura vs quota attuale |
| Da quanto tempo / se è rientrato | **Persistenza** | serie storica nel tempo |
| Notizie/statistiche a favore | **Contesto / notizie** | feed RSS testate, ricerca documenti |
| Verifica indipendente | **Linea sharp** | benchmark di un book "sharp" (Pinnacle...) |
| Segnalarla come BET | **Decisione** | `assessDecision` (contratto decisionale) |

Il motore (`src/lib/drop/engine.ts`, `analyzeDrop`) **implementa già tutto
questo**: calcola `magnitude`, `coordination`, `sharp`, `persistence`,
`coverage` e un **confidenceScore 0–100**. Quindi il "motore dei match
sospetti" **esiste già**.

---

## 2. Il blocco reale: il dato per-bookmaker manca

Il motore calcola già la coordinazione (`computeCoordination`) e la conferma
sharp (`computeSharp`), ma oggi **non può osservarle** perché:

- il ciclo di raccolta usa **solo BetExplorer**;
- BetExplorer espone **solo la quota di consenso** (`perBookmakerOdds: false`),
  e lo dichiara esplicitamente nel codice:
  `"Non può dare le quote dei singoli bookmaker: stanno dietro endpoint AJAX
  con ?matchid=, vietati dal robots.txt"`;
- quindi in `odds_snapshots` c'è **una sola riga** (il consenso `betexplorer-consensus`).

Di conseguenza nel motore:
- `coordination.booksTotal == 1` → **sotto** `MIN_BOOKS_FOR_COORDINATION` (2),
  la coordinazione **non è calcolabile** (0 punti su 25);
- `sharp.available == false` → la conferma sharp **manca** (0 punti su 20);
- `coverage.score` si ferma a **0,5125** (tetto strutturale con una sola linea
  di consenso, nessuna sharp, apertura presente).

**Il "match sospetto" che l'utente vuole esiste nel motore ma non può nascere:
manca il dato per-bookmaker.** Non è un bug: è la natura della fonte attuale,
dichiarata onestamente nel codice e nei buchi `bookmaker_missing`.

**Nota importante.** BetExplorer PUBBLICA il numero di bookmaker concordi
nell'elenco drop (es. `B's: 79% (18/19)`), e l'adapter lo legge (`agreement`:
`{ confirming, total }`), ma lo usa solo per dichiarare il buco. Non esiste
una per-bookmaker reale: solo un conteggio aggregato che la fonte già calcola.

---

## 3. Il cuore della scoperta: esistono TANTE fonti giuste, con compromessi

La ricerca esterna (09/09/2026) inquadra il panorama reale. Il punto è che
**esistono fonti con copertura per-bookmaker ampia, anche sui minori**. Le più
rilevanti per il concetto "calo in TUTTI i bookmaker":

| Fonte | Copertura | Bookmaker | Sharp (Pinnacle) | Minori? | Costo | Accesso |
|---|---|---|---|---|---|---|
| **BetExplorer** (attuale) | mondiale | **solo consenso** | no | sì | gratuito, robots ok | scraping |
| **The Odds API** (già integrato) | ~70 leghe | ~15–20/partita | **no** | fascia media | 500 req/mese | API chiave |
| **OddsPapi** | **1.372 tornei** | **140+/partita** | **sì** (Pinnacle, Singbet) | **sì** | 250 req/mese | API chiave |
| **odds-api.io** | **12.000+ leghe** | **265+** | ? | **sì** | 100 req/ora (500/gg) | API chiave |
| **OddsPortal** | mondiale | 80+ (open→close) | ? | **sì** | **nessuna API** (scraping + anti-bot/proxy) | scraping |

### Punti chiave verificati:
- **OddsPapi** copre **140+ bookmaker per partita, inclusi i "sharp" (Pinnacle,
  Singbet, Betfair Exchange)**, su **1.372 tornei** (fino ai tornei minori).
  È la fonte che meglio incarna il concetto "tutti i bookmaker + sharp".
- **odds-api.io** copre **12.000+ leghe e 265+ bookmaker**: la copertura più
  ampia sui minori. Ha un piano gratuito (100 req/ora, 500/giorno).
- **OddsPortal** è la fonte "da sogno" (per-bookmaker con apertura→chiusura,
  movimento linea, risultato) ma **non ha API ufficiale**: si legge con
  scraping (Playwright, proxy, anti-bot). È la stessa filosofia di BetExplorer.
- **The Odds API** (già presente) è la **peggiore** per questo concetto: poche
  leghe, nessuno sharp, ~15–20 book.

**Conclusione 3.** Il progetto ha già un'architettura per le fonti
(`OddsProvider`, registry, ingest-snapshots) che accetta indipendentemente
BetExplorer E qualunque altra fonte per-bookmaker. Il tassello mancante **non è
il motore** (pronto), **è la fonte per-bookmaker** da aggiungere.

---

## 4. Il secondo ingrediente: "notizie/statistiche a favore"

Il sistema ha GIÀ un modulo notizie e contesto:
- `src/lib/news/` — feed RSS pubblici (Gazzetta, BBC) filtrati per squadra,
  con limiter di cortesia (1 req/5s, 20/15min), e stato "nessuna notizia
  trovata" dichiarato (non confuso con informazione a favore).
- `src/lib/context/` — Contesto 360° e "Analisi 360° completa" (LLM), con
  **divieto nel parser**: qualsiasi raccomandazione/pick viene respinta.
  Le parti discorsive costruiscono un quadro, non un consiglio.

Queste componenti **non entrano nel punteggio**: sono un livello di lettura
qualitativa (e il contratto decisionale vieta che vengano usate per
"confermare" un pick a casaccio: `ContextEvidence` produce solo un warning,
mai una giustificazione automatica).

**Conseguenza per il concetto dell'utente.** "Notizie a favore" è rilevante
ma **non può, da solo, trasformare un dato in un BET**: il progetto rifiuta di
usare il contesto per giustificare un pick. Il percorso onesto è: le notizie
**arricchiscono** la scheda (fatti), mentre la **decisione** resta appesa al
**prezzo eseguibile per-bookmaker** (che oggi manca).

---

## 5. La dottrina "BET" e perché oggi è impossibile dal valore

Il concetto "segnalala come BET" collide con la dottrina del progetto,
che NON è una limitazione tecnica ma una scelta di onestà:

- `assessDecision` ha il gate **`PRICE_NOT_EXECUTABLE`**: se `priceSource` non
  è `bookmaker`/`exchange`, la riga resta **NON_AZIONABILE**, anche se
  movimento, notizie e statistica sono perfetti.
- In `value-bets.ts` (`scanValueGaps`) la `priceSource` è **impostata a
  `"consensus"` di proposito**: l'elenco /valore non può MAI produrre un BET.
- L'unico punto che può arrivare a CANDIDATA/VALORE_VERIFICATO è la **pagina
  partita**, e solo con una **linea per-bookmaker fresca** (`getSharpLine`,
  The Odds API, che non inquina `odds_snapshots`).

Quindi:
1. **La UI che l'utente immagina** (una lista di "match sospetti" con bandiera
   BET) **non esiste** con i dati attuali, perché il dato per-bookmaker manca.
2. **Anche aggiungendo una fonte per-bookmaker**, la lista deve rispettare il
   gate `PRICE_NOT_EXECUTABLE`. Un "match sospetto" può avere un **altissimo
   confidenceScore** (ciao, è proprio il concetto!) ma, se la lista usa il
   consenso, resta NON_AZIONABILE. Solo le righe con un **prezzo individuale
   fresco** possono essere BET.

**Questo è il punto che va deciso con l'umano:** vuole che la lista dei
"sospetti" mostri il **confidenceScore** (il "quanto è sospetto") e la bandiera
**BET solo quando c'è prezzo eseguibile**, oppure vuole un'esperienza in cui
"match sospetto" ≈ "BET consigliato" (che la dottrina vieta sul consenso)?

---

## 6. Problema di fondo: coordinazione e minori sono in tensione

C'è un paradosso che va detto:
- Il concetto "calo in tutti i bookmaker" (coordinazione) ha **più valore dove
  i bookmaker divergono** → nei **tornei minori** (es. Ecuador, Brasile C).
- Ma i tornei minori sono **il punto più debole** delle fonti per-bookmaker
  disponibili: The Odds API li ignora, OddsPapi/odds-api.io li coprono ma con
  meno bookmaker; OddsPortal li ha ma servirerebbe scraping.
- I tornei **maggiori** (Serie A, Premier) hanno molti bookmaker ma i movimenti
  sono più **efficienti** → meno "sospetti", drop più piccoli.

Quindi il concetto "tutti i bookmaker si muovono" è **più raro e prezioso
proprio dove i dati sono più deboli**. Questo va dichiarato, non nascosto.

---

## 7. Il percorso concreto (per fasi, dietro flag, senza rompere l'onestà)

Il motore è pronto; serve il **dato per-bookmaker**. Il percorso che rispetta
la dottrina:

**FASE 1 — Prima misurare (a costo zero).** `npm run odds:scopri` per vedere
quali campionati del monitor sono davvero coperti da una fonte per-bookmaker.
Risponde con dati reali, non a memoria.

**FASE 2 — Scegliere la fonte per-bookmaker.** La scelta dipende dall'obiettivo:
- Se si vuole **"tutti i bookmaker + sharp sui minori"** → **OddsPapi**
  (140+ book, Pinnacle, 1.372 tornei) o **odds-api.io** (12.000+ leghe): serve
  un **adapter nuovo** + chiave, ma l'architettura è già pronta.
- Se si accetta la scarsa copertura per questo scopo → **The Odds API** (già
  integrato) è comodo ma **non è la fonte giusta** per il concetto.

**FASE 3 — Cablare la fonte nel ciclo, dietro flag default OFF.** Solo i
**segnali attivi** su **leghe coperte**, budget `decide()` come unico gate.
**Attenzione al difetto di misura:** se si scrive in `odds_snapshots`, il
motore va istruito a distinguere consenso da per-book (escludere `isConsensus`
da `consensusAt` e `computeCoordination`), altrimenti i segnali esistenti
vengono distorti. Se invece si usa il percorso `getSharpLine` (che NON scrive
in `odds_snapshots`), non si inquina ma la coordinazione non entra nei segnali.

**FASE 4 — Presentare i "match sospetti".** Una vista che ordina per
**confidenceScore** (quanto è sospetto), mostra i **bookmaker concordi**
(coordinazione) e il **contesto/notizie** a fianco, e applica la **bandiera
BET solo dove esiste prezzo eseguibile** (gate `PRICE_NOT_EXECUTABLE`).

---

## 8. Cosa NON fare (le trappole)

- **Non** aggiungere una fonte per-bookmaker senza prima misurare la copertura
  reale sui campionati del monitor (rischio: budget su leghe senza segnali).
- **Non** confondere "consensus" con "tutti i bookmaker" (il consenso è un
  aggregato: usarlo come "coordinazione" sarebbe un dato inventato).
- **Non** usare le notizie per giustificare un pick (vietato dal parser: la
  dottrina è "i fatti si mostrano, la decisione resta appesa al prezzo").
- **Non** presentare un "match sospetto ad alto punteggio" come **BET**
  quando manca il prezzo individuale (è un'osservazione di qualità, non un
  ordine). Il sito deve dire chiaramente: "sospetto ← osservazione; BET ← solo
  con prezzo eseguibile".

---

## 9. Sintesi per l'umano

1. Il "motore dei match sospetti" (magnitude + coordination + sharp +
   persistence + coverage + confidenceScore) **esiste già** e implementa
   esattamente il concetto descritto.
2. **Non può nascere** perché manca il **dato per-bookmaker**: BetExplorer dà
   solo il consenso, per scelta dichiarata.
3. Esistono **fonti per-bookmaker giuste** (OddsPapi 140+ book con Pinnacle su
   1.372 tornei; odds-api.io 12.000+ leghe; OddsPortal via scraping), con
   compromessi di costo/accesso. The Odds API (già integrato) è la meno adatta.
4. Il **contesto/notizie** esiste ed è già integrato, ma per dottrina arricchisce
   la scheda, non decide.
5. La bandiera **BET** è vincolata a un **prezzo individuale fresco**: su
   consenso resta sempre "osservazione". Va deciso se la lista dei sospetti
   mostra il punteggio e la bandiera solo quando eseguibile.
6. **Paradosso da dichiarare:** la coordinazione vale di più sui minori, dove
   i dati per-bookmaker sono più deboli.
