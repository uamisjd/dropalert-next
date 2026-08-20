# Scheduling

Fino allo sprint precedente DropAlert sapeva compiere **un** giro quando
qualcuno glielo chiedeva: da riga di comando, dal pulsante, via HTTP. La
ripetizione nel tempo era delegata a uno scheduler esterno, e finché non se
ne configurava uno la serie storica non avanzava mai da sola.

Adesso la ripetizione è **una funzione del prodotto**: un runner in-process
che sveglia `runCycle()` a intervallo fisso finché l'applicazione è viva.

> Questo documento sostituisce la versione che dichiarava «nessun demone,
> nessun `setInterval`». Quell'affermazione non è più vera ed è stata
> rimossa invece di essere lasciata a invecchiare.

---

## 1. Come parte

| Cosa | Dove |
|---|---|
| Aggancio all'avvio | `src/instrumentation.ts` → `register()` |
| Runner | `src/lib/pipeline/collect-loop.ts` → `startCollectLoop()` |
| Giro vero | `src/lib/pipeline/scheduler.ts` → `runCycle({ trigger: "scheduled" })` |

Next chiama `register()` **una volta per processo server**, prima di servire
la prima richiesta. Non dipende dal fatto che qualcuno visiti una pagina e
non si duplica a ogni richiesta.

```
avvio del server
  └─ register()                  guardia: NEXT_RUNTIME === "nodejs"
       └─ startCollectLoop()     guardia: SCHEDULER_ENABLED === "true"
            ├─ +30 s   primo giro
            └─ +45 min ogni giro successivo
                 └─ runCycle({ trigger: "scheduled" })
                      └─ gate shouldRunNow() → collectBetexplorer() → detectAll() → runClosingJob()
```

Accensione:

```bash
SCHEDULER_ENABLED=true node --env-file=.env node_modules/.bin/next start -H 0.0.0.0 -p 3000
```

oppure `SCHEDULER_ENABLED=true` in `.env`.

**Il default è spento.** Non per prudenza generica: `next build` esegue il
codice di avvio per generare le pagine, e uno scheduler che parte durante una
build si metterebbe a bussare alla fonte da un contesto che non è un server.

Il runner è **idempotente**: chiamarlo due volte non crea due timer (handle
su `globalThis`, come il pool del database — in sviluppo il modulo viene
ricaricato a caldo e senza aggancio ogni ricarica lascerebbe un timer orfano).

Quando non parte, lo **dice** nei log:

```
[scheduler] runner schedulato acceso: un giro ogni 45 minuti (intervallo da valore predefinito), primo giro fra 30 secondi.
[scheduler] runner schedulato spento: SCHEDULER_ENABLED non vale "true". La raccolta resta disponibile a mano.
```

«Lo scheduler non gira» senza spiegazione è il tipo di silenzio che fa
perdere ore.

---

## 2. Intervallo

| Variabile | Default | Effetto |
|---|---|---|
| `SCHEDULER_ENABLED` | *(assente = spento)* | accende il runner; solo `true` accende |
| `COLLECT_INTERVAL_MINUTES` | **45** | minuti fra un giro e il successivo |
| `COLLECT_HORIZON_HOURS` | `72` | quanto avanti guardare nel calendario |
| `COLLECT_MAX_FIXTURES` | `25` | tetto di partite per giro |
| `COLLECT_WITH_RESULTS` | `true` | se aggiornare anche i risultati finali |

**Perché 45 minuti.** È un compromesso dichiarato fra due esigenze opposte:

- `FLASH_WINDOW_MINUTES = 30` — un movimento più corto di mezz'ora è un
  flash. Con giri da 45 minuti un flash può cadere **interamente fra due
  osservazioni**: lo si vede come un movimento già rimbalzato, o non lo si
  vede affatto. È una perdita di risoluzione **nota e accettata**, non un
  difetto nascosto;
- la fonte è pubblica e gratuita. 45 minuti significano ~32 richieste al
  giorno alla pagina di listing, un carico trascurabile e difendibile.

Valori: clamp fra `MIN_INTERVAL_MINUTES = 5` e `MAX_INTERVAL_MINUTES = 1440`.
Un valore illeggibile (`COLLECT_INTERVAL_MINUTES=presto`) **non spegne lo
scheduler**: torna al default e lo dichiara in `config.source = "default"`.

**Il timer propone, il gate dispone.** Ogni sveglia chiama `runCycle`, che
rilegge `shouldRunNow()` contro `system_state['scheduler:last_cycle']`. Un
giro manuale appena effettuato, due processi partiti per errore o un retry
non si traducono in traffico aggiuntivo verso la fonte: il gate risponde
`run = false`, la raccolta viene saltata e si passa ad analisi e chiusura,
che sono operazioni locali sul database.

---

## 3. Cosa fa il runner quando le cose vanno storte

| Situazione | Comportamento | Traccia |
|---|---|---|
| Giro più lungo dell'intervallo | la sveglia successiva **salta**, non accavalla | `lastStatus: "skipped_busy"` |
| Giro che solleva un'eccezione | il runner **resta acceso** e riprova alla sveglia dopo | `lastStatus: "failed"` + log |
| Archivio non raggiungibile alla scrittura dello stato | il giro **resta valido**, si perde solo il contatore | log `stato del runner non salvato` |
| Processo Node che muore | muore anche il timer | nessuna: serve un supervisore di processo |

L'ultima riga è un limite reale, non aggirabile da dentro: **la raccolta vive
quanto vive l'applicazione che la mostra.** Se il server si riavvia, il
runner riparte con `register()` e il primo giro arriva 30 secondi dopo.

Due giri sovrapposti raddoppierebbero il carico sulla fonte proprio quando la
fonte è già lenta: è la ragione del salto, non un dettaglio implementativo.

---

## 4. Il secondo tentativo sulle righe non raggiunte

Dentro il giro, fra la raccolta e i risultati, c'è una **fase 3-bis**:

1. il giro calcola quali righe uscirebbero etichettate `not_reached`
   (`selectRetryTargets`, la stessa logica che poi le etichetta — i test
   verificano che i due insiemi coincidano sempre);
2. attende **60 secondi**;
3. le ritenta **una volta sola** (`MAX_ATTEMPTS_PER_ROW = 2`);
4. quelle recuperate diventano importate; quelle ancora mancanti restano
   `not_reached` con il dettaglio «ritentata una volta dopo 60 secondi».

Cosa **non** viene ritentato, e perché:

| Riga | Motivo del no |
|---|---|
| importata ma senza quote pubblicate | è un'assenza dichiarata **dalla fonte**, insistere è accanimento |
| con motivo già dichiarato (`RUN_CAP`, fuori finestra) | il motivo la spiega già |
| che il parser non legge | è un problema di lettura, non di raggiungibilità |

Un solo tentativo aggiuntivo, non una raffica: `retry: {attempted, recovered,
stillMissing, refs}` finisce nel report e in `meta` del giro, così la
differenza fra «non raggiunta» e «non raggiunta due volte» resta leggibile.

---

## 5. Profondità della serie: contano solo i giri schedulati

`MIN_RUNS_FOR_TREND = 10`. Da questo sprint la soglia guarda
`stats.scheduledPoints`, **non** il totale dei punti.

Ogni giro registra la propria origine in `meta.trigger`:

| Origine | Chi | Fa profondità |
|---|---|---|
| `scheduled` | il runner | **sì** |
| `manual` | pulsante, `npm run job:collect`, `POST /api/jobs/analyze` | no |

Un giro manuale resta **pienamente nella misura** — entra in
`totalFootball`, `totalImported`, `pooledCoverage` — ma non avvicina la
soglia. Un giro chiesto a mano è un'osservazione fatta *quando ho guardato*,
non *a intervallo regolare*: dieci giri concentrati in venti minuti perché
qualcuno premeva un pulsante non sono una serie temporale, e trattarli come
tale produrrebbe una tendenza costruita sulla curiosità dell'osservatore.

I giri privi di `meta.trigger` (tutti quelli antecedenti a questo sprint)
valgono `manual`: promuoverli gonfierebbe la profondità con osservazioni mai
avvenute.

**Conseguenza dichiarata:** i 5 giri già misurati (run 114, 148, 149, 150,
151, copertura 100%) restano nei totali, ma **il contatore schedulato riparte
da 0/10**. Con 45 minuti di intervallo, dieci giri arrivano in circa
**7 ore e mezza**.

---

## 6. Cosa si vede nella pagina

Nel riquadro «Profondità dell'osservazione» di `/coverage` e nel riepilogo in
home:

- `N/10 giri` — solo schedulati;
- «Serie insufficiente, niente tendenza.» finché `N < 10`;
- i giri manuali, quando ce ne sono, sono dichiarati a parte come contati
  nella misura ma fuori dalla soglia;
- una riga sulla raccolta automatica via **GitHub Actions**, letta
  dall'archivio e non dalla riga di stato di un processo:

  «Raccolta automatica via GitHub Actions: cron «7,52 * * * *», circa un
  giro ogni 45 minuti.» seguita da «Ultimo giro schedulato (run N): esito
  riuscito.» con data e ora, e da un avviso ambra — «Nessun giro
  schedulato da …: oltre i 90 minuti attesi, la raccolta automatica
  potrebbe essersi fermata.» — quando il silenzio supera due intervalli;

- una riga sul runner in-process, **solo quando c'è un processo vivo che
  la sostenga**, in due varianti:

| Stato | Testo |
|---|---|
| attivo, prossimo giro noto | «Raccolta automatica ogni 45 minuti: prossimo giro fra 12 min.» |
| attivo, giro imminente | «…prossimo giro a momenti.» |
| stato incerto | «Stato incerto: l'ultimo stato salvato dice raccolta attiva ogni 45 minuti, ma non è confermato da questo processo. Nessun segno di vita da 3 h. Riavviare per ripartire con certezza.» |

Runner spento non produce più la riga «Raccolta automatica non attiva: la
serie non avanza da sola» (rimossa nello Sprint 9): con la raccolta
delegata al cron quella frase era falsa — la serie avanza lo stesso, e a
dirlo sono i giri schedulati letti dall'archivio.

`nextRunMinutes` viene da `minutesUntil(nextRunAt, now)`: un giro in ritardo
vale `0`, mai un numero negativo, e senza `nextRunAt` vale `null` — non si
inventa un tempo.

### Perché esiste lo «stato incerto»

`running: true` è un'affermazione scritta da un processo che potrebbe non
esistere più. Un processo terminato di colpo — riavvio, reset dell'ambiente,
crash — non ha modo di correggere la propria riga, e chi legge il pannello si
trova davanti un «prossimo giro fra 27 minuti» che non arriverà mai.

Due difese, entrambe necessarie:

1. **Ogni processo reclama la riga all'avvio**, prima del primo tick. Con lo
   scheduler acceso scrive il proprio stato; con lo scheduler spento scrive
   `running: false, nextRunAt: null` (`claimStateAsOff`). La riga descrive
   sempre il processo vivo, non l'ultimo che è passato di lì.
2. **Chi legge non si fida del flag**: `schedulerHealth(state, now)` guarda
   l'ultimo segno di vita — il tick più recente, o l'accensione se non ha
   ancora ticchettato. Oltre `STALE_INTERVAL_MULTIPLIER × intervallo`
   (2 × 45 = 90 minuti) lo stato diventa `uncertain`: niente orario, niente
   rassicurazioni, si dichiara che non è verificato.

La prima difesa copre il riavvio ordinato, la seconda il processo morto male
o l'archivio raggiunto da un altro processo. Un orario che non si può
garantire non si stampa.

`cyclesCompleted` resta un contatore **di processo** e riparte da zero a ogni
avvio: non ha alcun rapporto con la profondità della serie `N/10`, che si
conta dai run salvati in `collector_runs`.

Gli stessi campi sono in `GET /api/coverage`, sotto `scheduler` e dentro
`history` (`scheduledRuns`, `manualRuns`).

---

## 7. Dove finisce lo stato

| Chiave | Contenuto |
|---|---|
| `system_state['scheduler:loop']` | `LoopState{running, intervalMinutes, startedAt, lastTickAt, nextRunAt, cyclesCompleted, lastStatus}` |
| `system_state['scheduler:last_cycle']` | istante dell'ultima raccolta **effettiva**: è su questo che si regge il gate |
| `collector_runs` | una riga per giro, con `meta.coverage`, `meta.trigger`, `meta.retry` |
| `source_health` | latenza, stato della fonte, `blocked` dopo 3 errori consecutivi |
| `data_gaps` | ogni buco dichiarato, mai colmato con stime |

Un giro fallito a metà lascia `status = 'failed'` e gli errori in chiaro. Un
fallimento visibile è preferibile a un buco silenzioso.

---

## 8. Invocazione manuale — resta disponibile

| Modo | Comando | `trigger` |
|---|---|---|
| CLI, solo raccolta | `npm run job:collect -- --collect-only` | `manual` |
| CLI, giro completo | `npm run job:collect` (`--force` scavalca il gate) | `manual` |
| HTTP | `POST /api/jobs/analyze` con header `x-jobs-token` | `manual` |
| Pulsante | «Raccogli ora» in `/coverage` | `manual` |

```bash
curl -X POST https://<host>/api/jobs/analyze \
  -H "content-type: application/json" \
  -H "x-jobs-token: $JOBS_TOKEN" \
  -d '{"collect":true,"closing":true}'
```

`GET /api/jobs/analyze` risponde 405 ma restituisce la configurazione attiva:
utile per verificare l'intervallo reale senza eseguire nulla.

---

## 9. Scheduler esterni: perché non servono più

`.github/workflows/collect.yml` resta nel repository ma **non è il
meccanismo in uso** e non va considerato la risposta alla domanda «come parte
lo scheduler». Se il progetto finisse su GitHub con quel workflow attivo,
girerebbe *in aggiunta* al runner in-process; il gate dell'intervallo
impedirebbe il doppio carico sulla fonte, ma la cosa pulita è tenerne acceso
uno solo.

Limiti che avevano motivato l'abbandono degli scheduler esterni, tutti
verificati e tutti ancora veri:

| Limite | Valore |
|---|---|
| Intervallo minimo GitHub Actions | 5 minuti (`* * * * *` accettato dal parser, mai eseguito) |
| Puntualità | nessuna garanzia, ritardi di decine di minuti nelle ore di punta |
| Repo pubblici inattivi | schedule **disattivate dopo 60 giorni** senza commit |
| Repo privati, piano Free | ~2.000 minuti/mese, e la regola dei 60 giorni non li copre |
| Branch | solo l'ultimo commit del branch di default |
| Vercel Hobby | 1 cron job, **frequenza giornaliera** |
| Render | cron job a pagamento |
| GitLab CI Free | minimo 5 minuti, ~24 esecuzioni/giorno |

Per una macchina propria, se un giorno servisse il runner spento e il cron di
sistema acceso:

```cron
7,52 * * * * cd /path/dropalert && /usr/bin/npm run job:collect >> /var/log/dropalert.log 2>&1
```

Quei giri conterebbero come `manual` e **non** farebbero profondità: per
farli contare occorrerebbe estendere `RUN_TRIGGERS`, non aggirare il
controllo.

---

## 10. Verifica

```bash
# il runner è acceso? ogni quanto? fra quanto il prossimo giro?
curl -s "http://127.0.0.1:3000/api/coverage?limit=50" | jq '.scheduler'

# profondità: schedulati contro manuali
curl -s "http://127.0.0.1:3000/api/coverage?limit=50" | jq '.history | {scheduledRuns, manualRuns}'

# stato grezzo del runner
psql -d dropalert -c \
  "select value from system_state where key = 'scheduler:loop';"

# i giri, con la loro origine
psql -d dropalert -c \
  "select id, to_char(started_at,'HH24:MI') as ora, status,
          meta->>'trigger' as origine,
          meta->'coverage'->>'football' as calcio,
          meta->'coverage'->>'imported' as importate
   from collector_runs
   where collector_key = 'betexplorer-collect'
   order by id desc limit 12;"
```

Nei log del server, una riga per giro:

```
[scheduler] giro success: 11 quote scritte, 11 partite analizzate.
[scheduler] giro precedente ancora in corso: sveglia saltata per non sovrapporre due raccolte.
```

---

## 11. Test

`npm run test:scheduler` — 26 casi, parti pure soltanto: nessun timer acceso,
nessuna scrittura in archivio. Coprono intervallo e clamp, lettura
dell'ambiente e fallback dichiarato, interruttore, gate (incluso «un giro
manuale appena fatto ferma il giro schedulato»), conto alla rovescia e
credibilità dello stato (`schedulerHealth`: spento, vivo, silenzio oltre due
intervalli, processo morto che non resta «in esecuzione», soglia esatta a
90 minuti, istanti illeggibili).

Il secondo tentativo e il conteggio per origine sono in
`npm run test:coverage`; le varianti della riga sullo stato del runner e
della riga della raccolta via GitHub Actions — incluso l'avviso oltre i
90 minuti — in `npm run test:cov-view`.

---

## 8. Produzione (dal 19/08/2026)

Tre pezzi gratuiti, ognuno per ciò che sa fare:

| Pezzo | Ruolo | Perché |
|---|---|---|
| Vercel Hobby | serve le pagine | il piano gratuito consente **un solo cron al giorno**: inadatto a 45 minuti |
| GitHub Actions | esegue la raccolta | cron ogni 45 min, scrive direttamente su Neon |
| Neon free | PostgreSQL | nessuna carta, nessuna scadenza |

**Il runner interno è spento in produzione** (`SCHEDULER_ENABLED=false`). Su
Vercel il processo non sopravvive fra due richieste: un loop in-process
dichiarerebbe un "prossimo giro" che nessuno eseguirà. Dallo Sprint 9 il
pannello, con il processo spento, non dice più «Raccolta automatica non
attiva»: descrive la raccolta per come avviene — GitHub Actions, cron
`7,52 * * * *`, l'ora e l'esito dell'ultimo giro schedulato letti dai run
salvati, e un avviso ambra se nessun giro schedulato arriva da oltre 90
minuti. La verità non è nel processo che serve la pagina, è nell'archivio.

### Il cron non è `*/45`

`*/45 * * * *` **non** produce un giro ogni 45 minuti: il campo dei minuti si
azzera a ogni ora, quindi scatta a :00 e :45 — 45 minuti, poi 15. Il workflow
usa `7,52 * * * *` (45 e 75 minuti alternati, minuto 0 evitato perché
congestionato). L'autorità sulla spaziatura minima resta il gate interno
`COLLECT_INTERVAL_MINUTES=45`, che scarta i giri troppo ravvicinati.

### Cosa conta per la serie N/10

Solo `meta.trigger = "scheduled"`. `triggerOfRun` tratta ogni altro valore come
`manual`. Il workflow passa `npm run job:collect -- --scheduled`: senza quel
flag i giri del cron sarebbero contati come manuali e la serie resterebbe a
zero per sempre.

### Due trappole già pagate

- `NODE_ENV=production` a livello di job fa saltare le devDependencies a
  `npm ci`: drizzle-kit e tsx spariscono e la migrazione muore con «Please
  install latest version of drizzle-orm». La variabile non si mette sul job.
- `tsx --env-file=.env` esce con codice 9 dove `.env` non esiste (il runner CI,
  giustamente). Gli script `job:*` usano `--env-file-if-exists`.
