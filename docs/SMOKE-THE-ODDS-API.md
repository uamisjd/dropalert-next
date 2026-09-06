# Smoke test live di The Odds API — procedura passo per passo

> Documento operativo. Serve a chiudere l'ultimo gate del provider: una
> chiamata reale, con chiave vera e database reale. Finché questa procedura
> non produce un esito verificato, `ADAPTER_IMPLEMENTED` in
> `src/lib/providers/optional/the-odds-api.ts` resta `false` e il sito continua
> a dire **NO BET** quando manca un prezzo realmente eseguibile.
>
> Nessuna chiave e nessuna connection string va scritta in una chat, in un
> commit o in un issue: si configurano solo come *secret* del repository.

---

## 1. Quale ambiente usare (e perché)

**GitHub Actions**, tramite la workflow `Smoke The Odds API`.

Il motivo non è di gusto, è di fatto: il test ha bisogno di **due** cose
contemporaneamente — la chiave della fonte e il database reale — e questo è
l'unico ambiente dove il database è già raggiungibile senza installare nulla.

| Ambiente | Database reale | Chiave | Installazioni | Verdetto |
|---|---|---|---|---|
| **GitHub Actions** | ✅ già configurato (`DATABASE_URL`, lo stesso del giro di osservazione) | da aggiungere una volta come secret | nessuna | **scelto** |
| Vercel | ✅ | ✅ già presente (`theoddsapiKey`) | nessuna | non adatto: non c'è un modo di eseguire uno script una tantum con output leggibile |
| Locale | ❌ da esporre il Neon (tunnel/IP allowlist) | da mettere in un file `.env` | Node, npm, file `.env` | possibile ma più fragile e con più passaggi manuali |

Il giro di osservazione (`Osservazione DropAlert`) gira su GitHub Actions e
scrive sullo stesso database: è la prova che `DATABASE_URL` lì funziona.

### Quale workflow usare (importante, verificato il 06/09/2026)

GitHub registra e rende lanciabili **solo le workflow presenti sul branch di
default** (`main`). Una workflow nuova — come `smoke-odds.yml` — dà `404` finché
non è mergiata, e noi non mergiamo nulla prima del test reale. La soluzione già
in uso è la workflow manuale **`Verifica dati reali (manuale)`**, che esiste su
`main` ed è fatta per le letture contro i dati veri: sul ramo di lavoro le è
stata aggiunta la modalità `smoke-odds` (che quindi gira dal ramo, senza PR).

Quindi: in *Actions* scegli **`Verifica dati reali (manuale)`**, branch
`arena/01a07663-dropalert-next`, `which = smoke-odds`. Quando (e solo quando)
questo strumento verrà mergiato su `main`, la workflow dedicata
`Smoke The Odds API` diventerà lanciabile e prenderà il posto di questa.

---

## 2. Quanto costa

Il piano gratuito dà **500 crediti al mese**; il budget dichiarato in
`src/lib/providers/optional/odds-api-budget.ts` è **490**, con un tetto di 14
al giorno.

| Passo | Endpoint | Costo |
|---|---|---|
| Trovare la partita | `/v4/sports/{sport}/events` | **0 crediti** (la fonte dichiara questo endpoint fuori quota) |
| Smoke test | `/v4/sports/{sport}/odds` con 1 mercato (`h2h`) × 1 regione (`eu`) | **1 credito** |

L'intera verifica costa quindi **1 credito**. Il costo è controllato due volte:
dalla scelta dell'endpoint gratuito per la ricerca, e dal pre-check dello smoke
test che si ferma **prima** della chiamata a pagamento se la partita non è
riconoscibile.

---

## 3. Prima di cominciare: la chiave come secret

Da fare **una volta sola**.

1. Apri `https://github.com/uamisjd/dropalert-next/settings/secrets/actions`.
2. Se esiste già un secret chiamato `THE_ODDS_API_KEY`, salta al passo 4.
3. Premi **New repository secret**.
   - *Name*: `THE_ODDS_API_KEY`
   - *Secret*: il valore della chiave, copiato da
     `https://the-odds-api.com/account`
   - Premi **Add secret**.
4. Se la chiave esiste già su Vercel con il nome `theoddsapiKey`, **non serve
   rinominare nulla**: la workflow accetta anche quel nome. Copia il valore da
   Vercel (Settings → Environment Variables) e incollalo in un secret di
   GitHub. Puoi usare il nome che preferisci fra `THE_ODDS_API_KEY`,
   `ODDS_API_KEY`, `theoddsapiKey`, `THEODDSAPIKEY`.

La workflow si ferma con un messaggio esplicito se la chiave manca: non parte
nessuna chiamata.

---

## 4. Passo 1 — trova una partita valida (0 crediti)

1. Apri `https://github.com/uamisjd/dropalert-next/actions`.
2. Nella colonna di sinistra scegli **Verifica dati reali (manuale)** (§1).
3. A destra premi **Run workflow**.
4. *Use workflow from*: scegli il branch `arena/01a07663-dropalert-next`.
5. `Quale verifica` = **`smoke-odds`**, `match_id` **vuoto**, `ore` = `72`
   (l'intero orizzonte dell'archivio).
6. Premi **Run workflow** e apri l'esecuzione appena partita, passo
   **Smoke The Odds API**. La prima riga deve mostrare
   `MARKER-SMOKE-ODDS-BRANCH-v1`: conferma che gira il codice del ramo.

Nel log trovi una riga per ogni partita in archivio, ad esempio:

```
  #1234  sab 12/09, 20:45  Inter — Milan
          OK — evento unico sulla fonte: Inter — AC Milan (12/09, 20:45 ora italiana, id 9f2c…)
```

Cosa significano le etichette:

| Etichetta | Significato | Cosa fare |
|---|---|---|
| `OK` | la fonte ha **un solo** evento con quei nomi e quell'orario | questa partita va bene: usa il suo id |
| `GRAFIA INTERNA NON COMBACIATA` | i nostri nomi non contengono quelli della fonte | scegli un'altra partita, oppure correggi i nomi con le variabili descritte al §7 |
| `AMBIGUO` | la fonte ha più eventi con gli stessi nomi | scegli un'altra partita: nessuno dei due è preferibile |
| `NOMI PRESENTI MA ORARIO OLTRE 30 MINUTI` | nomi giusti, orario no | l'orario in archivio o quello della fonte è storto: verifica prima di spendere |
| `NON VERIFICATO` | l'elenco eventi di quel campionato non è arrivato | riprova più tardi |

Se non compare nessuna `OK`, la fonte non ha ancora pubblicato il turno:
riprova con `ore` = `120`, oppure in un altro giorno. **Non è un guasto
dell'adapter.**

In fondo al log c'è il riepilogo dei crediti spesi: deve dire `0`.

---

## 5. Passo 2 — smoke test (1 credito)

1. Stessa workflow (**Verifica dati reali (manuale)**), **Run workflow**,
   stesso branch.
2. `Quale verifica` = **`smoke-odds`**.
3. `match_id` = il numero visto nel passo precedente (es. `1234`).
4. **Run workflow**.

Lo script fa quattro cose, nell'ordine, e le stampa:

1. **pre-check di matching** — endpoint gratuito; se la partita non è
   riconoscibile si ferma qui **senza spendere il credito** (uscita `4`);
2. **lettura delle quote** — l'unica chiamata a pagamento: quote 1X2 per ogni
   bookmaker della regione `eu`;
3. **scrittura in `odds_snapshots`** — quote individuali, con bookmaker, fonte
   e orario della fonte;
4. **verifica di freshness** — rilegge la partita con lo stesso percorso della
   pagina (`getMatchDetail` + `executablePriceFromSeries`, soglia 90 minuti) e
   dice se esiste davvero una linea individuale fresca.

Esito atteso:

```
Esito
  chiamata reale        : riuscita
  matching partita      : verificato
  quote individuali     : salvate in odds_snapshots
  freshness             : verificata su 3 selezioni

SMOKE OK — gate superati su dati reali.
```

Codici di uscita:

| Codice | Significato | Crediti spesi |
|---|---|---|
| `0` | smoke test riuscito | 1 |
| `1` | chiamata, persistenza o freshness fallite | 1 |
| `2` | configurazione mancante (chiave, database, partita) | 0 |
| `4` | pre-check negativo: partita non riconoscibile | 0 |

---

## 6. Cosa uno smoke test riuscito **non** autorizza

- **Non** accende il provider. `ADAPTER_IMPLEMENTED` resta `false` e va cambiato
  solo in una PR separata, con i check verdi.
- **Non** trasforma il consensus in una quota eseguibile: sono due cose
  diverse e restano separate.
- **Non** aggiunge Kelly, stake o autobet: la UI non li mostra.
- **Non** cambia il contratto decisionale: senza prezzo eseguibile, fair
  indipendente, edge e freshness il sito dice **NO BET** o **OSSERVAZIONE**,
  con il motivo.

## 7. Se i nomi non combaciano

Il matching accetta i nomi che si contengono a vicenda, entro 30 minuti di
kickoff. Quando l'archivio usa un'abbreviazione ("Man Utd") e la fonte il nome
esteso ("Manchester United"), la lettura non parte. In quel caso si passano i
nomi reali della fonte come variabili, **solo per quella esecuzione**:

```bash
ODDS_API_SMOKE_MATCH_ID=1234 \
ODDS_API_SMOKE_HOME_TEAM="Manchester United" \
ODDS_API_SMOKE_AWAY_TEAM="Chelsea" \
npm run smoke:odds-api
```

Le variabili esplicite vincono su quelle derivate dall'archivio; ogni altro
valore (chiave sport, fixture, orario) continua ad arrivare dal database.
Su GitHub Actions si aggiungono come *Variables* del repository con gli stessi
nomi, oppure si esegue il comando in locale (§8).

Se la grafia interna è sbagliata in modo sistematico, la correzione giusta è
sull'anagrafica delle squadre, non un'eccezione nello smoke test.

## 8. Alternativa locale

Serve Node 22 e un `.env` nella root del progetto con `DATABASE_URL` e la
chiave (file già ignorato da git):

```bash
npm ci
npm run odds:find                     # 0 crediti
npm run smoke:odds-api -- --match-id 1234
```

Il Neon va raggiungibile dalla macchina: da pannello Neon, *Network Security*,
aggiungi l'IP pubblico oppure `0.0.0.0/0` solo per la durata del test, poi
rimuovilo. È il passaggio in più che rende questa strada più fragile di
GitHub Actions.

## 9. File coinvolti

| File | Ruolo |
|---|---|
| `src/scripts/find-odds-match.ts` | trova le partite leggibili, endpoint gratuito |
| `src/scripts/smoke-odds-api.ts` | la verifica live: chiamata, persistenza, freshness |
| `src/lib/providers/optional/the-odds-api-events.ts` | client dell'endpoint eventi (fuori quota) |
| `src/lib/providers/optional/odds-match-resolver.ts` | regole pure di matching e di risoluzione |
| `src/lib/providers/optional/the-odds-api-client.ts` | client delle quote (1 credito) |
| `src/lib/providers/ingest-snapshots.ts` | scrittura in `odds_snapshots` |
| `src/lib/decision/price-evidence.ts` | gate del prezzo eseguibile e della freshness |
| `.github/workflows/audit.yml` | workflow manuale che ospita la modalità `smoke-odds` |
| `.github/workflows/smoke-odds.yml` | versione dedicata, lanciabile solo dopo il merge su `main` |

## 10. Se ora non c'è una partita valida — non aspettare

Il database contiene solo le partite entro l'orizzonte di raccolta
(`COLLECT_HORIZON_HOURS`, default **72**). Se il giro trova «leggibili: 0» non
è un guasto: semplicemente il prossimo turno dei campionati coperti non è
ancora dentro la finestra. Due strade, in ordine di preferenza:

1. **Allarga la ricerca, gratis.** Rilancia il passo 1 con `ore` più alto (es.
   `168`). Non costa nulla: l'endpoint `/events` è fuori quota. Serve però che
   la partita esista già in archivio, quindi da sola non basta se il turno è
   oltre le 72h già raccolte.

2. **Allarga l'orizzonte di raccolta, una volta sola.** Fai entrare nel
   database il turno successivo così lo smoke test può usarlo subito:
   1. *Settings → Secrets and variables → Actions → Variables* →
      **New repository variable**: `COLLECT_HORIZON_HOURS` = `168`.
   2. *Actions → Osservazione DropAlert → Run workflow* con `force = true` e
      aspetta che finisca (qualche minuto): ora in archivio ci sono anche le
      partite dei prossimi 7 giorni.
   3. Rilancia il passo 1 (`ore = 168`): compariranno le `OK` dei campionati
      coperti.
   4. Esegui lo smoke test (§5) con l'id scelto.
   5. Se vuoi tornare al comportamento consueto, riporta
      `COLLECT_HORIZON_HOURS` a `72` (o elimina la variabile). Le partite già
      raccolte restano, quindi lo smoke test funziona comunque.

Allargare l'orizzonte aumenta le righe lette da BetExplorer in **un solo giro**;
non cambia il budget di The Odds API, che resta governato da
`odds-api-budget.ts` (lo smoke test costa 1 credito in tutto).

## 11. Esito del primo smoke test live (06/09/2026)

Eseguito su GitHub Actions (run `34036327654`) contro una partita **vera** già
in archivio e presente sulla fonte: `#569 Hearts — Dundee FC`
(`Scotland: Premiership`, chiave `soccer_spl` fornita come override perché fuori
dalla mappa di budget). Costo totale: **1 credito** (pre-check gratuito + una
lettura h2h×eu).

| Gate | Risultato osservato |
|---|---|
| Chiamata reale | riuscita: 54 quote su 18 bookmaker |
| Matching | evento unico, kickoff 2026-09-06T14:00Z verificato entro la tolleranza |
| Persistenza | 54 snapshot in `odds_snapshots`, 0 duplicati, 18 anagrafiche bookmaker |
| Freshness | linee individuali eseguibili (es. home 1.470 da `betfair_ex_eu`), età 0 min < soglia 90 |

Cosa **non** dimostra: non valida il percorso di produzione sui campionati
coperti (Serie A, EPL, …), che al momento dello smoke non avevano partite con
quote vive in archivio. Quella verifica è eseguibile con la lettura di
controllo (§12), anche prima che il turno entri nei movimenti grazie al
ripiego dalla fonte (§13). Non accende il provider: `ADAPTER_IMPLEMENTED`
resta `false` e l'attivazione è una PR separata.

## 12. Lettura di controllo sul percorso di produzione

Prima di impostare `ODDS_ADAPTER_IMPLEMENTED=true`, si valida il percorso che
userà la produzione — `getSharpLine` (vista budget → mappa `sportKeyFor` →
decisione `decide` → lettura reale → contatori in `system_state` → snapshot) —
su un campionato **coperto**. Strumento: `src/scripts/control-sharp-read.ts`,
lanciato dalla workflow con `which = control` (o in locale `npm run odds:control`).

- Se l'archivio ha partite coperte, legge da lì: **una** lettura (1 credito) e
  stampa budget prima/dopo, book sharp, prezzo e verdetto — la conferma che
  mapping, contatori e matching funzionano nel percorso reale.
- Se l'archivio è vuoto, da adesso **non aspetta il turno**: parte il ripiego
  «dalla fonte» (§13), che sceglie la partita con l'endpoint gratuito `/events`
  sulle chiavi coperte e poi esegue la stessa lettura di produzione (1 credito).
- `--solo-archivio` ripristina il vecchio comportamento garantito a 0 crediti
  («NESSUNA PARTITA DI CAMPIONATO COPERTO» e stop).

`signalActive` è passato `true` in modo dichiarato: è una lettura di controllo
voluta, non un segnale del monitor. I tetti mensili/giornalieri restano quelli
di `odds-api-budget.ts`.

## 13. Ripiego «dalla fonte» (06/09/2026)

Il 06/09/2026 la Serie A era in campo ma l'archivio BetExplorer (`matches`)
non conteneva partite coperte nella finestra: la lettura di controllo si
fermava a «NESSUNA PARTITA» pur essendoci partite reali leggibili. Il collo di
bottiglia era la *scelta* della partita, non la lettura: `getSharpLine` non
tocca mai `matches` (persiste in `system_state` con chiave di stringa, senza
vincoli esterni).

Il ripiego separa le due cose:

1. **Scelta** — `GET /sports/{key}/events` sulle chiavi coperte
   (`COVERED_SPORT_KEYS`, Serie A prima): endpoint gratuito, fuori quota, il
   costo dichiarato dalla fonte viene letto dagli header e stampato; se un
   giorno addebitasse qualcosa, il log lo dice.
2. **Lettura** — identica al percorso di produzione: `getSharpLine` con
   `signalActive: true`, 1 credito, contatori e snapshot in `system_state`.

La partita nata dalla fonte riceve un **id sintetico negativo**
(`syntheticMatchId`, derivato deterministicamente dall'id evento): non collide
con i serial positivi di `matches` e, rilanciando nello stesso giorno, ritrova
la propria fotografia in cache invece di rispendere il credito.

Comandi:

    npm run odds:control                      # archivio, poi ripiego automatico
    npm run odds:control -- --sport-key soccer_italy_serie_a   # ripiego mirato
    npm run odds:control -- --solo-archivio   # solo archivio, 0 crediti

Nella workflow: `which = control`, con `sport_key` facoltativo per mirare il
ripiego. Le funzioni pure (`syntheticMatchId`, `pickUpcomingEvent`) vivono in
`src/lib/repo/control-fallback.ts`, testate da `npm run test:control-fallback`.

Cosa dimostra il ripiego: mapping chiave→fonte, decisione budget, lettura
reale, contatori e snapshot sul percorso di produzione, su un campionato
coperto *vero* (nome e orario presi dalla fonte). Cosa non dimostra: che la
partita fosse già in archivio, cioè che il collettore BetExplorer l'avesse
vista — per quello resta valido il lancio con archivio popolato.

## 14. Esito della lettura di controllo con ripiego (06/09/2026)

Run `34039039441` (workflow *Verifica dati reali (manuale)*, `which=control`,
marcatore `MARKER-CONTROL-READ-v2`), finestra 72 h.

- Archivio vuoto sul turno corrente → ripiego dalla fonte.
- `[soccer_italy_serie_a]` 16 eventi in programma dalla fonte.
- Partita scelta: **Bologna — Sassuolo**, dom 06/09 18:00 (ora italiana);
  id evento `60776ba6c26557c9c5e6a34ae72e2ec8`, id sintetico `-1618439078`.
- Percorso: `getSharpLine` (budget → mappa → decisione → lettura → contatori).
- Budget dopo la lettura: mese **7/490**, oggi **3** (quota odierna 14).
- ESITO: **linea sharp letta sul percorso di produzione** — book sharp
  `pinnacle`, prezzo `1.95` (1x2/home), book osservati 24.
- Verdetto: «non osservabile» — atteso e dichiarato: la lettura di controllo
  passa consensus null (la partita non esiste in archivio, il sito non ha una
  sua linea di consenso da confrontare). In produzione, con la partita in
  archivio, il verdetto torna osservabile; il contratto price-evidence resta
  l'autorità sul NO BET.
- Costo: 1 credito (la scelta dalla fonte è gratuita).

Cosa dimostra: il mapping della Serie A sulla fonte, la decisione di budget,
il matching sui nomi reali della fonte, la lettura reale, l'incremento dei
contatori in `system_state` e la scrittura della fotografia — tutto sul
percorso di produzione, su un campionato coperto vero. Con questo esito il
piano autorizza la PR di attivazione controllata (interruttore env, default
spento), da mergiare solo con check verdi e ok esplicito.

## 15. Prima lettura di controllo post-attivazione (06/09/2026) — e la collisione «Brazil: Serie A»

Run `34046688765` (workflow *Verifica dati reali (manuale)*, `which=control`,
`ore=168`), il primo lanciato **da `main`** dopo l'attivazione in produzione.
Inizio 16:49 UTC, 33 s, esito `success`.

Fatti verificati (annotazioni del run via API + pannello budget del sito):

- `origine: ARCHIVIO — partita #661 dom 06/09, 21:00 Remo — Flamengo RJ`:
  con l'orizzonte di raccolta a 168 h l'archivio conteneva già partite del
  turno brasiliano, e la prima ritenuta «coperta» era questa (nessuna Serie A
  italiana era ancora in archivio: Juventus—Milan restava in «quote in
  arrivo»).
- `ESITO: linea sharp letta sul percorso di produzione` — ma la lettura era
  **vuota**, ed è qui che il controllo ha fatto il suo lavoro.
- Budget: **7/490 → 8/490 mese, 3/14 → 4/14 oggi** (verificato sul pannello
  home prima e dopo): 1 credito speso, contatori esatti.

Diagnosi (dal codice, riscontrabile nel Summary del run: `book sharp:
nessuno`, `prezzo: n.d.`, `verdetto: non osservabile`, `book osservati: 0`):
la partita è del campionato brasiliano, che la fonte BetExplorer etichetta
«Brazil: Serie A»; la regex della mappa cercava solo «serie a» e quindi la
classificava coperta con la chiave **della Serie A italiana**
(`soccer_italy_serie_a`). La lettura è partita sulla chiave sbagliata, la
fonte ha risposto con le partite italiane, il matching per nomi (Remo /
Flamengo RJ) non ha trovato nessun evento corrispondente e la fotografia
scritta è vuota: credito pagato, nessun dato. È la stessa classe di errore
della CAF Champions League scambiata per la UEFA CL (§ test «coppa
travestita»), prima non prevista per i campionati omonimi di altri paesi
(Brazil: Serie A, Ecuador: Serie B, i Premier League di Bahrain/Giordania/
Kuwait/Singapore/Ucraina, NIFL Championship…).

Correzione nello stesso ramo di sessione (verificata da test dedicati):

1. `sport-keys.ts`: la mappa ora confronta **paese e lega** («Paese: Lega» è
   il formato reale dell'archivio) con pattern ancorati; un nome senza paese
   non decide nulla (null = nessun credito). «Brazil: Serie A» e soci non
   collidono più; la coperta «England: Championship» non cambia.
2. `control-sharp-read.ts`: una lettura pagata ma vuota (nessun book, nessun
   prezzo) ora stampa `ESITO: lettura pagata ma NESSUNA linea` ed esce in
   errore: un controllo che dicesse «linea letta» su una fotografia vuota
   nasconderebbe il guasto che deve trovare. Il credito resta contato (il
   provider lo addebita comunque) e la fotografia vuota resta in cache per
   la giornata: è la protezione del budget, non un dato.

Cosa resta da fare dopo il merge: rilanciare `which=control` da `main` per
convalidare il percorso su una partita coperta vera (in archivio o, in
assenza, via ripiego dalla fonte: la prima in programma stasera era
Juventus—Milan). La fotografia vuota di #661 scade da sola a fine giornata
italiana e non è mostrata da nessuna pagina (la partita non ha segnale).
