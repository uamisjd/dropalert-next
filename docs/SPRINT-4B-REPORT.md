# Sprint 4B — Scheduler + closing lines + CLV

Data: 18 agosto 2026. Tutte le verifiche eseguite su dati reali della giornata.

---

## 1. File modificati

### Nuovi

| File | Righe | Contenuto |
|---|---|---|
| `src/lib/drop/novig.ts` | 189 | rimozione proporzionale del margine, fasce dell'indice. Funzioni pure |
| `src/lib/pipeline/scheduler.ts` | 396 | configurazione, gate dell'intervallo, giro completo |
| `docs/SCHEDULING.md` | 187 | scheduling a costo zero, limiti dichiarati, alternative |
| `docs/SPRINT-4B-REPORT.md` | — | questo documento |
| `.github/workflows/collect.yml` | 79 | cron ogni 15 min, `concurrency`, timezone Europe/Rome |
| `drizzle/0002_sprint4_fair_closing_clv_basis.sql` | 6 statement | migrazione applicata |

### Modificati

| File | Cosa è cambiato |
|---|---|
| `src/db/schema.ts` | +3 colonne a `closing_lines`, +3 a `clv_records` |
| `src/lib/pipeline/closing.ts` | riscritto (~640 righe): chiusura di mercato, fair no-vig, basis, job indipendente dai segnali |
| `src/app/api/jobs/analyze/route.ts` | ora esegue il giro completo (raccolta inclusa); GET espone la configurazione |
| `src/scripts/run-collect.ts` | giro completo, `--force` / `--no-collect` / `--collect-only`, **chiude la connessione** |
| `src/lib/drop/__tests__/engine.test.ts` | +13 test (no-vig, gate scheduler) |
| `src/lib/pipeline/__tests__/pipeline.test.ts` | +11 test (fair closing, basis, fasce, giro) |
| `README.md` | sezione Scheduling, chiusura fair, variabili, comandi |

---

## 2. Funzioni create

**`novig.ts`** — `fairMarket()`, `fairPriceFor()`, `scoreBucketOf()`;
costanti `MARKET_SELECTIONS`, `NOVIG_METHOD`, `SCORE_BUCKETS`.

**`scheduler.ts`** — `readSchedulerConfig()`, `shouldRunNow()` (pura),
`readLastCycle()`, `writeLastCycle()`, `runCycle()`; costanti
`DEFAULT_INTERVAL_MINUTES=15`, `MIN_INTERVAL_MINUTES=5`,
`MAX_INTERVAL_MINUTES=1440`, `LAST_CYCLE_KEY`.

**`closing.ts`** — `readPreKickoffPrices()` (legge l'intero mercato, non la
singola selezione), `captureClosingForMarket()`, `getClosingReference()`,
`summarizeClvByScoreBucket()`, `pendingClosings()`; `computeClvForSignal()` e
`runClosingJob()` riscritte. Il job di chiusura **non dipende più dai segnali**:
cerca le partite oltre il kickoff entro `CLOSING_LOOKBACK_HOURS=72`.

---

## 3. Tabelle e API

### Colonne aggiunte (migrazione `0002`, applicata)

`closing_lines`: `fair_closing_price numeric(8,3)`,
`fair_closing_prob numeric(7,6)`, `market_margin numeric(6,4)`.

`clv_records`: `closing_basis text NOT NULL DEFAULT 'raw_consensus'`,
`market_margin numeric(6,4)`, `signal_score numeric(5,2)`.

Tabella `system_state` (già esistente) ora in uso: chiave
`scheduler:last_cycle`.

### API

| Rotta | Prima | Ora |
|---|---|---|
| `POST /api/jobs/analyze` | solo analisi + chiusura | **giro completo**: raccolta → analisi → chiusura. Corpo: `collect`, `closing`, `force`, `matchIds` |
| `GET /api/jobs/analyze` | 405 secco | 405 **+ configurazione attiva dello scheduler** |

---

## 4. Test

| Suite | Prima | Ora |
|---|---|---|
| `test` (motore, puro) | 40 | **53** |
| `test:pipeline` (PostgreSQL) | 29 | **40** |
| `test:providers` | 49 | 49 |
| `test:betexplorer` | 39 | 39 |
| **Totale** | 157 | **181 — tutti verdi** |

Validazioni: `next typegen` ✓ · `tsc --noEmit` ✓ · `eslint --max-warnings=0` ✓ ·
`npm run build` ✓ · server avviato, `/api/health` 200, `/api/signals` 200,
`/api/jobs/analyze` GET 405 / POST senza token 401 / POST con token 200.

---

## 5. Definition of done — verifica sui dati reali

### Nuovi snapshot in tempo reale ✓

Due raccolte reali eseguite durante lo sprint (CLI e HTTP):

```
odds_snapshots reali (chiave be-%):  36 → 60 → 90
partite reali monitorate:             7 → 11
```

### Prima closing line reale ✓

Il match `be-YkmBW3Jc` (kickoff 18/08 20:45 Europe/Rome) è passato oltre il
fischio d'inizio durante lo sprint. Chiusura acquisita alle 20:37, **8 minuti
prima del kickoff**, con margine rimosso:

| selezione | chiusura grezza | prob. grezza | **fair no-vig** | **prob. fair** | margine |
|---|---|---|---|---|---|
| home | 1.780 | 0.561798 | **1.996** | 0.500961 | 0.1214 |
| draw | 3.730 | 0.268097 | **4.183** | 0.239065 | 0.1214 |
| away | 3.430 | 0.291545 | **3.847** | 0.259974 | 0.1214 |

Le tre probabilità fair sommano esattamente a 1.000000. Il margine osservato
del bookmaker di consenso è **12,14%**.

### Record CLV: 0, e il motivo è dichiarato

Nessun `clv_record` è stato prodotto. Non è un difetto del calcolo: **non
esisteva alcun segnale su quella partita**. Il match `be-YkmBW3Jc` non ha mai
superato la soglia di ampiezza (il suo movimento home 1.810 → 1.780 vale circa
1 punto percentuale, cioè rumore). Il CLV misura i segnali, non le partite:
senza segnale non c'è nulla da misurare, e inventarne uno per popolare la
tabella sarebbe esattamente ciò che questo sistema non fa.

Il primo segnale reale è nato in questo sprint — id 99, `be-EBF3oHSE`, 1x2
away, 3.290, delta **2.69 pp** (`moderate`), banda `insufficient_data` per
copertura da fonte singola. Quella partita ha kickoff **oggi alle 22:00**.

### Quando chiuderà la prima

**Il primo CLV reale sarà calcolabile dopo le 22:00 di oggi**, alla prima
esecuzione del giro successiva al kickoff di `be-EBF3oHSE`.

### Partite monitorate ancora da chiudere: 11

| chiave | kickoff (Europe/Rome) | snapshot |
|---|---|---|
| `be-Stt1j9GP` | 18/08 22:00 | 12 |
| `be-EBF3oHSE` | 18/08 22:00 | 12 ← porta il segnale 99 |
| `be-OQMHIRhB` | 18/08 22:00 | 6 |
| `be-dY7hzbTN` | 19/08 03:00 | 12 |
| `be-AeAX2EyS` | 19/08 12:00 | 12 |
| `be-O41Y70JO` | 19/08 12:00 | 12 |
| `be-IN0U83Rp` | 19/08 17:00 | 3 |
| `be-QNluaMzn` | 19/08 18:30 | 6 |
| `be-hrz5KdFb` | 19/08 19:00 | 3 |
| `be-C63J0um3` | 21/08 18:00 | 3 |
| `be-hjz8oPnp` | 21/08 20:00 | 3 |

### Nessun processo appeso ✓

`run-collect.ts` chiude la connessione con `sql.end({ timeout: 5 })` in
entrambi i rami e termina con `process.exit(0|1)`. Il giro è una funzione che
ritorna: nessun `setInterval`, nessun worker, nessun listener.

---

## 6. Scheduling a costo zero

Intervallo predefinito **15 minuti**, configurabile con
`COLLECT_INTERVAL_MINUTES`, con minimo assoluto di 5.

Il limite è applicato **dal codice**: `shouldRunNow()` legge
`system_state['scheduler:last_cycle']` e salta la raccolta se è troppo presto.
Verificato in esercizio — una seconda chiamata HTTP a distanza di 40 secondi ha
risposto:

```json
"gate": { "run": false,
  "reason": "ultimo giro 0.6 minuti fa, intervallo minimo 15 minuti: raccolta saltata per non martellare la fonte." }
```

Analisi e chiusura sono comunque proseguite: sono operazioni locali.

Limiti del piano gratuito, dichiarati in `docs/SCHEDULING.md`: GitHub Actions
ha un intervallo minimo reale di **5 minuti**, nessuna garanzia di puntualità,
timezone UTC salvo il campo `timezone:`, **schedule disattivate dopo 60 giorni
di inattività sui repository pubblici**, minuti illimitati sui pubblici e
~2.000/mese sui privati. Alternativa predisposta: due giri di natura diversa —
osservazione ogni 15–30 min e consolidamento giornaliero con `--no-collect`,
che recupera le chiusure arretrate entro 72 ore senza toccare la rete. Se il
budget non regge, si scende di frequenza e **si perde risoluzione, non
correttezza**.

---

## 7. Cosa manca

1. **CLV ancora a zero per assenza di segnali chiusi.** Attesa passiva: il
   primo arriva dopo le 22:00 di oggi. Le fasce dell'indice resteranno
   `underpowered` finché non ci saranno 10 osservazioni per fascia — cioè
   settimane di raccolta, non giorni.
2. **`sharpConfirms` resta `null`.** Gap `bookmaker_missing` aperto: **30
   dichiarazioni attive**. La fonte unica pubblica solo il consenso.
3. **La coordinazione fra bookmaker non entra nel punteggio.** Invariato per
   scelta esplicita.
4. **Nessuna interfaccia utente.** Tutto passa da API e CLI.
5. **Il workflow GitHub Actions non è mai stato eseguito**: richiede un
   repository remoto e il secret `DATABASE_URL`. È scritto e coerente con i
   comandi npm reali, ma la sua prima esecuzione andrà osservata.
6. **`applyResults` non ha ancora chiuso una partita in questo sprint**
   (`resultsUpdated: 0` in entrambe le raccolte): le partite di stasera sono
   ancora in corso.

---

## 8. Prossimo sprint consigliato

**Sprint 5 — interfaccia dell'osservatorio.** È la parte mancante più grande e
ora ha dati veri sotto: 90 snapshot reali, un segnale reale, una closing line
fair reale.

Contenuto proposto: elenco dei segnali con ampiezza, banda e copertura;
dettaglio con i cinque criteri e la spiegazione testuale già prodotta dal
motore; grafico della serie storica; pannello dei buchi dati dichiarati;
pagina sullo stato del monitor con salute delle fonti, ultimi giri e riepilogo
CLV per fascia — comprese le fasce vuote, mostrate come vuote.

Prima di iniziare va deciso un punto: **il riepilogo CLV va pubblicato anche
quando è `underpowered`**, marcato come non concludente, **oppure nascosto
finché non raggiunge le 10 osservazioni?** Mostrarlo è più trasparente;
nasconderlo evita che un numero provvisorio venga letto come un risultato.
