# Audit dei contenuti — 05/09/2026

> **Domanda posta.** «Ogni contenuto del sito è fatto in modo accurato e
> approfondito? Che cosa abbiamo fatto bene, che cosa non è fatto bene, che
> cosa si deve fare — perché il sito mi dia ottime informazioni per scegliere
> la partita giusta.»
>
> **Metodo.** Lettura del codice che produce ogni numero pubblicato, esecuzione
> delle suite del progetto, esecuzione degli script di studio sui dati
> congelati, e verifica esterna delle affermazioni sulle fonti. Ogni cifra di
> questo documento è il risultato di un comando eseguito, non una stima: dove
> non ho potuto verificare, è scritto.
>
> **Che cosa ho eseguito.** `npm run typecheck` (pulito), `npm run lint`
> (pulito), `npm run build` (22 rotte generate), 30 suite di test su 32
> (le due che richiedono PostgreSQL non sono eseguibili qui: nessun server
> nella sandbox), `npm run study:finished` (12 459 partite), sonde dirette sul
> motore e sui componenti in jsdom.

---

## 0. Verdetto in cinque righe

Il sito è **onesto e tecnicamente solido**: non ho trovato un solo numero
pubblicato che sia inventato, e la documentazione dei propri limiti è migliore
di quella della maggior parte dei prodotti commerciali equivalenti. Ma **non
può ancora dirti quale partita scegliere**, per tre motivi strutturali misurati
qui sotto: legge una sola linea di prezzo (45 punti su 100 dell'indice sono
non misurabili), la sua unica metrica di qualità mescola due basi di misura
senza dichiararlo in pagina, e il suo indice — misurato sul motore reale — non
può superare **50,13** su 100 nemmeno nel caso migliore possibile. Le correzioni
che potevo fare senza decisioni tue sono applicate in questo branch; le tre
scelte che servono per il salto di qualità sono in §5.

---

## 1. Che cosa è fatto bene (verificato, non presunto)

**1.1 Nessun numero costruito.** Ho ricostruito il percorso di ogni numero
pubblicato. `computeValueGap` (`src/lib/quant/value-gap.ts`) usa il prezzo
eseguibile e una fair derivata dalla linea completa con lo stesso metodo del
CLV; non esiste più il `× 1,045` né il pavimento `Math.max(0.5, …)` che
l'audit di `docs/STUDIO-VALUE-BETS.md` aveva trovato. Verificato nel codice,
riga per riga.

**1.2 Un dato mancante resta mancante.** `componentStatusOf`
(`src/lib/repo/score-view.ts`) distingue «zero perché il dato è sfavorevole»
da «zero perché il dato non esiste» e stampa `GAP` nel secondo caso. È la
scelta corretta e rara.

**1.3 Il contratto editoriale è rispettato.** Un grep di nomi di operatori su
`src/app` e `src/components` restituisce quattro occorrenze, tutte in contesto
di studio (Pinnacle e Bet365 nelle note di backtest, «Betfair ladder, assunta»
in `/trading`). Nessun link, nessun bonus, nessuna puntata consigliata.

**1.4 I test misurano il cablaggio, non solo la matematica.** Le suite jsdom
rendono i componenti in un DOM reale. È il motivo per cui l'errore che ho
commesso io in questo audit (vedi §4.1) è stato preso da un test invece che
spedito in produzione.

**1.5 La disciplina sui campioni piccoli è vera.** `CLV_INCONCLUSIVE_BELOW = 30`
per il giudizio, `MIN_SAMPLE_FOR_INFERENCE = 10` per l'intervallo di
confidenza: due soglie diverse per due scopi diversi, e la differenza è
spiegata nel codice.

---

## 2. Che cosa non è fatto bene

### 2.1 L'unica metrica di qualità era pubblicata su basi miste, senza dirlo — CORRETTO

**Il fatto.** Il CLV è `(probChiusura − probSegnale) × 100`. Il prezzo del
segnale è **sempre grezzo** (margine incluso); la chiusura è **fair no-vig**
quando il mercato era completo e **grezza** quando non lo era
(`getClosingReference`, `src/lib/pipeline/closing.ts:331-380`, che restituisce
`basis: "fair_novig"` oppure `"raw_consensus"`). La colonna
`clv_records.closing_basis` lo registra.

**Che cosa ho misurato.** Un grep su `src/app/performance/page.tsx`,
`src/components/ClvSection.tsx`, `src/lib/repo/performance.ts`,
`src/lib/repo/dashboard.ts`: **zero occorrenze** di `closingBasis`. La
composizione esisteva nel database e non arrivava in nessuna pagina.

**Quanto vale.** Lo studio del progetto (`npm run study:finished`, §1.1) lo
quantifica sull'archivio congelato: **−1,86 pp di CLV bruciati dal solo errore
di base**, media su 37 362 osservazioni, con il **20,6%** dei casi che
cambierebbe verso. Il CLV medio pubblicato è dello stesso ordine di grandezza:
quindi la frase «il CLV è negativo» non era distinguibile da «il confronto è
sporco».

**Correzione applicata.** Nuovo modulo puro `src/lib/view/clv-basis.ts`
(+31 test, `npm run test:clv-basis`): conta le osservazioni per base, marca
`mixed` quando ce n'è più di una, e produce la frase da pubblicare. Cablato in
`getClvMaturity`, `getPerformanceView`, `ClvSection`, `/performance`. Un
riepilogo a basi miste ora lo dice, in evidenza, **prima** del numero.

**Premessa corretta e ricalcolo (05/09).** Rileggendo lo studio §1.1 prima di
scrivere il ricalcolo, è emerso che le etichette del modulo
`src/lib/view/clv-basis.ts` sostenevano il contrario di ciò che il codice fa:
chiamavano `fair_novig` «confronto corretto». Non lo è. Il prezzo del segnale è
grezzo, quindi la coppia allineata è **grezzo contro grezzo**; depurare il
margine sulla sola chiusura alza il prezzo, abbassa la probabilità implicita e
abbassa `clvPp` meccanicamente — è esattamente il −1,86 pp dello studio. Le
etichette e la frase di stato sono state corrette (test aggiornato: prima
asseriva «omogeneo» sulla base sbagliata).

Da qui il ricalcolo, `src/lib/clv/rebasis.ts` + `npm run clv:rebase`:

- **rilegge** la chiusura grezza mediana che `closing_lines` conserva comunque
  e ricalcola il CLV su quella: non inventa un margine, non stima una
  chiusura, non tocca `signalPrice` (congelato al primo rilevamento);
- **di default non scrive**: stampa ciò che cambierebbe. La scrittura è
  `-- --apply`, o il pulsante «Ribasatura CLV (manuale)» in GitHub Actions,
  dove `DATABASE_URL` resta nei secrets e l'output è filtrato;
- il confronto fair-contro-fair sarebbe altrettanto legittimo ma richiederebbe
  di depurare **anche** il segnale, e quel dato non è a registro: dichiarato
  invece di approssimato.

### 2.2 L'indice non può superare 50,13 — misurato sul motore, non dedotto

**Che cosa ho eseguito.** Una sonda che chiama `analyzeDrop` con la
configurazione reale di produzione — un solo bookmaker di consenso, non sharp —
e il **miglior caso possibile**: drop da 2,00 a 1,60 (+11,3 pp, `very_high`),
sostenuto 8 ore.

```
magnitude=30/30  coordination=0/25  sharp=0/20  persistence=15/15  coverage=5.13/10
punteggio=50.13  banda=low          (algoritmo v1)
punteggio=37.60  banda=low          (suspicion-v2, moltiplicatore 0,75)
```

**Perché.** `coordination` è 0 perché `booksTotal = 1 < MIN_BOOKS_FOR_COORDINATION = 2`;
`sharp` è 0 perché nessun book è marcato sharp; `coverage` si ferma a 5,13/10
perché la formula è `0,45·(1/4) + 0,30·1 + 0 + 0,10 = 0,5125`. Il tetto
strutturale è **55 su 100**, e 41,25 con il moltiplicatore.

**Conseguenza, ed è la più importante di questo audit.** La tabella «CLV per
fascia di indice» — pubblicata in `/performance` e in `docs/BACKTEST-R2.md` —
ha le fasce **50–74 con n=1** e **75–100 con n=0**. Non è sfortuna di
campione: quelle fasce sono **strutturalmente irraggiungibili** con la fonte
attuale. La domanda che R2 lasciava aperta («un indice più alto dà un CLV
migliore?») non è senza risposta per mancanza di dati: è **impossibile da
porre** finché l'indice grezzo si ferma a 50. Ogni conclusione tratta da quella
tabella oggi è priva di fondamento, e la pagina non lo dice.

### 2.3 `/simulator` pubblicava «EV» senza dire lo stato del modello — CORRETTO

**Il fatto.** La pagina stampa `+X% EV` accanto a quote inserite dall'utente,
calcolato con un modello Dixon-Coles. `docs/RESEARCH-BACKLOG.md`, voce 7,
blocca esplicitamente l'ingresso di un modello di gol nell'interfaccia «finché
il backtest out-of-sample non è passato e dichiarato in un report». Quel
backtest non esiste. La pagina non lo dichiarava, e non aveva il rimando a
`/gioco-responsabile` che hanno tutte le pagine sorelle.

**Correzione applicata.** Sezione finale «Che cosa è questo modello, e che
cosa non è»: numeri inseriti dall'utente, modello **non validato sul mercato**
(dichiarato), limiti di Poisson/Dixon-Coles, rimando a `/strumenti` e
`/gioco-responsabile`. Coperta da `npm run test:simulator` (9 test).

**Un secondo difetto, latente.** `simulateDixonColes` aveva default
`maxGoals = 6` (matrice 7×7) mentre la pagina passa `5` (6×6) e le
intestazioni della tabella erano un elenco scritto a mano `[0,1,2,3,4,5]`.
Oggi coincidono per caso: chi avesse cambiato il default si sarebbe trovato una
colonna senza titolo. Ora esiste `DEFAULT_MAX_GOALS`, intestazioni e titolo
derivano dalla matrice, e due test (uno in `test:quant`, uno in
`test:simulator`) leggono la stessa costante.

### 2.4 Il README non descriveva più il progetto

Verificato comando per comando:

| Affermazione del README | Reale | Come l'ho misurato |
|---|---|---|
| «12 tabelle» | **16** | `grep -c "pgTable(" src/db/schema.ts` |
| «`__tests__/` 40 test» (motore drop) | **61** | `npm run test` → «Test superati: 61» |
| «tutte le suite (29)» | **30**, ora **32** | conteggio dei comandi in `test:all` |
| `/strumenti`: 2 strumenti | **5** | `src/app/strumenti/page.tsx` importa 5 calcolatori |
| «API interne»: 4 rotte | **11** | `find src/app/api -name route.ts` |
| albero `src/` con 4 moduli | **15** moduli in `src/lib` | `ls src/lib` |

Un README che sbaglia i propri numeri è un problema di affidabilità, non di
estetica: è il documento che un nuovo lettore usa per fidarsi del resto.
**Corretto**, insieme a `docs/DECISIONI-APERTE.md` §2 che dichiarava «3 crediti
su 49 al mese» contro i **490 su 500** di `ODDS_MONTHLY_CAP`.

### 2.5 Il sito non ha una pagina che risponda alla tua domanda

Esiste una «Guida in 60 secondi» che spiega che cos'è un drop, che cos'è
l'indice e che il CLV è la metrica. Non esiste **nessuna** pagina che dica:
«ecco come si usa questo sito per decidere una partita, ecco che cosa puoi
leggere e che cosa no, ecco l'ordine in cui guardare le cose». È il contenuto
che manca di più rispetto al tuo obiettivo, ed è l'unico che si può scrivere
oggi senza una fonte nuova: i numeri ci sono già, sono nei report.

---

## 3. Ricerca esterna: che cosa è cambiato nel mondo dei dati

**3.1 BetExplorer — la vostra lettura è corretta.** Ho scaricato
`betexplorer.com/robots.txt`: vieta esplicitamente le query string
(`/*?match=`, `/*?page=`, `/*?ttid=`, …) e `/bookmaker/`. La scelta del
progetto di non interrogare gli endpoint AJAX è quindi fondata, e il
conseguente `data_gaps` `bookmaker_missing` è la risposta giusta.

**3.2 Pinnacle ha chiuso l'API pubblica il 23 luglio 2025.** Non è
un'opinione: lo dichiarano più fonti indipendenti e lo conferma il vostro
stesso archivio. Ho letto `data/football-data/E0-2526.csv`: **210 righe su 380
hanno la colonna `PSH`**, l'ultima è dell'**08/01/2026**, il file arriva al
24/05/2026. Quindi:

- la linea sharp con cui sono stati costruiti R1, R1.5 e lo studio sulle
  partite finite **non verrà più aggiornata**;
- ogni backtest futuro che usa Pinnacle come riferimento «fair» confronta il
  mercato di oggi con una fotografia di gennaio;
- il `SHARP_BOOKS = ["pinnacle", "betfair_ex_eu", "smarkets"]` di
  `src/lib/providers/optional/odds-api-budget.ts` va verificato book per book
  presso il provider scelto: su The Odds API Pinnacle risulta disponibile solo
  per la regione EU e tramite scraping con ritardo dichiarato.

**3.3 Le opzioni reali per una seconda linea di prezzo** (rilevate oggi, non
da memoria):

| Fonte | Piano gratuito | Sharp incluso | Nota per questo progetto |
|---|---|---|---|
| The Odds API | 500 crediti/mese | no (Pinnacle solo EU, con ritardo) | già previsto come adapter opzionale; 500 crediti ≈ 16 chiamate/giorno |
| SportsGameOdds | 2 500 oggetti/mese, 10 req/min | **sì, Pinnacle diretto** | oggetti = eventi, i book dentro l'evento non costano extra |
| OddsPapi | 250 richieste/mese | **sì, 350+ book** | storico incluso senza moltiplicatore |
| pinnapi / pinnodds | 100 richieste/giorno | solo Pinnacle | nati esattamente per il drop-alerting |

Con la regola di budget già scritta nel progetto (una chiamata per partita
segnalata con indice ≥ 45, al rilevamento) **500 crediti/mese bastano largamente**:
a 3-4 partite/giorno sono ~120 chiamate/mese. Il collo di bottiglia non è il
budget, è la scelta della fonte e la mappatura `bookmaker → id fonte`.

---

## 4. Dove ho sbagliato io, in questo audit

**4.1 Ho affermato un difetto che non esisteva.** Leggendo il codice del
simulatore ho scritto che la tabella dei risultati esatti era disallineata:
intestazioni `0-5` contro una matrice 7×7. **Era falso.** Misurando in jsdom:
la pagina passa `maxGoals: 5`, la matrice è 6×6, `thead` ha 7 celle e ogni riga
di `tbody` ne ha 7. Il mio primo test è passato per il motivo sbagliato perché
confrontava la tabella con una matrice simulata da me con parametri diversi da
quelli della vista. Ho riscritto il test sui parametri reali della pagina; il
difetto vero era un altro (default divergente + nessuna dichiarazione di
stato), ed è quello che ho corretto.

**4.2 Le due suite che richiedono PostgreSQL non le ho eseguite.**
`test:pipeline` e `test:scheduler` — e `npm run build` stampa errori di
connessione a `127.0.0.1:5433` che sono attesi e non bloccano la generazione
delle 22 rotte. Se vuoi la verifica su dati reali, il comando è
`DATABASE_URL="…" npm run audit:value-bets`.

---

## 5. Le tre decisioni che servono (non posso prenderle io)

**D1 — Allineare la base del CLV.** Oggi ho reso visibile il problema; la
soluzione vera è scegliere una convenzione e ricalcolare lo storico:
(a) de-vigare il prezzo del segnale e confrontare fair contro fair, oppure
(b) conservare anche la chiusura grezza e confrontare grezzo contro grezzo.
La (a) è coerente con il no-vig già usato in `/value-bets`; la (b) richiede una
colonna nuova. Serve il tuo `DATABASE_URL` per il ricalcolo.

**D2 — Una seconda fonte di prezzo.** È l'unica cosa che rende misurabili
coordinazione (25 punti) e conferma sharp (20 punti), e l'unica che può
trasformare `/value-bets` da auto-confronto a confronto fra linee. La funzione
che lo farebbe esiste già ed è testata (`findValueFromSharpPrices` in
`src/lib/quant/ev-engine.ts`): non ha un chiamante.

**D3 — Che cosa fare dell'indice, dato il tetto di 50,13.** Tre strade:
ricalibrare i pesi sulla sola base misurabile (55 punti → 100), pubblicare le
fasce di CLV sulla scala normalizzata invece che su quella grezza, oppure
dichiarare in pagina che le fasce alte sono strutturalmente vuote. La prima
cambia i numeri storici; la seconda è la più onesta e la più rapida.

---

## 5bis. Le decisioni prese (delega del 05/09/2026)

Hai chiesto che scegliessi io dopo aver studiato. Ecco le scelte e il perché.

**D1 — base del CLV: dichiarata adesso, allineata poi.** Ho scelto di NON
riscrivere lo storico in questo branch. Un ricalcolo tocca ogni numero già
pubblicato in `/performance` e richiede il tuo `DATABASE_URL`, che non deve
passare dalla chat e che qui non esiste. Ho fatto la parte che si può
verificare: la composizione delle basi è ora misurata, pubblicata e testata.
Quando vorrai l'allineamento, la convenzione che consiglio è **fair contro
fair** (de-vigare anche il prezzo del segnale), perché è la stessa già usata in
`/value-bets` e nella chiusura preferita: una sola regola in tutto il sito.

**Aggiornamento su D2, dopo la domanda «non abbiamo già messo un'API
gratuita?».** Sì, e la mia risposta precedente era imprecisa. Nel codice ci sono
**due cose diverse** con lo stesso nome, in stati opposti — verificate con una
sonda sul registry:

| Che cosa | File | Stato | Che cosa sblocca |
|---|---|---|---|
| **Check sharp mirato** (una chiamata per partita segnalata) | `src/lib/providers/optional/odds-api-sharp.ts` (220 righe) | **implementato davvero**: endpoint `api.the-odds-api.com/v4/sports`, `fetchSharpLine`, `extractSharpPrice`, budget 490 crediti, 11 campionati mappati, cache giornaliera. Chiamato da `/matches/[id]` via `getSharpLine` | la **riga sharp** nella pagina della partita |
| **Provider completo** (quote per ogni bookmaker) | `src/lib/providers/optional/the-odds-api.ts` (89 righe) | **guscio vuoto**: `fetchOdds` restituisce `unsupported("le quote (adapter non implementato)")` | la **coordinazione** (25 punti) |

Sonde eseguite: senza variabili → `the-odds-api: enabled=false`; con
`ODDS_API_ENABLED=true` e senza chiave → resta `false`; con flag e chiave →
`enabled=true`. Quindi l'unica cosa che manca al check sharp è la chiave, e la
chiave è accettata con quattro nomi diversi (`THE_ODDS_API_KEY`,
`ODDS_API_KEY`, `theoddsapiKey`, `THEODDSAPIKEY`).

**Il difetto che la domanda ha fatto emergere, e che ho corretto.** Con flag e
chiave impostati, il provider dichiarava `perBookmakerOdds: true` pur non
restituendo una sola quota. Misurato: `perBookmakerOddsUnavailable()` passava da
`true` a `false`, quindi `/api/health` avrebbe stampato «Quote per singolo
bookmaker disponibili» e il sistema avrebbe smesso di dichiarare che
coordinazione e conferma sharp non sono misurabili — su una fonte che non
chiama la rete. Una capacità dichiarata e non mantenuta è peggio di una
capacità assente. Ora le capacità seguono `ADAPTER_IMPLEMENTED` (costante
esplicita, oggi `false`) e un test in `test:providers` lo blocca: 52/52.

**Aggiornamento (05/09, dopo lo screenshot di Vercel).** La chiave esiste già:
`theoddsapiKey` è impostata in produzione dal 26/08 ed è uno dei quattro nomi
accettati da `readOddsApiKey`. Quindi il **check sharp è già acceso** (non
richiede `ODDS_API_ENABLED`), mentre il **provider completo resta spento**
perché manca quel flag — e resterebbe un guscio comunque. I segnali attivi in
produzione sono quasi tutti su tornei minori non mappati in `sport-keys.ts`,
quindi il check sharp si accende raramente: è il motivo dei pochi crediti
spesi. **Non impostare `ODDS_API_ENABLED` ora**: il codice in produzione
dichiarerebbe una capacità che non ha (difetto corretto nel branch, non ancora
deployato).

**Difetto corretto (05/09).** I due interruttori leggevano la chiave in modo
diverso: il check sharp usava `readOddsApiKey()` (i quattro nomi accettati),
mentre `theOddsApiEnabled()` guardava solo `ODDS_API_KEY`. Con la chiave
impostata come `theoddsapiKey` — il caso reale in produzione — il check sharp
funzionava e la fonte restava spenta anche col flag acceso. Ora entrambi
leggono `readOddsApiKey()`, con un test che percorre i quattro nomi
(`test:providers` 52/52).

**Sul flag `ODDS_API_ENABLED`.** `/api/health` di produzione risponde
`the-odds-api: enabled=false`, «Disattivata da configurazione.». Nota: questo
da solo **non** prova l'assenza del flag, perché con il vecchio codice la
fonte era spenta comunque (la chiave non si chiama `ODDS_API_KEY`). La prova
dell'assenza è lo screenshot di Vercel, che elenca le variabili e non la
contiene. Dopo il fix, accendere il flag con la chiave esistente accenderebbe
davvero la fonte: **si fa solo insieme alla pubblicazione del fix.**

**Avanzamento sul provider completo.** Il pezzo che mancava non era la rete ma
la traduzione della risposta nel contratto interno: scritto
`src/lib/providers/optional/the-odds-api-odds.ts` (puro, testato con una
fixture JSON congelata, 76 test in `test:odds-adapter`). Regole: ogni bookmaker
diventa una serie reale (`isConsensus: false`), i nomi non risolvibili si
contano e non si indovinano, i mercati non gestiti non producono quote.

**Collegamento e coordinazione di mercato (05/09).** La documentazione della
fonte stabilisce che il costo di una chiamata è `mercati × regioni`, e che il
numero di bookmaker **non** entra nel conteggio
(https://the-odds-api.com/liveapi/guides/v4/#how-is-usage-calculated). Fino a
oggi la lettura sharp chiedeva tre book e ne usava uno: costava 1 credito e ne
sfruttava una frazione. Ora la chiamata chiede tutti i book della regione `eu`
sullo stesso mercato `h2h` — **stesso credito** — e la fotografia conserva:

- i prezzi di tutti i book che quotano la selezione osservata;
- la **dispersione di mercato** (min, max, differenza fra tutti i book);
- la **dispersione fra i soli book sharp**, tenuta separata perché misura
  un'altra cosa: quanto la linea "intelligente" è condivisa, non quanto lo è il
  mercato. Confonderle significherebbe spacciare l'una per l'altra.

Con una sola quotazione la dispersione è `null`, non `0`, e la pagina dichiara
che non è misurabile. **Fotografie vecchie:** quelle già in `system_state` non
hanno i campi nuovi; `normalizeSharpSnapshot` le riporta a "non misurabile"
invece di lasciarle `undefined`, perché la pagina legge `marketSpread.count` e
si schianterebbe sulle partite lette il giorno prima — difetto che comparirebbe
solo in produzione e solo per un giorno (test dedicato).

Il timeout sale da 8 a 12 s perché la risposta ora contiene tutti i book: un
payload più ricco non deve diventare un errore di rete.

Resta
deliberatamente separato il cablaggio nel ciclo di raccolta (quale partita
interrogare, come abbinarla a un evento della fonte, come pagarla dal budget):
sono scelte da fare con la chiave attiva, non al buio.

---

## 6. Che cosa ho cambiato in questo branch È l'unica già prevista
come adapter nel codice (`src/lib/providers/optional/the-odds-api.ts`), quindi
il costo di attivazione è una chiave e una mappatura, non un modulo nuovo; e
500 crediti/mese bastano largamente con la regola di budget già scritta (una
chiamata per partita segnalata). La riserva è seria e va detta: **Pinnacle su
The Odds API risulta disponibile solo per la regione EU e tramite scraping con
ritardo dichiarato**, quindi la «linea sharp» che ne uscirebbe non sarebbe
pulita come quella dei tuoi CSV. Se l'obiettivo è una linea sharp vera,
SportsGameOdds (Pinnacle diretto, 2 500 oggetti/mese gratuiti) è la scelta
migliore e costa un adapter nuovo. **Non posso completare nessuna delle due
senza una chiave tua**: è l'unico punto di questa lista bloccato su di te.

**D3 — indice: dichiarato il tetto, fasce marcate.** Ho scelto la strada che
non riscrive i numeri storici e non finge una ricalibrazione non validata: il
tetto si **calcola dalle costanti del motore** (`src/lib/view/score-ceiling.ts`)
e la tabella CLV marca «irraggiungibile» le fasce sopra quel valore. Se domani
una fonte per singolo bookmaker diventa attiva, il tetto sale da solo e le
fasce smettono di essere marcate — senza che nessuno debba ricordarsi di
aggiornare una costante. È l'opzione che resta vera da sola.

**Priorità — la pagina che mancava.** Ho scritto `/guida`, «Come si sceglie una
partita con questi dati»: è l'unico contenuto ad alto valore che si poteva
produrre oggi senza una fonte nuova, perché i numeri esistevano già nei report
e non arrivavano in nessuna pagina. Contiene, con i campioni accanto: il
risultato sul prezzo migliore (+6,53 pp di ROI), la tassa per fascia di quota,
il valore del drop per ampiezza, l'ordine di lettura di una card, e che cosa
ignorare.

---

## 6. Che cosa ho cambiato in questo branch

| File | Che cosa |
|---|---|
| `src/lib/view/clv-basis.ts` | nuovo: conteggio e dichiarazione della base del CLV |
| `src/lib/view/__tests__/clv-basis.test.ts` | nuovo: 31 test |
| `src/lib/view/score-ceiling.ts` | nuovo: tetto strutturale dell'indice e fasce irraggiungibili |
| `src/lib/view/__tests__/score-ceiling.test.ts` | nuovo: 29 test, verificati contro `analyzeDrop` |
| `src/lib/providers/optional/the-odds-api-odds.ts` | nuovo: parsing di The Odds API da JSON a quote per book |
| `src/lib/providers/optional/__tests__/the-odds-api-odds.test.ts` | nuovo: 76 test su fixture congelata, lettura sharp e normalizzazione |
| `src/lib/providers/optional/odds-api-sharp.ts` | tutti i book della regione, doppia dispersione, normalizzazione delle fotografie vecchie |
| `src/lib/repo/sharp.ts` | normalizza la fotografia letta dalla cache |
| `src/lib/clv/rebasis.ts` | nuovo: decisione di ribasatura del CLV, pura e motivata |
| `src/scripts/rebase-clv.ts` | nuovo: passaggio a secco di default, `--apply` per scrivere |
| `.github/workflows/rebase-clv.yml` | nuovo: pulsante manuale, secrets mai in chiaro |
| `src/lib/view/clv-basis.ts` | etichette corrette: allineata è grezzo-contro-grezzo |
| `src/components/SharpLineBlock.tsx` | mostra mercato e sharp separatamente, con i prezzi tutti elencati |
| `src/lib/providers/optional/the-odds-api.ts` | `ADAPTER_IMPLEMENTED`: le capacità seguono l'implementazione, non l'intenzione |
| `src/lib/providers/__tests__/providers.test.ts` | test su capacità non dichiarata e sui quattro nomi della chiave (52/52) |
| `src/app/guida/page.tsx` | nuovo: «Come si sceglie una partita con questi dati» |
| `src/lib/repo/dashboard.ts` | `basis`, `basisNote`, `ceiling`, `ceilingNote`, fasce `unreachable` |
| `src/lib/repo/performance.ts` | composizione delle basi sulla serie storica |
| `src/components/ClvSection.tsx` | base e tetto dichiarati prima del numero, fasce irraggiungibili marcate |
| `src/app/performance/page.tsx` | base di confronto dichiarata sopra il grafico |
| `src/app/metodologia/page.tsx` | le due soglie (10 e 30) spiegate, la base mista dichiarata con la misura −1,86 pp |
| `src/lib/drop/constants.ts` | `COVERAGE_WEIGHTS` esportato: una sola verità per motore e tetto |
| `src/lib/drop/engine.ts` | la copertura legge le costanti invece di frazioni scritte inline |
| `src/components/simulator/PoissonSimulatorView.tsx` | sezione di stato del modello, intestazioni derivate dalla matrice, rimandi mancanti |
| `src/lib/quant/dixon-coles.ts` | `DEFAULT_MAX_GOALS` esportato, default allineato alla pagina, stato del modello documentato |
| `src/lib/quant/__tests__/quant.test.ts` | l'asserzione legge la costante, non un 7 scritto a mano |
| `src/components/__tests__/simulator.test.tsx` | nuovo: 9 test in DOM reale |
| `src/components/SiteNav.tsx`, `src/lib/site.ts`, `src/app/sitemap.ts` | `/guida` in navigazione, sitemap e pagine pubbliche |
| `README.md` | 16 tabelle, 61 test, 33 suite, 5 strumenti, 11 rotte, albero reale |
| `docs/DECISIONI-APERTE.md` | budget Odds API corretto a 490/500 |

**Verifica.** `npm run typecheck` pulito · `npm run lint` pulito ·
`npm run build` **23 rotte** generate (era 22: `/guida`) · **33 suite su 33
eseguibili verdi** (`test:pipeline` e `test:scheduler` richiedono PostgreSQL,
assente nella sandbox) · `test:clv-basis` 31/31 · `test:score-ceiling` 29/29 ·
`test:odds-adapter` 76/76 · `test:clv-rebasis` 36/36 ·
`test:clv-basis` 35/35 · `test:providers` 52/52 ·
`test:simulator` 9/9 · `test:quant` 60/60 · `test` 61/61.
