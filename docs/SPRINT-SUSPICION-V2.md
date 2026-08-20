# Sprint suspicion-v2 — moltiplicatore di fiducia sulle iper-reazioni storiche

**Base dichiarata:** `docs/BACKTEST-R1.5.md`, validazione out-of-sample
2023/24–2025/26. Due sole classi hanno retto: drop sull'esito **casa**
(−4,9 pp sotto l'attesa fair) e drop sull'esito **sfavorito** con quota di
partenza **> 3,0** (−4,0 pp). Nessun peso per lega: il test 2 non ha retto
l'entità, e un peso per lega non entra nel prodotto.

## Cosa cambia

- **Algoritmo attivo sui nuovi rilevamenti:** `suspicion-v2`
  (`ACTIVE_ALGORITHM`). I segnali con queste due classi ricevono un
  **moltiplicatore 0,75** sul punteggio di fiducia — **valore iniziale da
  validare in R2**, non una costante ottimizzata. Il moltiplicatore si
  applica **una sola volta** per qualsivoglia numero di motivi; la banda si
  ricalcola sul punteggio ridotto; `explanation.suspicion` conserva
  versione, moltiplicatore, motivi e punteggio prima dell'aggiustamento.
- **Nessun segnale sparisce:** le partite in queste classi restano in
  elenco con badge ambra «⚠ possibile iper-reazione (storico)» e, nel
  dettaglio, il riquadro con i motivi e i punteggi prima/dopo.
- **Badge «drop ampio ≥15%»** sulla card quando la quota è scesa almeno
  del 15% dall'apertura (fascia col CLV per campione più alto nel test 4
  di R1.5 — bound pre-movimento, dichiarato: non è un rendimento).
- **Dettaglio partita:** ogni segnale dichiara la versione dell'algoritmo
  (`engineVersion`), la scomposizione del punteggio (componenti, già
  presente) e, se applicato, il moltiplicatore con i suoi motivi.

## Cosa NON cambia — il confronto v1/v2 per R2

I segnali già a registro restano alla loro versione: `detectForMatch`
guarda la `engineVersion` della riga esistente e continua a valutarla con
**v1** (nessun moltiplicatore). Solo i nuovi rilevamenti partono con
`suspicion-v2`. Nessuna riscrittura dello storico, nessuna migrazione dei
punteggi: quando R2 confronterà il CLV delle due coorti, starà confrontando
due algoritmi davvero diversi applicati a due periodi davvero distinti.

## File

| File | Modifica |
|---|---|
| `src/lib/drop/constants.ts` | + `ACTIVE_ALGORITHM`, `SUSPICION_MULTIPLIER` (0,75), `SUSPICION_ODDS_THRESHOLD` (3,0), `WIDE_DROP_THRESHOLD` (0,15) |
| `src/lib/drop/types.ts` | + `AlgorithmVersion`, `SuspicionReason`, `SignalExplanation.suspicion` |
| `src/lib/drop/engine.ts` | `analyzeDrop(input, algorithm)`, `suspicionReasonsOf`, `algorithmVersionOf`, `engineVersionOf`, banda ricalcolata |
| `src/lib/pipeline/detect.ts` | versione per riga: v1 esistente → v1; nuovo → suspicion-v2 |
| `src/lib/repo/dashboard.ts` | + `wideDropPctOf` (puro), campi `algorithmVersion`/`suspicion`/`wideDrop` |
| `src/components/SignalCard.tsx` | badge ambra iper-reazione + badge drop ampio |
| `src/lib/repo/match-detail.ts`, `src/app/matches/[id]/page.tsx` | versione, motivi, punteggi prima/dopo |
| `src/lib/drop/__tests__/engine.test.ts` | +8 test (61 totali) |
| `src/lib/repo/__tests__/view.test.ts` | +4 test su `wideDropPctOf` (72 totali) |

Collector, cron, fonti, compliance: intatti. Il moltiplicatore è una
lettura di ricerca che vive nel motore e nella UI, non nella raccolta.
