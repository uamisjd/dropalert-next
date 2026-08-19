# Sprint 6B — Strumentazione continua della copertura

**Chiuso il 18/08/2026, 23:32 (Europe/Rome).**

Obiettivo: smettere di misurare la copertura solo a mano, con uno script
lanciato da noi, e farla registrare **da ogni giro di raccolta**, dentro
`collector_runs.meta`. Da misura una tantum a serie storica.

---

## 1. Premessa non tecnica: un lavoro fuori perimetro

Parte di questo sprint è stata **ricostruzione**, non avanzamento.

I file dello Sprint 6A (`scan.ts`, i 44 test, la rotta API, la cartella
dei report) erano **spariti dal workspace**. Causa individuata con
certezza: l'ambiente **esclude dai salvataggi ogni cartella di nome
`coverage`**, nome riservato altrove ai report di copertura dei test.
Tutto ciò che stava in `src/lib/coverage/`, `src/app/api/coverage/` e
`docs/coverage/` è stato scartato al salvataggio. È sopravvissuto solo
`src/scripts/run-coverage.ts`, perché è un file, non una cartella.

Conseguenze, dichiarate:

- le funzioni di 6A sono state **riscritte da zero** e rimesse in
  `src/lib/cov/`; l'API è la stessa, il codice no;
- **i numeri della misura 2044Z di 6A non sono recuperabili come dato**:
  restano solo come testo in `docs/SPRINT-6A-REPORT.md`. Non sono stati
  reinseriti da nessuna parte come se fossero un dato vivo;
- l'indirizzo pubblico è cambiato di posto sul disco ma **non per chi lo
  usa**: la rotta vive in `src/app/api/cov/route.ts` e resta raggiungibile
  su `/api/coverage` grazie a una riscrittura in `next.config.ts`;
- **regola operativa permanente**: in questo progetto non si creano
  cartelle chiamate `coverage`. Si usa `cov`.

---

## 2. File modificati

| File | Stato | Contenuto |
|---|---|---|
| `src/lib/cov/scan.ts` | **ricreato** (~560 righe) | funzioni pure di misura, API 6A identica |
| `src/lib/cov/instrument.ts` | **nuovo** (504 righe) | costruzione del bilancio di un giro + lettura della serie |
| `src/lib/cov/__tests__/coverage.test.ts` | **ricreato e ampliato** | 76 casi (erano 44) |
| `src/lib/providers/exclusion-codes.ts` | **nuovo** | codici di esclusione, marcatura e rilettura |
| `src/lib/repo/coverage-history.ts` | **nuovo** | lettura sola della serie storica dai giri |
| `src/app/api/cov/route.ts` | **nuovo** | `GET /api/coverage` |
| `next.config.ts` | modificato | riscrittura `/api/coverage` → `/api/cov` |
| `src/lib/providers/types.ts` | modificato | `lastListing?()` facoltativo, `ProviderListing` |
| `src/lib/providers/betexplorer/index.ts` | modificato | memorizza l'elenco grezzo, marca le esclusioni |
| `src/lib/providers/betexplorer/collect.ts` | modificato | costruisce la copertura e la scrive nel giro |
| `src/scripts/run-coverage.ts` | modificato | import corretto, `--out` → `docs/cov` |
| `package.json` | modificato | percorso di `test:coverage` |

## 3. Funzioni create

**`exclusion-codes.ts`**
- `EXCLUSION_CODES` — `PAGE_UNREACHABLE`, `KICKOFF_MISSING`,
  `OUT_OF_WINDOW`, `UNREADABLE_ROW`, `RUN_CAP`.
- `taggedExclusion(ref, code, spiegazione)` — produce
  `<ref>: [<codice>] <spiegazione>`.
- `parseExclusion(msg)` — rilegge il messaggio. **Se il codice manca o non
  è riconosciuto restituisce `code: null`**: causa *non dichiarata*, mai
  una causa plausibile scelta da noi.

**`instrument.ts`**
- `buildRunCoverage(input)` → `RunCoverage`: il bilancio di un giro.
- `reasonForCode(code)` — traduce un codice in un motivo di esclusione;
  **codice assente → `altro`**.
- `emptyReasonCounts()`, `EXCLUSION_LABELS`, `EXCLUSION_REASONS`.
- `coverageOfRun(id, startedAt, status, meta)` → `CoveragePoint | null`.
- `coverageSeriesStats(points)` → medie, minimo, massimo, durata.
- `describeSeriesDepth(stats)` — frase che dichiara quanto è profonda la
  serie. `MIN_RUNS_FOR_TREND = 10`.

**`coverage-history.ts`**
- `getCoverageHistory(limit = 50)` — legge i giri del collector e separa
  i giri **non misurati** da quelli con copertura zero.

**`betexplorer/index.ts`**
- `lastListing()` — restituisce l'ultimo elenco grezzo già scaricato.
  **Nessuna richiesta di rete in più**: si riusa il corpo della risposta
  che il giro aveva comunque già preso.

## 4. API e tabelle

**API:** `GET /api/coverage` (`?limit=N`, default 50, massimo 200).
Sola lettura, **nessuna chiamata alla fonte**. Restituisce l'ultimo
bilancio, la serie storica, la legenda dei motivi, le note e il
disclaimer. In caso di guasto: `503` con `status: "DATI PARZIALI"`, mai
un numero inventato.

**Tabelle: nessuna migrazione.** `collector_runs.meta` è già `jsonb`; ora
contiene in più la chiave `coverage`, che vale `null` quando la fonte non
sa dire cosa ha visto. **Non misurato ≠ copertura zero**, e i due casi
restano distinti in tutta la catena.

## 5. Test

```
motore        53
viste         68
pipeline      40
provider      49
betexplorer   39
copertura     76   (erano 44)
────────────────
totale       325   falliti 0
```

I 32 casi nuovi coprono: codici di esclusione, `reasonForCode`, il
bilancio del giro, la quadratura `football = imported + lost`, la serie
storica e le sue soglie.

Un test ha fatto emergere un difetto vero: la quadratura contava come
"spiegate" solo due motivi su sei, così una riga esclusa **per un motivo
regolarmente dichiarato** veniva contata due volte, una come esclusione e
una come residuo inspiegato. Corretto: ora fa fede la presenza del
riferimento alla riga.

**Validazione:** `next typegen` ✓ · `tsc --noEmit` 0 errori ✓ ·
`npm run build` ✓ (8 rotte) · server avviato e interrogato ✓.

## 6. Misura reale — giro 114, 18/08/2026 23:30

| | |
|---|---|
| Righe in elenco | 24 |
| Di calcio | **11** |
| Lavorate | 11 |
| Importate | **11** |
| Perse | **0** |
| Copertura | **100%** |

Motivi: altri sport 13 · per-book non pubblicato 11 · dimostrative 0 ·
senza quote 0 · non raggiunte 0 · altro 0.

Competizioni: Japan Emperor's Cup 2/2 · Concacaf Central American Cup 2/2
· Slovakia Slovak Cup 2/2 · Bolivia Copa Paceña 1/1 · Brazil Copa Paulista
1/1 · Denmark A-Liga Women 1/1 · Saudi Professional League 1/1 · Sweden
Svenska Cupen 1/1.

**Come va letto questo 100%.** Non dice che il monitor è a posto. Dice che
in **quel** giro, su **11** righe, non se n'è persa nessuna. In 6A, su un
elenco diverso, se ne persero 2 su 9. Un giro pieno e un giro all'78% non
si contraddicono: sono due fotografie di un campione minuscolo. La serie
ha **1 punto su 10** necessari, ed è dichiarata **non concludente**.

Le 2 perdite `NOT_REACHED` di 6A **non sono state toccate**, come da
istruzione. Non si sono ripresentate in questo giro: se ricompariranno,
ora verranno registrate da sole, con il frammento grezzo allegato.

## 7. Come si legge un run

Un giro va letto in **quattro domande, in ordine**.

**1. La misura c'è?** Se `coverage` è `null`, la fonte non ha saputo dire
cosa aveva davanti: il giro è **non misurato**. Non è uno zero, non è un
fallimento; è assenza di misura, e va detto così.

**2. Quante righe di calcio c'erano?** È il denominatore, ed è l'unico
numero che dà senso alla percentuale. Con 11 righe, una partita persa vale
9 punti percentuali: la percentuale si muove tanto e significa poco. Il
numero assoluto `lost` è più onesto della copertura.

**3. Dove sono finite le righe non importate?** I motivi sono sei e sono
di **tre nature diverse**:
- `sport` e `demo` — **fuori perimetro**: viste, correttamente ignorate.
- `robots` — **limite della fonte**: la quota per singolo bookmaker non è
  pubblicata dove ci è consentito guardare. Non è una perdita del giro e
  non entra nel punteggio.
- `no_odds`, `not_reached`, `altro` — **queste sono le perdite vere**.
  `no_odds`: partita in anagrafica, zero quote. `not_reached`: riga
  leggibile che nessuna fase ha dichiarato di aver scartato, e che
  comunque non è arrivata. `altro`: motivo dichiarato ma non
  classificabile come perdita di dato (fuori finestra, tetto per giro).

Solo `no_odds` e `not_reached` chiedono un intervento sul nostro codice.

**4. Quanti giri ci sono dietro?** Sotto **10 giri** la serie è marcata
**non concludente** e la frase sulla profondità lo dice esplicitamente
("un solo giro è una fotografia, non una serie"). La copertura complessiva
è calcolata mettendo insieme i totali, non facendo la media delle medie:
un giro con 2 righe non pesa quanto un giro con 40.

Regola di lettura, valida sempre: **la copertura è la percentuale di righe
di calcio dell'elenco che sono diventate una partita con almeno una quota
in archivio.** Tutto il resto è contorno dichiarato.

## 8. Cosa manca

- **Serie ancora troppo corta**: 1 punto su 10. Nessuna tendenza è
  leggibile e il sistema lo dichiara da sé.
- **Le 2 perdite `NOT_REACHED` di 6A restano senza causa**, per scelta:
  non si correggono prima di averle viste ripetersi con la misura
  automatica.
- **Nessuna pagina** mostra la copertura: esiste solo l'API. La dashboard
  non ne parla.
- **Nessun allarme** se la copertura crolla: il numero viene registrato,
  nessuno lo guarda.
- I 24 gap `SOURCE_MISSING` per-book restano dichiarati e **non
  aggredibili**: il robots.txt della fonte lo vieta.

## 9. Prossimo sprint — uno solo

**Accumulare la serie: far girare la raccolta a intervalli regolari
finché i giri strumentati non sono almeno 10, e mostrare la copertura
nella dashboard come pannello dichiarativo.**

Il motivo viene dai numeri, non da una preferenza: abbiamo **1 punto su
10**, e ogni conclusione su dove il monitor perde dati — comprese le due
righe `NOT_REACHED` — è oggi indistinguibile dal rumore di un campione da
11 righe. Lo strumento di misura è finito e verificato; l'unica cosa che
manca è il tempo. Correggere adesso significherebbe inseguire un caso
singolo.

Non fa parte del prossimo sprint: nuovi collector, altri tornei, parsing
dei per-book, normalizzazione dei nomi, notifiche.

---

*DropAlert è un osservatorio statistico sui movimenti di quota. Nessun
contenuto di questo documento è un consiglio di scommessa.*
