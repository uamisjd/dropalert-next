# Backlog di ricerca — programma dichiarato

Ultimo aggiornamento: 20/08/2026, a valle del backtest R1.

Questo file è il programma di ricerca del progetto, in ordine di esecuzione.
Ogni voce dichiara **stato** e **prerequisito**: una voce senza prerequisito
soddisfatto non si inizia, e non si scambia l'ordine per comodità. Le regole
qui dentro sono vincolanti per chi lavora al progetto, compreso chi ci
lavora di fretta.

---

## 1. R1.5 — pattern storici segmentati

**Stato:** eseguito il 20/08/2026 · **Prerequisito:** dati R1 congelati (`data/football-data/`) — soddisfatto.

Test dei pattern del drop su segmenti (fascia di quota, lega, casa/trasferta,
soglia) con regola metodologica bloccata: ipotesi formulate e stimate su
2019/20–2022/23, validate out-of-sample su 2023/24–2025/26. Ciò che non
regge out-of-sample si scarta e si dichiara scartato. Report:
`docs/BACKTEST-R1.5.md`.

## 2. Shape features — feature di forma per segnale

**Stato:** eseguito il 21/08/2026 · **Prerequisito:** nessuno — soddisfatto.

Struttura dichiarata in `src/lib/shape/features.ts`, salvata in
`drop_signals.shape` (jsonb, migrazione 0005), backfill idempotente con
`npm run job:shape` (manuale: non sta nel cron, per scelta). Il punteggio
di fiducia NON la usa: è dato per R2/R3.

Per ogni segnale in archivio salvare in campi riusabili le feature di forma
del movimento: istante di inizio, durata, rimbalzi (numero e ampiezza),
tenuta. Costo piccolo, nessuna scelta di modellazione: sono letture, non
giudizi. Indispensabile per R2 e per ogni futura versione dell'indice:
senza forma, un drop è solo un numero.

## 3. R2 — validazione live

**Stato:** bloccato da prerequisito · **Prerequisito:** `/ieri` con **30+ partite con esito** registrato E storico di CLV maturato.

Solo quando la pagina /ieri avrà almeno trenta partite con esito e lo
storico sarà sufficiente, si validano dal vivo i pattern confermati in R1.5.
Nessuna scorciatoia: la validazione live misura ciò che il monitor rileva
con i suoi 45 minuti di cadenza, non ciò che il backtest misura con due
letture a partita.

## 4. R3 — algoritmo v2 ricampionato

**Stato:** bloccato da prerequisito · **Prerequisito:** verdetti di R1.5 (questo sprint) + R2 completata.

Ricampionare il punteggio di fiducia sui verdetti: i pesi delle componenti
si ricalibrano su ciò che i dati hanno confermato, non su ciò che era
ragionevole al primo sprint. Se R1.5 e R2 smentiscono una componente, la
componente si toglie — non si ripesa.

## 5. Sharp mirato (The Odds API o equivalente)

**Stato:** aperto con regole di budget bloccate · **Prerequisito:** nessuno tecnico; partire solo con le regole qui sotto accettate.

Una fonte per singolo bookmaker renderebbe osservabili coordinazione e
conferma sharp (i 45 punti oggi non misurabili). Regole di budget mensile,
bloccate in questa voce:

- **Budget = free tier del provider**: 500 crediti/mese per The Odds API, o
  il valore realmente dichiarato dal provider al momento della partenza.
  Il contatore vive nel database, si azzera il giorno 1 del mese.
- **Si chiama SOLO una partita già segnata** con indice di fiducia ≥ 45,
  **una chiamata per partita**, al momento del rilevamento. Mai ricerche
  per partita non segnata, mai chiamate di verifica.
- **A ogni ciclo si legge il saldo**: sotto il 10% del budget → **pausa
  fino al giorno 1**, dichiarata nel pannello: «check sharp in pausa,
  riprende il giorno 1 — saldo X/Y».
- **La pausa intacca solo la riga sharp** del pannello: `sharpConfirms`
  torna a «non osservabile», che è già dichiarato esattamente così. Mai il
  core del monitor, mai la serie N/10, mai il CLV.

## 6. Coerenza multi-mercato (1X2 + GG + OU)

**Stato:** bloccato da prerequisito · **Prerequisito:** la fonte della voce 5 attiva e stabile.

Un movimento su 1X2 è più credibile se coerenza con Over/Under ed entrambe
segnano. Richiede una fonte che pubblichi mercati multipli per la stessa
partita: si valuta come estensione dell'adapter della voce 5, non come
fonte ulteriore.

## 7. Modello gol (Elo/Poisson) vs mercato

**Stato:** aperto con vincolo · **Prerequisito:** backtest out-of-sample obbligatorio PRIMA di qualsiasi integrazione.

Un modello di gol confrontato con le probabilità del mercato può esporre
disallineamenti. Vincolo bloccato: nessun output del modello entra nel
sito, nel punteggio o nel CLV finché il backtest out-of-sample non è
passato e dichiarato in un report. Un modello non validato che alimenta
l'interfaccia sarebbe la cosa più simile a un pronostico che questo
progetto possa fare — ed è fuori perimetro.

## 8. Mini-grafico del calo sulla card

**Stato:** aperto, sprint UI piccolo · **Prerequisito:** nessuno — i dati esistono già.

Le card dei segnali mostrano numeri, non forma. Un mini-grafico SVG inline
della serie di quota (senza librerie, dati già in `odds_snapshots`)
renderebbe visibile ciò che la voce 2 rende riutilizzabile. Piccolo per
scelta: nessun grafico interattivo, nessuna dipendenza nuova.

---

## Regola di priorità

Le voci 2 e 8 sono piccole e senza prerequisiti: si inseriscono fra gli
sprint di raccolta, non li sostituiscono. Le voci 3 e 4 hanno prerequisiti
di dati che solo il tempo produce: non si forzano. La voce 5 si può
partire quando si vuole, ma SOLO con le sue regole di budget.
