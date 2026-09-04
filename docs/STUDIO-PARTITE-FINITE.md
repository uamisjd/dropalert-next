# Studio della sezione «partite finite» — audit dell'archivio e dove sta il profitto

**Data di lettura:** 04/09/2026. **Di chi è questo documento:** analisi interna, non una pagina del sito.
**Perimetro:** i segnali chiusi (partite finite), il loro esito, il loro CLV, e la domanda «dove si può
fare profitto con questa sezione». **Metodo:** due binari — (1) audit dello stato reale dell'archivio e
del codice che lo produce; (2) studio quantitativo sui ~12 500 partite congelate di `data/football-data/`,
dove la potenza statistica esiste davvero.

Ripetibile:

```bash
npm run audit:finished > docs/AUDIT-PARTITE-FINITE.md   # legge il DB, non scrive nulla
npm run study:finished                                  # dati congelati, zero rete, zero DB
```

---

## 1. Lo stato di fatto (letto in produzione il 04/09/2026)

| Cosa | Numero |
|---|---|
| segnali totali | **245** — chiusi 238, attivi 5, rimbalzati 2 |
| partite in archivio | 606 |
| rilevazioni di quota | 11 295 |
| record CLV | 238 (uno per segnale chiuso) |
| buchi dati aperti | 778 — `bookmaker_missing` 598, `rate_limited` 91, `provider_unavailable` 55, `result_not_published` 34 |
| CLV medio | **−3,77 pp** |
| segnali che hanno battuto la chiusura | **8%** |
| esiti di ieri (`/ieri`) | 20 risolti: 7 centrate, 13 mancate (35%) |
| indice più alto in archivio | 53,12 su 100 — con `normalizedScore` 97 su base misurabile |

Per fascia di indice (`/performance`, scala grezza):

| Fascia | n | CLV medio | Batte la chiusura |
|---|---|---|---|
| 0–24 | 104 | −4,51 pp | 0% |
| 25–49 | 133 | −3,21 pp | 14% |
| 50–74 | 1 | −1,12 pp | 0% |
| 75–100 | **0** | n/d | n/d |

Le prime tre cose che si vedono da qui, prima di ogni statistica:

1. **la popolazione è minuta e periferica**: le 20 schede di ieri sono Uruguay Copa, San Marino, Bahrain,
   Thailandia 2, FA Cup inglesi minori, Egitto Division 2 A, Premier League Cup U21. Non è un campione di
   mercato: è l'elenco di ciò che si muoveva alle 22–23 UTC mentre il collector girava;
2. **nessun segnale dell'archivio arriva alla fascia medio/alta**, e non è un caso (vedi §2.D);
3. **il numero che dovrebbe decidere tutto — il CLV — è oggi il numero meno affidabile della sezione**
   (§2.A e §2.B).

---

## 2. Sei riscontri sulla sezione (audit del codice + dei dati)

### A. Il CLV confronta due basi diverse: prezzo grezzo contro chiusura senza margine

`computeClvForSignal` passa a `computeClv` il `detectedPrice` — una quota di **consenso con dentro il
margine** — e come chiusura `getClosingReference().price`, che **è la fair no-vig** quando è calcolabile
(`src/lib/pipeline/closing.ts:477-480` e `:329-361`). Il divario di prezzo fra le due basi è esattamente il
margine, e il CLV ne esce depresso per costruzione.

Prova sul dato vivo — segnale 228 (Oriental – Racing Montevideo, 03/09):

```
detected 1.54 (grezzo)  vs  chiusura 1.69 (fair, proportional)  →  CLV −5,76 pp
```

L'intera cifra è il margine: `1/1.54 = 0,6494`, `1/1.69 = 0,5917`, scarto 5,77 pp, nessun movimento reale
fra le due letture. Dimensionato su 12 459 partite (§3, S1.1): lo spostamento meccanico medio è
**−1,86 pp**, tocca **−4,26 pp** sulle quote 1.01–1.39, e **il 20,6% dei casi cambierebbe verso**.

> Conseguenza: «CLV medio −3,77 pp, 8% batte la chiusura» non è una bocciatura dei drop. È, in larghissima
> parte, l'imposta del bookmaker letta come se fosse un verdetto. E su questo numero R3 vorrà ricalibrare i
> pesi dell'indice: si sta calibrando su un artefatto.

### B. La «chiusura» non è la chiusura: il campo che lo dimostra esiste, nessuno lo legge

Le quote di una partita sono osservate **solo finché la partita è nell'elenco dei movimenti**
(`fetchOdds` di BetExplorer rilegge quell'elenco e, se la partita non c'è più, dichiara «nessuna quota
corrente osservabile»: `src/lib/providers/betexplorer/index.ts:311-333`). La closing line è quindi «l'ultima
volta che la fonte parlava della partita», non l'ultimo prezzo prima del kickoff. Il sistema calcola e salva
`closing_lines.minutes_before_kickoff` (`closing.ts:240`) e **non lo legge da nessuna parte**: nessun filtro,
nessuna distribuzione pubblicata, nessun caveat in pagina.

Effetto combinato con A: dove la serie è corta, il CLV confronta il prezzo di rilevamento con sé stesso
depurato del margine → CLV garantito negativo. Il conteggio di questi casi (`signalPrice == closingPrice`) è
nella sezione B dell'audit.

### C. Gli esiti arrivano entro 30 giorni, poi la scheda resta muta per sempre

`findPendingResultMatches` lavora con `RESULT_LOOKBACK_DAYS = 30` e un tetto di 25 campionati a giro
(`src/lib/providers/betexplorer/ingest.ts:349-352`). Una partita finita che il caso non ha saldato dentro la
finestra non viene più rincorsa: l'archivio invecchia e la colonna esiti no. È **esattamente** il lavoro che
stai facendo a mano («verificare scheda per scheda»): si può automatizzare, la macchina esiste già, manca solo
il passaruota (§5, idea D).

### D. L'indice non può superare 55: le fasce alte del riepilogo CLV sono strutturalmente vuote

Con una sola fonte di consenso, coordinazione (25 punti) e conferma sharp (20) non sono misurabili
(`registry: perBookmakerOdds = false`). Il tetto raggiungibile è 55/100 — e infatti l'API lo dichiara:
`measurableMax: 55`, con `normalizedScore` 94–97 per i segnali migliori. `/performance` però taglia le fasce
sull'indice **grezzo** (0–24, 25–49, 50–74, 75–100): le due fasce alte non possono riempirsi, e il test
«un indice più alto corrisponde a un CLV migliore?» viene fatto su metà scala. Che sia monotono in senso
positivo (−4,51 → −3,21 → −1,12) è l'unico segnale incoraggiante in tutta la tabella, ma con n = 1 sopra i 50
non è una conferma.

### E. L'indice della card non è l'indice del momento in cui avresti potuto agire

Motore: `sustainedMinutes = now − firstMoveAt` (`src/lib/drop/engine.ts:344`) e
`durationScore = sustainedMinutes / 240` — **nessun blocco al kickoff**. Nel segnale 228 il movimento reale
occupa 30 minuti (22:15 → 22:45) mentre la partita calcia alle 23:00: il punteggio finale attribuisce
13,05/15 di «tenuta nel tempo» contando minuti corsi **dopo** il fischio d'inizio, e la card parla di «livello
mantenuto da 4 ore». La storia degli eventi dice altro: 38,5 al rilevamento → 40,96 alla chiusura → 51,55
all'ultimo aggiornamento. Il `signal_score` salvato nel record CLV è un quarto numero (quello all'istante del
calcolo). Quattro numeri della stessa misura, e solo uno era disponibile a chi guardava la card in tempo
reale.

### F. «Coordinato da 16/17 bookmaker» e «movimento osservato su un solo bookmaker» convivono nella stessa scheda

Il gap dichiarato lo dice testualmente (`dataGaps` del segnale 228): «La fonte *dichiara* 16/17 bookmaker
concordi, ma non espone le singole quote», mentre `coordination` vale `booksTotal: 1, booksConfirming: 1,
coordinationScore: 0`. Corretto nel metodo (non si stima ciò che non si vede), ma la lettura umana è
impossibile da conciliare: la fonte *dice* che 16 libri sono d'accordo e il sito *conta* un libro solo. Vale
la pena scrivere in pagina la distinzione fra «concordanza dichiarata dalla fonte» (non verificabile) e
«concordanza osservata» (assente), perché è lì che un lettore cerca la forza del movimento.

---

## 3. Che cosa dicono 12 459 partite: lo studio sui dati congelati

Stesso perimetro dei backtest R1/R1.5 (Pinnacle come riferimento, fair no-vig proporzionale, esiti reali),
ma con una domanda in più: non «il drop predice l'esito?» (risposta nota: no) bensì **«a quale prezzo, con
quale base di confronto, e con quale potenza: dove il segno del ROI diventa positivo?»**. Sette sezioni,
output rigenerabile con `npm run study:finished` (appendice in fondo).

### S1.1 — L'imposta di base (la misura del problema A)

| Fascia di quota al rilevamento | osservazioni | CLV perso per solo errore di base |
|---|---|---|
| 1.01–1.39 | 1 654 | **−4,26 pp** |
| 1.40–1.99 | 5 295 | −3,20 pp |
| 2.00–2.99 | 7 442 | −2,19 pp |
| 3.00–4.99 | 16 725 | −1,45 pp |
| 5.00–9.99 | 5 264 | −0,87 pp |
| 10.00+ | 982 | −0,44 pp |

### S3 — Il drop aggiunge qualcosa al «puntare a caso alla stessa quota»? (base retrospettiva, tetto)

Fuori dal campione (2023/24 → 2025/26), ROI della selezione più scesa contro riferimento senza segnale sulla
**stessa fascia di quota**:

| Fascia | n drop | ROI drop | riferimento (n) | differenza | t |
|---|---|---|---|---|---|
| 1.01–1.39 | 334 | +3,17% | −0,97% (215) | +4,14 pp | 0,92 |
| 1.40–1.99 | 877 | −5,71% | −0,40% (1 006) | −5,31 pp | −1,38 |
| 2.00–2.99 | 1 024 | −7,65% | −1,53% (1 527) | −6,12 pp | −1,28 |
| 3.00–4.99 | 1 639 | −7,87% | −6,66% (4 083) | −1,21 pp | −0,26 |
| 5.00–9.99 | 371 | **−22,10%** | −22,07% (1 457) | −0,04 pp | 0,00 |
| 10.00+ | 34 | −35,29% | −45,56% (270) | +10,26 pp | 0,21 |

Nessuna fascia significativa in nessun verso; dove il numero è grande (10.00+) il campione è 34. La fascia
5.00–9.99 è la peggiore in assoluto: −22% di ROI, identica con o senza segnale — lì il problema non è il
drop, è il prezzo.

Per classe di ampiezza del sito (tetto retrospettivo, ROI a chiusura Bet365): `moderate` −7,87% (t −4,01),
`high` −5,20% (t −1,43), `very_high` +16,17% con n = 41 (non concludente). La scala delle ampiezze **non**
ordina il profitto: semmai ordina il rumore, e R1.5 lo aveva già mostrato con ben altro campione.

### S4 — Esecuibile (nessun lookahead): valore contro il fair sharp, per decili

34 800 puntate «tutte le selezioni 1X2» ordinate per `edge = fair Pinnacle − implicita pagata`:

| | D1 (edge peggiore) | D5 | D10 (edge migliore) | D10 solo out-of-sample |
|---|---|---|---|---|
| pre-movimento | −7,27% | −7,88% | **+1,06%** (t 0,28) | **−12,84%** (±6,09 pp) |
| chiusura | −6,34% | −8,95% | −0,86% (t −0,25) | −9,40% (±5,47 pp) |

Over/Under 2.5: decile migliore −2,21% vs peggiore −4,75%. Handicap asiatico: decile migliore **−12,20%
(t −6,43)**. Traduzione: anche l'idea classicamente «vera» — inseguire il book morbido quando quota più a
lungo del fair sharp — su questi dati non produce un bordo distinguibile da zero, e dove produce qualcosa
fuori dal campione si capovolge. Non è la prova che l'edge non esista (Pinnacle come verità è un'approssimazione,
e i prezzi del CSV non sono quotazioni eseguibili): è la prova che **non è abbastanza grande da essere
trovato qui**, e che nessun prodotto dovrebbe prometterlo.

### S5 — Il CLV come predittore di denaro

| Bucket di CLV vs fair di chiusura | n | ROI atteso dal CLV | ROI realizzato | OOS |
|---|---|---|---|---|
| sotto −4 pp | 6 042 | −14,56% | −14,16% | −10,90% |
| −4 … −2 | 8 637 | −10,10% | −12,40% | −12,10% |
| −2 … −1 | 6 621 | −6,09% | −5,56% | −5,98% |
| −1 … 0 | 5 988 | −2,27% | −3,55% | −10,12% |
| 0 … +0,5 | 2 177 | +1,01% | +1,56% | **−6,72%** |
| +0,5 … +1 | 1 619 | +3,10% | +2,22% | −5,30% |
| +1 … +1,5 | 1 139 | +5,09% | +5,19% | +7,09% |
| +1,5 … +2 | 793 | +6,75% | −0,66% | −11,72% |
| +3 … +4 | 409 | +12,19% | +18,74% | −5,21% |
| sopra +6 | 124 | +23,13% | +38,21% | +52,28% |

Due letture, entrambe utili: (1) **il CLV è una misura di denaro** — fra −4 pp e +1,5 pp l'atteso (ciò che
il CLV promette) e il realizzato coincidono entro il mezzo punto percentuali su 31 000 puntate, e questo
assolve completamente la scelta del sito di validarsi sul CLV invece che sulle percentuali di vincita;
(2) la zona attorno allo zero è rumore: il primo bucket positivo (0 … +0,5 pp) vale +1,56% realizzato ma
**−6,72% out-of-sample**, e già a +1,5 … +2 pp il realizzato gira di nuovo sotto zero. Nessun bucket sotto
+1 pp di CLV è ragionevole chiamarlo vantaggio; e un CLV medio di −3,77 pp sta nel secondo bucket da sotto,
quello dove lo studio misura un −12% di ROI.

### S6 — Dove il profitto è misurato (e non è un segnale)

- Stesso identico insieme di puntate (tutte le selezioni a chiusura, 37 374 casi): **−6,60% di ROI da
  Bet365, −0,07% al prezzo migliore disponibile → +6,53 pp di ROI**. Nessuna previsione, nessuna velocità,
  nessun modello: solo *dove* compri. È il numero più grande e più solido di tutto lo studio.
- Margine medio per libro: Bet365 5,5 pp, consenso 4,7 pp, Pinnacle 2,7 pp, e **−0,36 pp** per il «migliore
  disponibile» — cioè il paniere dei prezzi migliori è, in media, *sopra il fair*: non c'è margine da
  pagare, lì.
- Arbitraggio reale fra 8 bookmaker individuali: **1,6% delle partite a chiusura** (profitto medio 1,13%),
  0,18% al pre-movimento. Usando invece la colonna «Max» del provider — che include il prezzo del betting
  exchange — le "occasioni" salgono al **59,9%**. È il medesimo artefatto che una calcolatrice di sicurezze
  senza dichiarazione della fonte del prezzo trasforma in un prodotto inventato: la `/surebet` del sito è
  salva finché il dato lo inserisce chi legge, ma va blindata con una riga di caveat sulla fonte del prezzo.

### S2 — Quanto è già tardi quando lo vedi

Per le selezioni con drop in classe `high` (5–10 pp), la stessa selezione vale **+10,30% di ROI al prezzo
pre-movimento** e **−5,20% alla chiusura**: 15,5 pp di valore che il mercato si mangia fra le due letture.
Con la cadenza di 45 minuti del collector e un elenco che pubblica solo ciò che si muove *adesso*, il
progetto non sta misurando «il valore di un drop»: sta misurando «quanto ne restava quando la fonte ha
smesso di parlarne».

### S8 — La potenza, per non prendere in giro nessuno

σ per puntata = **1,59**. Per dimostrare un ROI dell'1% servono ~199 000 puntate, del 2% ~50 000. I 238
segnali dell'archivio sono lo 0,5% di quel fabbisogno: la verifica scheda per scheda degli esiti **non può**
produrre un verdetto economico, può solo produrre dati completi. Chi scrive «rendimento» su 238 schede sta
scrivendo rumore con la formattica di un risultato.

---

## 4. Verdetto: dove si può fare profitto

**Non qui, non così.** Tre affermazioni separate, tutte con la loro prova:

1. **Seguire i drop di consensus non è un'attività a valore atteso positivo.** Su 11 600 partite, a parità
   di fascia di quota, la selezione più scesa non batte il riferimento (S3): 0 segmenti su 6 significativi,
   4 su 6 negativi; sulle quote 5.00–9.99 brucia un −22% di ROI. Il campione del sito dice la stessa cosa
   con un metro diverso (8% di beat-close), anche se per una quota larga di artefatto (§2.A).
2. **La sezione, oggi, non può misurare il profitto.** Il CLV è su base mista (§2.A), la «chiusura» è un
   proxy della fine dell'attenzione della fonte (§2.B), l'indice ha quattro valori diversi a seconda
   dell'istante (§2.E), le fasce alte della tabella di validazione sono irraggiungibili (§2.D). Su questi
   numeri si può lavorare *solo* per aggiustarli, non per trarne strategie.
3. **Il profitto misurato in questi dati è nel prezzo, non nel segnale.** +6,5 pp di ROI dallo shopping
   (S6): è 15 volte l'effetto di qualsiasi classe di ampiezza e l'unico numero grande, stabile e senza
   modello. Un osservatorio che vuole parlare di denaro ha una riga sola da aggiungere, ed è «quanto costa
   il prezzo che stai guardando».

---

## 5. Idee e tecniche, ordinate per valore sul progetto

Legenda: **V** = valore per il progetto (misura che abilita), **C** = costo, **R** = rischio per l'identità
(«misura, non consiglia»).

| # | Idea | V | C | R | Perché, in una riga |
|---|---|---|---|---|---|
| A | **CLV a base coerente**: de-viggare anche il prezzo di rilevamento (la terna completa c'è in ogni snapshot) e salvare `clvPp` su base omogenea, con la base grezza tenuta come secondo numero | ★★★ | piccolo (1 modulo + 1 test) | nessuno | senza questo, R2 e R3 calibrano su un'imposta |
| B | **Guardia della chiusura**: `minutesBeforeKickoff` diventa un filtro e una riga in pagina; i CLV con `signalPrice == closingPrice` diventano «non misurabile», non «negativo» | ★★★ | piccolo | nessuno | smette di chiamare verdetto un'assenza di dato |
| C | **Score congelato al rilevamento** (`detected_score`) + persistenza contata solo sui minuti pre-kickoff; card che mostra «al rilevamento / alla chiusura» | ★★ | piccolo | nessuno | l'indice deve essere la foto di quando avresti potuto agire |
| D | **Backfill esiti senza finestra** (job che scorre le partite passate oltre i 30 giorni, con budget di richieste) | ★★ | medio (1 job + limiti) | nessuno | trasforma il tuo «scheda per scheda» in un ciclo; 34 gap aperti + tutto ciò che è più vecchio |
| E | **Fasce del riepilogo CLV su scala misurabile** (55/55 = 100) o, in alternativa, bande dichiarate su `measurableMax` | ★★ | piccolo | nessuno | oggi la tabella di validazione ha due righe strutturalmente vuote |
| F | **Secondo libro, anche uno solo** (The Odds API con le regole di budget già scritte nel backlog, voce 5) | ★★★ | medio (crediti) | basso | 45 dei 100 punti dell'indice sono accesi solo da lì; e «16/17 bookmaker concordi» diventerebbe misurato invece che dichiarato |
| G | **Pannello «quanto vale il prezzo»**: margine del consenso osservato, fair no-vig della terna, scarto fra prezzo visto e prezzo migliore teorico | ★★★ | medio | da progettare con cura | è l'unico effetto grande e stabile emerso dallo studio (S6) |
| H | **Filtro per fascia di quota, non per classe di ampiezza**: la penalità di iper-reazione (suspicion-v2) va agganciata a `quota > 5.00`, dove lo studio mostra −22% di ROI, e non all'ampiezza del calo | ★★ | piccolo | basso | è il segmento che si ripete in R1.5, nello studio S3 e nelle schede di ieri |
| I | **Metrica «tempo al kickoff al rilevamento»**: `kickoffAt − detectedAt` distribuita in /coverage e incrociata col CLV | ★★ | piccolo | nessuno | S2 dice che il valore si consuma in fretta: oggi non sappiamo quanto tardi arriviamo |
| J | **Tabella di traduzione CLV → denaro** (bucket di CLV e ROI atteso/realizzato, dal backtest) in /metodologia | ★★ | piccolo | basso | insegna ai lettori che un CLV di −3 pp *significa* un −12% di ROI; è educazione, non pronostico |
| K | **Caveat anti-surebet per fonte di prezzo**: in `/surebet`, una riga che dichiari che i prezzi di exchange non sono offerte di bookmaker (60% vs 1,6% di occasioni) | ★ | banale | nessuno | l'artefatto più facile da produrre per un lettore |
| L | **Campioni non pubblicabili, detto in pagina**: su < 1 000 esiti, /ieri e /performance mostrano il fabbisogno di potenza (S8) accanto ai numeri | ★ | banale | riduce il rischio | mette per iscritto che 20 schede non sono un rendimento |

**Cose che lo studio sconsiglia esplicitamente**: rincorrere il valore sui mercati handicap (decile
migliore −12,2%, t −6,4); usare il tasso di vincita come metro (σ 1,59: servono ~50 000 puntate per vedere
un 2%); pubblicare «segmenti» per lega o per soglia di drop come elementi di prodotto (R1.5: direzione
stabile, entità no); fidarsi dell'ampiezza come ordinatore di qualità (S3: `moderate` è la fascia più
popolosa e la peggiore per t).

## 6. Le tre patch che proporrei, in ordine (non applicate in questo documento)

1. `src/lib/pipeline/closing.ts` — in `computeClvForSignal`, costruire il `signalPrice` sulla stessa base
   della chiusura: se `reference.basis === "fair_novig"`, de-viggare la terna del segnale nello stesso
   snapshot (i dati ci sono: `parseDroppingOdds` salva H/D/A correnti a ogni giro) e salvare il CLV su base
   `fair_fair`, mantenendo `raw_raw` come secondo numero. Test attesi: (a) con terna completa il CLV su base
   mista non è mai salvato; (b) un segnale con `closingPrice == signalPrice` produce `basis = "not_measurable"`.
2. `src/lib/pipeline/closing.ts` + `src/lib/repo/performance.ts` — soglia dichiarata per la chiusura
   (proposta: `minutesBeforeKickoff ≤ 60`, configurabile) e distribuzione pubblicata in `/coverage`; i CLV
   fuori soglia restano in archivio ma escono dalle medie, con il conteggio di quanti ne escono.
3. `src/lib/drop/engine.ts` — `sustainedMinutes` troncata al kickoff (i minuti dopo non sono tenuta di un
   prezzo pre-partita), e `detected_score` salvato al primo rilevamento accanto a quello corrente.

Tutte e tre sono *misure*, nessuna tocca la promessa del sito: nessun pronostico, nessun consiglio.

## 7. Limiti di questo documento

- I numeri §1 vengono dalle pagine pubbliche e dalle API di produzione lette il 04/09/2026: snapshot di un
  giorno, non una query SQL. `npm run audit:finished` (nuovo) li rifà dal database e aggiunge i conteggi che
  qui non potevo fare (quanti CLV `signalPrice == closingPrice`, distribuzione di `minutesBeforeKickoff`,
  ricalcolo del CLV a base corretta, ROI per segmento).
- I prezzi «pre-movimento» del CSV non sono aperture reali, e la chiusura è una fotografia raccolta in
  un'ora del provider: le differenze di prezzo fra i due istanti sono un limite superiore, non un'operazione
  eseguibile. Dichiarato anche in `data/README.md`.
- «Fair = Pinnacle» è un'assunzione, non un teorema: tutto ciò che sta in S4 dipende da lì.
- Le 5 leghe mayores non sono la popolazione del sito (che oggi vive di coppe minori, riserve e campionati
  esotici): per quella fascia di mercato non ho dati, e il sito è l'unico che può produrli — motivo in più
  per aggiustare prima la misura (§6), così che lo storico che state accumulando diventi un giorno una prova.

---

# Appendice — output integrale di `npm run study:finished`

# Studio «partite finite» — output rigenerato

Dati: `data/football-data/*`, 5 campionati, 7 stagioni, 12459 righe lette; 11407 partite con un drop ≥ 0 pp misurabile su Pinnacle. In-sample 7203 righe, out-of-sample 5256.

## S0 — Che cosa c'è davvero nell'archivio congelato

Righe lette: 12459 · con risultato: 12459 · base comune (esito + terna Pinnacle nei due istanti + terna Bet365 a chiusura): **11596** · di cui out-of-sample 4402.

| Campionato | partite | base usabile | Pinnacle assente |
|---|---|---|---|
| Premier League | 2660 | 2490 | 170 |
| Serie A | 2660 | 2475 | 185 |
| La Liga | 2660 | 2465 | 195 |
| Bundesliga | 2142 | 1985 | 157 |
| Ligue 1 | 2337 | 2181 | 156 |

Nessuna partita viene scartata in silenzio: la colonna «Pinnacle assente» è il conto di ciò che non è misurabile (stagione 2025/26 interrotta a metà dal provider, dichiarato in `data/README.md`).

## S1 — Quanto del CLV negativo è soltanto margine

Domanda tecnica con conseguenze economiche: quando il CLV è calcolato contro una chiusura GREZZA (base `raw_consensus`, quella che il sito usa quando il mercato non è completo o la fonte non espone i singoli libri), quanta parte del delta negativo è imposta del bookmaker e non mercato.

| Libro e istante | n partite | margine medio (pp) |
|---|---|---|
| Bet365 · pre-movimento | 12454 | 5.48 |
| Bet365 · chiusura | 12458 | 5.59 |
| Consenso (Avg) · pre-movimento | 12458 | 4.84 |
| Consenso (Avg) · chiusura | 12459 | 4.73 |
| Pinnacle · pre-movimento | 11601 | 3.02 |
| Pinnacle · chiusura | 11605 | 2.73 |
| Migliore disponibile · chiusura | 12459 | -0.36 |

Imposta per singola selezione: implicita del consenso **meno** fair no-vig Pinnacle, stesso istante (chiusura). È ciò che un CLV su base grezza perde per costruzione, fascia per fascia.

| Fascia di quota a chiusura | selezioni | imposta media (pp di probabilità) |
|---|---|---|
| 1.01–1.39 | 1620 | +2.84 |
| 1.40–1.99 | 4873 | +2.27 |
| 2.00–2.99 | 7115 | +1.79 |
| 3.00–4.99 | 15471 | +1.27 |
| 5.00–9.99 | 4779 | +1.02 |
| 10.00+ | 957 | +0.64 |

Lettura: un CLV medio di −3,77 pp su base grezza, in fascia 1.40–2.99, è dentro due punti e mezzo di imposta: non è una bocciatura del metodo, è un numero **non confrontabile**. Finché la base non è `fair_novig` su tutta la popolazione, la frase giusta è «non misurabile», non «negativo».

### 1.1 — La prova del bias di base (è il controllo più importante di tutto lo studio)

Il sito calcola `clvPp = (probChiusura − probSegnale) × 100`. Se la probabilità di chiusura è quella **fair senza margine** e quella del segnale è il prezzo **grezzo** (che il margine lo contiene), il confronto mescola due basi e il CLV esce depresso di un importo meccanico, non di mercato. Qui sotto la stessa partita misurata nei due modi onesti: grezzo-contro-grezzo, fair-contro-fair.

| Fascia di quota al rilevamento | osservazioni | spostamento medio del CLV per solo errore di base (pp) |
|---|---|---|
| 1.01–1.39 | 1654 | −4.26 pp |
| 1.40–1.99 | 5295 | −3.20 pp |
| 2.00–2.99 | 7442 | −2.19 pp |
| 3.00–4.99 | 16725 | −1.45 pp |
| 5.00–9.99 | 5264 | −0.87 pp |
| 10.00+ | 982 | −0.44 pp |

Media su tutte le 37362 osservazioni: **−1.86 pp** di CLV bruciati dal solo errore di base, e 20.6% dei casi cambierebbe verso (da «non ha battuto la chiusura» a «l'ha battuta», o il contrario).

Conseguenza diretta su /performance: un CLV medio di −3,77 pp su 238 osservazioni è dello stesso ordine di grandezza dello spostamento meccanico qui misurato. Prima di leggere qualsiasi verdetto sui signal, la domanda da mettere per iscritto è: **le due quote del CLV stanno sulla stessa base?** Se no, il numero non dice che i drop perdono: dice che il confronto è sporco.

## S2 — Quanto del movimento è già assorbito dal prezzo

Il drop che il monitor rileva non è denaro: è denaro **finché qualcuno è disposto a fare meglio di te**. Misura: per la selezione più scesa, la differenza fra il prezzo pre-movimento e la chiusura, e quanto resta disponibile a chiusura.

| Classe di ampiezza (soglie del sito) | n | Δ implicita pre→chiusura (pp) | ROI puntando sulla stessa selezione al prezzo pre-movimento | ROI alla chiusura |
|---|---|---|---|---|
| `moderate` | 4169 | +3.01 | 0.14% | -7.87% |
| `high` | 823 | +6.36 | 10.30% | -5.20% |
| `very_high` | 41 | +12.26 | 50.37% | 16.17% |

Perché conta per il prodotto: la cadenza del collector è di ~45 minuti. Se il movimento si consuma in una frazione d'ora, un segnale arrivato dopo vale poco in termini di prezzo e la corsa non è sul trovare il drop, è nell'arrivare prima. È la stessa gerarchia che R1.5 aveva già indicato: il valore del movimento cresce con la soglia, ma il prezzo a cui lo ottieni cresce con esso.

## S3 — Il drop aggiunge qualcosa al «puntare a caso nella stessa fascia»?

Test corretto: la selezione più scesa si giudica contro le selezioni della **stessa fascia di quota delle stesse partite**, non contro la media generale — altrimenti si misura la lunghezza della quota, non il movimento. Base retrospettiva (quota di chiusura), dichiarata come tetto.


**In-sample 2019/20–2022/23** — stessa fascia di quota, stesso metodo:

| Fascia di quota | puntate sul calo (n, ROI) | riferimento senza segnale (n, ROI) | Differenza | Errore standard della differenza | t |
|---|---|---|---|---|---|
| 1.01–1.39 | 588, ROI -4.33% | 404, ROI -6.92% | **+2.59 pp** | 3.56 pp | 0.73 |
| 1.40–1.99 | 1490, ROI -3.41% | 1537, ROI -2.88% | **−0.53 pp** | 3.01 pp | -0.18 |
| 2.00–2.99 | 1683, ROI -6.19% | 2531, ROI -6.10% | **−0.10 pp** | 3.71 pp | -0.03 |
| 3.00–4.99 | 2557, ROI -1.76% | 6931, ROI -6.63% | **+4.87 pp** | 3.73 pp | 1.31 |
| 5.00–9.99 | 706, ROI -14.62% | 2355, ROI -10.39% | **−4.23 pp** | 9.46 pp | -0.45 |
| 10.00+ | 103, ROI 50.49% | 496, ROI 7.06% | **+43.43 pp** | 46.54 pp | 0.93 |

**Out-of-sample 2023/24–2025/26** — stessa fascia di quota, stesso metodo:

| Fascia di quota | puntate sul calo (n, ROI) | riferimento senza segnale (n, ROI) | Differenza | Errore standard della differenza | t |
|---|---|---|---|---|---|
| 1.01–1.39 | 334, ROI 3.17% | 215, ROI -0.97% | **+4.14 pp** | 4.48 pp | 0.92 |
| 1.40–1.99 | 877, ROI -5.71% | 1006, ROI -0.40% | **−5.31 pp** | 3.85 pp | -1.38 |
| 2.00–2.99 | 1024, ROI -7.65% | 1527, ROI -1.53% | **−6.12 pp** | 4.78 pp | -1.28 |
| 3.00–4.99 | 1639, ROI -7.87% | 4083, ROI -6.66% | **−1.21 pp** | 4.64 pp | -0.26 |
| 5.00–9.99 | 371, ROI -22.10% | 1457, ROI -22.07% | **−0.04 pp** | 11.79 pp | -0.00 |
| 10.00+ | 34, ROI -35.29% | 270, ROI -45.56% | **+10.26 pp** | 47.95 pp | 0.21 |

### 3.1 — Per classe di ampiezza, e solo dove il sito potrebbe arrivare

| Segmento | n | Frequent. reale | Attesa fair chiusura | Residuo (pp) | ROI | IC 95% del ROI | t | Verdetto |
|---|---|---|---|---|---|---|---|---|
| tutte le stagioni · `moderate` (1432 fuori campione) | 4169 | 41.6% | 42.3% | −0.7 | -7.87% | ±1.96 pp | -4.01 | sotto zero |
| tutte le stagioni · `high` (252 fuori campione) | 823 | 50.8% | 50.9% | −0.1 | -5.20% | ±3.64 pp | -1.43 | non distinguibile da zero |
| tutte le stagioni · `very_high` (10 fuori campione) | 41 | 65.9% | 56.0% | +9.8 | 16.17% | ±15.00 pp | 1.08 | non distinguibile da zero |
| fuori campione · `moderate` | 1432 | 40.9% | 43.0% | −2.1 | -12.20% | ±3.15 pp | -3.88 | sotto zero |
| fuori campione · `high` | 252 | 54.8% | 51.1% | +3.7 | 1.40% | ±6.52 pp | 0.22 | non distinguibile da zero |

### 3.2 — Con il prezzo migliore disponibile invece di Bet365

| Segmento | n | Frequent. reale | Attesa fair chiusura | Residuo (pp) | ROI | IC 95% del ROI | t | Verdetto |
|---|---|---|---|---|---|---|---|---|
| `moderate` al prezzo migliore | 4169 | 41.6% | 42.3% | −0.7 | -0.78% | ±2.16 pp | -0.36 | non distinguibile da zero |
| `high` al prezzo migliore | 824 | 50.7% | 50.9% | −0.1 | 2.95% | ±4.03 pp | 0.73 | non distinguibile da zero |
| `very_high` al prezzo migliore | 41 | 65.9% | 56.0% | +9.8 | 27.17% | ±17.15 pp | 1.58 | non distinguibile da zero |

Il confronto 3.1 / 3.2 è il vero «dove si può fare profit» su questa idea: stesso segnale, prezzo diverso. Se il ROI gira solo comprando meglio, la strategia non è il segnale.

## S4 — Esecuibile: valore contro il fair sharp allo stesso istante, per decili

Regola del test: tutto ciò che serve per decidere deve essere nell'istante della scelta. Confronto fra l'implicita pagata (Bet365) e la fair no-vig Pinnacle **nello stesso istante**; poi ROI realizzato sui gol. Nessun uso della chiusura per scegliere: questi numeri sono eseguibili, non retrospettivi.


### 4.1 — istante pre-movimento (venerdì) — 34800 puntate

| Decile di edge vs fair sharp | edge medio (pp) | n | Frequent. reale | Attesa fair | Residuo (pp) | ROI | IC 95% del ROI | t |
|---|---|---|---|---|---|---|---|---|
| D1 | −4.00 | 3480 | 57.0% | 56.7% | +0.3 | -7.27% | ±1.52 pp | -4.79 |
| D2 | −3.00 | 3480 | 47.6% | 45.7% | +1.9 | -3.60% | ±1.92 pp | -1.88 |
| D3 | −2.53 | 3480 | 39.9% | 39.8% | +0.2 | -6.78% | ±2.18 pp | -3.10 |
| D4 | −2.18 | 3480 | 34.0% | 34.7% | −0.7 | -11.75% | ±2.31 pp | -5.09 |
| D5 | −1.88 | 3480 | 31.1% | 31.4% | −0.3 | -7.88% | ±2.57 pp | -3.07 |
| D6 | −1.61 | 3480 | 27.7% | 28.4% | −0.8 | -9.98% | ±2.73 pp | -3.66 |
| D7 | −1.33 | 3480 | 27.0% | 26.9% | +0.1 | -7.30% | ±2.77 pp | -2.63 |
| D8 | −1.03 | 3480 | 25.5% | 25.0% | +0.6 | -2.49% | ±3.13 pp | -0.80 |
| D9 | −0.68 | 3480 | 22.0% | 23.5% | −1.4 | -7.87% | ±3.35 pp | -2.35 |
| D10 | +0.01 | 3480 | 21.5% | 21.3% | +0.2 | 1.06% | ±3.82 pp | 0.28 |

Decile migliore (3480 puntate, ROI 1.06%) — solo out-of-sample: n 1180, ROI -12.84%, IC ±6.09 pp.

### 4.2 — istante chiusura — 34812 puntate

| Decile di edge vs fair sharp | edge medio (pp) | n | Frequent. reale | Attesa fair | Residuo (pp) | ROI | IC 95% del ROI | t |
|---|---|---|---|---|---|---|---|---|
| D1 | −4.20 | 3481 | 56.0% | 54.7% | +1.3 | -6.34% | ±1.55 pp | -4.08 |
| D2 | −3.10 | 3481 | 46.2% | 45.6% | +0.6 | -7.19% | ±1.93 pp | -3.72 |
| D3 | −2.62 | 3481 | 39.6% | 39.6% | −0.1 | -9.27% | ±2.19 pp | -4.23 |
| D4 | −2.24 | 3481 | 35.2% | 35.4% | −0.3 | -7.51% | ±2.42 pp | -3.11 |
| D5 | −1.91 | 3482 | 30.9% | 30.7% | +0.2 | -8.95% | ±2.59 pp | -3.45 |
| D6 | −1.61 | 3481 | 28.6% | 28.1% | +0.5 | -3.40% | ±2.92 pp | -1.17 |
| D7 | −1.32 | 3481 | 25.5% | 26.2% | −0.7 | -8.98% | ±2.92 pp | -3.08 |
| D8 | −1.01 | 3481 | 24.3% | 25.2% | −0.9 | -9.81% | ±2.97 pp | -3.30 |
| D9 | −0.65 | 3481 | 23.4% | 24.2% | −0.9 | -4.45% | ±3.39 pp | -1.31 |
| D10 | +0.05 | 3482 | 23.8% | 23.6% | +0.1 | -0.86% | ±3.48 pp | -0.25 |

Decile migliore (3482 puntate, ROI -0.86%) — solo out-of-sample: n 1017, ROI -9.40%, IC ±5.47 pp.

*Alla chiusura il confronto è fra due prezzi quasi simultanei: è il test più pulito ma anche il più costoso da eseguire (limiti, conti, velocità).*

### 4.3 — Stessa regola sugli altri due mercati (istante di chiusura)

- **Over/Under 2.5** (23064 puntate): decile di edge più alto → ROI -2.21% (n 2307, t -0.91); decile più basso → ROI -4.75%. Ampiezza della scala: +2.53 pp di ROI.
- **Handicap asiatico** (23208 puntate): decile di edge più alto → ROI -12.20% (n 2321, t -6.43); decile più basso → ROI -13.24%. Ampiezza della scala: +1.03 pp di ROI.

## S5 — Il CLV predice i soldi? Tabella di break-even

È la tabella che decide se il CLV — l'unica misura di validità del sito — misura denaro o solo igiene statistica. Scelta senza lookahead: si paga il prezzo Bet365 del pre-movimento; il «CLV contro la fair di chiusura» è quanto la fair Pinnacle alla chiusura stava sopra l'implicita pagata.

| Bucket di CLV (pp) | n | ROI atteso dal CLV | ROI realizzato | Differenza | IC 95% del ROI | t | ROI realizzato, solo out-of-sample |
|---|---|---|---|---|---|---|---|
| sotto −4.0 | 6042 | -14.56% | -14.16% | +0.41 pp | ±1.50 pp | -9.45 | -10.90% |
| −4.0 … −2.0 | 8637 | -10.10% | -12.40% | −2.30 pp | ±1.59 pp | -7.81 | -12.10% |
| −2.0 … −1.0 | 6621 | -6.09% | -5.56% | +0.53 pp | ±2.07 pp | -2.69 | -5.98% |
| −1.0 … 0.0 | 5988 | -2.27% | -3.55% | −1.28 pp | ±2.26 pp | -1.57 | -10.12% |
| 0.0 … +0.5 | 2177 | 1.01% | 1.56% | +0.55 pp | ±3.98 pp | 0.39 | -6.72% |
| +0.5 … +1.0 | 1619 | 3.10% | 2.22% | −0.88 pp | ±4.45 pp | 0.50 | -5.30% |
| +1.0 … +1.5 | 1139 | 5.09% | 5.19% | +0.09 pp | ±5.69 pp | 0.91 | 7.09% |
| +1.5 … +2.0 | 793 | 6.75% | -0.66% | −7.41 pp | ±6.13 pp | -0.11 | -11.72% |
| +2.0 … +3.0 | 928 | 8.94% | -3.50% | −12.44 pp | ±5.32 pp | -0.66 | -2.04% |
| +3.0 … +4.0 | 409 | 12.19% | 18.74% | +6.55 pp | ±10.05 pp | 1.86 | -5.21% |
| +4.0 … +6.0 | 323 | 15.49% | 20.03% | +4.54 pp | ±9.38 pp | 2.14 | 23.97% |
| sopra +6.0 | 124 | 23.13% | 38.21% | +15.08 pp | ±13.82 pp | 2.76 | 52.28% |

Punto di pareggio stimato: **+0.0 pp di CLV** contro la fair di chiusura: sotto quella riga il margine mangia tutto, sopra il vantaggio esiste sulla carta.

Tradotto per il sito: il CLV medio dell'archivio è −3,77 pp su 238 osservazioni. Se la scala qui sopra tiene, il problema non è «poco margine»: è che il prezzo rilevato oggi sta sotto la chiusura fair di un importo che nessuna gestione del bankroll può recuperare.

## S6 — Quanto vale il prezzo, prima ancora del segnale

- Prezzo migliore rispetto a Bet365 sulla stessa selezione a chiusura: presente nel 96.6% delle selezioni (36098 su 37374); quando c'è vale in media 7.55% di quota in più.
- ROI delle stesse identiche puntate (tutte le selezioni 1X2 a chiusura, 37374 casi): Bet365 -6.60%, prezzo migliore -0.07% → **+6.53 pp di ROI** solo per aver comprato altrove, senza sapere nulla della partita.
- Arbitraggio fra bookmaker veri (8 libri individuali del CSV, miglior prezzo per selezione; somma delle implicite sotto 1): **200 su 12459 partite a chiusura** (1.605%), profitto medio 1.13% quando esiste. Al pre-movimento: 22 su 12457 (0.177%), profitto medio 1.46%.
- Nota sul prezzo "Max" del CSV: è il migliore fra la lista completa del provider, exchange compreso, quindi la sua somma di implicite scende sotto 1 nel 59.9% delle partite: è l'artefatto che una calcolatrice di sicurezze, se non dichiara la fonte del prezzo, trasforma in "occasioni" inesistenti.

Questo è l'unico risultato dello studio che non dipende da un modello e non usa la chiusura per scegliere: è margine strutturale, piccolo, reale, e non finisce mai in una card di pronostici. Se il progetto vuole parlare di denaro, la riga da costruire prima di ogni altra è «quanto stai regalando comprando dal solito book».

## S7 — La tassa di base: ROI per fascia di quota senza nessun segnale

Si punta su **tutte** le selezioni 1X2 di tutte le partite, allo stesso prezzo, e si guarda il ROI per fascia di quota. È l'imposta che ogni strategia deve pagare: se una fascia sta sopra lo zero senza nessun segnale, lì il profitto ha una casa; se nessuna ci sta, il sito non ha niente da promettere a nessuno.


Alla chiusura (Bet365):
| Segmento | n | Frequent. reale | Attesa fair chiusura | Residuo (pp) | ROI | IC 95% del ROI | t | Verdetto |
|---|---|---|---|---|---|---|---|---|
| quota 1.01–1.39 | 1700 | 77.4% | 76.3% | +1.1 | -2.76% | ±1.29 pp | -2.14 | sotto zero |
| quota 1.40–1.99 | 5365 | 58.2% | 57.1% | +1.2 | -3.17% | ±1.13 pp | -2.80 | sotto zero |
| quota 2.00–2.99 | 7370 | 39.3% | 39.2% | +0.1 | -5.71% | ±1.38 pp | -4.13 | sotto zero |
| quota 3.00–4.99 | 16603 | 26.0% | 26.2% | −0.2 | -5.77% | ±1.25 pp | -4.62 | sotto zero |
| quota 5.00–9.99 | 5339 | 13.8% | 14.9% | −1.1 | -14.88% | ±2.96 pp | -5.02 | sotto zero |
| quota 10.00+ | 997 | 7.0% | 7.0% | +0.0 | -7.72% | ±11.10 pp | -0.70 | non distinguibile da zero |
| **tutte le quote** | 37374 | 33.3% | 33.3% | +0.0 | -6.60% | ±0.82 pp | -8.01 | sotto zero |

Al pre-movimento / venerdì (Bet365):
| Segmento | n | Frequent. reale | Attesa fair chiusura | Residuo (pp) | ROI | IC 95% del ROI | t | Verdetto |
|---|---|---|---|---|---|---|---|---|
| quota 1.01–1.39 | 1654 | 76.7% | 76.0% | +0.7 | -3.49% | ±1.32 pp | -2.64 | sotto zero |
| quota 1.40–1.99 | 5295 | 58.5% | 57.2% | +1.3 | -3.01% | ±1.14 pp | -2.65 | sotto zero |
| quota 2.00–2.99 | 7442 | 39.5% | 39.3% | +0.1 | -5.57% | ±1.37 pp | -4.06 | sotto zero |
| quota 3.00–4.99 | 16725 | 25.9% | 26.2% | −0.3 | -6.27% | ±1.24 pp | -5.06 | sotto zero |
| quota 5.00–9.99 | 5264 | 14.1% | 15.0% | −0.9 | -13.58% | ±3.00 pp | -4.53 | sotto zero |
| quota 10.00+ | 982 | 8.0% | 7.2% | +0.8 | 3.77% | ±11.58 pp | 0.33 | non distinguibile da zero |
| **tutte le quote** | 37362 | 33.3% | 33.3% | +0.0 | -6.31% | ±0.83 pp | -7.64 | sotto zero |

## S8 — Quante partite servono, prima di ogni verdetto

Deviazione standard del profitto per puntata, misurata su questi dati: **1.59 per unità puntata** (è la ragione per cui le percentuali di vincita dicono poco e gli scarti dicono tutto).

| ROI per puntata da dimostrare | puntate necessarie (potenza 80%, α 5%) | partite 1X2 equivalenti |
|---|---|---|
| 0.5% | 796.132 | 265.378 |
| 1.0% | 199.033 | 66.345 |
| 2.0% | 49.759 | 16.587 |
| 5.0% | 7962 | 2654 |

Confronto con l'archivio del monitor: 238 osservazioni di CLV. Per un effetto da 2 pp di ROI le puntate necessarie sono nell'ordine delle decine di migliaia: nessuna verifica «scheda per scheda» cambia questo ordine di grandezza, lo aumenta. Due conseguenze operative: (1) gli esiti delle partite finite servono a validare il percorso, non a pubblicare un rendimento; (2) il CLV resta l'unica metrica che cresce di un'unità per segnale, e va protetto da ogni contaminazione (base grezza, margini, partite fantasma).

Numero di segnali con drop ≥ 2 pp nell'archivio congelato: 11407. È la scala con cui si può discutere di pattern; i 238 del sito sono 2.1% di quel campione.
