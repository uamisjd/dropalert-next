# Strumenti di calcolo sul lato betting — decisioni e confini

Data: 04/09/2026 · Stato: in produzione su `/strumenti`

Questo documento spiega **perché** il sito ha aggiunto una sezione che tocca il
betting dopo aver dichiarato per mesi di non volerlo fare, **che cosa** contiene
e **dove si ferma**. Serve a chi ci lavorerà dopo: i confini scritti qui sono
stati scelti uno per uno, e spostarne uno va fatto consapevolmente.

---

## 1. Perché sì, adesso

Il sito è nato come osservatorio: registra i movimenti di quota, ne misura la
solidità e ne verifica la qualità con il CLV. Per leggere il CLV serve però
sapere due cose che l'osservatorio dava per implicithe:

1. **ogni quota contiene un margine**, e la quota di chiusura con cui il CLV si
   confronta ne contiene uno a sua volta — il progetto lo sa già, tanto che
   calcola una chiusura fair no-vig;
2. **un rendimento atteso da solo non descrive niente**, perché su poche decine
   di osservazioni domina la varianza — ed è la stessa ragione per cui il sito
   non pubblica intervalli di confidenza sotto le dieci osservazioni.

Mancavano gli strumenti per rendere queste due cose visibili a chi legge. Non
sono pronostici: sono aritmetica. Aggiungerli rende il sito più coerente con sé
stesso, non meno.

---

## 2. Che cosa contiene

### Margine e quota fair

Preso un mercato completo (tutti gli esiti, quote decimali):

```
probabilità implicita_i = 1 / quota_i
overround               = Σ probabilità implicite        (es. 103,97%)
margine                 = overround − 100%               (es. 3,97 pp)
trattenuta              = margine / overround            (es. 3,82%)
```

La **trattenuta** non è il margine: è quanto il banco trattiene in media per ogni
euro giocato su quel mercato. Coprire tutti gli esiti alle quote pubblicate
restituisce esattamente `1 − 1/overround` di quanto giocato. Il calcolatore
mostra entrambi i numeri e dice quale è quale, perché confonderli è l'errore più
comune.

Tre metodi di rimozione del margine, tutti dichiarati a schermo:

| Metodo | Come ripartisce il margine | Comportamento |
|---|---|---|
| proporzionale | in proporzione alla probabilità implicita | è lo stesso usato dalla chiusura fair no-vig del progetto |
| additivo | in parti uguali in valore assoluto | pesa proporzionalmente di più sulle quote alte; su mercati molto sbilanciati può dare probabilità non positive |
| power | cerca l'esponente `k` con `Σ p_i^k = 1` | risolto per bisezione, 200 iterazioni, tolleranza 1e-12 |

Accanto ai risultati compare lo **scostamento massimo fra i metodi**: non esiste
un metodo giusto, sono tre ipotesi diverse, e chi legge ha diritto di vedere
quanto il numero dipende da quella scelta.

### Peso della varianza

Pareggio (`1/quota`), rendimento atteso (`p·quota − 1`), frazione di Kelly
(`(p·b − q)/b`, con `b = quota − 1`) e una simulazione di `trials` sequenze da
`bets` giocate.

La simulazione è **deterministica**: generatore mulberry32 con seme dichiarato
in interfaccia. A parità di seme il risultato è identico, quindi è riproducibile
da chiunque e i test non sono fluttuanti. Vengono mostrati mediana, 5° e 95°
percentile del capitale finale, quota di sequenze in perdita, quota di sequenze
rovinate e mediana del calo massimo dal picco.

La soglia di rovina è una **convenzione dichiarata** (20% del capitale iniziale),
non una legge: sta scritta in pagina insieme al risultato.

---

## 3. Dove si ferma — e perché

### Nessuna selezione indicata

Nessuno dei due strumenti riceve in input una partita, un mercato o una
squadra. I numeri li inserisce chi legge. Non esiste un percorso di codice che
possa produrre qualcosa di simile a «gioca questo».

### Nessun operatore

Niente link a concessionari, niente bonus, niente confronti fra bookmaker, niente
nomi di operatori usati come richiamo. Il sito cita le fonti dei dati
(BetExplorer) perché sono provenienze, non destinazioni: la differenza è che
nessun link porta a giocare.

Riferimento normativo: l'art. 9 del d.l. 87/2018 («Decreto Dignità», convertito
in l. 96/2018) vieta qualsiasi forma di pubblicità, **anche indiretta**, dei
giochi con vincita in denaro, su ogni mezzo compresi i canali digitali. Le linee
guida AGCOM del 18/04/2019 escludono dal divieto i servizi informativi e di
comparazione «purché effettuati nel rispetto dei principi di continenza, non
ingannevolezza e trasparenza» e con «assenza di enfasi promozionale». Questa
pagina sta dentro quel perimetro per costruzione: non compara offerte e non
promuove nulla. La sanzione per violazione è il 20% del valore della pubblicità
e comunque non meno di 50.000 euro per violazione.

### Nessuna previsione spacciata per verità

La quota fair è una convenzione di calcolo sui numeri inseriti, non una stima
della realtà. Il testo in pagina lo dice, e lo ripete in coda a ogni strumento.

### Un metodo non applicabile lo dichiara

Il metodo additivo, su un mercato molto sbilanciato, può portare una selezione a
probabilità non positiva. **Non viene forzato a zero**: una probabilità nulla
sarebbe un'affermazione sul mondo («impossibile»), non un arrotondamento. La
riga del metodo mostra il motivo e le altre due restano disponibili. Stessa
regola del resto del progetto: un buco si dichiara, non si riempie.

### Avvisi fissi

`+18`, «il gioco può causare dipendenza» e il Numero Verde nazionale
**800 558 822** sono nel footer persistente di ogni pagina, quindi anche qui. La
pagina ripete il limite in testa («che cosa questa pagina non fa») e in coda a
ogni strumento.

---

## 4. Che cosa NON è stato fatto, deliberatamente

| Scartato | Motivo |
|---|---|
| Rilevatore di «value bet» sul monitor | Sarebbe un consiglio di giocata travestito da misura: prende i segnali e dice dove sta il vantaggio. È esattamente ciò che il sito dichiara di non essere. |
| Comparatore di quote fra operatori | Diventa pubblicità indiretta nel momento in cui orienta verso un concessionario, e apre la strada a link di affiliazione. |
| Affiliazioni, bonus, codici promo | Incompatibili con l'art. 9 e con l'identità del progetto. |
| Kelly come dimensione di puntata consigliata | La frazione è mostrata come **tetto teorico** con l'avviso che dipende da una probabilità che nessuno conosce: sovrastimarla accelera la perdita, non la crescita. |
| Storico giocate / bankroll tracker dell'utente | Introduce un profilo di gioco persistente. Se un giorno si farà, va fatto con consenso esplicito, export e cancellazione, non in un localStorage. |

---

## 5. Verifica

| Comando | Che cosa copre |
|---|---|
| `npm run test:tools` | 91 test sulla matematica: identità margine/trattenuta, somma a 100 dei tre metodi, direzione dello spostamento fra metodi, rifiuto degli input invalidi, determinismo della simulazione |
| `npm run test:client` | 9 test in un DOM reale (jsdom + React 19) sul cablaggio: i campi arrivano alle funzioni, i numeri arrivano a schermo, un input assurdo produce l'avviso invece di un risultato, i disclaimer restano fissi |

Due identità che i test bloccano, perché sono il contenuto della pagina:

- `trattenuta = 1 − 100/overround`;
- giocare alla quota pubblicata con la probabilità **fair** costa esattamente la
  trattenuta (con la probabilità implicita della stessa quota il rendimento è
  zero per definizione, e non è un vantaggio).

---

## 6. Se si vuole estendere

Cose compatibili con i confini qui sopra:

- **margine osservato sul monitor**: la fonte pubblica una sola linea di
  consenso, quindi un mercato a tre esiti c'è ma per un solo book sintetico. Si
  può mostrare la trattenuta di quella linea nel tempo, come serie — è misura,
  non confronto fra operatori.
- **costo del margine sul CLV**: quantificare quanto del CLV misurato è
  movimento e quanto è margine, usando la scomposizione già a registro.
- **calibro dell'indice**: confrontare l'indice normalizzato con la frequenza
  osservata, dichiarando il campione. È la domanda a cui il CLV risponde già in
  parte, e va fatta con le stesse soglie di numerosità.

Cose che invece spostano il confine e vanno decise esplicitamente, non aggiunte
di passaggio: qualsiasi output che nomini una selezione come preferibile,
qualsiasi link verso un operatore, qualsiasi incentivo.
