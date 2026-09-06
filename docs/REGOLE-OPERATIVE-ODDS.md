# Regole operative — The Odds API (chi fa cosa, e con quali limiti)

> Documento di regia. Riassume lo stato reale al 06/09/2026 e divide il lavoro
> fra ciò che l'agente può fare da solo e ciò che richiede un clic umano.
> Ogni regola qui sotto è motivata da un fatto verificato, non da prudenza
> generica. Leggere prima di qualunque intervento su questa fonte.

---

## 0. Stato in una riga

Il provider è **ATTIVO in produzione** dal 06/09/2026: PR #21 (fondamenta
odds) e #22 (attivazione controllata) mergiate su `main` con «Verifica» verde;
`ODDS_API_ENABLED=true` + `ODDS_ADAPTER_IMPLEMENTED=true` impostati su Vercel
Production e verificati via `/api/health` (the-odds-api enabled,
perBookmakerOdds true). Budget all'attivazione: 7/490 mese, 3/14 giorno.
L'adapter **non è cablato nel ciclo di raccolta**: i soli percorsi che
spendono crediti sono `getSharpLine` dalla scheda partita (solo segnali
attivi su leghe coperte, 1 lettura/partita/giorno, hard-stop in
`odds-api-budget.ts`) e gli script manuali smoke/lettura di controllo.
Rollback: togliere i due flag su Vercel + redeploy.

---

## 1. Divisione del lavoro (verificata, non presunta)

### L'agente PUÒ fare da solo
- Scrivere, testare, commitare e pushare codice e documenti sul ramo di
  sessione `arena/01a07663-dropalert-next`.
- Leggere lo stato di GitHub: run, job, passi (`gh run list`, `gh api …/jobs`),
  branch, PR.
- Eseguire in locale: `typecheck`, `lint`, `test:*`, `build`.

### L'agente NON PUÒ (bloccato da permessi, verificato 403)
- **Lanciare workflow** (`gh workflow run` → 403): il clic «Run workflow» è umano.
- **Leggere o scrivere secret e variables** (`gh secret/variable/api` → 403).
- **Toccare Vercel** (nessun accesso): le variabili d'ambiente Vercel si
  impostano dalla dashboard.
- **Scaricare i log grezzi** dei run (host `results-receiver…` irraggiungibile):
  l'output va letto/incollato dalla UI o dedotto dai passi via API.

### L'umano deve (pochi clic, tutti documentati)
- Impostare secret/variables su GitHub (fatto: `THE_ODDS_API_KEY`,
  `COLLECT_HORIZON_HOURS=168`).
- Premere «Run workflow» con i parametri indicati (§4).
- Autorizzare esplicitamente merge e attivazione (§6).

---

## 2. Regole fisse (non negoziabili)

1. **Nessuna PR/merge prima di un test reale riuscito.** Il test reale
   (smoke) è avvenuto; resta da fare la lettura di controllo coperta prima
   dell'attivazione.
2. **Il provider resta spento** finché: lettura di controllo coperta verde **e**
   ok umano. Attivare = impostare `ODDS_ADAPTER_IMPLEMENTED=true` (env), mai un
   cambio di codice non recensito.
3. **Mai una chiave o una connection string in chat, commit o issue.** Solo
   secret/variables. Gli script mascherano gli URL postgres in uscita.
4. **Budget**: 490/mese, 14/giorno, 1 lettura/partita/giorno, solo segnali
   attivi (`odds-api-budget.ts`). Ogni strumento dichiara i crediti spesi.
5. **Mai presentare il consensus come quota eseguibile**; il sito dice
   **NO BET** quando manca un prezzo individuale fresco (`price-evidence.ts`,
   `contract.ts`).
6. **Costi per azione** (dichiarati dalla fonte): ricerca/sonda `/events` = 0
   crediti; smoke `/odds` h2h×eu = 1 credito; lettura di controllo = 1 credito.

---

## 3. Mappa degli strumenti (tutti su `main` da PR #21/#22)

| Strumento | Comando / workflow | Costo | A cosa serve |
|---|---|---|---|
| Ricerca partita | `odds:find` · `which=smoke-odds` (match_id vuoto) | 0 | elenca le partite leggibili (mappa di budget) |
| Sonda lega fuori mappa | `odds:find --sonda <key>` · `which=smoke-odds`+`sport_key` | 0 | trova l'id per una lega reale non mappata |
| Smoke test | `smoke:odds-api -- --match-id N [--sport-key K]` · `which=smoke-odds`+`match_id` | 1 | chiamata+matching+persistenza+freshness |
| Lettura di controllo | `odds:control` · `which=control` (+`sport_key` facoltativo) | 0 o 1 | percorso di produzione su lega coperta; archivio vuoto → ripiego dalla fonte (§13 SMOKE) |

Tutto quanto sopra è **mergiato su `main`** con PR #21 e #22: la workflow
*Verifica dati reali (manuale)* si lancia da `main`. Il ramo di sessione serve
solo per il lavoro nuovo.

---

## 4. Procedure clic-per-clic (per l'umano)

### 4.1 Lettura di controllo (eseguibile OGNI giorno)
1. Actions → *Verifica dati reali (manuale)* → Run workflow.
2. Branch `main`; `which = control`; `ore = 168`; facoltativo
   `sport_key = soccer_italy_serie_a` per mirare il ripiego.
3. Con il turno in archivio legge da lì; con archivio vuoto il **ripiego dalla
   fonte** sceglie la partita coperta in programma (endpoint gratuito, 0
   crediti) ed esegue la lettura di produzione (1 credito). Se stampa la linea
   sharp → verde, procedere a §6. Se stampa che né archivio né fonte hanno
   partite (0 crediti) → il turno è davvero assente.

### 4.2 Attivazione (solo dopo 4.1 verde + ok)
Impostare nell'ambiente di produzione (Vercel) **tutti e tre**:
- `ODDS_API_ENABLED=true`
- `ODDS_ADAPTER_IMPLEMENTED=true`
- la chiave (già presente come `theoddsapiKey`).
Poi aprire/mergiare la PR di attivazione solo con «Verifica» verde.

---

## 5. Ambiente per ambiente

- **GitHub Actions**: database già raggiungibile (`DATABASE_URL`), chiave come
  secret. È dove girano ricerca/sonda/smoke/control. L'agente legge i passi,
  l'umano preme Run.
- **Vercel**: hosting + deploy; ha `theoddsapiKey` e `DATABASE_URL`. Qui va
  impostato il doppio flag di attivazione (§4.2). L'agente non vi accede.
- **Locale**: solo per sviluppo/test (`npm ci`, `npm run test:*`, `build`).
  Per un uso live servirebbe `.env` con chiave+`DATABASE_URL` e Neon
  raggiungibile: sconsigliato, GitHub Actions è più semplice.

---

## 6. Checklist «cosa facciamo adesso»

- [x] Smoke test live su lega reale (run `34036327654`) — 1 credito.
- [x] Interruttore di attivazione env-ready (default off).
- [x] Lettura di controllo con ripiego dalla fonte (`which=control`): eseguibile
  ogni giorno su campionato coperto, anche con archivio vuoto.
- [x] **Lettura di controllo coperta verde** (run `34039039441`:
  Bologna—Sassuolo, sharp `pinnacle 1.95`, 24 book, 1 credito).
- [x] PR strumenti/attivazione: #21 e #22 mergiate su `main` con «Verifica»
  verde + ok umano.
- [x] Flag Vercel `ODDS_API_ENABLED=true` + `ODDS_ADAPTER_IMPLEMENTED=true` +
  redeploy, verificati via `/api/health` (06/09/2026).
- [ ] **Osservazione del primo turno acceso** (Serie A 06–07/09): lettura di
  controllo `which=control` da `main`, contatori giorno/mese coerenti con le
  letture dichiarate, sito in NO BET senza prezzo individuale fresco.
- [ ] Valutare dopo qualche giorno `COLLECT_HORIZON_HOURS=168` (variabile
  GitHub): serve perché l'archivio veda il turno corrente.

Il rollback resta sempre: togliere i due flag su Vercel + redeploy.
