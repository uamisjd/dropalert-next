# Sprint 7 — Il tempo passa da solo

**Obiettivo:** togliere all'osservatorio la dipendenza da chi preme un
pulsante. Fino a ieri la serie storica avanzava solo quando qualcuno chiedeva
un giro; da adesso avanza perché passa il tempo.

Perimetro rispettato: nessun CLV, nessuna notifica, nessuna GitHub Action,
nessun collector nuovo, nessuna UI oltre la riga «prossimo giro fra X min».

---

## 1. File modificati

| File | Cosa cambia |
|---|---|
| `src/instrumentation.ts` | **nuovo** — `register()`, unico punto di avvio del runner |
| `src/lib/pipeline/collect-loop.ts` | **nuovo** — timer in-process, un giro alla volta, errori non spengono |
| `src/lib/pipeline/scheduler.ts` | intervallo 15 → **45 min**, `CycleOptions.trigger`, stato `scheduler:loop`, `minutesUntil` |
| `src/lib/providers/betexplorer/collect.ts` | opzioni `trigger`/`retryNotReached`/`sleep`, **fase 3-bis** di retry, `retry` nel report e in `meta` |
| `src/lib/cov/instrument.ts` | `RunTrigger`, `trigger` nel punto serie, `scheduledPoints`/`manualPoints`, soglia sui soli schedulati, `selectRetryTargets` |
| `src/lib/cov/view.ts` | `manualRuns`, `nextRunMinutes`, `schedulerLabel`, `runs = scheduledPoints` |
| `src/lib/repo/coverage-history.ts` | `SchedulerStatus`, `readSchedulerStatus(now)`, parametro `now` |
| `src/app/api/cov/route.ts` | `scheduler` in risposta, `scheduledRuns`/`manualRuns` in `history` |
| `src/components/CoveragePanel.tsx` | riga giri manuali fuori soglia, riga stato runner |
| `src/components/CoverageSummary.tsx` | riga stato runner |
| `src/app/cov/page.tsx`, `src/app/page.tsx` | passano `scheduler` e `now` alla vista |
| `src/app/cov/actions.ts` | `collectBetexplorer({ trigger: "manual" })` esplicito |
| `src/lib/pipeline/__tests__/pipeline.test.ts` | **correzione**: lo stato dello scheduler viene preso in prestito e ripristinato |
| `src/lib/cov/__tests__/{coverage,view}.test.ts` | +14 e +6 casi |
| `src/lib/pipeline/__tests__/scheduler.test.ts` | **nuovo** — 17 casi |
| `docs/SCHEDULING.md` | **riscritto** (dichiarava «nessun demone, nessun setInterval») |
| `package.json`, `.env` | script `test:scheduler`; `SCHEDULER_ENABLED`, `COLLECT_INTERVAL_MINUTES` |

## 2. Funzioni create

`startCollectLoop()`, `stopCollectLoop()`, `currentLoop()`, `schedulerEnabled(env)`,
`register()`, `readLoopState()`, `writeLoopState()`, `minutesUntil(nextRunAt, now)`,
`triggerOfRun(meta)`, `selectRetryTargets(input)`, `readSchedulerStatus(now)`.

Costanti: `FIRST_RUN_DELAY_MS = 30_000`, `RETRY_DELAY_MS = 60_000`,
`MAX_ATTEMPTS_PER_ROW = 2`, `LOOP_STATE_KEY`, `RUN_TRIGGERS`,
`DEFAULT_INTERVAL_MINUTES = 45`.

## 3. API e tabelle

**Nessuna tabella nuova, nessuna migrazione.** Lo stato del runner sta in
`system_state['scheduler:loop']`, che è la tabella chiave/valore già
esistente. L'origine del giro sta in `collector_runs.meta.trigger`, dentro un
`jsonb` già presente: i giri vecchi restano leggibili e valgono `manual`.

`GET /api/coverage` guadagna `scheduler{running, intervalMinutes,
nextRunMinutes, cyclesCompleted}` e `history.scheduledRuns` /
`history.manualRuns`. Nessuna rotta nuova; `POST /api/jobs/analyze` invariato.

## 4. Test

**389 su 389**, da 352. Nuovi: 17 scheduler (intervallo, clamp, fallback su
valore illeggibile, interruttore, gate, conto alla rovescia), 14 copertura
(bersagli del retry, esclusioni dal retry, origine dei giri), 6 vista (tre
varianti della riga runner, soglia sui soli schedulati).

Il test che conta più degli altri: **i bersagli di `selectRetryTargets` sono
esattamente le righe che `buildRunCoverage` etichetta `not_reached`**,
verificato su quattro configurazioni. Sono due funzioni separate che devono
concordare; se divergessero, il giro ritenterebbe righe diverse da quelle che
poi dichiara perse.

Catena completa: `next typegen` → `tsc --noEmit` pulito →
`eslint --max-warnings=0` pulito → `npm run build` → server avviato.

## 5. Verifica sul campo

```
[scheduler] runner schedulato acceso: un giro ogni 45 minuti
            (intervallo da COLLECT_INTERVAL_MINUTES), primo giro fra 30 secondi.
[scheduler] giro success: 30 quote scritte, 34 partite analizzate.
```

Run **195**, `trigger = scheduled`, 10 righe di calcio, 10 importate, 0 perse,
copertura 100%, `retry.attempted = 0`. `scheduler:loop` riporta
`nextRunAt` a +45 minuti. Il pannello scrive:

> 1/10 giri — Serie insufficiente, niente tendenza.
> Osservazione iniziata da 11.5 ore, su 6 giri (1 schedulati, 5 chiesti a mano).
> I 5 giri chiesti a mano restano nei totali ma non contano per la soglia.
> Raccolta automatica ogni 45 minuti: prossimo giro fra 45 min.

## 6. Un difetto trovato mentre verificavo

Il primo giro schedulato è partito e **non ha raccolto niente**: il gate
dell'intervallo lo ha bloccato.

La causa non era nello scheduler. `pipeline.test.ts` verifica il gate
scrivendo `scheduler:last_cycle = adesso`, e non lo ripristinava. Quella
chiave è la stessa su cui si regge il runner in produzione: **ogni corsa di
`npm run test:all` lasciava lo scheduler reale ingabbiato per 45 minuti**, con
i sintomi di un runner rotto e nessuna traccia della causa.

Corretto nel test, non nel prodotto: lo stato viene letto prima di essere
toccato e rimesso com'era in `cleanup()`, anche in caso di errore. Riverificato
da zero: secondo avvio, 30 quote scritte.

Vale la pena registrarlo perché è il tipo di difetto che si sarebbe
manifestato fra settimane, come «la serie ogni tanto non avanza».

## 7. Cosa manca

- **La serie schedulata è a 1/10.** Con 45 minuti servono ~7 ore per la
  soglia. I 5 giri manuali precedenti restano nella misura ma non contano:
  giri ravvicinati su richiesta sono la stessa fotografia ripetuta.
- **Il runner vive quanto il processo.** Se il server si riavvia, riparte con
  `register()` e il primo giro arriva 30 s dopo; se il processo muore, muore
  con lui. Non c'è supervisore, e questo è dichiarato.
- **Risoluzione sui flash.** 45 minuti contro `FLASH_WINDOW_MINUTES = 30`: un
  movimento più corto di mezz'ora può cadere interamente fra due osservazioni.
  Perdita nota e accettata, non un difetto nascosto.
- **La fase 3-bis non è mai stata esercitata su un caso reale**: tutti i giri
  di oggi hanno copertura 100%, `retry.attempted = 0`. È coperta dai test, non
  dal campo.
- Gap aperti invariati: 24 `SOURCE_MISSING` per-book (robots), `sharpConfirms`
  null, CLV sotto le 30 osservazioni.

## 8. Prossimo sprint consigliato

**Lasciare girare, poi leggere la serie.** Fra circa 7 ore ci saranno 10 giri
schedulati e il pannello smetterà da solo di dire «serie insufficiente». Il
lavoro successivo dovrebbe partire da quei numeri, non da un'idea a priori: se
la copertura resta al 100% su dieci giri distanziati, la misura è chiusa e ha
senso passare al CLV; se compaiono `not_reached` ricorrenti, il primo lavoro è
lì, e il campo `retry.stillMissing` dirà se il secondo tentativo serve o se il
problema è a monte.
