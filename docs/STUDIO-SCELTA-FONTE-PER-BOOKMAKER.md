# Studio — Scelta della fonte per-bookmaker (Fase 2)

> Data: 2026-09-09.
> Obiettivo: rendere OSSERVABILE il concetto che l'utente ha spiegato
> («calo di quota in tutti i bookmaker + notizie/statistiche a favore →
> segnalata come BET»). Il collo di bottiglia è il **dato per-bookmaker**:
> BetExplorer dà solo consenso. Qui si sceglie quale fonte aggiungere.
> Il motore (`analyzeDrop`) è già pronto: serve solo alimentarlo con le
> quote dei singoli operatori. La dottrina (NO BET senza prezzo individuale
> fresco) resta inviolata.

---

## 1. Criteri di scelta (dal concetto dell'utente)

Per «calo di quota in TUTTI i bookmaker» + «verifica indipendente» + «minori»
servono, da una fonte:

1. **Quote per singolo bookmaker identificabile** (per confrontare chi si muove).
2. **Mercati multipli** (1X2, over/under, per coerenza cross-mercato).
3. **Sharp bookmaker** (Pinnacle o equivalente) → per la conferma indipendente.
4. **Copertura dei tornei minori** (il cuore del monitor, dove nascono i drop).
5. **Costo prevedibile e sostenibile** (free tier o quasi; budget bloccabile).
6. **Affidabilità/accesso** (API documentata, niente scraping fragile).

---

## 2. Confronto verificato (12/09/2026)

Nota di trasparenza: i numeri di copertura/quote vengono dalle pagine
pubbliche e dai confronti dei rivenditori (maggio–agosto 2026), NON da una
chiamata live (nessuna chiave in questo ambiente). La struttura dell'API è
documentata; lo schema esatto va congelato con una fixture e validato in un
**smoke test live** prima dell'attivazione — lo stesso metodo già usato per
The Odds API nel progetto.

| Asse | **OddsPapi** (oddspapi.io) | **odds-api.io** | **OddsPortal** |
|---|---|---|---|
| Modello costo | per-richiesta, piatto | per-richiesta | n/a (nessuna API) |
| Free tier | **250 richieste/mese** | 100 req/ora (500/gg) | n/a |
| Bookmaker nel free | **348–370** (tutti) | **2 "recreational"** | via scraping |
| Sharp nel free | **Pinnacle, Singbet, SBOBet** | **no** (solo a pagamento) | dipende dai book |
| Exchange nel free | **Betfair Exchange** | no | dipende |
| Tornei minori | **9.600+ leghe / 69 sport** | 12.000+ leghe | ampio |
| Storico nel free | **incluso**, no moltiplicatore | non specificato | via scraping |
| Accesso | API REST documentata (+WebSocket a pagamento) | API REST documentata | **no API: scraping**, robots.txt/ToS lo scoraggiano |
| Copertura title | 370 book | 265+ book, 12.000+ leghe | 80+ book, open→close |
| Pro (pagato) | ~$49/mese | da ~£49/mese (2 book) → £229 (15 book) | n/a |
| Rating rivenditori | 6.5/10 | — | — |

### Lettura della tabella (i punti che decidono)

- **OddsPapi** è l'unico in cui il **free tier include TUTTO**: tutti i
  348–370 bookmaker, gli sharps (Pinnacle/Singbet/SBOBet), le exchange
  (Betfair), lo storico gratis e **9.600+ leghe** (i minori). Costo piatto
  e prevedibile: `250 richieste/mese` = tante quante le richieste, non
  "crediti" che si moltiplicano per mercato/regione.
- **odds-api.io** ha la copertura nominale più alta (12.000+ leghe, 265+
  book), ma il **free tier è mutilato**: solo **2 bookmaker recreational**,
  **nessun sharp** (a pagamento), e — critico — **le nuove chiavi gratuite
  sono in pausa a tempo indeterminato**. Quindi non è testabile gratis e
  non dà gli sharps al costo zero.
- **OddsPortal** è il "sogno" (per-bookmaker con apertura→chiusura, tutti i
  mercati) ma **non ha API**, il robots.txt scoraggia l'accesso, la ToS
  vieta il riuso commerciale, e richiede **proxies + anti-bot + browser
  automation + manutenzione continua** (alto rischio di blocco IP, oppure
  costo di un servizio di scraping a pagamento). È la scelta a più alto
  rischio e manutenzione, in contrasto con la filosofia del progetto
  (fonte affidabile, budget dichiarato, niente fragile).

**Vincolo esplicito del progetto.** Il repository usa `robots.txt`/ToS come
confine per BetExplorer ("le quote dei singoli book stanno dietro endpoint
AJAX vietati dal robots.txt"). Usare OddsPortal violerebbe lo stesso
principio di cortesia/legalità che il progetto applica a BetExplorer. Quindi
OddsPortal è da scartare per coerenza con la dottrina del progetto.

---

## 3. VALUTAZIONE e RACCOMANDAZIONE

**Raccomandazione: OddsPapi come fonte per-bookmaker.**

Motivi:
1. **Free tier con gli sharps e i minori** — la cosa che serve al concetto.
   Unici tra quelli analizzati a includere Pinnacle/Singbet/Betfair Exchange
   e 9.600+ leghe nel piano gratuito.
2. **Costo piatto e prevedibile** — 1 request = 1 request (tutta la board),
   non "crediti" variabili. Il budget si governa come si fa già con
   `odds-api-budget.ts`.
3. **API documentata** — REST JSON, niente scraping.
4. **Storico incluso gratis** — utile per il CLV/backtest, che è la misura
   di riferimento dell'osservatorio.

**Perché non odds-api.io**: il free tier non ha i bookmaker giusti (2
recreational, no sharps) e le chiavi gratuite sono sospese. Servirebbe un
piano a pagamento per avere gli sharps → costo mensile ricorrente per
provare il concetto. Non giustificato prima di un POC.

**Perché non OddsPortal**: nessuna API, robots.txt/ToS contrari, scraping
fragile e costoso (proxies/anti-bot/manutenzione), in contrasto con la
dottrina di cortesia del progetto.

---

## 4. Effort di integrazione concreto (verificato sull'architettura)

L'architettura è già pronta: `OddsProvider` (interfaccia), registry
(`registerProvider`), ingest (`ingest-snapshots.ts` → `writeProviderSnapshots`
→ `ensureBookmaker`, che già mappa `isSharp`), e `the-odds-api.ts` come
**template da clonare**. Per aggiungere OddsPapi servirebbe:

1. **Nuovo provider** `provide/optional/oddspapi.ts` — implementa `OddsProvider`
   (clone di `createTheOddsApiProvider`), attivo dietro flag-ambiente (default OFF).
2. **Client + parser** `oddspapi-client.ts` / `oddspapi-parse.ts` — chiama
   `/fixtures`, `/odds`; legge `bookmakerOdds`, `markets`, `outcomes`.
3. **Mappa sportId/lega → sportKey** — come `sport-keys.ts` (solo le leghe
   verificate nel catalogo reale, prima via `/sports`).
4. **Mappa bookmaker → `bookmakerKey` + `isSharp`** — `pinnacle`, `singbet`,
   `sbobet`, `betfair-exchange` → `isSharp=true`; il resto `false`.
5. **Mappa mercati** — `moneyline` → `1x2`, `totals`/`over_under` → `ou_2_5`,
   `btts` → `btts`.
6. **Registrazione** in `src/lib/providers/index.ts`.
7. **Budget** — estensione/modula di `odds-api-budget.ts` (tetto =
   richieste/mese, `decide()` come unico gate).
8. **Fixture congelata + test** dello schema reale (come già si fa per The
   Odds API) e **smoke test live** con chiave reale prima di attivare.

### Il difetto da risolvere (fondamentale)

Come documentato in `STUDIO-CABLAGGIO-ODDS.md` §4.7: se si scrive la fonte
per-bookmaker in `odds_snapshots`, il motore va **istruito a distinguere il
consenso dai bookmaker reali**, altrimenti `consensusAt` (mediana di tutte le
serie) e `computeCoordination` (conta il consenso come un book) **distorcono
i segnali esistenti**. Con la fonte nuova entrano DAVVERO più bookmaker in
`odds_snapshots`, quindi questo passo non è più rimandabile: va fatto insieme
all'integrazione, con test dedicati (non-regressione sui segnali esistenti).

O la fonte si usa **solo** per la linea sharp della scheda partita (percorso
`getSharpLine`, che NON scrive in `odds_snapshots`, e quindi non inquina ma
non accende la coordinazione in lista) — O si scrive in `odds_snapshots` E si
corregge il motore.

---

## 5. Cosa propongo di fare (ordinato)

1. **POC dietro flag default-OFF**: adapter OddsPapi + client + parser +
   fixture + test, **senza** toccare il motore né `odds_snapshots`.
2. **Smoke test live** (l'umano, con chiave in ambiente Vercel) per verificare
   lo schema reale e il matching dei nomi, come si è fatto per The Odds API
   il 06/09/2026.
3. **Se il POC conferma la copertura**, decidere l'innalzamento: correggere
   il motore (escludere `isConsensus` da `consensusAt`/`computeCoordination`)
   + scrivere in `odds_snapshots` per i segnali attivi, dietro flag.
4. **Poi** la vista "match sospetti" ordinata per `confidenceScore`, con
   bookmaker concordi e contesto/notizie a fianco, e bandiera BET solo dove
   esiste prezzo eseguibile.

**Ordine dei passi 1–4 è importante**: si misura e si valida PRIMA, si
attiva la modifica al motore DOPO, e sempre dietro flag.

### 5.1 POC costruito (09/09/2026) — solo parser + client + test, niente motore/DB

È stato costruito il **POC credibile** dell'adapter OddsPapi, limitato a ciò
che non tocca il core del sistema (motore e `odds_snapshots` non sono stati
toccati):

- `src/lib/providers/optional/oddspapi-odds.ts` — **parser puro** che traduce
  la risposta `/odds` di OddsPapi in `OddsQuoteDTO[]`, con le regole di
  onestà del progetto (ogni book è una riga reale; `isSharp` dalla key
  dichiarata, mai dal prezzo; esiti non risolvibili contati, mai indovinati).
- `src/lib/providers/optional/oddspapi-client.ts` — **client HTTP** verso
  `/odds`, con gestione errori (parse/network/429/disabled) e distinzione
  onesta tra "struttura cambiata" (errore parse) e "nessun evento" (parziale).
- fixture congelata `oddspapi-odds.json` + test
  (`oddspapi-odds.test.ts` 12 test, `oddspapi-client.test.ts` 6 test).

**Contratto dati VERIFICATO (09/09/2026) su `oddspapi.io/en/docs`.** Non è più
necessario risolvere "per nome" né indovinare lo schema delle chiavi: la
documentazione pubblica di OddsPapi (`GET /sports`, `GET /markets`,
`GET /odds`) è stata letta e conferma la tassonomia:

- **Sport**: il calcio è `sportId: 10` (`slug: "soccer"`).
- **1X2** (Full Time Result) = `marketId 101`, con esiti `101="1"` (casa),
  `102="X"` (pareggio), `103="2"` (trasferta), `marketType: "1x2"`.
- **Over/Under 2.5** = `marketId 1010`, con esiti `1010=Over`, `1011=Under`.
- **Risposta `/odds`**: `bookmakerOdds[slug].markets[marketId].outcomes[
  outcomeId].players["0"].price` (quota decimale); `bookmakerIsActive`,
  `marketActive` e `active` su ogni esito. I nomi squadra stanno a livello
  top (`participant1Name`/`participant2Name`), **non** sugli esiti.

Quindi la selezione si risolve per **ID di esito verificato** (101/102/103 e
1010/1011): è la strada onesta e precisa. Il fallback per nome non è più
necessario perché la fonte non pubblica un `name` sugli esiti; un ID di esito
non gestito o inattivo viene **contato**, mai indovinato. Questo è anche il
motivo per cui la prima bozza (che assumeva 131/132/133 e risolveva per nome)
è stata **sostituita** da mappatura ID verificata.

**Nota sull'ambiente:** `node_modules` non è persistito nel sandbox; i test
OddsPapi passano con `npm run test:odds-oddspapi` (18 verdi) e `npm run
typecheck` è pulito. Il tutto è accanto agli altri test Odds (`test:odds-*`),
già tutti verdi.

---

## 6. Cosa NON fare

- **Non** scegliere OddsPortal per coerenza con la dottrina (scraping
  contro robots/ToS) e per il costo nascosto di manutenzione/anti-bot.
- **Non** scegliere odds-api.io al posto di OddsPapi: free tier senza sharps,
  chiavi gratuite sospese → servirebbe subito un piano a pagamento.
- **Non** scrivere la fonte in `odds_snapshots` senza la correzione al
  motore (distorcerebbe i segnali esistenti).
- **Non** presentare il "match sospetto" come BET senza prezzo individuale
  fresco (gate `PRICE_NOT_EXECUTABLE`).
