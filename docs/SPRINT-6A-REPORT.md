# Sprint 6A — Misura della copertura

**Data di esecuzione:** 18 agosto 2026, 22:44 (Europe/Rome) — `2026-08-18T20:44Z`
**Perimetro:** sola diagnosi. Zero codice di parsing, zero modifiche agli adapter, nessuna nuova fonte, nessun dato aggiustato.
**Verifica di non invasività:** prima e dopo la misura il database contiene **19 match, 30 gap, 255 snapshot, 9 collector_runs**. Invariato.

---

## 1. File creati

| File | Contenuto |
|---|---|
| `src/lib/coverage/scan.ts` | Funzioni **pure** della misura: conteggio grezzo delle righe della fonte, classificazione delle cause, aggregazione per competizione, tabelle testuali, lettura dei numeri. |
| `src/lib/coverage/__tests__/coverage.test.ts` | 44 test, nessuna rete, nessun database. |
| `src/scripts/run-coverage.ts` | CLI della misura: interroga la fonte una volta, confronta con il DB, salva il report timestampato. |
| `src/app/api/coverage/report/route.ts` | `GET /api/coverage/report` — stessa misura via HTTP, sola lettura. |
| `docs/coverage/coverage-2026-08-18T2044Z.{json,txt}` | Report salvato dell'esecuzione di oggi. |

**File modificato:** `package.json` — aggiunti `test:coverage` e `report:coverage`, e `test:coverage` inserito in `test:all`.

Nessun altro file toccato. Parser, adapter, motore e schema del database sono rimasti come erano.

---

## 2. Funzioni create

**`src/lib/coverage/scan.ts`**

| Funzione | Cosa fa |
|---|---|
| `scanSourceRows(html)` | Riconta le righe dell'elenco in modo grezzo (solo torneo + id partita). È una copia deliberata della regex dell'adapter: serve a contare **anche** le righe che il parser scarterebbe. |
| `classifyDataGap(gap)` | Attribuisce una causa a un buco già registrato, dal motivo salvato e dalle capacità dichiarate delle fonti attive. |
| `classifySourceRow(input)` | Stabilisce che fine ha fatto una riga vista sulla fonte: importata con serie, importata senza serie, persa (con causa). |
| `aggregateByCompetition(verdicts, labels)` | Raggruppa per torneo e calcola il delta, ordinando per perdita decrescente. |
| `countCauses`, `emptyCauseCounts`, `dominantCause` | Conteggi sulle quattro cause. |
| `recommendationFor(counts)` | Traduce la causa dominante nell'unica conseguenza operativa che i numeri sostengono. |
| `renderTable`, `competitionTableRows`, `compressFragment`, `isRealFixtureKey` | Resa testuale e utilità. |

**Tipi:** `GapCause`, `GapClassification`, `SourceScan`, `SourceRowScan`, `ProbeOutcome`, `SourceRowVerdict`, `CompetitionRow`.

---

## 3. API e tabelle

- **API creata:** `GET /api/coverage/report` (sola lettura).
  - senza parametri: misura sul solo database, e **dichiara** che il confronto con la fonte non è stato fatto;
  - `?live=1`: una richiesta alla fonte, confronto per competizione;
  - `?horizon=H`: finestra in avanti, default 72h come il collector;
  - se la fonte non risponde: `FONTE BLOCCATA`, nessun numero stimato al suo posto.
- **CLI:** `npm run report:coverage` (`-- --probe=N`, `--json`, `--no-save`, `--out=DIR`, `--horizon=H`).
- **Tabelle create o modificate: nessuna.** Lo sprint non scrive sul database.

---

## 4. Test

| Suite | Esito |
|---|---|
| `test` (motore) | 53 / 53 |
| `test:view` | 68 / 68 |
| `test:pipeline` | 40 / 40 |
| `test:providers` | 49 / 49 |
| `test:betexplorer` | 39 / 39 |
| **`test:coverage` (nuova)** | **44 / 44** |
| **Totale `test:all`** | **293 / 293, 0 falliti** |

**Validazioni:** `next typegen` ✅ · `tsc --noEmit` ✅ · `eslint src --max-warnings=0` ✅ · `npm run build` ✅ (rotta `ƒ /api/coverage/report` presente) · server avviato e interrogato via HTTP ✅.

---

## 5. La misura, sui dati reali di oggi

### Fonte

| Voce | Valore |
|---|---|
| URL | `https://www.betexplorer.com/dropping-odds/` |
| Esito | HTTP 200, 169 433 byte, 923 ms |
| Righe totali del documento | 73 |
| Righe partita (tutti gli sport) | 25 |
| **Righe di calcio** | **9** |
| Righe partita di altri sport | 16 (tennis, pallavolo — campioni grezzi allegati al report) |
| Accettate dal parser | 9 |
| **Scartate dal parser** | **0** |

### Copertura per competizione

| Competizione | Fonte | Importate | Con serie | Perse | Delta |
|---|---:|---:|---:|---:|---:|
| Slovakia · Slovak Cup | 2 | 1 | 1 | 1 | −1 |
| Bolivia · Copa Paceña | 1 | 0 | 0 | 1 | −1 |
| Japan · Emperor's Cup | 2 | 2 | 2 | 0 | 0 |
| Denmark · A-Liga Women | 1 | 1 | 1 | 0 | 0 |
| North & Central America · Concacaf Central American Cup | 1 | 1 | 1 | 0 | 0 |
| Saudi Arabia · Saudi Professional League | 1 | 1 | 1 | 0 | 0 |
| Sweden · Svenska Cupen | 1 | 1 | 1 | 0 | 0 |

**Totale: 9 sulla fonte · 7 importate (77,8%) · 7 con serie (77,8%) · 2 perse.**

Ogni partita importata ha una serie storica: non ci sono anagrafiche vuote.

### Cause dei 30 buchi aperti

| Causa | N | Quota |
|---|---:|---:|
| `SOURCE_MISSING` | 24 | 80,0% |
| `ENTRY_MISSED` | 0 | 0,0% |
| `MATCH_FAILED` | 0 | 0,0% |
| `OTHER` | 6 | 20,0% |
| **Totale** | **30** | **100%** |

**Dettaglio:**

- **24 × `SOURCE_MISSING` / `PER_BOOK_NOT_PUBLISHED`** — tutti su partite reali `be-`. BetExplorer pubblica solo la quota di consenso; le quote per singolo bookmaker stanno dietro chiamate con query string, vietate dal suo `robots.txt`. Frammento reale registrato: *«BetExplorer espone solo la quota di consenso… La fonte dichiara 18/19 bookmaker concordi, ma non espone le singole quote.»*
- **6 × `OTHER` / `NON_REAL_FIXTURE`** — buchi appartenenti alle fixture dimostrative (`demo-*`). Non misurano la copertura del collector e sono esclusi dal conteggio utile, non nascosti.

### Cause delle 2 righe perse (verifica con `--probe=10`)

| Causa | N |
|---|---:|
| `ENTRY_MISSED` / `NOT_REACHED` | 2 |

Entrambe le partite — `nTDIqdmo` (Bolivia · Copa Paceña, The Strongest – Oriente Petrolero) e `lrPUpcv2` (Slovakia · Slovak Cup, Nová Dedinka – Petržalka) — hanno riga leggibile, orario valido e kickoff **dentro** la finestra interrogata. La fonte le mostra; noi non le abbiamo prese. Frammenti grezzi allegati al report.

Senza la verifica delle pagine partita (`--probe=0`, comportamento predefinito) queste due righe restano `OTHER` / `NOT_VERIFIED`: la causa non viene indovinata.

### Quadro complessivo (32 elementi classificati)

| Causa | N | Quota |
|---|---:|---:|
| `SOURCE_MISSING` | 24 | 75,0% |
| `ENTRY_MISSED` | 2 | 6,3% |
| `MATCH_FAILED` | 0 | 0,0% |
| `OTHER` | 6 | 18,8% |

---

## 6. Cosa dicono i numeri

**Tre fatti, in ordine di importanza.**

1. **Il parser non perde nulla.** 9 righe di calcio sulla fonte, 9 accettate, 0 scartate, `MATCH_FAILED` = 0. L'ipotesi «stiamo perdendo partite per errori di lettura o di aggancio dei nomi» è **falsificata dai dati di oggi**. Qualsiasi lavoro sulla normalizzazione dei nomi sarebbe stato speso su un problema che non esiste.

2. **Il 75% dei buchi non è recuperabile con il nostro codice.** I 24 `SOURCE_MISSING` sono la conseguenza diretta di una decisione già presa e documentata: rispettare il `robots.txt`. Non è un difetto da correggere, è un limite da dichiarare — ed è già dichiarato in `data_gaps` e mostrato in interfaccia.

3. **La perdita reale è piccola e ha una causa sola: il punto di ingresso.** 2 partite su 9 (22,2%), entrambe `ENTRY_MISSED` / `NOT_REACHED`. Non sono uscite dalla finestra e non sono illeggibili: semplicemente il giro di raccolta non le ha raggiunte. Il sospetto sul tetto `maxFixtures = 25` **non è confermato** da questi numeri, perché oggi la fonte espone appena 9 righe di calcio: il tetto non è mai stato toccato. La causa concreta va cercata altrove nel giro di raccolta.

**Un limite onesto di questa misura:** è una fotografia a un istante, su 9 righe. Un elenco così corto rende ogni percentuale fragile. Le due partite perse valgono il 22% oggi e potrebbero valere lo 0% domani. Il campione è troppo piccolo per una diagnosi definitiva, e questo report lo dichiara invece di arrotondare.

---

## 7. Cosa manca

- Nessuna misura ripetuta nel tempo: una sola fotografia, senza storico della copertura.
- Le righe di altri sport (16 su 25) sono contate ma non distinte fra «normale» e «markup cambiato»: da questa misura non è possibile separarle.
- La copertura non è esposta in interfaccia: vive in CLI e API.
- La causa precisa dei due `NOT_REACHED` non è determinata — sappiamo *dove* si perdono, non *perché*.

---

## 8. Sprint 6B consigliato — guidato dai numeri

**Titolo: trovare la causa dei `NOT_REACHED` e misurare la copertura nel tempo.**

I numeri escludono due strade e ne indicano una:

- ❌ **niente lavoro sul parser** — `MATCH_FAILED` = 0;
- ❌ **niente nuova fonte per il per-book** — i 24 `SOURCE_MISSING` sono una scelta consapevole sul `robots.txt`, non un buco da tappare di corsa;
- ✅ **istruire il giro di raccolta** — è l'unica causa recuperabile misurata.

Proposta in tre passi:

1. **Tracciare il giro di raccolta.** Registrare in `collector_runs.meta` quali `providerMatchId` sono stati visti nell'elenco e quali sono stati effettivamente lavorati, con il motivo dell'esclusione. Oggi la differenza fra «visto» e «importato» si ricostruisce solo dall'esterno, come ha dovuto fare questo strumento.
2. **Far girare la misura a ogni raccolta** e salvarne l'esito, per avere la copertura come serie storica invece che come fotografia. Con 9 righe al giorno servono più giorni prima di poter dire qualcosa di solido.
3. **Solo dopo**, con i due punti sopra in mano, correggere la causa dei `NOT_REACHED`.

Prima si guarda dentro il giro di raccolta, poi si corregge. Al contrario si correggerebbe un'ipotesi.

---

## 9. Riepilogo

Strumento di misura costruito ed eseguito sui dati reali del 18 agosto 2026. Copertura **7 su 9 (77,8%)** su 7 competizioni. Tutti e 30 i buchi aperti classificati: **24 `SOURCE_MISSING`, 6 `OTHER` dichiarati** (fixture dimostrative), **0 `MATCH_FAILED`**; le 2 righe perse sono **`ENTRY_MISSED` / `NOT_REACHED`**, con frammento grezzo allegato. Report timestampato in `docs/coverage/`. Suite a **293/293**, validazioni verdi, **database invariato**.

---

*DropAlert è un osservatorio statistico sui movimenti di quota. Questo documento descrive la copertura dei dati raccolti e non contiene indicazioni di scommessa.*
