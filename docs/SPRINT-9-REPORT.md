# Sprint 9 — La raccolta raccontata dall'archivio, ieri e domani

**Perimetro:** cinque modifiche, un filo solo. Chi avanza la serie non è il
processo che serve la pagina, e la pagina deve dirlo con i fatti letti
dall'archivio, non con la riga di stato di un processo che può essere spento
o morto. E due letture nuove: che cosa è successo ieri, che cosa c'è domani.

---

## 1. `/coverage`: la raccolta automatica è GitHub Actions

La riga «Raccolta automatica non attiva: la serie non avanza da sola» —
stampata dallo Sprint 8 quando il runner in-process era spento — con la
produzione su GitHub Actions era diventata **falsa**: la serie avanza lo
stesso, la avanza il cron del workflow. Una frase falsa è peggio di nessuna
frase.

La riga è rimossa. Al suo posto, tre righe nuove lette **dall'archivio**
(`collector_runs`, `meta.trigger = "scheduled"`), non dalla riga di stato:

- «Raccolta automatica via GitHub Actions: cron «7,52 * * * *», circa un
  giro ogni 45 minuti.» — «circa» perché il cron alterna 45 e 75 minuti;
- «Ultimo giro schedulato (run N): esito riuscito.» con data, ora e
  distanza dal presente;
- un avviso ambra quando il silenzio supera i **90 minuti** (2 × intervallo,
  la stessa regola del runner): «Nessun giro schedulato da 2 h 32 min:
  oltre i 90 minuti attesi, la raccolta automatica potrebbe essersi
  fermata.»

La soglia è *oltre*, non *oltre-o-uguale*: a 90 minuti esatti il ritardo è
ancora dentro due intervalli, non è un fermo. E un avviso che compare solo
quando c'è motivo di allarmarsi avverte davvero: per questo non è mai
abbinato a un orario del processo web, che su Vercel non sopravvive fra due
richieste.

La riga del runner in-process resta **solo quando un processo vivo la
sostiene**: acceso (conto alla rovescia) o incerto (silenzio oltre due
intervalli). Spento, non dice più niente: parla l'archivio.

`GET /api/coverage` espone lo stesso blocco sotto `githubActions`.

## 2. `/coverage`: il 429 della fonte, riga ambra separata

Il rate-limit subito dalla fonte (429) è un limite di essa, non una perdita
del monitor. Il pannello di copertura ora lo dichiara in una riga ambra
propria, letta da `source_health` (`last_rate_limit_at`, `rate_limit_count`)
in un **try/catch separato**: se la tabella non è leggibile, la misura di
copertura resta valida e la riga semplicemente non compare. Mai cadere per
un'annotazione.

## 3. `/ieri`: esiti dai gol finali, mai dal CLV

Pagina nuova, indirizzo `/ieri`. I segnali le cui partite si sono giocate
ieri (giornata civile italiana), ciascuno con l'esito descrittivo:

| Verdetto | Regola |
|---|---|
| `centrata` / `mancata` | calcolata **dai gol finali registrati** in `matches` |
| `in_attesa` | nessun risultato registrato: non si indovina |

Il calcolo vive in `src/lib/settle/outcome.ts`, **modulo puro**: una regola
dichiarata per selezione (1X2, Over/Under 2.5, BTTS), switch esaustivo — se
l'enum cresce, la compilazione si rompe invece di lasciare una selezione
senza verdetto. Il CLV non è letto nemmeno per sbaglio: un test verifica
che il modulo non lo nomini. Esito e CLV misurano cose diverse e la pagina
lo dichiara: l'esito dice che cosa è accaduto in campo, il CLV resta
l'unica misura di qualità del monitor.

Sotto **10 esiti risolti** (centrate + mancate; le «in attesa» non contano)
la pagina dice: «N esiti risolti su 10: non è una tendenza». E l'avviso
fisso, sempre: **«Non è un rendimento né un consiglio.»**

## 4. `/domani`: programma dall'archivio

Pagina nuova, indirizzo `/domani`. Le partite con kickoff domani che
l'archivio ha già incontrato. **Non è un calendario**: l'elenco nasce dai
movimenti esposti dalla fonte, e l'empty state lo dice — un'assenza qui è
un'assenza di osservazioni, non un'assenza di calcio.

- partite con quote: ultima rilevazione per selezione (`DISTINCT ON`
  ordinato per istante: la lettura più recente, non una media), numero di
  rilevazioni in archivio;
- partite senza quote: restano in elenco con la nota **«Quote in arrivo»**,
  ambra — già osservazioni, non ancora misure.

## 5. Link

`/ieri` e `/domani` sono raggiungibili dalla dashboard (sotto
l'intestazione) e dal dettaglio partita (in alto a destra), accanto al
ritorno all'elenco.

---

## File modificati

| File | Modifica |
|---|---|
| `src/lib/cov/actions.ts` | **nuovo** — costanti cron/intervallo/soglia, `buildActionsView()`, `formatDuration()`, puri |
| `src/lib/cov/view.ts` | `CoverageView` += `actions`; `buildSchedulerLabel` non ha più il ramo «non attiva» |
| `src/lib/repo/coverage-history.ts` | + `readLastScheduledRun()` (try/catch proprio, `meta->>'trigger'`) |
| `src/lib/repo/source-rate-limit.ts` | **nuovo** — `readRateLimitNotice()` da `source_health` |
| `src/lib/settle/outcome.ts` | **nuovo** — `outcomeOf()`, `tallyOutcomes()`, `isUnderpowered()`, soglie e avvisi |
| `src/lib/settle/__tests__/outcome.test.ts` | **nuovo** — 27 test |
| `src/lib/repo/yesterday.ts` | **nuovo** — segnali di ieri, giornata italiana decisa da PostgreSQL |
| `src/lib/repo/tomorrow.ts` | **nuovo** — programma di domani, `selectDistinctOn` per l'ultima quota |
| `src/app/ieri/page.tsx` | **nuova** pagina |
| `src/app/domani/page.tsx` | **nuova** pagina |
| `src/app/cov/page.tsx` | riga Actions + lettura rate-limit in try/catch separato |
| `src/app/api/cov/route.ts` | + blocco `githubActions` |
| `src/components/CoveragePanel.tsx` | righe Actions nel riquadro profondità; riga ambra 429 |
| `src/components/CoverageSummary.tsx` | riga Actions compatta |
| `src/app/page.tsx`, `src/app/matches/[id]/page.tsx` | link a /ieri e /domani |
| `src/lib/pipeline/scheduler.ts` | solo commento: `off` non significa più «la serie non avanza» |
| `src/lib/cov/__tests__/view.test.ts` | ramo «non attiva» rimosso; +9 test Actions |
| `package.json` | + `test:settle`, in `test:all` |
| `docs/SCHEDULING.md` | §6 e §8 riscritte sulla riga Actions |
| `docs/BACKLOG.md` | due limiti nuovi dichiarati (/domani, /ieri) |

**Funzioni create:** `buildActionsView`, `minutesBetween`, `formatDuration`,
`runStatusLabel`, `readLastScheduledRun`, `readRateLimitNotice`, `outcomeOf`,
`tallyOutcomes`, `settledCount`, `isUnderpowered`, `getYesterdayView`,
`getTomorrowView`.
**API/tabelle:** nessuna nuova tabella; `GET /api/coverage` espone
`githubActions`.

---

## Test

`npm run test:all` (esclusa la pipeline, che richiede PostgreSQL): **399
superati / 0 falliti** così ripartiti — 53 engine + 68 view + **27 settle**
+ 91 coverage + **46** cov-view (era 37) + 26 scheduler + 49 providers +
39 betexplorer.

Validazioni: `next typegen` OK, `tsc --noEmit` pulito, `eslint
--max-warnings=0` pulito, `npm run build` OK (11 rotte, incluse `/ieri` e
`/domani`).

---

## Cosa manca

- **Il campo resta da provare con dati veri**: le pagine nuove sono state
  validate su tipi, build e moduli puri, ma l'HTML prodotto va verificato
  con l'archivio popolato (PostgreSQL locale acceso o Neon).
- **`/ieri` non misura qualità**: è dichiarato; il CLV resta l'unica metrica
  di validità e resta sotto la soglia delle 30 osservazioni.
- **`/domani` copre solo ciò che la fonte espone**: gap strutturale già al
  punto 1 del backlog (copertura per competizione).
- La riga Actions legge i run del collector, non lo stato del workflow
  GitHub: se Actions fosse disattivato con l'ultimo run riuscito recente,
  il pannello non può saperlo. Il limite è l'assenza di una API pubblica
  gratuita dello stato dei workflow — dichiarato qui invece che finto.

## Prossimo sprint

Nessuno deciso: prima si lascia accumulare serie schedulata dal cron, poi
si decide sui numeri misurati.
