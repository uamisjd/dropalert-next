# Sprint 5A — Dashboard osservatorio (lista segnali)

Chiuso il 18/08/2026. Ambito rispettato: **nessuna pagina di dettaglio partita**
(rinviata a 5B), **nessuna modifica a collector, motore di scoring o pipeline**.

---

## 1. File creati

| File | Righe | Contenuto |
|---|---|---|
| `src/lib/repo/dashboard.ts` | 560 | Repository di lettura della dashboard |
| `src/components/format.ts` | 120 | Formattazione condivisa (date, quote, percentuali, assenze) |
| `src/components/Badges.tsx` | 135 | Badge livello segnale, freschezza dato, ampiezza, CLV non concludente |
| `src/components/SignalCard.tsx` | 210 | Card della partita con movimento rilevato |
| `src/components/StatusPanel.tsx` | 195 | Pannello "Stato dati" |
| `src/components/ClvSection.tsx` | 130 | Sezione "Performance in maturazione" |
| `src/components/SignalFilters.tsx` | 205 | Filtri e ordinamento (unico client component) |
| `src/components/EmptyState.tsx` | 95 | Stato vuoto con causa esplicita |
| `docs/SPRINT-5A-REPORT.md` | — | Questo report |

## 2. File modificati

| File | Modifica |
|---|---|
| `src/app/page.tsx` | Boilerplate `create-next-app` **sostituito** dalla dashboard |
| `src/app/layout.tsx` | `metadata` reale (era "Create Next App"), `lang="it"`, sfondo |
| `src/app/globals.css` | Palette fissa; **rimosso** il blocco `prefers-color-scheme: dark` |

Il dark mode automatico è stato tolto di proposito: l'interfaccia usa il colore
per distinguere la qualità del dato (fresco / fermo / parziale) e un'inversione
parziale avrebbe reso illeggibili proprio quelle distinzioni.

## 3. Funzioni create

**`src/lib/repo/dashboard.ts`**

| Funzione | Ruolo |
|---|---|
| `getDashboardData(filters, now)` | Punto d'ingresso unico: segnali + stato + CLV in parallelo |
| `getDashboardSignals(filters, now)` | Lista segnali con contesto partita, picco osservato, freschezza |
| `getDashboardStatus(now)` | Fonti, buchi aperti, ultimo run, conteggi di giornata |
| `getClvMaturity(now)` | Riepilogo CLV con vincoli di prudenza, incluso per fascia di indice |
| `signalLevelOf(band, magnitude, status)` | Traduce banda+ampiezza in forte/reale/debole/nessuno |
| `freshnessOf(lastSnapshotAt, openGaps, now)` | Classifica live/stale/partial con motivazione testuale |

Costanti esportate: `CLV_INCONCLUSIVE_BELOW = 30`, `CLV_MATURITY_NOTE`,
`SIGNAL_LEVEL_LABELS`, `FRESHNESS_LABELS`.

**Nessuna API e nessuna tabella create in questo sprint.** La dashboard è un
server component che legge il database direttamente: non c'è motivo di
attraversare HTTP per parlare con il proprio stesso processo. Le API esistenti
(`/api/signals`, `/api/health`, `/api/jobs/analyze`) sono rimaste intatte.

## 4. Requisiti e come sono stati soddisfatti

| # | Requisito | Esito |
|---|---|---|
| 1 | Route `/` con segnali reali | ✅ `/` dinamica, dati da `drop_signals` + `matches` + `odds_snapshots` |
| 2 | Card con squadre, lega, kickoff, apertura/picco/corrente, drop %, shift pp, livello, stato dati | ✅ tutti presenti |
| 3 | Filtri livello / competizione / squadra + ordinamento indice / drop % / orario | ✅ via query string |
| 4 | Pannello "Stato dati" in alto | ✅ fonti, buchi, ultimo run, 4 conteggi |
| 5 | Empty state con causa e ultimo run riuscito | ✅ tre casi distinti |
| 6 | Sezione CLV vincolata | ✅ vedi §5 |
| 7 | Disclaimer nel footer | ✅ tre paragrafi |
| 8 | Mobile-first, zero decorazioni, nessun dato fake | ✅ verificato a 390 px |

**Il "picco" non è inventato**: è il prezzo estremo realmente registrato in
`odds_snapshots` nella direzione del movimento (minimo se la probabilità sale).
Se non esiste uno snapshot distinto dall'apertura, la card mostra `—` invece di
ripetere un valore per riempire la colonna.

## 5. Vincoli sul CLV — verificati uno per uno

| Vincolo | Attuazione | Prova |
|---|---|---|
| Sotto 30 osservazioni: badge "NON CONCLUDENTE — n=X", colore neutro, `n` sempre visibile | `InconclusiveBadge`, `border-slate-400 bg-slate-100` | HTML reso: `NON CONCLUDENTE — n=0` |
| Mai in hero o statistiche principali | Sezione dopo i segnali, prima del footer | verificato a video |
| Riga esplicativa fissa | `CLV_MATURITY_NOTE`, sempre resa | "Con campioni piccoli il CLV oscillante non prova nulla. Serve storico." |
| Mai per badge, classifiche o testi celebrativi | Nessun ordinamento o etichetta usa il CLV | grep: zero classi `green`/`emerald`/`red` nella sezione |

Anche le etichette delle metriche portano `n` incorporato — *"CLV medio (n=0)"* —
così il numero non può essere letto separato dal suo campione.

## 6. Distinzioni preservate

- **`sharpConfirms = null` → "non osservabile"**, non "non conferma". La fonte
  non pubblica le linee per singolo bookmaker: assenza di misura, non smentita.
- **`booksTotal = 1` → "consenso unico, coordinazione non misurabile"**, coerente
  con la scelta di non far entrare la coordinazione nel punteggio.
- **`partial` prevale su `stale`**: un buco dichiarato conta più della freschezza.
- **Stato complessivo pessimistico**: basta una fonte degradata per far scendere
  l'etichetta dell'intera pagina.

## 7. Validazioni

| Comando | Esito |
|---|---|
| `npx next typegen` | ✅ Types generated successfully |
| `npx tsc --noEmit` | ✅ nessun errore |
| `npx eslint src --max-warnings=0` | ✅ pulito |
| `npm run build` | ✅ compilato in 1.4 s, `/` marcata `ƒ` (dinamica) |
| `build_and_start` + smoke HTTP | ✅ vedi sotto |
| `npm run test:all` | ✅ **181/181** (53 + 40 + 49 + 39), nessuna regressione |

ESLint ha inizialmente segnalato `react-hooks/set-state-in-effect` nei filtri:
sincronizzavo lo stato dell'input dall'URL dentro un effetto. Corretto rendendo
la casella l'unica fonte di verità del proprio testo, con reset esplicito.

**Smoke test HTTP** (tutti 200):

```
200  /                      37689 bytes
200  /?level=forte          25772 bytes   (filtro esclude → empty state)
200  /?team=trujillanos     37888 bytes   (match trovato)
200  /?team=zzzz            25794 bytes   (nessun match → empty state)
200  /?sort=kickoff         37746 bytes
200  /api/health             2280 bytes   (invariata)
```

## 8. DoD — dati reali verificati con conteggi query

Ogni numero mostrato è stato confrontato con una query indipendente in `psql`.

| Metrica | Dashboard | Query diretta | ✓ |
|---|---|---|---|
| Segnali reali | 1 | 1 | ✅ |
| Partite oggi (giornata Rome) | 4 | 4 | ✅ |
| Partite monitorate | 12 | 12 | ✅ |
| Rilevazioni oggi | 90 | 90 | ✅ |
| Buchi aperti | 30 `bookmaker_missing` | 30 | ✅ |
| `clv_records` | 0 | 0 | ✅ |
| Partite in attesa di chiusura | 11 | 11 | ✅ |
| Fonti attive | 1/1 | 1 | ✅ |

Il **picco 3.290** del segnale #99 corrisponde al `min(price)` realmente
osservato su 4 snapshot (min 3.290 / max 3.610).

Il confronto di giornata è delegato a PostgreSQL
(`at time zone 'Europe/Rome'`), così l'ora legale non è un problema nostro.

**Segnale reso a video** — Trujillanos–Urena, Copa Venezuela, 18/08 22:00:
apertura 3.610 → picco 3.290 → corrente 3.290; variazione −8.86%; spostamento
+2.69 pp (Moderato); badge **Nessun segnale** (banda `insufficient_data`) +
**Dati parziali**; indice 13.95/100; 2 dati mancanti.

Vale la pena notarlo: un movimento dell'8.86% sulla quota viene comunque
classificato **"Nessun segnale"**, perché la copertura dati non basta a
sostenerlo. È esattamente il comportamento voluto — l'ampiezza da sola non
promuove nulla.

## 9. Cosa manca

1. **Dettaglio partita** — è lo Sprint 5B: grafico della serie storica, tabella
   degli snapshot, cronologia degli eventi del segnale, linea di chiusura.
2. **Le card non sono cliccabili**: senza pagina di destinazione un link sarebbe
   un vicolo cieco. Si collegano in 5B.
3. **Paginazione**: il repository si ferma a 200 segnali. Con un solo segnale
   reale il problema non esiste ancora, ma con lo storico servirà.
4. **CLV vuoto**: `clv_records` = 0 finché le 11 partite monitorate non superano
   il kickoff. Non è un difetto della dashboard, è il tempo che deve passare.
5. **Aggiornamento manuale**: nessun auto-refresh. Da valutare, ma un polling
   client su una pagina di sola lettura va pesato contro il costo.
6. **Nessun test automatico sui nuovi componenti**: le funzioni pure
   (`signalLevelOf`, `freshnessOf`, i formattatori) sono facilmente testabili e
   meritano una suite dedicata.

## 10. Prossimo sprint consigliato

**Sprint 5B — Dettaglio partita**, con questo ordine:

1. Test unitari sulle funzioni pure introdotte qui (chiudere il debito §9.6).
2. Route `/match/[id]` con serie storica per bookmaker, scomposizione del
   punteggio, elenco dei buchi e riferimento di chiusura quando esiste.
3. Card cliccabili dalla dashboard.
4. Grafico dell'andamento in SVG inline, senza dipendenze esterne.

Da valutare in parallelo, con priorità sui dati: il monitor ha **un solo segnale
reale** e 30 buchi aperti. Ampliare la copertura del collector sui tornei minori
darebbe alla dashboard qualcosa da mostrare e al CLV un campione per maturare.
