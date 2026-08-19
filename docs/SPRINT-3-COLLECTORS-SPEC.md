# Specifica collector — vincolante per lo Sprint 3

Decisione presa dal committente. Questo documento è la fonte di verità per
l'implementazione dei collector: va letto prima di scrivere qualsiasi adapter.

## Strada scelta

Interfaccia `OddsProvider` pulita **+ primo adapter reale su fonti pubbliche
gratuite**. Nessuna API a pagamento, nessun servizio obbligatorio.

## Vincoli

1. **Contratto unico.** `OddsProvider` deve avere lo stesso contratto per ogni
   fonte. Aggiungere una fonte non deve comportare alcuna modifica al motore
   (`src/lib/drop/*`) né allo schema. Il motore consuma solo `BookmakerSeries`.

2. **Primo adapter reale: fonti pubbliche gratuite.** Scraping/parsing di
   pagine pubbliche, nello stile di:
   - fonte tipo *Livescore* → calendario partite, stato, risultati;
   - fonte tipo *BetExplorer* → quote multi-bookmaker e dropping odds.

3. **the-odds-api NON è la fonte principale.** Il free tier (~500 richieste/mese)
   non regge il polling a 90 secondi su più leghe. Va predisposto come adapter
   **opzionale e disattivato di default** (`enabled: false`, attivabile solo da
   variabile d'ambiente esplicita).

4. **Osservabilità obbligatoria.** Ogni adapter registra su `source_health` e
   `collector_runs`: latenza per richiesta, tasso di errore, ultimo successo,
   attivazione di fallback, stato circuito (ok / degradato / bloccato).

5. **Mai dati simulati spacciati per reali.** Se una fonte non risponde il
   sistema espone **DATI PARZIALI** o **FONTE BLOCCATA**, registra un
   `data_gaps` e abbassa la copertura. Non si interpola, non si stima, non si
   riempie il buco.

## Contratto previsto (bozza, da finalizzare in Sprint 3)

```ts
interface OddsProvider {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  /** limiti dichiarati dalla fonte, usati dallo scheduler */
  readonly rateLimit: { requestsPerMinute: number; minIntervalMs: number };

  fetchFixtures(window: DateRange): Promise<ProviderResult<FixtureDTO[]>>;
  fetchOdds(fixture: FixtureRef): Promise<ProviderResult<OddsQuoteDTO[]>>;
  fetchResults(window: DateRange): Promise<ProviderResult<ResultDTO[]>>;
  healthCheck(): Promise<ProviderHealth>;
}

/** Nessuna eccezione silenziosa: l'esito parziale è un valore, non un errore. */
type ProviderResult<T> =
  | { ok: true; data: T; latencyMs: number; partial: false }
  | { ok: true; data: T; latencyMs: number; partial: true; missing: string[] }
  | { ok: false; error: ProviderError; latencyMs: number; retryable: boolean };
```

## Precondizioni già soddisfatte

- `collector_runs` e `data_gaps` esistono dallo Sprint 1;
- `source_health` introdotta nello Sprint 2;
- `odds_snapshots` è append-only con colonna `source`: la provenienza di ogni
  dato è tracciata per costruzione.

---

# Addendum — esito della ricognizione (Sprint 3A, 18.08.2026)

Verificato sul campo con richieste reali, UA `DropAlertBot/1.0`, `sleep`
fra le richieste. Questi vincoli sono **fatti misurati**, non ipotesi.

## 1. LiveScore non è utilizzabile per il calendario

`robots.txt` vieta `/api/`, ed è da lì che la pagina carica le partite.
L'HTML iniziale contiene solo menu di navigazione (squadre e campionati
popolari), nessuna partita. **Il vincolo "LiveScore per le partite" non è
realizzabile con scraping educato** ed è stato ritirato dal committente.
Fonte unica: BetExplorer, per partite, quote e risultati.

## 2. BetExplorer non espone quote per singolo bookmaker (entro robots)

| Pagina | Esito | Contenuto utile |
|---|---|---|
| `/dropping-odds/` | 200, 171 KB | squadre, campionato, data/ora, selezione 1X2 scesa, apertura → corrente, % drop, accordo book "17/21" |
| `/football/<paese>/<lega>/` | 200, 157 KB | solo quota media di consenso |
| `/football/.../<slug>/<id>/` | 200, 109 KB | **zero quote** (0 occorrenze `data-odd`) |
| `.../<id>/odds/`, `/odds-movements/`, `/odds/1x2/` | 404 | — |
| `.../<id>/1x2/` | 301 → pagina base | — |

Le quote per book stanno dietro endpoint AJAX con query string
(`?matchid=...`), **vietati dal robots.txt**. Non esiste una via lecita.

**Conseguenza accettata dal committente:** si registra una serie di
**consenso dichiarata** (`betexplorer-consensus`, `isSharp = false`),
costruita nel tempo dal nostro polling — ogni punto è un'osservazione
reale, non una stima.

Quindi, e va detto nell'interfaccia:
- `sharpConfirms` resta **`null`** (non calcolabile), mai `false`;
- la **coordinazione non entra nel punteggio** finché non esiste una fonte
  per-book; estendere il motore sarà una modifica separata e documentata;
- resta aperto un `data_gaps` `bookmaker_missing` dichiarato;
- il campo reale "B's: 17/21" pubblicato dalla fonte viene **salvato come
  metadato osservato** (`OddsQuoteDTO.agreement`), non usato per calcolare.

## 3. Attenzione al vocabolario degli URL

BetExplorer usa `/football/`, **non** `/soccer/`. `/next/soccer/` → 301.

## 4. Fusi orari

Gli orari nella pagina non dichiarano il fuso: `FixtureDTO` porta
`kickoffIsAssumedUtc` per non far scoprire tardi l'approssimazione.

---

## Addendum — esito del passo 3B (adapter BetExplorer reale)

Scritto il 18.08.2026, dopo la prima raccolta reale riuscita.

### Scoperte sul campo che hanno cambiato il progetto

Tre cose sono emerse solo interrogando la fonte vera, e vanno ricordate
perché non sono deducibili dal markup a colpo d'occhio.

**1. La data nell'elenco drop non è la data della partita.**
Le righe `table-main__date` appartengono al gruppo di un singolo sport, e
le righe di calcio sono intercalate ad altri sport. Riportare "l'ultima
data vista" attribuisce alla partita la data di un gruppo diverso.
Verificato una per una su 4 partite: la data ereditata era **sbagliata in
3 casi su 4** (es. `Stt1j9GP` risultava 20.08, in realtà 18.08).
Conseguenza: quel campo si chiama `listedDateHint` ed è usato solo per
diagnostica.

**2. L'orario dell'elenco non dichiara il fuso ed è sfasato.**
Elenco: `21:00`. Pagina partita: `2026-08-18T22:00:00+02:00`. Non è stata
applicata nessuna correzione fissa: un offset dedotto è un valore
inventato. L'unico orario usato è `startDate` del JSON-LD della pagina
partita, che dichiara il fuso. **Se manca, la partita viene esclusa e il
buco dichiarato**, mai salvata con un orario indovinato.

**3. Le quote per singolo bookmaker restano irraggiungibili.**
Stanno dietro endpoint AJAX con `?matchid=`. Il robots.txt vieta una lista
di parametri (`?match=`, `?page=`, …) che alla lettera **non** copre
`?matchid=`. Abbiamo scelto una politica **più severa della regola**:
nessuna query string su questo host, nessuna eccezione. Sfruttare il buco
di una regola per raggiungere proprio i dati protetti sarebbe scorretto.

### Conseguenza sul modello dei dati

La fonte dà **solo la quota di consenso**, registrata sotto il bookmaker
sintetico `betexplorer-consensus` (`isSharp = false`). Perciò:

- `perBookmakerOdds = false`, dichiarato nel registry e in `/api/health`;
- **coordinazione fra book e conferma della linea sharp NON sono
  calcolabili**: ogni partita raccolta apre un `data_gaps` di tipo
  `bookmaker_missing` che lo dice esplicitamente;
- il dato reale `B's: 18/19` viene salvato come metadato osservato
  (`agreement`), non trasformato in un numero di book confermanti;
- la serie storica nasce dal **nostro polling ripetuto**: ogni rilevazione
  è un punto realmente osservato in quell'istante.

### Cortesia verso la fonte

- User-Agent identificabile con natura e intenzioni del progetto;
- 12 richieste/minuto, intervallo minimo 4 s, entrambi configurabili;
- l'elenco drop (una pagina da ~160 KB che contiene le quote di TUTTE le
  partite) è messo in cache per 30 s: un giro di raccolta su N partite
  fa **una sola** richiesta invece di N;
- backoff e circuit breaker ereditati dal passo 3A;
- 403 = blocco (non si ritenta), 429 = limite (si rispetta l'attesa).
