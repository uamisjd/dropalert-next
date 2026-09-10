# Handoff — DropAlert: stato lavori, infrastruttura live, cosa continuare

> Documento di continuità fra sessioni di lavoro. Ultimo aggiornamento: **2026-09-10**.
> **Leggi prima §0** (ripartenza di oggi): dice dove siamo, cosa è acceso e
> cosa fare adesso. Da `## Stato decisionale — aggiornamento 2026-09-06` in poi
> il testo è **storico** (PR #11–#22): utile come contesto, non come stato corrente.
> Gli orari di questo documento sono in UTC quando hanno la `Z`; le pagine del
> sito li mostrano in ora italiana (estate = UTC+2) — non confondere i due.

---

## 0. RIPARTENZA — aggiornamento 2026-09-10

### 0.1 Dove siamo (verificato, non a memoria)

- **PR #26 MERGIATA su `main`** — merge commit **`ceb4f3a`**
  (`https://github.com/uamisjd/dropalert-next/pull/26`). Conteneva: onestà
  fonte/verdetto (`/arbitrage`, `/api/health`, motore `drop`), copertura The Odds
  API **guidata dal catalogo reale**, cattura senza terminale, `SMOKE OK` live.
- **PR #27 MERGIATA subito dopo** — merge commit **`0dcb581`**: rimuoveva il flag
  fantasma `--senza-fonte` da `odds:scopri` (era documentato ma non implementato:
  i doc ora indicano il percorso offline reale `--catalogo` + `--leagues`).
  Questi due hash sono fissi e restano validi anche quando `main` avanza.
- **PR #29 MERGIATA il 10/09/2026** — merge commit **`71c59ef`**: cablaggio
  per-bookmaker nel ciclo (dietro doppio flag default OFF), CLV su base
  allineata raw-vs-raw, base di cattura derivata dal catalogo, modalità
  `which=smoke-wire` in `audit.yml` + primo smoke live. «Verifica» su `main`
  verde post-merge (run `34475105406`). Restano i soli passi umani: ribasatura
  CLV storico (`clv:rebase` con `DATABASE_URL`), lettura reale del cablaggio
  (1 credito, serve un segnale `active` ≥ 45 su competizione coperta),
  eventuale accensione dei due flag su Vercel dopo il confronto prima/dopo.
- **Obiettivo dell'utente raggiunto**: `SMOKE OK` su dati reali **senza terminale**
  (match #788 Venezia—Fiorentina, 72 quote da 24 bookmaker, freshness a 0 min).
  Dettagli in `docs/SMOKE-THE-ODDS-API.md` §17.
- **Regola d'oro dell'utente (vincolante)**: NON deve esistere una distinzione fra
  leghe "minori" e "maggiori" — il sistema deve individuare la partita giusta da
  giocare ovunque la fonte abbia davvero i dati. La copertura è quindi guidata dal
  catalogo reale (`sport-catalog.ts`), non da una lista a monte.

### 0.2 Cosa è ACCESO e cosa è SPENTO (attenzione: qui è facile confondersi)

| Cosa | Stato | Nota |
|---|---|---|
| Flag adapter su **Vercel Production** | **ACCESO** (`perBookmakerOdds: true`, health "Attiva") | attivazione del 06/09, env su Vercel |
| Default nel **codice** | `ADAPTER_IMPLEMENTED = envFlag("ODDS_ADAPTER_IMPLEMENTED", false)` | test/dev spenti senza env |
| Cablaggio nel **ciclo di raccolta** | **NON fatto** | i segnali restano su **consenso** BetExplorer; `bookmaker_missing` ~987 aperto |
| Effetto pratico | l'adapter **legge** se interrogato (scheda partita, script), ma **non alimenta** il monitor | per questo il sito non può ancora calcolare coordinazione cross-book e conferma sharp sui segnali |

Dopo il merge di #26 anche `/api/health` lo dichiara con parole oneste
(«può leggere… NON entra di default nel ciclo di raccolta»). **Verifica
post-merge consigliata**: aprire `https://dropalert-next.vercel.app/api/health` e
controllare che la nota sia quella nuova (se dice ancora «Quote per singolo
bookmaker disponibili.» il deploy di `main` non è ancora aggiornato).

### 0.3 Il lavoro vero che resta (in ordine di priorità)

1. **Cablaggio dell'adapter per-bookmaker nel ciclo di raccolta** — è IL passo che
   cambia la sostanza: finché non entra, coordinazione e conferma sharp restano non
   calcolabili e il buco `bookmaker_missing` non si chiude.
   ⚠️ **Leggere prima `docs/STUDIO-CABLAGGIO-ODDS.md` §4.7**: il cablaggio
   "ingenuo" **inquina il consenso** (una linea per-bookmaker sommata alla linea di
   consenso falsa la mediana). Il flag `DROP_EXCLUDE_CONSENSUS_BOOKS` esiste già
   (`src/lib/repo/odds.ts:26`, **default `false`**) e serve a marcare il consenso
   perché il motore lo escluda. Sequenza corretta: cablaggio **dietro flag** +
   smoke test live + contatori di budget, poi eventuale accensione.
   ✅ **Fatto il 10/09/2026 (codice):** la fase esiste in
   `src/lib/providers/optional/odds-collect-wire.ts`, è inserita nel ciclo
   (`scheduler.ts`, fase «1b», solo modalità `full`, mai `collect_only` né
   `--no-collect`) e si accende **solo con entrambi** `ODDS_WIRE_COLLECT=true`
   e `DROP_EXCLUDE_CONSENSUS_BOOKS=true` (`wireGate()`). Regole applicate: solo
   segnali `active` con indice ≥ 45, **solo mercato 1x2** (la lettura h2h non
   copre `ou_2_5`/`btts`), competizioni coperte, mai demo/non giocabili/
   kickoff passato, 1 lettura/partita/giorno (marcatore + cache sharp), budget
   via `decide()` come unico gate di rete; credito contato alla lettura anche
   se la scrittura fallisce (`persistenceError`). Test puri: `npm run test:odds-wire`
   (26 asserzioni). **Restano i passi umani**: smoke test live del cablaggio +
   confronto prima/dopo sui punteggi in modalità mista, poi accensione dei due
   flag su Vercel (il token dell'agente non tocca Vercel).
   ✅ **Smoke live ESEGUITO (10/09/2026, run `34470604421` su GitHub Actions,
   `which=smoke-wire`):** l'umano ha aggiunto la modalità `smoke-wire` a
   `audit.yml` (3 commit: `ad58423`, `e46b7a1`, `181b03d`; l'ultimo ha
   corretto l'indentazione del passo). Esito: marker
   `MARKER-SMOKE-WIRE-BRANCH-v1` presente, passo **success**, flag **SPENTO**
   col motivo corretto, **0 candidati** («oggi nessun segnale attivo su
   competizione coperta»), **0 crediti**. L'infrastruttura del percorso è
   verificata contro il DB reale; manca solo la **lettura reale** (1 credito),
   che richiede un candidato: rilanciare `which=smoke-wire` quando il giro
   avrà segnali `active` con indice ≥ 45 su competizione coperta, poi
   `-f match_id=<id>`. Lo smoke stampa ora anche i contatori dei segnali
   attivi (`listWireSignalStats`: totale attivi e quanti ≥ 45), così «0
   candidati» distingue «nessun segnale» da «segnali sotto soglia». Nota
   minore: con `which=smoke-wire` il passo «Sguardo sui dati (read-only)»
   esegue comunque i due audit (innocuo, read-only): eventuale pulizia
   futura della condizione `if` del passo.
2. **Ampliare la "base di cattura"** (`src/lib/providers/optional/odds-capture-league.ts`,
   `CAPTURABLE`) e/o permettere all'utente di **seguire leghe servite** (Serie A,
   Premier, Liga, Bundesliga, Ligue 1), così le partite che il sito mostra sono
   partite che hanno davvero un prezzo individuale.
   ✅ **Fatto il 10/09/2026 (codice):** la base è ora **derivata dal catalogo
   reale** (39 competizioni attive, meno le esclusioni dichiarate con motivo:
   MLS non servita dal piano, World Cup senza round-trip «Paese: Lega»). Niente
   più lista a mano di sole 6 leghe: anche Argentina, Brasile, Eredivisie,
   Primeira Liga, coppe UEFA ecc. sono catturabili. Invariante di round-trip
   testata: ogni titolo «Paese: Lega» risolve indietro alla stessa `sportKey`
   (`test:odds-sports`).
3. **Audit del matching dei nomi** (punto 2 del vecchio "ordine di lavoro"): restano
   volutamente non-matching le abbreviazioni («Man Utd» ↔ «Manchester United») e i
   qualificatori diversi («Vitoria Guimaraes» ↔ «Vitoria SC»). La parte di codice è
   già coperta da test (`odds-match-resolver.test.ts`): la diagnosi `/events` è
   gratuita e avviene **prima** di spendere il credito, il caso particella «de»
   passa per token, «Inter»⊂«Internazionale» per sottostringa. Resta solo la parte
   operativa: passare in rassegna i casi reali e, dove la grafia interna è sbagliata
   in modo sistematico, correggere l'**anagrafica** delle squadre — non aggiungere
   eccezioni al matcher.
4. **Decisioni aperte dell'utente** già scritte in `docs/DECISIONI-APERTE.md`.
   ✅ **Base del CLV — decisa e allineata il 10/09/2026 (codice):** la coppia
   corretta è **grezzo contro grezzo** (`closingBasis = "raw_consensus"`); la
   pipeline di chiusura ora scrive le nuove osservazioni sulla base allineata
   (`getClosingReference`, `src/lib/pipeline/closing.ts`) e la chiusura fair
   resta a registro solo come qualità della linea. Resta il passaggio umano:
   ribasare lo storico con `npm run clv:rebase -- --apply` (o il pulsante
   manuale «Ribasatura CLV (manuale)»), che richiede il `DATABASE_URL`.

### 0.4 Contesto della fonte (verificato il 10/09/2026 — non riscoprirlo)

- `GET /v4/sports` è **gratuito** (0 crediti) e dà il catalogo: 44 sport, 41 calcio,
  **39 attivi**. `soccer_mls` è nel catalogo ma la fonte risponde **HTTP 404** sulle
  sue partite → **non servito dal piano gratuito**. The Odds API usa 404 (non 403)
  **apposta** per "sport non disponibile sul tuo tier".
- `soccer_italy_serie_a` funziona: **20 eventi**, 0 crediti; la lettura vera costa
  **1 credito** (72 quote, 24 bookmaker, incluso Pinnacle).
- Quindi: le leghe dell'archivio BetExplorer (Algeria, Egitto, Georgia, Colombia,
  Brasile Serie B, Canada, Copa, Youth…) **non hanno prezzi** su questa fonte.
  Non è un bug della mappa: è il perimetro del piano.
- Budget mensile **490 crediti**; i contatori e l'hard-stop stanno in
  `src/lib/providers/optional/odds-api-budget.ts`. `decide()` resta **l'unico
  gate di rete**.

### 0.5 Mappa dei file toccati dal lavoro "Odds" (per orientarsi in fretta)

| File | Ruolo |
|---|---|
| `src/lib/providers/optional/sport-catalog.ts` | catalogo reale (39 leghe attive) + `resolveSportKeyFromCatalog` (vincolo di paese, collision-safe) |
| `src/lib/providers/optional/sport-keys.ts` | `MAP` curata (1ª passata) + fallback catalogo; `COVERED_SPORT_KEYS`, `isCoveredBySportKey` |
| `src/lib/providers/optional/odds-coverage.ts` | classifica copertura (`mapped`/`near`/`uncovered`/`unknown`); `near` **mai** usato come certezza |
| `src/lib/providers/optional/odds-capture-league.ts` | base di cattura derivata dal catalogo (39 attive meno esclusioni; `captureExclusionReason`) |
| `src/lib/providers/optional/ingest-odds-event.ts` | scrive evento della fonte in `leagues`/`teams`/`matches` (riusa le chiavi anagrafiche) |
| `src/app/api/jobs/capture-odds/route.ts` | rotta protetta GET/POST per portare in archivio una partita servita (0 crediti) |
| `src/lib/providers/optional/odds-match-resolver.ts` | matching partita↔evento; nota override corretta (non dice più "fuori mappa" per leghe coperte) |
| `docs/SMOKE-THE-ODDS-API.md` | procedura + §10-bis cattura + §17 esito `SMOKE OK` |

### 0.6 Come si verifica (senza terminale, come vuole l'utente)

1. **Cattura** (0 crediti) — aprire nel browser:
   `https://<deploy>/api/jobs/capture-odds?token=<JOBS_TOKEN>&sportKey=soccer_italy_serie_a`
   → risponde JSON con `matchId`.
2. **Smoke** (1 credito) — GitHub → Actions → **`Verifica dati reali (manuale)`** →
   Run workflow con `which=smoke-odds`, `match_id=<id>`, `sport_key=soccer_italy_serie_a`,
   `ore` vuoto, **branch = ramo della sessione**.
   ⚠️ se il passo `Smoke The Odds API` esce **⊘ (saltato)** il motivo è `which` rimasto
   su `both`, non un guasto.
3. **Comandi locali** (se serve): `npm ci --include=dev` (la sandbox perde
   `node_modules` fra una sessione e l'altra), poi `npm run typecheck`,
   `npm run test:odds-sports`, `npm run test:odds-resolver`, `npm run build`.

### 0.7 Trappole già incontrate (non ripeterle)

- **`node_modules` sparisce** fra le sessioni: rilanciare `npm ci --include=dev`.
- **Il checkout può essere riclonato** (reflog con solo `clone`): confrontare con
  `git ls-remote origin <ramo>` prima di committare, per non perdere storia.
- **`gh pr edit` può fallire** con errore GraphQL (Projects classic): usare
  `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F title=... -F body=@file`.
- **Mai toccare `.github/workflows/`** via push (il token non ha scope `workflow`).
- **Mai cambiare ramo**: lavoro e push solo sul ramo della sessione; PR verso `main`.
- **Il 404 di The Odds API** su una lega = limite del piano, non un bug nostro.
- Un `near` (somiglianza) **non è** copertura: non promuoverlo a certezza.

---

## Stato decisionale — aggiornamento 2026-09-06 (STORICO)

Il progetto è in trasformazione da monitor dei drop a supporto decisionale quantitativo,
ma **non esiste ancora una giocata operativa verificata**. La specifica vincolante è
`docs/CONTRATTO-DECISIONALE.md`; il gate puro è in `src/lib/decision/contract.ts` e
ha test dedicati (`npm run test:decision`).

Stato reale:

- BetExplorer alimenta il monitor con **consenso**, non con quote per singolo
  bookmaker. Una quota consensus non va chiamata «eseguibile».
- `/value-bets` misura il divario osservato contro il no-vig della linea completa
  della stessa fonte. Non è +EV indipendente: ogni riga è marcata `NON AZIONABILE`
  dal contratto e la UI non mostra Kelly o stake. Anche la scheda partita mostra ora
  lo stato decisionale e non contiene più la calcolatrice Kelly operativa.
- Il parser The Odds API e il percorso sharp hanno parti pure e una verifica nella
  scheda partita. Ora il percorso sharp può conservare le linee complete dei
  bookmaker e calcolare il no-vig della prima linea sharp completa, ma il risultato
  resta riferimento indipendente: non è ancora un prezzo eseguibile per l'utente e
  non alimenta `/value-bets`. `src/lib/providers/optional/the-odds-api.ts` resta con
  `ADAPTER_IMPLEMENTED = false`: non c'è ancora ingest multi-bookmaker operativo
  per lo scanner.
- `CANDIDATA` richiederà prezzo reale, fair indipendente, linea completa, freshness,
  edge e segnali coerenti; `VALORE VERIFICATO` richiederà inoltre campione minimo,
  out-of-sample, CLV e calibrazione. In assenza di uno di questi requisiti il sito
  deve dire `NO BET` o `OSSERVAZIONE`, con il motivo.
- `odds_snapshots` ha già i campi necessari per persistere una linea individuale
  (`bookmaker_id`, `source`, `collected_at`, `is_stale`). Il nuovo confine puro
  `src/lib/decision/price-evidence.ts` rifiuta le chiavi aggregate e accetta solo
  una linea individuale fresca; il dettaglio lo usa per non confondere una quota
  eseguibile con il consenso.
- Il client The Odds API ora gestisce rete, timeout, HTTP, JSON, matching di
  squadre/kickoff e DTO per-bookmaker con fixture testabili. Esiste anche il
  percorso esplicito `collectAndPersistTheOddsApiOdds` verso `odds_snapshots`.
  `ADAPTER_IMPLEMENTED` resta però `false`: manca ancora lo smoke test con chiave
  reale e database raggiungibile; nessuna attivazione è stata simulata.
- **Aggiornamento 2026-09-06 (dopo PR #21)**: lo smoke test non richiede più sei
  variabili scritte a mano. `npm run odds:find` individua le partite leggibili
  usando l'endpoint `/v4/sports/{sport}/events`, che la documentazione della fonte
  dichiara **fuori quota** (0 crediti); `npm run smoke:odds-api -- --match-id <id>`
  deriva sport, fixture, squadre e orario dall'archivio, fa un pre-check gratuito
  di matching e solo allora spende **1 credito**. Dopo la scrittura rilegge la
  partita con `getMatchDetail` + `executablePriceFromSeries` e dichiara se esiste
  una linea individuale fresca. L'esecuzione è manuale anche da GitHub Actions
  (workflow `Smoke The Odds API`), dove `DATABASE_URL` è già un secret: la
  procedura completa è in `docs/SMOKE-THE-ODDS-API.md`.
- **Smoke test live ESEGUITO con successo il 06/09/2026** (run `34036327654`): su
  `#569 Hearts — Dundee FC` (`soccer_spl`, override fuori mappa) ha letto 54 quote
  da 18 bookmaker (1 credito), scritto 54 snapshot in `odds_snapshots` e verificato
  linee individuali fresche (età 0 min). Dettagli e limiti in
  `docs/SMOKE-THE-ODDS-API.md` §11. **Non valida il percorso di produzione sui
  campionati coperti** (nessuna partita coperta aveva quote vive oggi) e **non
  accende il provider**: `ADAPTER_IMPLEMENTED` resta `false`; l'attivazione è una
  PR separata e controllata.
- **Regole operative e divisione del lavoro** (chi fa cosa fra agente e umano,
  limiti dei permessi, costi per azione, checklist «cosa facciamo adesso»):
  `docs/REGOLE-OPERATIVE-ODDS.md`. È il documento di regia da leggere prima di
  qualunque intervento su The Odds API.
- **Ripiego «dalla fonte» della lettura di controllo** (06/09/2026): se
  l'archivio BetExplorer è vuoto sul turno corrente, `which=control` sceglie la
  partita coperta dall'endpoint gratuito `/events` (id sintetico negativo) e
  legge comunque via `getSharpLine` (1 credito). Codice in
  `src/lib/repo/control-fallback.ts` + script; docs §13 di SMOKE-THE-ODDS-API.
- **Lettura di controllo coperta VERDE** (run `34039039441`, 06/09/2026):
  Bologna—Sassuolo da `soccer_italy_serie_a`, sharp `pinnacle 1.95`, 24 book,
  budget 7/490 mese; verdetto «non osservabile» atteso (consensus null nel
  controllo). Dettagli in SMOKE §14. Con questo esito è autorizzata la PR di
  attivazione controllata (interruttore env già nel ramo, default spento).
- **ATTIVAZIONE ESEGUITA in produzione (06/09/2026)**: PR #21 (fondamenta odds)
  e #22 (attivazione controllata + lettura di controllo con ripiego dalla
  fonte) mergiate su `main` con «Verifica» verde; flag `ODDS_API_ENABLED=true`
  e `ODDS_ADAPTER_IMPLEMENTED=true` su Vercel Production + redeploy,
  verificati via `/api/health`: the-odds-api enabled, `perBookmakerOdds: true`.
  Budget alle 14:24 UTC: 7/490 mese, 3/14 giorno; alla verifica delle 16:26 UTC
  invariato (nessuna spesa fuori controllo). L'adapter **non è cablato nel
  ciclo di raccolta**: i soli percorsi che spendono crediti sono `getSharpLine`
  dalla scheda partita (solo segnale attivo, lega coperta, 1 lettura/partita/
  giorno, hard-stop in `odds-api-budget.ts`) e gli script manuali
  smoke/controllo. Rollback = togliere i due flag su Vercel + redeploy.
  `COLLECT_HORIZON_HOURS=168` (variabile GitHub) serve perché l'archivio veda
  il turno corrente: da valutare dopo qualche giorno. Regia in
  `docs/REGOLE-OPERATIVE-ODDS.md`.
- **Prima lettura di controllo post-attivazione (06/09/2026, run
  `34046688765` da `main`)**: contatori esatti (7/490 → 8/490, 3/14 → 4/14),
  ma la lettura ha rivelato una **collisione della mappa competizioni**: il
  turno brasiliano era in archivio come «Brazil: Serie A», la regex cercava
  solo «serie a» e la lettura è partita con la chiave della Serie A italiana
  su Remo—Flamengo: credito speso, nessun evento corrispondente, fotografia
  vuota. Corretta nello stesso ramo (matching paese+lega ancorato in
  `sport-keys.ts`, fallire-chiuso senza paese; il controllo ora esce in
  errore su letture pagate ma vuote). Stessa classe della CAF Champions
  League già fermata in passato. Dettagli in SMOKE §15; dopo il merge
  rilanciare `which=control` per la convalida su partita coperta vera.
- **Secondo controllo post-merge (06/09/2026)**: chiave giusta
  (Portugal: Liga Portugal → soccer_portugal_primeira_liga, alias nuovo),
  contatori esatti (9/490, 5/14), ma **matching dei nomi fallito**: l'archivio
  dice «Academico Viseu», la fonte «Academico de Viseu», la regola storica
  per sottostringa non li vedeva uguali — altro credito, fotografia vuota,
  run rosso come da nuovo comportamento. Corretto nello stesso ramo:
  `teamNameMatches` (sottostringa ∪ token, condivisa da `findEvent` e dalla
  diagnosi del resolver) e diagnosi gratuita `/events` nel controllo dopo
  ogni lettura vuota. Restano volutamente non-matching le abbreviazioni
  («Man Utd» ↔ «Manchester United») e i qualificatori diversi («Vitoria
  Guimaraes» ↔ «Vitoria SC»): l'audit del matching è il punto 2 del prossimo
  ordine di lavoro. Dettagli in SMOKE §16.
- Non aggiungere dati, Kelly, stake, +EV o «giocata consigliata» per riempire una
  lista. La calcolatrice manuale è separata dalla decisione e non va collegata al
  flusso operativo.

Prossimo ordine di lavoro: (1) propagare il contratto a tutte le viste che ordinano
segnali; (2) audit completo della fonte sharp e del matching per partita; (3) persistenza
di prezzo/book/freshness e fixture stale/parziali/consensus; (4) validazione temporale
con CLV, calibrazione e intervalli; (5) solo dopo eventuale promozione a valore
verificato. Prima di dichiarare un adapter disponibile devono esistere chiamata di
rete, salvataggio e test end-to-end.

## 1. Cos'è questo progetto (in una frase)

DropAlert è un **terminale quantitativo per scommesse sul calcio**: monitora i
movimenti delle quote (fonte BetExplorer, solo consenso), misura divari contro
linee no-vig, pubblica CLV onesto (anche negativo) e offre calcolatori
client-side. Contratto editoriale: segnali e strumenti per informare le giocate,
**nessuna vincita garantita**, gioco responsabile. Niente consigli di puntata,
niente link a bookmaker, niente stime spacciate per dati.

## 2. Mappa rapida

- Pagine: `/` movimenti · `/value-bets` divario · `/trading` escursione ·
  `/surebet` + `/strumenti` + `/simulator` calcolatori · `/ieri` esiti ·
  `/domani` calendario · `/performance` CLV · `/cov` copertura ·
  `/metodologia` · `/preferite` watchlist · `/gioco-responsabile` · `/privacy`
- Raccolta: `Osservazione DropAlert` (GitHub Actions, ogni ~15 min) →
  `scripts/cycle.sh` → `src/scripts/run-collect.ts` → pipeline
  (`src/lib/pipeline/`) → Neon Postgres. Le pagine leggono il DB, mai la fonte.
- Fonte live: BetExplorer scraping (`src/lib/providers/betexplorer/`), solo
  consenso (`perBookmakerOdds=false`, dichiarato ovunque). Fonti secondarie:
  football-data (calendario, serve chiave), Tavily (news+contesto, budget
  giornaliero condiviso), the-odds-api (ATTIVA dal 06/09/2026 per la sola
  linea sharp regolata; non partecipa alla raccolta, vedi «Stato decisionale»).
- Vercel: solo hosting + deploy (il cron di Vercel NON si usa: piano Hobby =
  1 cron/giorno). **Deployment Protection DISATTIVATA** (05.09.2026): sito
  pubblico, indicizzabile. Non riattivarla senza motivo.

## 3. Cosa è stato fatto (sessioni precedenti, già in `main`)

1. Riposizionamento a terminale betting + guardrail frasi vietate.
2. Audit P0+P1: **leak SQL rimossi da 4 pagine** (ieri/domani/cov/value-bets —
   errore grezzo solo nel log server, testo generico in HTML); unità divario
   % vs pp riallineate ovunque (scanner, card, MatchQuantPanel); banner
   "PROFITTO GARANTITO" rimosso; GreenUp onesto (segni, colori, responsabilità
   condizionale, no "Rischio Zero"); EmptyState a 3 toni; grafico CLV con
   rottura oltre 7 gg di silenzio; `readFailed` nel trading.
3. **Fix critico collector** (motivo della PR): `fetchFixtures` visitava in
   serie una pagina di dettaglio per OGNI riga dell'elenco (200+ nel weekend)
   → 3 timeout da 10 min di fila, raccolta ferma. Ora: tetto 60 righe +
   budget 5 min, ordinate per calo, resto dichiarato `[dettaglio-non-visitato]`
   (contato come `our_choice`). Aggiunti: timeout 15 s su invio web-push,
   `connect_timeout` 30 s + statement timeout 120 s sul client DB.
4. Fonti/strumenti auditati: Margin/Variance/Kelly/synthetic/EV/Dixon-Coles
   corretti; simulator senza più `undefined% EV`/💎; Dutching con invito a
   quote incomplete; robots.txt riverificato live (invariato 05.09.2026).

## 4. Stato live al momento del merge (verificare che regga)

- Produzione: deploy Vercel `success` su main; home con dati freschi.
- `/api/health`: `partial_data` con ~95 buchi `rate_limited` + circuito
  BetExplorer aperto = pressione della fonte gestita come progettato.
- Azioni GitHub: run `Osservazione DropAlert` ripartiti da soli (09:29Z) dopo
  i 3 timeout notturni; PR #11 con check Vercel + validate verdi.

## 5. Istruzioni per la prossima sessione (in ordine)

> ⚠ questo elenco è del 05.09 mattina ed è in parte superato: i punti 1 e 2 sono eseguiti (esito in §8) e il punto 2 (RPM 12→8) non va eseguito d'ufficio, vedi §9.4.

1. **Post-merge (subito)**: deploy Production verde? Prossimi 2–3 run
   `Osservazione DropAlert` in `success` (non `cancelled`)? `/coverage` con
   giri recenti? `/api/health` raggiungibile? Comando:
   `gh run list --workflow "Osservazione DropAlert" --limit 5`.
2. **Pressione fonte (giorni successivi)**: se i 429 persistono
   (`rate_limited` alto in health), abbassare il ritmo:
   `BETEXPLORER_RPM` 12→8 o `BETEXPLORER_MIN_INTERVAL_MS` 4000→6000
   (variabili del workflow, NON servono push di codice). Meno righe per giro,
   ma giri che arrivano in fondo.
3. **Fragilità nota del parser**: le regex cercano classi `table-main__*` e
   BetExplorer ha aggiunto un age-gate 18+ (05.09.2026, contenuto ancora
   presente nell'HTML). Se un giorno `fetchFixtures` torna 0 righe con pagina
   200, la guardia scatta (`partial`, non silenzio): controllare se hanno
   cambiato markup o se il gate blocca davvero, poi aggiornare `parse.ts` e le
   fixture in `src/lib/providers/__tests__/fixtures/`.
4. **Mai toccare `.github/workflows/` via push dell'agente**: il token in uso
   non ha scope `workflow` e il push viene rifiutato. Modifiche al cron solo
   da interfaccia GitHub.
5. **Mai cambiare ramo**: tutto il lavoro sul ramo della sessione attiva;
   push solo a quello; PR da quello verso `main`.

## 6. Comandi utili

- `npm run test:all` (exit 0 = tutto verde) · `npx tsc --noEmit` ·
  `npm run build` · singole suite: `test:client test:feed test:filters
  test:quant test:tools test:betexplorer test:coverage test:view ...`
- Cultura di lavoro: un edit per file alla volta + `grep` di
  riverifica (edit multipli sullo stesso file possono perdersi); commenti in
  italiano; stati onesti mai zeri di ripiego; test per ogni fix UI in
  `src/components/__tests__/tools.test.tsx` (jsdom; c'è lo shim di `self`).

## 7. URL e riferimenti

- Produzione: alias canonico `https://dropalert-next.vercel.app`; il deploy di
  #12 verificato è `dropalert-next-69uclcngb-sima14.vercel.app`. Non usare il
  vecchio URL `i31uaax6b`: è un deployment immutabile precedente al fix.
- PR #11: `https://github.com/uamisjd/dropalert-next/pull/11`; PR #13:
  `https://github.com/uamisjd/dropalert-next/pull/13`.
- Workflow: `Osservazione DropAlert` (.github/workflows/collect.yml),
  `Verifica`, `Verifica dati reali (manuale)`.
- Doc di metodo: `docs/STUDIO-VALUE-BETS.md`, `docs/STUDIO-PARTITE-FINITE.md`,
  `docs/SCHEDULING.md`, `src/app/metodologia/page.tsx` (fonte di verità
  pubblica di cosa il sito dichiara di misurare).

## 8. Verifica post-merge e gate «anti-runaway» (05.09.2026, ore 12:00–13:10 UTC+2)

**Verifica del punto 1, con gli orari giusti (ora italiana).** Merge di PR #11 alle
11:37. Il primo giro post-merge è quello di Actions #297: 11:29 → 11:37, `success`,
8 minuti (non 10 = non il `timeout-minutes` del job) ✓. Poi **le finestre 12:07,
12:22 e 12:37 non hanno prodotto alcun run** — coda vuota, workflow `active`: lo
scheduler di GitHub ne ha servite 4 su 16 nelle 12 ore precedenti. «Prossimi 2–3 run
in success» quindi **non ancora verificato**: serve un altro giro di Actions, non una
raccolta qualsiasi. `/api/health` raggiungibile, `partial_data`, DB raggiungibile,
parser vivo (22 righe viste, 11 di calcio importate, 0 perse): il punto 3 non è
scattato. Deploy di produzione giudicato vivo da `/api/health` (`force-dynamic`) e da
`Verifica` #27 verde su main — l'API di Vercel non è raggiungibile da questo sandbox.

**La scoperta.** Il database si muoveva comunque: giri alle 12:15, 12:30, 12:45,
nessuno dei quali da Actions. Sono la **seconda gamba** — uno scheduler esterno che
busna `/api/cron/collect` ogni 15 minuti (prova: `/api/cron/status` → `lastPingAt`
12:45, `lastPingSkipped:false`). Il giro completo misura ~430 s, la funzione ha
`maxDuration = 300 s`: **la seconda gamba non può chiudersi mai**, quindi non scrive
`scheduler:last_cycle` (scritto solo a giro chiuso) e lascia la riga `collector_runs`
a `running` per sempre. Conseguenze: (a) il gate è cieco e lascia passare ogni
battuta → ~11 richieste in più alla fonte ogni 15 minuti, 3× la pressione progettata
su una fonte con 154 episodi 429 e circuito aperto; (b) la pagina
  raccontava «in corso» un dato che non sarebbe mai arrivato; (c) la profondità della serie
(46 → 47 «giri schedulati») avanza su giri monchi, mentre `instrument.ts` dichiara
l'opposto; (d) `clvRecords` fermo: analisi e chiusure le fa solo chi arriva in fondo.

**Cosa fa la PR #12** (codice, nessun tocco a `.github/workflows/`):
1. `scheduler:cycle_claim` — il tentativo di giro si marca **prima** di toccare la
   fonte; il gate (`readGateMoment`, usata da `runCycle` e dall'uscita anticipata
   della rotta) rispetta il più recente fra chiuso e tentato. Un giro interrotto
   vale come lavoro fatto: i ping fuori cadenza escono in millisecondi.
2. `resolveRunStatus` + `ABANDONED_RUN_AFTER_MINUTES = 15`: una riga `running` oltre
   il tetto del job si chiama **troncato**, e la pagina dice cosa manca invece di
   promettere un dato in arrivo.
3. Onestà di pagina: `ACTIONS_CRON` era «7,52» contro un workflow a quattro
   occasioni; ora il test legge il cron **dal file**, quindi la copia non può più
   invecchiare in silenzio. `RUNNER_NOTE` dice anche della seconda gamba esterna e
   punta a `/api/cron/status`.
4. In #12 `scripts/gate-check.sh` (non cablato) rispettava anche il claim;
   #13 lo riallinea all'heartbeat **full** per evitare starvation di Actions,
   mentre il gate della fonte continua a rispettare il tentativo.

**Baseline registrata alle 13:13 (ora italiana), prima del merge**: fonte passata
da `ok` a **`degraded`** in ~40 minuti (latenza media 151 → 426 ms, circuito
aperto), `matches` 627, `oddsSnapshots` 12 255, `clvRecords` **239 da ore** (la
seconda gamba non calcola CLV), un ciclo `running` orfano aperto alle 13:00. Il
`degraded` non è una prova del nesso causa-effetto — i 429 dipendono anche dal
palinsesto serale — ma è il motivo per cui il merge non è stato rimandato.

**Test di accettazione dopo il deploy.** `/api/cron/status` deve mostrare, nei ping
fuori cadenza, `lastPingSkipped: true` e `gate.minutesUntilNextRun > 0`; a regime
`gate.lastCycleTruncated` deve comparire solo quando un giro viene davvero interrotto
(non a ogni giro, come accadeva). Un `npm run test:pipeline` su Postgres di servizio
copre il caso «46 min chiuso + 15 min tentato ⇒ non si raccoglie».

**Verifica aggiuntiva del 05.09, ore 14:13–14:33 italiane.** Il deploy corretto
(di #12, URL `69uclcngb`, non il vecchio `i31uaax6b`) è verde. Il gate nuovo è
vivo: ping esterni saltati e claim effettivi alle 13:30 e 14:30, quindi la fonte
non è più stata interrogata ogni 15 minuti. Actions, invece, non ha prodotto un
nuovo run dopo #297 delle 11:29: la verifica dei 2–3 successi resta aperta.
Alle 14:13 la fonte era `ok`, alle 14:33 era tornata `degraded`, mentre
`dataGaps.byReason.rate_limited` è rimasto **95** in entrambe le letture. Questa
oscillazione è precisamente il motivo per cui non si può anticipare il verdetto
fissato al 06.09 ore 13:30: oggi manca comunque la seconda condizione (`> 95`).

**Intervento preparato in PR #13 (da considerare live solo dopo il merge).**

1. `/api/cron/collect` usa ora un vero profilo `collect_only`: termina dopo la
   raccolta e lascia analisi, risultati, chiusure e notifiche al giro completo
   di Actions. Chiude `scheduler-cycle` e aggiorna
   `scheduler:last_collection`; il claim tiene chiuso il gate della fonte,
   quindi non lascia più un outer-run condannato a restare `running`.
   `scheduler:last_cycle` resta invece l'heartbeat del giro completo: separarli
   impedisce al fallback puntuale di affamare Actions per sempre.
2. Il profilo serverless impone 15 righe/120 s alla fase di dettaglio e disattiva
   il retry da 60 s: dei 300 s ne restano almeno 180 per quote, DB e
   finalizzazione. Le esclusioni restano dichiarate come nostra scelta.
3. Un parziale dovuto soltanto a tetto/deadline nostri resta parziale nella
   copertura ma non degrada `source_health`; errori, parse failure e 429
   continuano invece a degradarla. Così il misuratore del §9.4 non viene falsato
   dalla cura stessa.
4. `/api/health` proietta una riga `running` oltre 15 minuti come `aborted`,
   conserva anche `storedStatus` e mostra `mode`/`finishedAt`. Il DB storico non
   viene riscritto.
5. Decisione sulla profondità: restano validi i punti di raccolta automatica il
   cui **collector è concluso**, anche se l'outer-cycle precedente è stato
   troncato; la misura riguarda righe viste/importate, non analisi o CLV. Le
   query ora escludono esplicitamente `finished_at is null`, e la metodologia
   pubblica lo dichiara.
6. `test:pipeline` è entrato in `test:all` ed è stato eseguito davvero su una
   PostgreSQL effimera: 45/45 casi verdi, incluso il fallback che chiude il run,
   non finge fasi eseguite, avanza il gate della fonte e non affama il full.
   Anche l'intera `test:all`,
   typecheck, lint e build compilata sono verdi.

**Verifica della preview di PR #13, ore 14:47 italiane.** `/api/health` ha
proiettato correttamente l'outer-run orfano delle 14:30 come
`status: "aborted"`, conservando `storedStatus: "running"` e
`finishedAt: null`; `/api/cron/status` espone già `lastCycleMode` (correttamente
`null` finché non gira il nuovo profilo). La fonte era `degraded`, ma
`rate_limited` ancora **95**: anche quest'ultimo campione non autorizza il
12→8 e non sostituisce la lettura prescritta per domani.

**Nuovo campione Actions, ore 15:00–15:11 italiane.** Il run schedulato
#33967658782 è arrivato spontaneamente ma è stato cancellato al tetto di 10
minuti: quindi non vale come secondo successo. Non ha scritto nuove quote né
aggiornato la fonte, mentre i segnali sono avanzati durante il run: evidenza
coerente con la lunga scansione DB seriale, non con pressione BetExplorer. PR
#13 esegue ora `detectAll` con quattro worker indipendenti (pool DB da dieci),
con ordine del report conservato e test esplicito sul tetto di concorrenza.
Va verificata la durata del primo full dopo il merge; il fallimento live non
viene trasformato retroattivamente in successo.

**Cosa resta aperto:** il solo esito temporale del §9.4, i 2–3 run spontanei di
Actions e le operazioni esterne al repository. Il lavoro di codice sui 300 s,
sulla profondità e sul test di pipeline è svolto in questa sessione.

## 9. Stato e ripartenza della prossima sessione

Stato sul ramo della sessione: il lavoro tecnico verificabile dei vecchi punti
2, 3 e 7 è completato; il workflow Actions resta intatto e completo, e nessuna
soglia di pressione è stata toccata. Restano i controlli che richiedono il nuovo
deploy o il trascorrere della finestra temporale.

### Istruzioni vincolanti per il nuovo agente dopo il merge di #13

Eseguire questa checklist in ordine e riportare gli esiti in §8 con timestamp in
ora italiana. Non confondere un check CI, una raccolta Vercel e un ciclo Actions:
sono tre prove diverse.

1. **Confermare merge e deploy del commit di #13.** Usare
   `gh pr view 13 --json state,mergedAt,mergeCommit,url`, poi controllare che
   `Verifica` su `main` e il deploy Production Vercel siano verdi. Verificare il
   sito tramite l'alias canonico `https://dropalert-next.vercel.app`, non tramite
   vecchi deployment immutabili.
2. **Verificare il primo fallback realmente ammesso dal gate.** Non basta un ping
   saltato. Dopo un `lastPingSkipped: false`, `/api/cron/status` deve mostrare
   `lastCycleMode: "collect_only"`, `lastCollectionAt` recente,
   `lastCycleTruncated: false` e `lastFullCycleAt` invariato fino al successivo
   Actions. In `/api/health` il relativo `scheduler-cycle` deve avere
   `finishedAt` valorizzato entro 300 s, con `mode: "collect_only"`; nella
   risposta della rotta o nel `meta` del run, analisi, chiusure e notifiche
   devono risultare `executed: false`, non zeri spacciati per lavoro svolto.
3. **Verificare il full Actions corretto, senza lanciarlo manualmente per
   sostituire la prova.** Servono 2–3 run schedulati spontanei consecutivi in
   `success`, ciascuno sotto i 10 minuti. Il run deve essere `mode: "full"`,
   avanzare `lastFullCycleAt` ed eseguire analisi/chiusure/notifiche anche quando
   il gate salta una raccolta recente. Il run 33967658782 del 05.09 è
   `cancelled` e non conta. Se un nuovo run scade ancora, individuare dai log la
   fase lenta e annotare il fallimento: non promuoverlo a successo e non
   trasformare Actions in collect-only.
4. **Controllare la diagnostica degli orfani.** In `/api/health`, ogni stato DB
   `running` vecchio di oltre 15 minuti deve essere esposto come
   `status: "aborted"`, con `storedStatus: "running"` e `finishedAt: null`. Non
   aggiornare manualmente quelle righe: sono prova storica del timeout.
5. **Applicare il gate RPM una sola volta, non prima del 06.09.2026 ore 13:30
   italiane.** Nello stesso campione registrare `sources[0].status` e
   `dataGaps.byReason.rate_limited`. Rallentare 12→8 soltanto se lo stato è
   ancora `degraded` **AND** il contatore è `> 95`. Se manca una delle due
   condizioni, non cambiare alcuna variabile e scrivere in §8 esattamente
   **«valutata e respinta»**. I campioni precedenti, fermi a 95, non autorizzano
   una decisione anticipata.
6. **Non modificare `.github/workflows/collect.yml` durante questa verifica.**
   Actions deve restare il ciclo completo; il fallback deve restare
   collect-only. Non cablare `scripts/gate-check.sh` e non cambiare cadenze o
   limiti finché i campioni sopra non indicano un problema specifico.

### Dettaglio tecnico di riferimento

1. **Verifica a caldo dopo il prossimo deploy (primi 30 min).**
   - `GET /api/cron/status` → un giro esterno concluso deve avere
     `lastCycleMode: "collect_only"`, `lastCollectionAt` valorizzato,
     `lastPingSkipped: false` e outer-run chiuso; `lastFullCycleAt` deve avanzare
     solo col giro Actions. I ping fuori cadenza restano `lastPingSkipped: true`.
   - `GET /api/health` → `recentRuns`: nessun `scheduler-cycle` deve essere
     presentato come `running` oltre 15 minuti; per i vecchi orfani ci si aspetta
     `status: "aborted"` e `storedStatus: "running"`.
   - `gh run list --workflow "Osservazione DropAlert" --limit 5` → resta da
     vedere 2–3 run spontanei di Actions in `success`; devono avere modalità
     `full`, con analisi/chiusure/notifiche eseguite.
   - `/coverage` è in ISR con `revalidate = 300`: la prima richiesta dopo la
     scadenza può ancora ricevere la copia precedente.
2. **Profondità della serie — DECISA E IMPLEMENTATA.** Conta ogni raccolta
   schedulata il cui provider-run è realmente concluso (`finished_at is not
   null`), anche se il vecchio outer-cycle è stato poi troncato: la fotografia
   ripetuta è quella della fonte, non l'analisi. Un run ancora aperto non conta.
   `coverage-history.ts`, i test e `/metodologia` sono allineati; non cambiare
   `instrument.ts` per filtrare in base al successo dell'outer-cycle.
3. **Budget 300 s — RISOLTO SUL RAMO.** La rotta Vercel usa `collect_only`,
   massimo 15 dettagli e 120 s di dettaglio, senza retry; finalizza outer-run e
   gate e non esegue le fasi complete. Actions continua a chiamare `runCycle`
   senza override e quindi resta `full`. Dopo il deploy verificare la durata
   reale, ma non ridurre ulteriormente `COLLECT_MAX_FIXTURES` o orizzonte senza
   una nuova misura.
4. **Soglie di pressione: NON toccare niente prima del 06.09.2026 alle 13:30
   (ora italiana).** Il punto 2 dell'handoff (`BETEXPLORER_RPM` 12→8,
   `BETEXPLORER_MIN_INTERVAL_MS` 4000→6000) nasce da 429 osservati quando il ritmo
   reale era 15 minuti, non 45: ora va rivalutato a gate corretto. Misuratori:
   `dataGaps.byReason.rate_limited` (baseline 95, ferma da giorni), gli episodi 429
   dichiarati in `/coverage` (154, ultimo 05:01) e `sources[0].status` (`ok` /
   `degraded`). La finestra di 24 h scade il **06.09.2026 alle 13:30 (ora
   italiana)**. A quell'ora il rallentamento si fa **solo se entrambe** queste
   condizioni sono vere: `sources[0].status` è ancora `degraded` **e**
   `dataGaps.byReason.rate_limited` è salito sopra 95 (`> 95`). In tal caso si
   applica il 12→8 (o 4000→6000): sono variabili del workflow, non codice. Se
   anche una sola condizione non è soddisfatta, non si modifica nulla e si
   riporta l'esito in §8 come **«valutata e respinta»**.
5. **Operazioni esterne residue.**
   - Non trasformare Actions in collect-only: `.github/workflows/collect.yml`
     deve continuare a eseguire il ciclo `full`. L'inline gate può restare:
     legge `scheduler:last_cycle`, riservato all'ultimo full concluso, mentre il
     fallback usa `scheduler:last_collection` + claim. `scripts/gate-check.sh`
     è ora allineato alla stessa separazione; cablarlo resta un'ottimizzazione
     opzionale che richiede una modifica esplicita del workflow.
   - La cadenza dello scheduler esterno non è nel repository: 15 min è innocuo
     per la fonte grazie al gate; 60 min riduce le sole function invocation.
6. **Pulizia dei residui (non necessaria).** Le righe `collector_runs`
   lasciate a `running` dal vecchio comportamento restano come prova storica;
   `publicRunStatus` le espone come `aborted` **solo in lettura**, insieme allo
   `storedStatus`. Non scrivere `aborted`/`partial` a mano nel DB: la proiezione
   risolve la diagnostica senza fabbricare una chiusura mai avvenuta.
7. **Test pipeline — RISOLTO.** Eseguito contro PostgreSQL effimera dopo le
   migrazioni (45/45) e aggiunto a `test:all`; di conseguenza anche `Verifica`,
   che prepara PostgreSQL 17 e lancia `test:all`, lo eseguirà. Non rimuoverlo per
   rendere verde un ambiente locale senza DB: avviare invece PostgreSQL e usare
   una `DATABASE_URL` esplicita.
8. **Vincoli sempre validi**: lavorare e pushare solo sul ramo della sessione
   attiva, PR verso `main` (punto 5); mai `.github/workflows/` (punto 4); un edit
   per file + `grep` di riverifica; commenti in italiano; stati onesti, mai zeri
   di ripiego; `npm run test:all` + `npx tsc --noEmit` + `npm run build` prima di
   aprire la PR.
