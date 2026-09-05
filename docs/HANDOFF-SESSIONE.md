# Handoff — DropAlert: stato lavori, infrastruttura live, cosa continuare

> Documento di continuità fra sessioni di lavoro. Ultimo aggiornamento: 2026-09-05.
> PR #11 (ramo `arena/01a0707a-dropalert-next` → `main`): MERGIATA.
> PR #12 (ramo `arena/01a07101-dropalert-next` → `main`): MERGIATA su richiesta
> dell'utente in questa sessione — è il primo fix descritto in §8.
> PR #13 (ramo `arena/01a0717b-dropalert-next` → `main`): APERTA, check
> `Verifica` e Vercel verdi — contiene profilo collect-only, diagnostica health
> e test descritti in §8–§9.
> Gli orari di questo
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
   PostgreSQL effimera: 44/44 casi verdi, incluso il fallback che chiude il run,
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

**Cosa resta aperto:** il solo esito temporale del §9.4, i 2–3 run spontanei di
Actions e le operazioni esterne al repository. Il lavoro di codice sui 300 s,
sulla profondità e sul test di pipeline è svolto in questa sessione.

## 9. Stato e ripartenza della prossima sessione

Stato sul ramo della sessione: il lavoro tecnico verificabile dei vecchi punti
2, 3 e 7 è completato; il workflow Actions resta intatto e completo, e nessuna
soglia di pressione è stata toccata. Restano i controlli che richiedono il nuovo
deploy o il trascorrere della finestra temporale.

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
   migrazioni (44/44) e aggiunto a `test:all`; di conseguenza anche `Verifica`,
   che prepara PostgreSQL 17 e lancia `test:all`, lo eseguirà. Non rimuoverlo per
   rendere verde un ambiente locale senza DB: avviare invece PostgreSQL e usare
   una `DATABASE_URL` esplicita.
8. **Vincoli sempre validi**: lavorare e pushare solo sul ramo della sessione
   attiva, PR verso `main` (punto 5); mai `.github/workflows/` (punto 4); un edit
   per file + `grep` di riverifica; commenti in italiano; stati onesti, mai zeri
   di ripiego; `npm run test:all` + `npx tsc --noEmit` + `npm run build` prima di
   aprire la PR.
