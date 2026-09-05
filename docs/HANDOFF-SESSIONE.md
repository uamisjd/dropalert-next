# Handoff — DropAlert: stato lavori, infrastruttura live, cosa continuare

> Documento di continuità fra sessioni di lavoro. Ultimo aggiornamento: 2026-09-05.
> PR #11 (ramo `arena/01a0707a-dropalert-next` → `main`): MERGIATA.
> PR #12 (ramo `arena/01a07101-dropalert-next` → `main`): MERGIATA su richiesta
> dell'utente in questa sessione — è il fix descritto in §8, e il piano per
> ripartire è in §9. Gli orari di questo
> documento sono in UTC quando hanno la `Z`; le pagine del sito li mostrano in
> ora italiana (estate = UTC+2) — non confondere i due, il «giro delle 10:22»
> è le 12:22 a Napoli.

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
  giornaliero condiviso), the-odds-api (SPENTA di proposito, guscio onesto).
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
-_countingultura di lavoro_: un edit per file alla volta + `grep` di
  riverifica (edit multipli sullo stesso file possono perdersi); commenti in
  italiano; stati onesti mai zeri di ripiego; test per ogni fix UI in
  `src/components/__tests__/tools.test.tsx` (jsdom; c'è lo shim di `self`).

## 7. URL e riferimenti

- Produzione: deployment `dropalert-next-i31uaax6b-sima14.vercel.app`
  (l'alias/canonical sta in `SITE_URL` / `NEXT_PUBLIC_SITE_URL`).
- PR #11: `https://github.com/uamisjd/dropalert-next/pull/11`.
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
4. `scripts/gate-check.sh` (non cablato nel workflow) allineato alla stessa regola;
   `docs/SCHEDULING.md` aggiornato con la sezione «Il gate rispetta il tentativo».

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

**Cosa resta aperto** non è elencato qui per non fare doppia contabilità: sta tutto
in §9, che è il punto di ripartenza per la prossima sessione (verifica a caldo,
profondità della serie, 300 s contro ~430 s, e le due mosse che solo l'owner può
fare: cadenza del chiamante esterno e workflow).

## 9. Piano per la prossima sessione (in ordine, con i comandi)

Stato al merge di #12: `main` porta il gate sul tentativo, il workflow di
raccolta è intatto, nessuna soglia di pressione toccata.

1. **Verifica a caldo (primi 30 min, dal browser o con `curl`)**
   - `GET /api/cron/status` → `gate.lastClaimAt` deve comparire **solo dopo il
     primo giro col codice nuovo** (prima è `null` ed è corretto, non un guasto);
     sui ping fuori cadenza ci si aspetta `lastPingSkipped: true` con
     `gate.minutesUntilNextRun > 0`.
   - `GET /api/health` → `recentRuns`: nuovi `scheduler-cycle` devono risultare
     `success`/`partial`, non `running` oltre 15 minuti; `/coverage` deve dire
     «troncato» dove prima diceva «in corso».
   - `gh run list --workflow "Osservazione DropAlert" --limit 5` → il punto 1
     dell'handoff è **ancora aperto**: serve vedere 2–3 run di Actions in
     `success` (alle 13:13 ne era arrivato uno solo post-merge, #297).
   - Nota: `/coverage` è in ISR con `revalidate = 300` e la prima richiesta dopo
     la scadenza riceve la copia precedente: non leggere il ritardo come gelo.
2. **La profondità della serie va decisa, non subìta** — scelta editoriale, ora
   che i dati ci sono. I giri troncati hanno `meta.trigger = "scheduled"` e quindi
   fanno `scheduledPoints`: il «47 giri schedulati» in pagina include giri che non
   hanno mai eseguito analisi e chiusure, mentre `instrument.ts:74` dichiara
   l'opposto («la stessa fotografia ripetuta»). Se si decide di filtrare, si tocca
   il conteggio in `src/lib/cov/instrument.ts` (sui soli giri **chiusi**) e i test
   in `src/lib/cov/__tests__/coverage.test.ts` + `view.test.ts`. Da dichiarare anche
   in `src/app/metodologia/page.tsx`, che è la fonte di verità pubblica.
3. **Il nodo irrisolto: 300 s di budget contro ~430 s di giro.** Finché resta
   così, la seconda gamba non chiuderà mai un giro e la serie dipende al 100% da
   Actions (che ne serve 4 su 16). Tre strade, in ordine di preferibilità:
   (a) percorso *collect-only* per la rotta Vercel, lasciando analisi e chiusure ad
   Actions; (b) *soft deadline* dentro `runCycle`, che chiuda il run come `partial`
   prima del tetto invece di farlo uccidere; (c) ridurre lavoro per giro
   (`COLLECT_MAX_FIXTURES`, `COLLECT_HORIZON_HOURS`) per far stare il giro in 300 s.
   (a) e (b) si sommano bene. Misurare prima: un giro completo è 433 s con 12
   righe di calcio importate.
4. **Soglie di pressione: NON toccare niente per 24 h.** Il punto 2 dell'handoff
   (`BETEXPLORER_RPM` 12→8, `BETEXPLORER_MIN_INTERVAL_MS` 4000→6000) nasce da 429
   osservati quando il ritmo reale era 15 minuti, non 45: ora va rivalutato a
   gate corretto. Misuratori: `dataGaps.byReason.rate_limited` (95, fermo da giorni),
   gli episodi 429 dichiarati in `/coverage` (154, ultimo 05:01) e
   `sources[0].status` (`ok` / `degraded`). Se dopo 24 h a regime resta
   `degraded`, allora si rallenta — sono variabili del workflow, non codice.
5. **Due cose che richiedono mani umane (l'agente non può):**
   - cablare il gate del workflow su `scripts/gate-check.sh` (oggi il passo
     «Serve raccogliere?» ha il `psql` scritto in linea e legge solo
     `scheduler:last_cycle`: è coerente lato fonte ma non lato minuti di runner;
     lo script è già allineato alla regola del tentativo). Serve modificare
     `.github/workflows/collect.yml` da interfaccia GitHub: il token dell'agente
     non ha scope `workflow` (punto 4).
   - decidere la cadenza dello scheduler esterno (15 min è innocuo ora; 60 min
     fa risparmiare funzione-invocation sul piano Hobby). Non è nel repo.
6. **Pulizia dei residui (opzionale, e con una trappola).** Le righe
   `collector_runs` lasciate a `running` dal vecchio comportamento restano in
   archivio per sempre; `resolveRunStatus` le etichetta «troncato» **in lettura**,
   e va bene così: non scrivere `aborted` a mano nell'archivio, perché il codice
   non lo produce e avremmo due verità. Se proprio si vuole ripulire, è un
   `update collector_runs set status = 'partial'` dove `finished_at is null` — da
   fare solo decidendo di sacrificare la prova storica del taglio.
7. **Il test che nessuna macchina esegue.** `test:pipeline` (dove sta il test
   «un giro tentato e non chiuso tiene chiuso il gate») non è né in `test:all` né
   in `Verifica`: va corso almeno una volta contro una Postgres di servizio
   (`DATABASE_URL` + `npx drizzle-kit migrate`, come fa il workflow) e solo dopo
   aggiungerlo a `test:all` in `package.json`. Non serve toccare i workflow.
8. **Vincoli sempre validi**: lavorare e pushare solo sul ramo della sessione
   attiva, PR verso `main` (punto 5); mai `.github/workflows/` (punto 4); un edit
   per file + `grep` di riverifica; commenti in italiano; stati onesti, mai zeri
   di ripiego; `npm run test:all` + `npx tsc --noEmit` + `npm run build` prima di
   aprire la PR.
