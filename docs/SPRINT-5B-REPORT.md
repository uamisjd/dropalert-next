# Sprint 5B — Dettaglio partita

Chiuso il 18/08/2026. Perimetro rispettato: nessuna modifica a collector,
scorer, notifiche o watchlist.

---

## 0. Nota preliminare — ripristino dell'ambiente

Alla ripresa della sessione lo snapshot aveva perso `node_modules`, il pacchetto
PostgreSQL, le directory di scratch di `pgdata` e l'installazione di Playwright.
Prima di scrivere qualsiasi riga: `npm install`, reinstallazione di
`postgresql-17`, ricreazione delle 16 directory di scratch, riavvio del cluster
custom sulla 5433, reinstallazione di `chromium` + `install-deps`. Nessun dato
del database è andato perso: i 4 segnali e le 90 rilevazioni di ieri sono
intatti.

---

## 1. Debito test chiuso — prima di tutto il resto

Come richiesto, i test sulle funzioni pure dello Sprint 5A sono stati scritti
**prima** di toccare la UI.

**Nuovo file:** `src/lib/repo/__tests__/view.test.ts` — **68 test, 0 falliti**.

| Area coperta | Test | Cosa verifica in particolare |
|---|---|---|
| `signalLevelOf` | 10 | ordine di priorità delle regole: rumore e dati insufficienti prevalgono su qualunque banda; `rebounded`/`expired` declassano; `closed` no |
| `freshnessOf` | 11 | soglia dei 90 minuti **esclusiva**, il gap dichiarato prevale sulla vecchiaia, singolare/plurale, età mai negativa su timestamp futuri |
| `format.ts` | 18 | `n/d` (mai `0`) su null e non finiti, segno meno tipografico U+2212, rese sul fuso `Europe/Rome` e non su UTC, motivi di gap sconosciuti resi leggibili invece che nascosti |
| `series.ts` *(nuovo)* | 14 | statistiche sulla serie **reale** della partita 59 (3.610 → 3.290, −8.86%, +2.69 pp), picco come estremo osservato, ordinamento dei punti, serie vuota tutta `null` |
| `describeDepth` *(nuovo)* | 5 | la nota dichiara profondità e limite, mai profondità simulata |
| `buildChart` *(nuovo)* | 10 | casi degeneri veri: serie piatta e istanti coincidenti non producono `NaN`; valori non finiti scartati, non convertiti in zero |

**Script npm:** aggiunto `test:view`, agganciato a `test:all`.
Suite complessiva: **249 test, 0 falliti** (53 + 68 + 40 + 49 + 39).

---

## 2. File creati

| File | Contenuto |
|---|---|
| `src/lib/repo/series.ts` | statistiche pure di una serie osservata: `peakOf`, `dropPctOf`, `seriesStats`, `describeDepth`, `MIN_POINTS_FOR_TREND = 6` |
| `src/lib/repo/score-view.ts` | distingue "zero punti misurato" da "componente non misurabile": `componentStatusOf`, `scoreComponentsView`, `scoreReachability` |
| `src/lib/repo/match-detail.ts` | repository del dettaglio: `getMatchDetail(matchId, now)`, `listMonitoredMatchIds`, etichette di stato partita/segnale/eventi |
| `src/components/chart.ts` | geometria pura del grafico: `buildChart`, `CHART_WIDTH`, `CHART_HEIGHT` |
| `src/components/OddsChart.tsx` | grafico SVG inline, zero librerie |
| `src/components/SignalTimeline.tsx` | timeline delle transizioni da `signal_events` |
| `src/components/ScoreBreakdown.tsx` | scomposizione dell'indice con i GAP dichiarati |
| `src/app/matches/[id]/page.tsx` | pagina di dettaglio |
| `src/lib/repo/__tests__/view.test.ts` | i 68 test |
| `docs/BACKLOG.md` | coda dichiarata |

## File modificati

| File | Modifica |
|---|---|
| `src/components/SignalCard.tsx` | card cliccabile verso `/matches/[matchId]` |
| `src/db/schema.ts` | esportato il tipo `MatchStatus`, che mancava fra gli enum inferiti |
| `package.json` | `test:view` + `test:all` aggiornato |

**Nessuna tabella creata, nessuna migrazione, nessuna API nuova.** Il dettaglio
è un Server Component che legge il database direttamente, come la dashboard.

---

## 3. Cosa mostra oggi il dettaglio

Verificato su `/matches/59` — Trujillanos–Urena, Copa Venezuela, l'unico match
con segnale reale.

- **Header**: squadre, competizione con paese, kickoff in ora italiana, stato
  della partita, badge di freschezza. Il risultato compare quando c'è
  (verificato su `/matches/65`, conclusa 0–0) accompagnato da *"registrato, non
  usato per valutare il segnale"*.
- **Banner stato dati**: `Dati parziali — 2 buchi dichiarati su questa partita`,
  con la stessa regola `freshnessOf` della dashboard. Quattro contatori:
  12 rilevazioni, 3 serie, ultima raccolta 1 h fa, 2 lacune aperte.
- **Serie storica reale**: tutte e tre le selezioni 1X2, ciascuna con grafico
  SVG dei 4 punti effettivi. Un pallino per rilevazione, così la densità del
  disegno dichiara quante osservazioni ci sono davvero. Sotto: apertura 3.610,
  picco 3.290, corrente 3.290, −8.86%, +2.69 pp, finestra 40 min — tutti valori
  che coincidono con `psql` e con la card della dashboard.
- **Stato parziale**: *"Osservazione iniziata da 1 h 42 min: 4 rilevazioni
  disponibili, troppo poche per descrivere un andamento."* — soglia a 6 punti.
- **Componenti dell'indice**: 13.95/100. Ampiezza 12/30 e copertura 1.95/10
  hanno la barra; **coordinazione (25 pt) e sharp (20 pt) sono marcati
  `GAP — NON MISURABILE`** con il motivo esplicito, barra tratteggiata e la nota
  che quei punti non sono né assegnabili né sottraibili. In fondo la lettura
  corretta: *"13.95 punti su 55 effettivamente misurabili; gli altri 45 su 100
  appartengono a 2 componenti che i dati non permettono di valutare."*
- **Timeline**: l'evento `detected` del 18/08 21:14, +2.69 pp, indice 13.95, con
  la nota del motore. Chiude dichiarando che vengono registrate solo le
  transizioni di stato e le variazioni ≥ 5 punti — così un audit trail corto non
  si legge come assenza di monitoraggio.
- **Dati mancanti**: i 2 `data_gaps` aperti riportati testualmente, incluso
  quello che spiega il limite del `robots.txt` di BetExplorer.

**Stati vuoti verificati:** `/matches/65` (0 rilevazioni) dichiara che il
collector non ha prodotto osservazioni e non ricostruisce nulla; `/matches/58`
(12 rilevazioni, nessun segnale) mostra le serie e spiega che nessun movimento
ha superato la soglia di rumore.

---

## 4. Validazioni

| Comando | Esito |
|---|---|
| `npx next typegen` | ✓ |
| `npx tsc --noEmit` | ✓ |
| `npx eslint src --max-warnings=0` | ✓ |
| `npm run build` | ✓ — `/matches/[id]` registrata come ƒ dinamica |
| `npm run test:all` | ✓ **249/249** |
| build + start | ✓ `/` 200, `/matches/59` 200, `/matches/58` 200, `/matches/60` 200, `/matches/65` 200, `/matches/99999` **404**, `/matches/abc` **404**, `/api/health` 200 |
| screenshot | desktop 1280 e mobile 390 ispezionati: grafici leggibili, nessun overflow |

---

## 5. Gap aperti — aggiornati

- **30 `bookmaker_missing`** su tutte le partite monitorate: invariati. Restano
  la causa dei due GAP visibili in ogni dettaglio.
- **`clv_records` = 0**: nessun segnale ha ancora raggiunto il kickoff con linea
  di chiusura registrata. 8 partite in attesa, la prima il 19/08 03:00.
- **Nessun test sui componenti React**: coperte le funzioni pure, il rendering
  è verificato solo per ispezione HTML e screenshot.
- **Paginazione, auto-refresh**: invariati, tracciati in `docs/BACKLOG.md`.

---

## 6. Prossimo sprint consigliato

**Sprint 6 — Copertura del collector sui tornei minori** (punto 1 del backlog).

È il debito che oggi degrada di più la qualità della misura: il monitor osserva
ciò che la vetrina dropping-odds di BetExplorer decide di mostrare, e i tornei
minori — dichiarati il cuore del progetto — non hanno una copertura misurata.
Primo passo suggerito: quantificare la copertura reale per competizione prima
di scrivere codice, così da sapere se il problema è la fonte o il nostro punto
di ingresso.

In alternativa, se si preferisce lavorare sul limite strutturale invece che
sull'ampiezza: **punto 2 del backlog** — ricerca di una fonte multi-bookmaker
che renda finalmente calcolabile `sharpConfirms` e sblocchi i 45 punti di indice
oggi inaccessibili. È il lavoro con il maggior ritorno sulla qualità del
segnale, ma dipende dall'esistenza di una fonte legittima e gratuita, che va
verificata prima di impegnare uno sprint.
