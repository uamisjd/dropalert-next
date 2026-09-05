# Decisioni aperte (in parole semplici)

> Perché questo file: le righe «non ho toccato X, serve una tua decisione» dette in mezzo
> a un report tecnico non sono una spiegazione. Qui ogni punto ha la stessa struttura —
> **cos'è**, **perché non l'ho sistemato io**, **cosa cambierebbe**, **che cosa devi
> scrivere tu (o me)**. Niente qui dentro è urgente: sono scelte, non guasti.
> Data: 05/09/2026, branch `arena/01a06ea0-dropalert-next` (PR #7).

---

## 1. Il CLV è misurato su due scale diverse («basi miste»)

**Cos'è.** Il CLV è la differenza fra la quota che avevamo sotto occhio e la *linea di
chiusura*: è l'unico numero del sito che può dire se il metodo funziona. Ma oggi le due
metà del numero non sono dello stesso tipo. Lo provano due casi letti su dati reali:

| caso | quota del segnale | chiusura | CLV dichiarato |
| --- | --- | --- | --- |
| Oriental – Racing Montevideo | 1,54 (prezzo **grezzo** di un solo bookmaker) | 1,69 (linea **di consenso**, quindi senza vigore) | −5,76 pp |
| media ultima settimana | idem | idem | **−3,77 pp**, 8% sopra la chiusura |

Confrontare un prezzo con vigore con una linea senza vigore è come pesare la spesa con la
busta: il «vantaggio» parte da −5/−10 pp e non c'entra nulla con la bravura. È per questo
che lo studio sulle partite finite ha proposto la *patch A*: allineare le due metà
(de-vigare il prezzo del segnale, o usare per entrambi la stessa linea).

**Perché non l'ho fatta.** Tocca `src/lib/pipeline/closing.ts:477-480`, cioè il calcolo
che scrive in tabella: i valori già pubblicati in `/performance` e `/api/health`
cambierebbero tutti, e nessuno dei due numeri è «quello giusto» finché non lo scegli tu.
Una migrazione che riscrive il passato non si fa di straforo in una PR di correzioni.

**Cosa cambierebbe.** Il CLV medio diventerebbe confrontabile (attesa: meno negativo, e
soprattutto *paragonabile fra leghe*). I grafici storici si sposterebbero.

**Che fare, in ordine.**
1. decidere la convenzione: `devig del segnale` contro `chiusura no-vig` (coerente) oppure
   `grezzo` contro `grezzo` (serve però la chiusura grezza, che oggi non è conservata);
2. `git checkout -b clv-same-base`, modifica, script di ricalcolo sulle righe esistenti;
3. se voglio farlo io: dimmi quale delle due convenzioni e preparo branch + script, **ma
   il ricalcolo va lanciato con il tuo `DATABASE_URL`** (vedi §4).

---

## 2. Serve una seconda fonte (R2-R3 del backlog) — non è un fix, è un prodotto nuovo

**Cos'è.** Il divario «+EV» ha bisogno di due numeri: la tua quota e una **linea
indipendente** (quasi sempre quella di un bookmaker sharp, Pinnacle in testa). Il sito oggi
legge **una sola linea di consenso**: `booksTotal: 1`, `sharpAvailable: false` in ogni
segnale, e `/api/health` che dichiara `perBookmakerOdds = false`.

**Perché non l'ho fatta.** Senza una seconda linea di prezzi il confronto non esiste: il
nuovo scanner, correttamente, dice «la tua quota contro la stessa linea che ho letto».
Risultato: la lista è corta e i numeri sono intorno a **−margine** (−8,66% … −11,58%,
misurato). Questo è il comportamento *giusto* di uno strumento onesto, non un bug — e io
non posso inventarmi la seconda fonte.

**Cosa cambierebbe.** È l'unica cosa che rende `/value-bets` potenzialmente utile invece
che solo corretta: R2 = quota per singolo bookmaker, R3 = linea sharp vera.

**Che fare.** Scegliere la fonte (OddsAPI ha un piano gratuito con copertura per-bookmaker;
il budget attuale è **3 crediti su 49 al mese**, quindi lo spazio c'è) e scrivere la
mappatura `bookmaker → id fonte`. Se vuoi, preparo il `docs/RESEARCH-BACKLOG.md` con i
passi e la stima di crediti, senza toccare il codice.

---

## 3. Le finestre: `RESULT_LOOKBACK_DAYS = 30` e 12 ore per le linee

**Cosa sono.** Due parametri di raccolta, non di logica:
- gli esiti delle partite vengono cercati **solo nei 30 giorni** indietro;
- la «linea» usata dal divario guarda **le ultime 12 ore** di rilevazioni.

**Perché non li ho toccati.** Non sono sbagliati: sono una scelta fra «vedi poco ma
fresco» e «vedi tutto, ma con molti buchi». Alzare la finestra delle linee a 24-48 ore
aumenterebbe il numero di partite con terna completa (più righe in lista), ma ogni riga
userebbe una linea **più vecchia** — e una linea vecchia di 30 ore non è una linea di
chiusura: sarebbe baratto tra quantità e verità. Stesso ragionamento per il backfill:
allargarlo recupera verdetti, ma su leghe periferiche il 30° giorno è già fuori dalla
copertura della fonte.

**Cosa cambierebbe.** Volumi, non verità: più righe con `lineAgeMinutes` alto (il campo
esiste e la pagina lo mostra), oppure meno partite con esito noto.

**Che fare.** Nessuna azione adesso. Se dopo il merge la lista è **vuota su tutte le
giornate**, allora il collo di bottiglia è la finestra e si valuta 24 ore insieme
all'indicatore di anzianità. Fino a quel momento è una modifica senza evidenza.

---

## 4. I due comandi che solo tu puoi lanciare (e cosa rispondere)

Nessun DB in questo ambiente: `npx` qui non vede Postgres. I due comandi sotto girano sul
tuo PC o su Actions.

```bash
# 1) lo sguardo sui dati veri: 7 controlli, tutti a OK = la pagina è coerente
DATABASE_URL="postgres://…" npm run audit:value-bets
```

La stringa è la stessa di Vercel → *Settings → Environment Variables → `DATABASE_URL`*
(dal tuo account, non da me: non deve passare dalla chat).

Cosa aspettarsi, in concreto:

| riga dello sguardo | OK significa | ATTENZIONE significa |
| --- | --- | --- |
| «kickoff futuro» | nessuna partita giocata in lista | c'è una riga con kickoff passato → ritorno del difetto storico |
| «edge sotto il margine» | i numeri sono coerenti col no-vig | qualche riga con +5% veri: da leggere una per una |
| «nessun euro in output» | nessuno stake consigliato dalla pagina | qualche componente che lo rimette |
| «la terna simultanea esiste nei dati» | il divario è calcolabile | gli istanti sono molti ma nessuno completo: è il collettore |

```bash
# 2) la pagina con i fix, renderizzata
```

La preview della PR è dietro l'accesso Vercel: **apri l'anteprima dal tuo account
Vercel** (deployment `dropalert-next-git-arena-…`) e dimmi se qualche numero non torna.
Io la pagina resa non l'ho mai vista — l'ho verificata sui dati (fixture) e sul codice,
non sul browser.

**Del resto — il merge — posso farlo io in un comando** (`gh pr merge 7 --squash`).
Lo faccio su tua parola, perché pubblica su `main` e quindi in produzione.

---

## 5. Che cosa ho misurato io, stanotte, sui dati di produzione

Per il punto 3 dell'audit dello scanner («e se la regola della terna completa azzerasse
tutto per un motivo tecnico?») non serviva il DB: bastava una pagina pubblica.

- **A. Klagenfurt – SK Rapid** (partita non giocata): tre serie da **29 rilevazioni
  ciascuno**, stessa apertura (22:15) e stessa ultima lettura (02:30).
- **UNAM Pumas W – Club América W** (partita non giocata): tre serie da **26
  rilevazioni ciascuno**, 07:15 → 18:31, finestra identica (11 h 16 min).

Selezioni diverse, stesso numero di punti, stessi estremi: le terne arrivano **complete e
nello stesso istante** anche nei dati reali. La regola non è il problema — e il test
`npm run test:line-shape` (40 asserzioni) resta lì a bloccare un cambiamento di forma
della fonte.

Un numero che ho letto sulle stesse pagine, per capire il prima/dopo: su UNAM – América
la versione in produzione calcola «Fair no-vig @7,45» da una quota di 7,13 (**7,13 ×
1,045 = 7,45**, l'assunzione del vecchio codice) e da lì «+15,7% di edge», «¼ Kelly:
€ 5,15». Con la PR #7 lo stesso segnale non produce né fair fittizia né euro.
