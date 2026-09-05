# DropAlert — Osservatorio statistico sui movimenti di quota

DropAlert è un **osservatorio statistico**: registra come si muovono le quote del
calcio, misura quanto è solido ogni movimento e verifica nel tempo la propria
attendibilità tramite il CLV.

**Non è** un servizio di pronostici, non promette esiti e non fornisce consigli
di scommessa. Ogni scheda descrive un fenomeno di mercato osservato, dichiara i
dati che mancano e mostra la scomposizione del punteggio.

---

## Metodo

### Probabilità implicita

```
probabilità implicita = 1 / quota decimale
```

Tutti i confronti avvengono in **punti percentuali (pp) di probabilità
implicita**, non in variazione di quota: 2.00 → 1.90 e 5.00 → 4.90 sono
movimenti molto diversi, e solo la probabilità implicita lo rende evidente.

Un delta **positivo** significa probabilità implicita in salita, cioè **quota in
calo**: è il drop.

### Soglie di ampiezza

| Movimento | Classe | Significato |
|---|---|---|
| < 2 pp | `noise` | rumore, non è un segnale |
| 2 – 5 pp | `moderate` | movimento moderato |
| 5 – 10 pp | `high` | movimento alto |
| > 10 pp | `very_high` | movimento molto alto |

### Cosa rende un movimento credibile

1. **Coordinazione** — un drop confermato da più bookmaker pesa più di un
   movimento isolato. Un solo book non produce mai coordinazione.
2. **Conferma sharp** — i libri a bassa marginalità e limiti alti sono la
   verifica indipendente. Se mancano, il sistema lo dichiara e non stima.
3. **Tenuta temporale** — un movimento concluso in meno di 30 minuti è *flash*
   e riceve fiducia ridotta; un livello mantenuto per ore riceve fiducia
   superiore.
4. **Rimbalzo** — se il prezzo restituisce oltre il 50% del movimento massimo,
   è un **falso segnale parziale** e il punteggio viene fortemente penalizzato.
5. **Copertura dati** — quanti book, quanto storico, quale profondità. Una
   copertura sotto 0.35 forza la banda `insufficient_data`.

### Punteggio di fiducia (0–100)

| Componente | Peso |
|---|---|
| Ampiezza | 30 |
| Coordinazione fra bookmaker | 25 |
| Conferma linea sharp | 20 |
| Tenuta nel tempo | 15 |
| Copertura dei dati | 10 |

Il punteggio misura **la solidità dell'osservazione**, non la probabilità che
l'esito si verifichi.

### CLV — l'unica misura di validità

```
clvPp  = (probabilitàChiusura − probabilitàSegnale) × 100
clvPct = quotaSegnale / quotaChiusura − 1
```

Un segnale è utile se la quota rilevata **batte la quota di chiusura**. Sotto le
10 osservazioni il sistema dichiara il campione insufficiente e non pubblica
intervalli di confidenza.

#### Chiusura fair, senza margine

La quota di chiusura pubblicata contiene il margine del bookmaker: confrontarla
con la quota rilevata misura due cose insieme, il movimento del mercato e il
margine applicato. Quando l'insieme completo delle selezioni di un mercato è
disponibile per lo stesso bookmaker, il margine viene rimosso per via
proporzionale e il CLV è calcolato contro la **chiusura fair no-vig**.

La base usata è sempre registrata accanto al valore:

| `closing_basis` | Significato |
|---|---|
| `fair_novig` | margine rimosso, confronto fra stime di probabilità |
| `raw_consensus` | mercato incompleto: confronto contro la chiusura grezza, margine incluso |

Il mercato incompleto **non** viene completato con stime: si ripiega sulla base
grezza e lo si dichiara. Il riepilogo del CLV è disaggregato per fascia
dell'indice di fiducia (0–24, 25–49, 50–74, 75–100) per verificare se un indice
più alto corrisponde davvero a un CLV migliore; sotto le 10 osservazioni la
fascia è marcata `underpowered` e non viene commentata.

---

## Stack

- **Next.js 16** (App Router) + React 19
- **PostgreSQL 17** locale — nessun servizio a pagamento richiesto
- **Drizzle ORM** + drizzle-kit per le migrazioni
- **Tailwind CSS 4**
- **TypeScript** in strict mode
- Test con runner interno, zero dipendenze esterne

---

## Struttura

```
src/
├── db/
│   ├── schema.ts        12 tabelle, enum, tipi inferiti
│   ├── client.ts        connessione postgres-js condivisa
│   └── seed.ts          anagrafiche + scenari dimostrativi
├── lib/
│   ├── drop/
│   │   ├── constants.ts soglie e pesi dichiarati, ENGINE_VERSION
│   │   ├── math.ts      aritmetica delle quote, null-safe
│   │   ├── types.ts     contratti del motore
│   │   ├── engine.ts    ampiezza, coordinazione, sharp, persistenza, fiducia
│   │   ├── clv.ts       CLV singolo e aggregato con IC 95%
│   │   └── __tests__/   40 test
│   ├── push/
│   │   ├── pure.ts      regole pure: soglia, dedupe, testo dell'avviso
│   │   └── live.ts      dato vivo con cui si confronta la soglia
│   ├── tools/
│   │   ├── margin.ts    margine, trattenuta, quote fair (3 metodi)
│   │   └── stake.ts     pareggio, rendimento atteso, Kelly, varianza
│   └── repo/
│       └── odds.ts      lettura serie storiche dal DB
└── scripts/
    └── verify-scenarios.ts  verifica end-to-end DB → motore
```

## Schema dati

| Tabella | Ruolo |
|---|---|
| `leagues`, `teams`, `matches` | anagrafiche |
| `bookmakers` | con flag `is_sharp` e peso di coordinazione |
| `odds_snapshots` | serie storica append-only, fonte di verità |
| `closing_lines` | ultimo prezzo prima del kickoff, base del CLV |
| `drop_signals` | movimento osservato con metriche e spiegazione jsonb |
| `signal_events` | audit trail di ogni cambio di stato |
| `clv_records` | confronto segnale / chiusura |
| `collector_runs` | osservabilità dei job |
| `data_gaps` | registro esplicito di ciò che manca |
| `source_health` | salute per fonte: latenza, errori, fallback, stato |
| `system_state` | cursori e stato dei job |

## Comandi

```bash
npm run dev              # sviluppo
npm run build            # build di produzione
npm run start            # server di produzione
npm run typegen          # next typegen
npm run typecheck        # tsc --noEmit
npm run test             # test del motore (puro, senza DB)
npm run test:pipeline    # test della pipeline (richiede PostgreSQL)
npm run test:providers   # test delle fondamenta dei collector
npm run test:betexplorer # test dell'adapter su HTML reale congelato
npm run test:tools       # strumenti di calcolo (margine, varianza)
npm run test:value-lines   # come si costruisce una linea di prezzo per il divario (puro)
npm run test:line-shape    # la forma reale delle linee 1X2, sull'HTML congelato del provider
npm run test:filters       # i filtri di /value-bets: «mostra i negativi» non è un pavimento
npm run test:client      # componenti in un DOM reale (jsdom + React 19)
npm run test:all         # tutte le suite (29)
npm run job:analyze      # solo analisi + chiusura, senza rete
npm run job:collect      # giro completo: raccolta + analisi + chiusura + notifiche
npm run job:collect -- --force         # ignora l'intervallo minimo
npm run job:collect -- --no-collect    # solo consolidamento, nessuna rete
npm run job:collect -- --collect-only --max 10 --no-results
npm run job:verify-results       # verifica partita → risultato su dati reali
npm run audit:value-bets         # verifica della pagina «Divario di prezzo»: 6 controlli (kickoff futuro, verdetti, fair reale, nessun pavimento)
npm run audit:finished           # audit dello storico «partite finite» (solo letture, markdown su stdout)
npm run study:finished           # studio quantitativo sui CSV congelati (zero rete, zero DB)
npm run validate         # typegen + typecheck + test + build
npm run db:generate      # genera migrazione da schema.ts
npm run db:migrate       # applica migrazioni
npm run db:seed          # anagrafiche
npm run db:seed -- --demo        # + scenari dimostrativi
npm run db:seed -- --clean-demo  # rimuove i dati dimostrativi
```

### Database locale

```bash
/usr/lib/postgresql/17/bin/postgres -D /home/user/pgdata
# DATABASE_URL=postgres://dropalert@127.0.0.1:5433/dropalert
```

## API interne

Tutte le rotte restituiscono JSON e dichiarano sempre i dati mancanti invece
di colmarli con stime.

| Rotta | Metodo | Descrizione |
|---|---|---|
| `/api/signals` | GET | elenco dei segnali, filtrabile |
| `/api/signals/[id]` | GET | dettaglio: 5 criteri, eventi, CLV, buchi dati |
| `/api/health` | GET | stato del sistema, salute delle fonti, buchi aperti |
| `/api/jobs/analyze` | POST | esegue un giro completo (raccolta, analisi, chiusura), tracciato in `collector_runs` |
| `/api/jobs/analyze` | GET | 405, ma restituisce la configurazione attiva dello scheduler |

Filtri di `/api/signals`: `status`, `minScore`, `market`, `magnitude`,
`demo=1`, `limit`, `offset`. **I dati dimostrativi sono esclusi per
impostazione predefinita** e, quando richiesti, restano marcati
`match.isDemo = true` in ogni elemento della risposta.

### Protezione del job

`POST /api/jobs/analyze` richiede l'header `x-jobs-token` se la variabile
d'ambiente `JOBS_TOKEN` è impostata. Se non lo è, la rotta è **disabilitata in
produzione** e risponde 401: un job che scrive sul database non deve mai
restare aperto per errore di configurazione.

```bash
curl -X POST http://localhost:3000/api/jobs/analyze \
  -H 'x-jobs-token: <token>' -H 'content-type: application/json' -d '{}'
```

Il job è **idempotente**: rieseguirlo aggiorna i segnali esistenti senza
duplicarli e non riscrive mai `detected_price`, il prezzo congelato al primo
rilevamento che fa da riferimento onesto per il CLV.

## Strumenti di calcolo (`/strumenti`)

È la sola parte del sito che tocca il betting in modo esplicito, e resta dentro
l'identità dell'osservatorio: **misura, non consiglia**.

| Strumento | Che cosa risponde |
|---|---|
| Margine e quota fair | Quanto margine contiene un insieme di quote (overround, margine in punti, trattenuta) e che cosa resta togliendolo, con tre metodi a confronto: proporzionale, additivo, power. |
| Peso della varianza | Punto di pareggio a una quota, rendimento atteso, frazione di Kelly e distribuzione dei risultati su N sequenze simulate. |

Regole che valgono per entrambi:

- **nessuna selezione indicata**: i numeri li inserisce chi legge, il sito non
  sceglie partite, mercati né esiti;
- **nessun operatore**: niente link, bonus, promozioni o confronti fra
  concessionari, in nessuna pagina;
- **nessun dato**: tutto il calcolo avviene nel browser;
- **un metodo non applicabile lo dichiara**: il metodo additivo su un mercato
  molto sbilanciato può produrre una probabilità non positiva, e allora restituisce
  il motivo invece di forzare un valore a zero;
- **la simulazione è deterministica**: seme fisso e dichiarato, quindi il
  risultato è riproducibile da chiunque e verificabile nei test.

La distinzione fra **margine** e **trattenuta** non è un dettaglio: coprire tutti
gli esiti alle quote pubblicate restituisce `1 − 1/overround`, cioè la trattenuta,
non il margine. Il calcolatore mostra entrambi e dice quale è quale.

Dettagli e motivazioni in [`docs/STRUMENTI-BETTING.md`](docs/STRUMENTI-BETTING.md).

---

## Notifiche

L'avviso per una partita seguita che supera la soglia personale è una **fase del
ciclo di osservazione**, non una rotta separata: lo scheduler che raccoglie è lo
stesso che notifica.

- la soglia si confronta con l'indice **normalizzato sulla base misurabile**, lo
  stesso numero della card e di `/preferite` — una sola scala per tutti i canali;
- massimo una notifica per partita al giorno per iscrizione, con dedupe a
  registro;
- senza chiavi VAPID la fase lo dichiara (`configured: false`) invece di fallire:
  il giro di raccolta non dipende dalle notifiche;
- l'esito della fase è stampato dal CLI e scritto in `collector_runs.meta`.

| Variabile | Default | Effetto |
|---|---|---|
| `VAPID_PUBLIC_KEY` | *(assente)* | senza, le notifiche restano spente e la UI lo dichiara |
| `VAPID_PRIVATE_KEY` | *(assente)* | idem |

---

## Stati di un segnale

| Stato | Significato |
|---|---|
| `forming` | movimento visto ma non ancora consolidato (flash incluso) |
| `active` | movimento significativo e ancora in essere |
| `rebounded` | il prezzo è rientrato: falso segnale parziale |
| `closed` | partita iniziata, closing line acquisita |
| `expired` | i dati non sono più sufficienti a sostenerlo |

Un segnale non viene mai cancellato: cambia stato e lascia una riga in
`signal_events`.

## Dati dimostrativi

Gli scenari di seed sono **sintetici e dichiarati tali**: chiavi prefissate
`demo-`, snapshot con `source = "seed-demo"`. Servono a verificare che il motore
distingua i casi limite (drop coordinato, flash rientrato, movimento isolato,
rumore) e sono rimovibili in blocco. Non rappresentano partite reali.

## Fonti dei dati

### BetExplorer (attiva, nessuna chiave richiesta)

Fonte principale, letta da `/dropping-odds/` per le partite in movimento e
dalle pagine `/results/` per i risultati. I tornei minori sono coperti:
sono il cuore del monitor.

**Cosa questa fonte può dare**: partite, campionato, quota 1X2 di
consenso, quota di apertura della selezione in calo, accordo fra
bookmaker così come pubblicato dalla fonte (`B's: 18/19`), risultati.

**Cosa NON può dare**: le quote dei singoli bookmaker. Vivono dietro
endpoint con query string che abbiamo scelto di non interrogare. Perciò:

- le quote sono registrate sotto il bookmaker sintetico
  `betexplorer-consensus`, dichiarato non-sharp;
- **la coordinazione fra book e la conferma della linea sharp non sono
  calcolabili**: ogni partita raccolta apre un `data_gaps`
  `bookmaker_missing` che lo dichiara;
- `sharpConfirms` resta `null` — che significa "non osservato", non "no".

Nessun valore viene stimato per colmare questi buchi. Una fonte
multi-bookmaker potrà essere aggiunta in futuro come nuovo adapter, senza
toccare il motore.

**L'orario di inizio** viene letto dal JSON-LD della pagina partita, che
dichiara il fuso. Gli orari dell'elenco non lo dichiarano e sono sfasati:
se il JSON-LD manca, la partita viene esclusa e il buco dichiarato,
invece di salvare un orario indovinato.

**Scraping educato**: User-Agent identificabile, 12 richieste/minuto,
intervallo minimo di 4 secondi, backoff sugli errori, circuit breaker,
nessuna query string, mai i percorsi vietati dal `robots.txt`. L'elenco
drop è messo in cache 30 secondi: un giro di raccolta fa una sola
richiesta invece di una per partita.

### the-odds-api (opzionale, spenta di default)

Dichiarata nel registry ma disattivata: il piano gratuito non regge un
polling frequente. Richiede `ODDS_API_ENABLED=true` e `ODDS_API_KEY`.
Il sistema funziona senza di essa e senza alcuna chiave API.

### Variabili d'ambiente delle fonti

| Variabile | Default | Effetto |
|---|---|---|
| `BETEXPLORER_ENABLED` | `true` | spegne la fonte principale |
| `BETEXPLORER_RPM` | `12` | richieste al minuto |
| `BETEXPLORER_MIN_INTERVAL_MS` | `4000` | intervallo minimo fra richieste |
| `BETEXPLORER_LISTING_TTL_MS` | `30000` | validità della cache dell'elenco |
| `ODDS_API_ENABLED` | `false` | accende the-odds-api (serve la chiave) |

### Variabili d'ambiente del Contesto 360°

| Variabile | Default | Effetto |
|---|---|---|
| `LLM_API_KEY` | *(assente)* | chiave Gemini (free tier): senza, il contesto dichiara «non disponibile — chiave non configurata» |
| `RSS_FEEDS` | *(assente)* | feed RSS pubblici (URL separati da virgola, max 3) per le notizie accanto al contesto |

Il Contesto 360° non entra nel punteggio: cache 24h per partita, tetto
giornaliero di 50 chiamate con hard-stop dichiarato nel pannello.

### Variabili d'ambiente dello scheduler

| Variabile | Default | Effetto |
|---|---|---|
| `COLLECT_INTERVAL_MINUTES` | `15` | intervallo minimo fra due raccolte (minimo assoluto 5) |
| `COLLECT_HORIZON_HOURS` | `72` | quanto avanti guardare nel calendario |
| `COLLECT_MAX_FIXTURES` | `25` | tetto di partite per giro |
| `COLLECT_WITH_RESULTS` | `true` | aggiorna anche i risultati finali |

---

## Scheduling

**Non esistono processi long-lived.** Un giro è una funzione che parte,
raccoglie, analizza, chiude e termina. La ripetizione è delegata a uno
scheduler esterno gratuito: GitHub Actions cron (workflow già pronto in
`.github/workflows/collect.yml`) oppure il cron della piattaforma di hosting.

L'intervallo minimo è applicato **dal codice**, non dal cron: `shouldRunNow()`
confronta l'istante corrente con `system_state['scheduler:last_cycle']` e salta
la raccolta se è troppo presto. Un cron troppo fitto, un retry o due
invocazioni manuali ravvicinate non producono traffico aggiuntivo verso la
fonte — il giro passa direttamente ad analisi e chiusura, che sono operazioni
locali.

Limiti reali dichiarati (GitHub Actions): intervallo minimo **5 minuti**,
nessuna garanzia di puntualità, schedule **disattivate dopo 60 giorni** di
inattività sui repository pubblici, ~2.000 minuti/mese sui privati nel piano
Free. Dettagli, alternative e strategia di degradazione in
**[`docs/SCHEDULING.md`](docs/SCHEDULING.md)**.
ok
