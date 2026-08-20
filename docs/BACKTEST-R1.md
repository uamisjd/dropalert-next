# Backtest R1 — cosa dicono sette stagioni di gocce reali

**Domanda.** Quando un esito 1X2 scende di quota, quel movimento è
informazione vera? E il prezzo di chi lo segue batte il mercato, o arriva
tardi? Questo backtest mette numeri storici dietro la domanda che il
monitor pone in tempo reale.

**Dati.** football-data.co.uk, CSV pubblici congelati il 20/08/2026 in
`data/football-data/`: 5 competizioni (Premier League, Serie A, La Liga,
Bundesliga, Ligue 1) × 7 stagioni (2019/20 → 2025/26), 12.459 partite
giocate. Due libri per parte: Pinnacle (riferimento sharp) e Bet365
(soft). Fonte, colonne e limiti dichiarati in `data/README.md`.

---

## Metodo

- **Prezzo pre-movimento**: quota rilevata dalla fonte il venerdì/martedì
  prima (`PSH/PSD/PSA`, `B365H/B365D/B365A`). Non è l'apertura vera del
  bookmaker: è la quota precedente al movimento, ed è questa che serve.
- **Chiusura**: quota finale dello stesso libro (`PSCH…`, `B365CH…`).
- **Drop**: per ogni partita si prende l'esito **più sceso** in percentuale
  sulla quota (1 − chiusura/pre-movimento) e lo si classifica nelle fasce
  **≥5%, ≥10%, ≥15%** (fascie cumulative: ≥10% è dentro anche ≥5%).
- **Frequenza reale**: quante volte l'esito più sceso ha vinto davvero
  (`FTR`), con intervallo di Wilson al 95%.
- **Attesa (1/quota)**: tre riferimenti — la probabilità implicita
  pre-movimento, la chiusura **fair no-vig di Pinnacle** (margine rimosso
  in via proporzionale sulla terna completa) e la chiusura grezza.
- **CLV**: `quota pre-movimento / quota fair di chiusura − 1`, dove la
  base fair è la chiusura Pinnacle senza margine. È il CLV di chi avesse
  preso il prezzo **prima** che il movimento partisse.

**Scelte dichiarate:** nessuna interpolazione fra le due letture (la fonte
ne dà solo due); le partite senza terne complete sono escluse e contate;
nessun valore stimato, mai.

---

## Lettura in tre frasi

1. **Il drop è informazione reale.** La frequenza reale dell'esito sceso è
   sistematicamente **sopra** l'attesa pre-movimento e cresce con la
   fascia: Pinnacle ≥5% → 33,1% reale contro 32,0% attesa; ≥10% → 28,9%
   contro 25,9%; ≥15% → 23,4% contro 19,9%. Il mercato non si muove a caso.

2. **Ma a fine corsa non resta margine.** La stessa frequenza reale è
   **sotto l'attesa fair della chiusura in ogni fascia** (33,1% contro
   34,3%; 28,9% contro 29,3%; 23,4% contro 24,1%): comprare l'esito sceso
   ai prezzi di chiusura non batte il fair. Il valore del movimento se lo
   prende chi era in posizione prima.

3. **Il CLV pre-movimento è enorme — ed è un bound, non un edge.** +8,4%
   medio nella fascia ≥5%, +15,0% nella ≥10%, +22,8% nella ≥15% (Pinnacle;
   positivo nel 100% dei casi, perché è la definizione stessa di drop).
   Misura quanto sarebbe valso comprare **sapendo prima** chi sarebbe
   sceso: nessuno lo sa. È il limite superiore del senno di poi, utile
   solo come scala del movimento.

Il controllo di specificità chiude il cerchio: sulle partite **senza**
movimento rilevante (±1%) la frequenza reale è 45,9% contro un'attesa fair
del 46,1% (Pinnacle): il fair di chiusura è calibrato sia con il drop sia
senza. Non è il drop a essere mal prezzato — è già tutto nel prezzo
finale.

---

## Cosa confermerebbe l'indice attuale, e cosa lo smentirebbe

L'indice di fiducia di DropAlert (0–100) poggia su ampiezza, tenuta,
coordinazione, copertura. Questo backtest dice cosa può valere:

**Confermerebbe** l'impianto:

- un CLV del sito **positivo** sui segnali presi **all'inizio** del
  movimento — qui il prezzo pre-movimento batte la chiusura fair del
  +8/+15/+23% per fascia: chi entra presto nel drop ha il vento dei
  numeri dalla sua;
- la relazione monotona ampiezza→contenuto informativo: a fasce più
  alte, più differenza fra attesa pre-movimento e frequenza reale.

**Smentirebbe** (o forzerebbe a ridisegnare):

- un CLV medio ≤ 0 sui segnali rilevati quando il drop è già pieno:
  l'edge era prima, e la tabella lo mostra (frequenza reale ≤ attesa fair
  a chiusura, in tutte le fasce);
- qualunque lettura «l'esito sceso vince più di quanto il mercato dice»:
  qui non accade — semmai vince **meno** dell'attesa fair (−0,4/−1,2 pp),
  e alla fascia ≥5% Pinnacle la differenza sfiora il bordo dell'intervallo
  di confidenza;
- usare l'esito centrata/mancata come misura di qualità: la frequenza reale
  segue le probabilità, non la bontà del prezzo. Vale per il sito e vale
  qui.

---

## Limiti dichiarati

- **Due letture per partita, non una serie**: il sito osserva il movimento
  in continuo (45'), qui ci sono solo pre-movimento e chiusura. Il CLV
  «a metà movimento» non è calcolabile con questi dati — e non è stato
  inventato.
- **Pinnacle finito a metà 2025/26** (≈ gennaio 2026): la stagione conta
  per la frequenza solo nella prima parte; il CLV fair manca dove manca la
  terna di chiusura Pinnacle (854 righe Bet365 escluse dal solo CLV,
  dichiarate nel conteggio).
- **Fascie in % sulla quota**, mentre il sito misura il drop in punti
  percentuali di probabilità implicita: un calo del 10% sulla quota vale
  ~+5 pp se la quota parte da 2,00, di più se parte da quote alte. Le due
  scale non sono convertibili con un fattore fisso: confronti qualitativi.
- **Solo 1X2 e solo due libri**; niente tenuta nel tempo, niente flash,
  niente coordinazione: questo backtest prova la materia prima (il drop),
  non l'indice composito.
- Celle con n < 30 sono marcate ⚠ e non vanno lette.


---

# Appendice — tabelle complete

Le tabelle che seguono sono generate da `scripts/backtest-r1.ts` (`npm run backtest:r1`) sugli stessi dati congelati: rieseguendolo si ottengono gli stessi numeri.

<!-- generato da scripts/backtest-r1.ts — tabelle rigenerabili -->

## Copertura dei dati

| File | Competizione | Stagione | Partite giocate | Usabili Pinnacle | Usabili Bet365 |
|---|---|---|---|---|---|
| E0-1920.csv | Premier League | 2019/20 | 380 | 380 | 380 |
| E0-2021.csv | Premier League | 2020/21 | 380 | 380 | 380 |
| E0-2122.csv | Premier League | 2021/22 | 380 | 380 | 380 |
| E0-2223.csv | Premier League | 2022/23 | 380 | 380 | 380 |
| E0-2324.csv | Premier League | 2023/24 | 380 | 380 | 380 |
| E0-2425.csv | Premier League | 2024/25 | 380 | 380 | 380 |
| E0-2526.csv | Premier League | 2025/26 | 380 | 210 | 380 |
| I1-1920.csv | Serie A | 2019/20 | 380 | 380 | 380 |
| I1-2021.csv | Serie A | 2020/21 | 380 | 378 | 378 |
| I1-2122.csv | Serie A | 2021/22 | 380 | 379 | 379 |
| I1-2223.csv | Serie A | 2022/23 | 380 | 380 | 380 |
| I1-2324.csv | Serie A | 2023/24 | 380 | 380 | 380 |
| I1-2425.csv | Serie A | 2024/25 | 380 | 380 | 380 |
| I1-2526.csv | Serie A | 2025/26 | 380 | 198 | 380 |
| SP1-1920.csv | La Liga | 2019/20 | 380 | 378 | 380 |
| SP1-2021.csv | La Liga | 2020/21 | 380 | 380 | 380 |
| SP1-2122.csv | La Liga | 2021/22 | 380 | 379 | 380 |
| SP1-2223.csv | La Liga | 2022/23 | 380 | 380 | 380 |
| SP1-2324.csv | La Liga | 2023/24 | 380 | 380 | 380 |
| SP1-2425.csv | La Liga | 2024/25 | 380 | 380 | 380 |
| SP1-2526.csv | La Liga | 2025/26 | 380 | 188 | 380 |
| D1-1920.csv | Bundesliga | 2019/20 | 306 | 306 | 306 |
| D1-2021.csv | Bundesliga | 2020/21 | 306 | 306 | 306 |
| D1-2122.csv | Bundesliga | 2021/22 | 306 | 306 | 306 |
| D1-2223.csv | Bundesliga | 2022/23 | 306 | 306 | 306 |
| D1-2324.csv | Bundesliga | 2023/24 | 306 | 306 | 306 |
| D1-2425.csv | Bundesliga | 2024/25 | 306 | 306 | 306 |
| D1-2526.csv | Bundesliga | 2025/26 | 306 | 149 | 306 |
| F1-1920.csv | Ligue 1 | 2019/20 | 279 | 279 | 279 |
| F1-2021.csv | Ligue 1 | 2020/21 | 380 | 378 | 378 |
| F1-2122.csv | Ligue 1 | 2021/22 | 380 | 380 | 380 |
| F1-2223.csv | Ligue 1 | 2022/23 | 380 | 380 | 380 |
| F1-2324.csv | Ligue 1 | 2023/24 | 306 | 306 | 306 |
| F1-2425.csv | Ligue 1 | 2024/25 | 306 | 306 | 306 |
| F1-2526.csv | Ligue 1 | 2025/26 | 306 | 153 | 306 |

Partite giocate totali: **12459**; esclusioni: terne di apertura mancanti 863, terne di chiusura mancanti 4, chiusura Pinnacle assente (CLV fair non calcolabile, il match resta nella frequenza) 854.


## Pinnacle — tutte le competizioni, tutte le stagioni

| Segmento | n | vinti | freq reale (IC 95%) | attesa pre-movimento | attesa fair no-vig | attesa chiusura grezza | CLV % medio | CLV % mediano | CLV pp medio |
|---|---|---|---|---|---|---|---|---|---|
| drop ≥ 5% | 5800 | 1917 | 33.1% (31.9%–34.3%) | 32.0% | 34.3% | 35.2% | +8.39% | +6.26% | +2.32 pp (5800) |
| drop ≥ 10% | 2008 | 581 | 28.9% (27.0%–31.0%) | 25.9% | 29.3% | 30.1% | +14.97% | +12.29% | +3.48 pp (2008) |
| drop ≥ 15% | 704 | 165 | 23.4% (20.5%–26.7%) | 19.9% | 24.1% | 24.7% | +22.84% | +19.69% | +4.21 pp (704) |


## Bet365 — tutte le competizioni, tutte le stagioni

| Segmento | n | vinti | freq reale (IC 95%) | attesa pre-movimento | attesa fair no-vig | attesa chiusura grezza | CLV % medio | CLV % mediano | CLV pp medio |
|---|---|---|---|---|---|---|---|---|---|
| drop ≥ 5% | 7062 | 2300 | 32.6% (31.5%–33.7%) | 32.2% | 33.4% | 35.5% | +3.78% | +2.81% | +1.14 pp (6589) |
| drop ≥ 10% | 2552 | 688 | 27.0% (25.3%–28.7%) | 25.9% | 28.2% | 30.4% | +9.00% | +7.90% | +2.30 pp (2376) |
| drop ≥ 15% | 1087 | 250 | 23.0% (20.6%–25.6%) | 20.7% | 23.7% | 25.8% | +13.98% | +13.24% | +2.95 pp (1020) |


## Pinnacle — per competizione (stagioni aggregate)

| Segmento | n | vinti | freq reale (IC 95%) | attesa pre-movimento | attesa fair no-vig | attesa chiusura grezza | CLV % medio | CLV % mediano | CLV pp medio |
|---|---|---|---|---|---|---|---|---|---|
| Premier League · ≥5% | 1204 | 384 | 31.9% (29.3%–34.6%) | 29.6% | 31.8% | 32.6% | +8.72% | +6.66% | +2.18 pp (1204) |
| Premier League · ≥10% | 455 | 123 | 27.0% (23.2%–31.3%) | 23.1% | 26.1% | 26.8% | +14.98% | +12.52% | +3.09 pp (455) |
| Premier League · ≥15% | 166 | 28 | 16.9% (11.9%–23.3%) | 17.1% | 20.7% | 21.2% | +22.28% | +18.46% | +3.58 pp (166) |
| Serie A · ≥5% | 1253 | 411 | 32.8% (30.3%–35.4%) | 32.2% | 34.5% | 35.5% | +8.34% | +6.10% | +2.29 pp (1253) |
| Serie A · ≥10% | 415 | 114 | 27.5% (23.4%–32.0%) | 25.6% | 29.1% | 29.9% | +15.35% | +12.53% | +3.52 pp (415) |
| Serie A · ≥15% | 154 | 39 | 25.3% (19.1%–32.7%) | 19.8% | 24.1% | 24.8% | +23.21% | +20.38% | +4.30 pp (154) |
| La Liga · ≥5% | 1229 | 407 | 33.1% (30.5%–35.8%) | 33.2% | 35.6% | 36.5% | +8.10% | +6.13% | +2.37 pp (1229) |
| La Liga · ≥10% | 406 | 133 | 32.8% (28.4%–37.5%) | 27.5% | 31.2% | 32.1% | +14.66% | +12.00% | +3.70 pp (406) |
| La Liga · ≥15% | 137 | 37 | 27.0% (20.3%–35.0%) | 22.2% | 26.9% | 27.7% | +22.51% | +19.51% | +4.69 pp (137) |
| Bundesliga · ≥5% | 963 | 319 | 33.1% (30.2%–36.2%) | 31.5% | 33.8% | 34.7% | +8.60% | +6.40% | +2.32 pp (963) |
| Bundesliga · ≥10% | 352 | 95 | 27.0% (22.6%–31.9%) | 25.1% | 28.4% | 29.2% | +14.86% | +12.08% | +3.32 pp (352) |
| Bundesliga · ≥15% | 123 | 26 | 21.1% (14.9%–29.2%) | 18.9% | 22.8% | 23.4% | +22.80% | +20.30% | +3.92 pp (123) |
| Ligue 1 · ≥5% | 1151 | 396 | 34.4% (31.7%–37.2%) | 33.3% | 35.7% | 36.7% | +8.24% | +6.12% | +2.41 pp (1151) |
| Ligue 1 · ≥10% | 380 | 116 | 30.5% (26.1%–35.3%) | 28.4% | 32.3% | 33.1% | +14.98% | +12.06% | +3.82 pp (380) |
| Ligue 1 · ≥15% | 124 | 35 | 28.2% (21.1%–36.7%) | 22.0% | 26.7% | 27.4% | +23.55% | +20.29% | +4.71 pp (124) |


## Bet365 — per competizione (stagioni aggregate)

| Segmento | n | vinti | freq reale (IC 95%) | attesa pre-movimento | attesa fair no-vig | attesa chiusura grezza | CLV % medio | CLV % mediano | CLV pp medio |
|---|---|---|---|---|---|---|---|---|---|
| Premier League · ≥5% | 1481 | 475 | 32.1% (29.7%–34.5%) | 30.1% | 31.0% | 33.2% | +3.96% | +2.99% | +1.10 pp (1385) |
| Premier League · ≥10% | 547 | 148 | 27.1% (23.5%–30.9%) | 23.1% | 24.7% | 27.1% | +8.93% | +8.01% | +2.05 pp (507) |
| Premier League · ≥15% | 227 | 57 | 25.1% (19.9%–31.1%) | 17.6% | 19.9% | 22.0% | +13.85% | +13.65% | +2.56 pp (215) |
| Serie A · ≥5% | 1513 | 486 | 32.1% (29.8%–34.5%) | 31.9% | 33.2% | 35.3% | +3.60% | +2.56% | +1.09 pp (1412) |
| Serie A · ≥10% | 530 | 143 | 27.0% (23.4%–30.9%) | 25.2% | 27.7% | 29.7% | +9.13% | +7.59% | +2.27 pp (493) |
| Serie A · ≥15% | 239 | 55 | 23.0% (18.1%–28.8%) | 20.2% | 23.4% | 25.3% | +13.68% | +12.59% | +2.86 pp (223) |
| La Liga · ≥5% | 1481 | 480 | 32.4% (30.1%–34.8%) | 33.1% | 34.5% | 36.5% | +3.52% | +2.67% | +1.15 pp (1372) |
| La Liga · ≥10% | 499 | 128 | 25.7% (22.0%–29.7%) | 27.0% | 29.6% | 31.7% | +8.72% | +7.98% | +2.40 pp (469) |
| La Liga · ≥15% | 197 | 46 | 23.4% (18.0%–29.7%) | 23.0% | 26.4% | 28.5% | +14.69% | +13.91% | +3.38 pp (188) |
| Bundesliga · ≥5% | 1220 | 383 | 31.4% (28.9%–34.1%) | 31.8% | 32.9% | 35.2% | +3.72% | +2.93% | +1.11 pp (1134) |
| Bundesliga · ≥10% | 450 | 115 | 25.6% (21.7%–29.8%) | 26.2% | 28.5% | 30.8% | +8.89% | +7.86% | +2.28 pp (415) |
| Bundesliga · ≥15% | 198 | 40 | 20.2% (15.2%–26.3%) | 20.3% | 23.3% | 25.2% | +13.31% | +13.40% | +2.80 pp (184) |
| Ligue 1 · ≥5% | 1367 | 476 | 34.8% (32.3%–37.4%) | 33.9% | 35.2% | 37.6% | +4.11% | +2.90% | +1.26 pp (1286) |
| Ligue 1 · ≥10% | 526 | 154 | 29.3% (25.6%–33.3%) | 28.2% | 30.9% | 33.1% | +9.33% | +8.09% | +2.49 pp (492) |
| Ligue 1 · ≥15% | 226 | 52 | 23.0% (18.0%–28.9%) | 22.7% | 26.0% | 28.2% | +14.39% | +12.54% | +3.17 pp (210) |


## Pinnacle — per stagione (competizioni aggregate)

| Segmento | n | vinti | freq reale (IC 95%) | attesa pre-movimento | attesa fair no-vig | attesa chiusura grezza | CLV % medio | CLV % mediano | CLV pp medio |
|---|---|---|---|---|---|---|---|---|---|
| 2019/20 · ≥5% | 918 | 308 | 33.6% (30.6%–36.7%) | 32.3% | 34.7% | 35.7% | +8.88% | +6.45% | +2.39 pp (918) |
| 2019/20 · ≥10% | 366 | 100 | 27.3% (23.0%–32.1%) | 25.9% | 29.4% | 30.3% | +15.35% | +12.39% | +3.50 pp (366) |
| 2019/20 · ≥15% | 139 | 30 | 21.6% (15.6%–29.1%) | 19.2% | 23.3% | 24.1% | +23.29% | +20.26% | +4.13 pp (139) |
| 2020/21 · ≥5% | 1060 | 372 | 35.1% (32.3%–38.0%) | 31.9% | 34.4% | 35.3% | +9.33% | +6.84% | +2.54 pp (1060) |
| 2020/21 · ≥10% | 394 | 125 | 31.7% (27.3%–36.5%) | 25.8% | 29.5% | 30.2% | +16.25% | +12.92% | +3.74 pp (394) |
| 2020/21 · ≥15% | 152 | 42 | 27.6% (21.1%–35.2%) | 20.6% | 25.2% | 25.8% | +24.41% | +20.38% | +4.58 pp (152) |
| 2021/22 · ≥5% | 959 | 332 | 34.6% (31.7%–37.7%) | 32.6% | 35.0% | 35.9% | +8.26% | +6.49% | +2.39 pp (959) |
| 2021/22 · ≥10% | 318 | 91 | 28.6% (23.9%–33.8%) | 26.6% | 30.1% | 30.9% | +14.48% | +12.71% | +3.56 pp (318) |
| 2021/22 · ≥15% | 114 | 25 | 21.9% (15.3%–30.4%) | 20.6% | 24.8% | 25.4% | +20.72% | +18.47% | +4.13 pp (114) |
| 2022/23 · ≥5% | 907 | 280 | 30.9% (28.0%–34.0%) | 30.6% | 32.8% | 33.6% | +8.63% | +6.37% | +2.23 pp (907) |
| 2022/23 · ≥10% | 303 | 76 | 25.1% (20.5%–30.3%) | 24.0% | 27.3% | 27.9% | +15.51% | +12.33% | +3.24 pp (303) |
| 2022/23 · ≥15% | 114 | 21 | 18.4% (12.4%–26.5%) | 16.6% | 20.1% | 20.6% | +23.23% | +19.67% | +3.53 pp (114) |
| 2023/24 · ≥5% | 772 | 253 | 32.8% (29.6%–36.2%) | 33.1% | 35.3% | 36.3% | +7.49% | +5.69% | +2.18 pp (772) |
| 2023/24 · ≥10% | 236 | 82 | 34.7% (29.0%–41.0%) | 26.8% | 30.3% | 31.2% | +13.98% | +11.94% | +3.44 pp (236) |
| 2023/24 · ≥15% | 71 | 18 | 25.4% (16.7%–36.6%) | 21.5% | 25.9% | 26.7% | +22.13% | +19.21% | +4.44 pp (71) |
| 2024/25 · ≥5% | 819 | 273 | 33.3% (30.2%–36.6%) | 32.1% | 34.4% | 35.4% | +7.96% | +6.01% | +2.24 pp (819) |
| 2024/25 · ≥10% | 279 | 83 | 29.7% (24.7%–35.4%) | 26.7% | 30.2% | 31.1% | +14.37% | +11.77% | +3.51 pp (279) |
| 2024/25 · ≥15% | 84 | 26 | 31.0% (22.1%–41.5%) | 21.4% | 26.1% | 26.9% | +23.24% | +20.30% | +4.62 pp (84) |
| 2025/26 · ≥5% | 365 | 99 | 27.1% (22.8%–31.9%) | 30.5% | 32.4% | 33.4% | +7.02% | +5.60% | +1.93 pp (365) |
| 2025/26 · ≥10% | 112 | 24 | 21.4% (14.8%–29.9%) | 24.8% | 27.7% | 28.5% | +12.73% | +10.83% | +2.97 pp (112) |
| 2025/26 · ≥15% | 30 | 3 | 10.0% (3.5%–25.6%) | 20.4% | 24.3% | 25.1% | +19.97% | +19.54% | +3.91 pp (30) |


## Bet365 — per stagione (competizioni aggregate)

| Segmento | n | vinti | freq reale (IC 95%) | attesa pre-movimento | attesa fair no-vig | attesa chiusura grezza | CLV % medio | CLV % mediano | CLV pp medio |
|---|---|---|---|---|---|---|---|---|---|
| 2019/20 · ≥5% | 1003 | 351 | 35.0% (32.1%–38.0%) | 33.4% | 34.7% | 37.0% | +4.74% | +3.32% | +1.33 pp (1003) |
| 2019/20 · ≥10% | 386 | 105 | 27.2% (23.0%–31.8%) | 28.0% | 30.7% | 33.0% | +10.54% | +8.97% | +2.65 pp (386) |
| 2019/20 · ≥15% | 174 | 40 | 23.0% (17.4%–29.8%) | 22.0% | 25.4% | 27.4% | +16.15% | +14.25% | +3.39 pp (174) |
| 2020/21 · ≥5% | 1070 | 377 | 35.2% (32.4%–38.1%) | 32.6% | 33.9% | 36.1% | +5.02% | +3.46% | +1.36 pp (1070) |
| 2020/21 · ≥10% | 409 | 127 | 31.1% (26.8%–35.7%) | 26.6% | 29.2% | 31.3% | +10.92% | +8.97% | +2.62 pp (409) |
| 2020/21 · ≥15% | 185 | 58 | 31.4% (25.1%–38.4%) | 21.7% | 25.2% | 27.1% | +16.82% | +15.23% | +3.47 pp (185) |
| 2021/22 · ≥5% | 1063 | 366 | 34.4% (31.6%–37.3%) | 33.7% | 34.8% | 37.2% | +2.99% | +2.48% | +1.04 pp (1063) |
| 2021/22 · ≥10% | 358 | 95 | 26.5% (22.2%–31.3%) | 26.0% | 28.2% | 30.5% | +7.69% | +7.90% | +2.21 pp (358) |
| 2021/22 · ≥15% | 142 | 27 | 19.0% (13.4%–26.3%) | 21.3% | 24.2% | 26.5% | +12.16% | +12.96% | +2.92 pp (142) |
| 2022/23 · ≥5% | 1009 | 320 | 31.7% (28.9%–34.7%) | 31.2% | 32.3% | 34.4% | +3.99% | +2.74% | +1.11 pp (1009) |
| 2022/23 · ≥10% | 343 | 82 | 23.9% (19.7%–28.7%) | 24.2% | 26.4% | 28.5% | +9.73% | +8.20% | +2.21 pp (343) |
| 2022/23 · ≥15% | 159 | 33 | 20.8% (15.2%–27.7%) | 18.4% | 21.0% | 22.9% | +14.56% | +13.26% | +2.62 pp (159) |
| 2023/24 · ≥5% | 942 | 278 | 29.5% (26.7%–32.5%) | 31.2% | 32.4% | 34.5% | +3.44% | +2.70% | +1.16 pp (942) |
| 2023/24 · ≥10% | 326 | 88 | 27.0% (22.5%–32.1%) | 24.3% | 26.4% | 28.5% | +7.90% | +7.48% | +2.14 pp (326) |
| 2023/24 · ≥15% | 144 | 35 | 24.3% (18.0%–31.9%) | 20.5% | 23.3% | 25.4% | +12.34% | +12.89% | +2.80 pp (144) |
| 2024/25 · ≥5% | 970 | 315 | 32.5% (29.6%–35.5%) | 32.3% | 33.5% | 35.7% | +3.75% | +2.96% | +1.20 pp (970) |
| 2024/25 · ≥10% | 376 | 102 | 27.1% (22.9%–31.8%) | 26.4% | 28.7% | 30.9% | +8.69% | +7.42% | +2.32 pp (376) |
| 2024/25 · ≥15% | 143 | 34 | 23.8% (17.5%–31.4%) | 20.5% | 23.4% | 25.5% | +13.36% | +11.82% | +2.82 pp (143) |
| 2025/26 · ≥5% | 1005 | 293 | 29.2% (26.4%–32.0%) | 30.6% | 30.5% | 33.8% | +1.29% | +0.88% | +0.42 pp (532) |
| 2025/26 · ≥10% | 354 | 89 | 25.1% (20.9%–29.9%) | 25.3% | 26.5% | 29.7% | +5.22% | +5.49% | +1.36 pp (178) |
| 2025/26 · ≥15% | 140 | 23 | 16.4% (11.2%–23.4%) | 20.4% | 23.0% | 25.3% | +8.38% | +9.56% | +1.86 pp (73) |


## Controllo di specificità — esiti non scesi

- Pinnacle: partite senza movimento rilevante (±1%): n=734, freq reale 45.9%, attesa fair 46.1%.
- Bet365: partite senza movimento rilevante (±1%): n=945, freq reale 48.5%, attesa fair 47.1%.
