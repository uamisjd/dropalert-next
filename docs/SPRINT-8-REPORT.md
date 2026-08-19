# Sprint 8 — Verità dello stato del runner

**Perimetro:** un solo difetto, quello trovato durante la verifica dello
sprint 7. Nessun'altra modifica.

---

## 1. Il difetto

La riga `system_state['scheduler:loop']` conteneva `running: true` e un
`nextRunAt` nel futuro, scritti da un processo che non esisteva più. Nessuno
la correggeva: un processo che muore — riavvio, reset dell'ambiente, crash —
non ha modo di chiudere il proprio stato.

Conseguenza osservata sul campo: un server avviato con `SCHEDULER_ENABLED=false`
mostrava «Raccolta automatica ogni 45 minuti: prossimo giro fra 27 min.»
mentre **nessun timer era attivo**. Il pannello dichiarava un giro che non
sarebbe mai arrivato.

Il difetto era limitato alla riga di stato. La serie storica `N/10` non è mai
stata toccata: si conta dai run in `collector_runs`.

---

## 2. Correzione, su due livelli

**Chi scrive.** Ogni processo reclama la riga all'avvio, *prima* del primo
tick.

| Avvio | Riga scritta |
|---|---|
| `SCHEDULER_ENABLED=false` | `running: false`, `nextRunAt: null`, `cyclesCompleted: 0` (`claimStateAsOff`) |
| `SCHEDULER_ENABLED=true` | stato del processo corrente, con `nextRunAt` a 30 s dall'avvio |

In `startCollectLoop` la `persist` iniziale è stata spostata **prima** del
`setTimeout`: nei trenta secondi che precedono il primo giro il pannello
descrive già questo processo, non l'ultimo che è passato di lì.

**Chi legge.** `readSchedulerStatus` non crede più al flag: chiama
`schedulerHealth(state, now)`, funzione pura che guarda l'ultimo segno di
vita — il tick più recente, o l'accensione se non ha ancora ticchettato.

| Condizione | `health` | Cosa mostra |
|---|---|---|
| `running: false` | `off` | «Raccolta automatica non attiva: la serie non avanza da sola.» |
| vivo, silenzio ≤ 2×intervallo | `running` | «…prossimo giro fra X min.» |
| silenzio > 2×intervallo (90 min) | `uncertain` | «Stato incerto: … non è confermato da questo processo. Nessun segno di vita da 3 h. Riavviare per ripartire con certezza.» |

La prima difesa copre il riavvio ordinato, la seconda il processo morto male.
Un orario che non si può garantire non viene stampato.

---

## 3. File modificati

| File | Modifica |
|---|---|
| `src/lib/pipeline/scheduler.ts` | + `schedulerHealth()`, `STALE_INTERVAL_MULTIPLIER`, tipi `SchedulerHealth`/`SchedulerVerdict` |
| `src/lib/pipeline/collect-loop.ts` | + `claimStateAsOff()`; `persist` iniziale spostata prima del timer |
| `src/lib/repo/coverage-history.ts` | `readSchedulerStatus` usa il giudizio; `SchedulerStatus` += `health`, `silentMinutes` |
| `src/lib/cov/view.ts` | + `buildSchedulerLabel()`, `formatSilence()`; `CoverageView` += `schedulerUncertain` |
| `src/components/CoveragePanel.tsx` | stato incerto in ambra con «⚠» |
| `src/components/CoverageSummary.tsx` | idem |
| `src/lib/pipeline/__tests__/scheduler.test.ts` | +9 casi su `schedulerHealth` |
| `src/lib/cov/__tests__/view.test.ts` | +4 casi sulla frase «stato incerto» |
| `docs/SCHEDULING.md` | quarta variante, sezione «Perché esiste lo stato incerto» |

**Funzioni create:** `schedulerHealth`, `claimStateAsOff`, `buildSchedulerLabel`,
`formatSilence`.
**API/tabelle:** nessuna nuova. `GET /api/coverage` espone due campi in più
sotto `scheduler` (`health`, `silentMinutes`).

---

## 4. Test

`npm run test:all` → **402/402** (era 389): 53 engine + 68 view + 40 pipeline +
49 providers + 39 betexplorer + 90 coverage + **37** cov-view + **26** scheduler.

Validazioni: `next typegen` OK, `tsc --noEmit` pulito, `eslint --max-warnings=0`
pulito, `npm run build` OK (580 ms, 9 rotte), server avviato e risponde.

### Prova finale sul campo

Riga di stato riportata a mano nella condizione bugiarda (`running: true`,
`nextRunAt` nel futuro, processo inesistente), poi:

| Prova | Riga in archivio dopo l'avvio | Pannello |
|---|---|---|
| avvio con `SCHEDULER_ENABLED=false` | `running: false`, `nextRunAt: null` | «Raccolta automatica non attiva» — nessun orario |
| avvio con scheduler acceso | stato del processo vivo | «prossimo giro fra 1 min» (vero: primo giro a 30 s) |
| dopo il primo tick | `cyclesCompleted: 1` | «prossimo giro fra 45 min», serie **2/10** |
| `lastTickAt` spostato a 3 ore fa | invariata | «Stato incerto … Nessun segno di vita da 3 h» — nessun orario |

Il dato di prova è stato ripristinato al valore reale a fine verifica.

Effetto collaterale utile: il giro schedulato del nuovo processo è andato a
buon fine (run **229**, `trigger=scheduled`), portando la serie da 1 a **2/10**.

---

## 5. Cosa manca

- **Serie a 2/10.** Servono 8 giri schedulati, circa 6 ore a 45 minuti.
- `cyclesCompleted` resta un contatore di processo e riparte da zero a ogni
  avvio. È dichiarato come tale e non alimenta la soglia.
- Nessun supervisore: se il processo muore, il timer muore con lui. Ora però
  l'archivio non lo nasconde più — dopo 90 minuti di silenzio lo stato si
  dichiara incerto.
- Restano aperti e dichiarati i gap noti: 24 `SOURCE_MISSING` per-book
  (robots), `sharpConfirms` null, CLV sotto le 30 osservazioni.

## 6. Prossimo sprint

Nessuno. Si accumulano giri schedulati fino a 10/10, poi si decide sui numeri
misurati.
