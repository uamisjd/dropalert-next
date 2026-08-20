# Dati congelati per il backtest R1

**Fonte:** [football-data.co.uk](https://www.football-data.co.uk/data.php) —
CSV pubblici e gratuiti dei risultati e delle quote 1X2.

**Scaricati il:** 20/08/2026, congelati in questa cartella. Il backtest non
chiama mai la rete: rileggere questi file dà sempre gli stessi numeri.

**Permessi d'uso dichiarati dalla fonte:** i dati sono forniti gratuitamente
per uso personale; la fonte non rilascia i dati con una licenza aperta. Qui
sono usati per un'analisi statistica interna, con attribuzione; non vengono
ridistribuiti in forma grezza al di fuori di questo repository.

## Contenuto

`football-data/` — 35 file, 5 competizioni × 7 stagioni (2019/20 → 2025/26):

| Codice | Competizione |
|---|---|
| E0 | Premier League |
| I1 | Serie A |
| SP1 | La Liga |
| D1 | Bundesliga |
| F1 | Ligue 1 |

Colonne usate: `FTHG`, `FTAG`, `FTR` (risultato finale),
`PSH/PSD/PSA` e `PSCH/PSCD/PSCA` (Pinnacle, rilevazione settimanale e
chiusura), `B365H/B365D/B365A` e `B365CH/B365CD/B365CA` (Bet365, idem).

## Limiti dichiarati dei dati stessi

- **«Apertura» non è l'apertura vera.** Le colonne H/D/A sono raccolte il
  venerdì (partite del weekend) e il martedì (settimanali): sono quote
  pre-movimento, non la quota di apertura del bookmaker. Nel report si
  chiamano «pre-movimento» per questo.
- **Pinnacle termina a metà della stagione 2025/26** (ultime righe con
  `PSH/PSCH` verso gennaio 2026): quella stagione conta per la frequenza
  solo nella prima parte, e il CLV fair no-vig non è calcolabile dove la
  terna di chiusura Pinnacle manca. Il conteggio delle esclusioni è nel
  report.
- Le stagioni a 306 partite (Bundesliga sempre; Ligue 1 dal 2023/24) e la
  Ligue 1 2019/20 interrotta (279) sono complete così: non sono buchi nostri.

Chi rigenera le tabelle: `npm run backtest:r1` e `npm run backtest:r15`
(scripts `scripts/backtest-r1.ts` e `scripts/backtest-r15.ts`, fuori dal
sito: nessuna importazione dal codice di DropAlert).
