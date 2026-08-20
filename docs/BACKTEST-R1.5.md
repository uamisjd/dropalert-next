# Backtest R1.5 — pattern segmentati, con validazione out-of-sample

**Regola metodologica bloccata** (backlog di ricerca, voce 1): ogni ipotesi
si formula e si stima su **2019/20–2022/23** (in-sample, n=3.844 con drop
≥5%) e si valida **out-of-sample su 2023/24–2025/26** (n=1.956). Ciò che
non regge fuori dal campione si scarta e si dichiara scartato. Nessuna
moltiplicazione di ipotesi: quattro test soltanto, decisi prima di guardare
i numeri.

**Dati e metriche:** stessi CSV congelati di R1 (football-data.co.uk, 5
leghe, 7 stagioni, dichiarati in `data/README.md`), libro Pinnacle, esito
più sceso per partita, base drop ≥5%. Ogni cella riporta: frequenza reale
dell'esito sceso, attesa fair no-vig alla chiusura, residuo (freq − attesa,
in punti percentuali) e CLV medio del bound pre-movimento (quota prima del
movimento contro chiusura fair). Il CLV cresce meccanicamente con il drop:
nei verdetti conta la **stabilità** in→out, non il valore assoluto.
Tabelle rigenerabili: `npm run backtest:r15`.

---

## Test 1 — Drop × fascia di quota dell'esito sceso

**Ipotesi.** La relazione drop→esito non è uniforme: cambia con la fascia
di quota di partenza dell'esito sceso (favorito <2.0, fascia media 2.0–3.0,
sfavorito >3.0).

**In-sample (2019/20–2022/23).** Favoriti +1,1 pp sopra l'attesa fair;
fascia media −0,7; sfavoriti −1,0. Sfumature di entità, stesso ordine.

**Out-of-sample (2023/24–2025/26).** Favoriti perfettamente calibrati
(63,3% reale contro 63,3% atteso, attesa dentro l'IC 95%, n=267); fascia
media calibrata (−0,0, n=499); **sfavoriti 20,0% reale contro 24,0%
atteso: −4,0 pp, attesa fuori dall'intervallo di confidenza** [17,8–22,4],
n=1.190. Il verso dell'in-sample regge e si amplifica.

**Verdetto: CONFERMATO (n out 267/499/1.190).** Il drop su quote alte
sopravvaluta l'esito: chi segue un drop su uno sfavorito, ai prezzi di
chiusura, prende sistematicamente peggio di quanto il fair dichiara. I
favoriti scesi restano calibrati.

## Test 2 — Drop × lega

**Ipotesi.** Le cinque leghe si comportano in modo omogeneo: il pattern
R1 (nessun edge residuo a chiusura) tiene ovunque allo stesso modo.

**In-sample.** Residui compresi fra +0,5 (Premier) e −1,4 (La Liga):
omogenei nel verso e nell'entità.

**Out-of-sample.** Il verso regge ovunque — **nessuna lega mostra edge
positivo** — ma l'entità si disomogeneizza: Premier −0,6 (quasi calibrata,
n=418), Bundesliga −1,2 (n=344), Ligue 1 −2,7 (n=372), Serie A −3,0
(n=407), La Liga −4,4 (n=415; attesa 35,3 al bordo dell'IC [26,6–35,4]:
da sola non significativa, coerente però con le altre continentali).

**Verdetto: CONFERMATO IN DIREZIONE, SMENTITA L'OMOGENEITÀ (n out
344–418 per lega).** L'unica affermazione che regge fuori dal campione è
quella che serve a R3: nessuna lega produce vantaggio seguendo i drop a
chiusura. Le differenze di entità fra leghe esistono ma non sono
statisticamente solide una per una: non diventano segmenti di prodotto.

## Test 3 — Casa vs trasferta

**Ipotesi.** I drop sulla casa si comportano come quelli sulla trasferta.

**In-sample.** Sembra di sì: casa +0,3 pp (n=1.398), trasferta −0,5
(n=1.681), pareggio −2,5 (n=765, controllo).

**Out-of-sample.** **SMENTITO, e con forza.** La casa collassa: 37,4%
reale contro 42,3% atteso, **−4,9 pp, attesa fuori dall'IC 95%**
[33,9–41,0], n=711. La trasferta è stabile e calibrata: 31,8% contro
33,0% (−1,2, attesa dentro l'IC, n=748). Il pareggio resta calibrato
(−0,7, n=497).

**Verdetto: SMENTITO (n out 711 casa / 748 trasferta).** Il pattern
«drop sulla casa» non è equivalente a «drop sulla trasferta» e non è
stabile: nell'in-sample sembrava innocuo, fuori dal campione è il
segmento peggiore in valore assoluto. Scartato come ipotesi di equivalenza
e dichiarato scartato. Se R3 vorrà un segmento, l'unico con comportamento
stabile è la trasferta — ma nessuno dei due mostra edge positivo.

## Test 4 — Soglia di drop (3/5/8/10/15%)

**Ipotesi.** Esiste una soglia di drop che massimizza il CLV per campione,
e la scelta è stabile out-of-sample.

**In-sample.** CLV medio per campione crescente con la soglia: 6,7% (≥3),
8,8% (≥5), 12,5% (≥8), 15,4% (≥10), 23,0% (≥15).

**Out-of-sample.** Stesso ordinamento, valori quasi sovrapposti: 5,5 /
7,6 / 11,1 / 13,9 / **22,3%**. Massimo a **≥15%** (n out=185, dichiarato).
Il residuo freq−attesa resta ≈0 o negativo a ogni soglia; l'unica cella
positiva è ≥10% (+0,3, n=627) — osservazione dichiarata, non ipotesi
testata: non si pesca.

**Verdetto: CONFERMATO (n out 2.928/1.956/1.027/627/185).** La relazione
soglia→valore del movimento è monotona e stabile fuori dal campione. Caveat
dichiarato: il CLV è il bound pre-movimento — cresce con il drop per
costruzione, quindi la conferma dice che la scala è robusta, non che esista
un rendimento ottenibile a ≥15%.

---

## Sintesi per R2 e R3

- **Passa a R2/R3:** fascia di quota (sfavoriti scesi = sottoperformanti
  stabili), soglie monotoniche stabili, assenza di edge a chiusura in ogni
  segmento (nessuna eccezione out-of-sample).
- **Scartato e dichiarato:** equivalenza casa/trasferta; segmentazione per
  lega come elemento di prodotto (direzione sì, entità non solida).
- **Pattern out-of-sample più forte:** drop su quota >3,0 — frequenza
  reale −4,0 pp sotto l'attesa fair, unica differenza ampiamente fuori
  dall'intervallo di confidenza (n=1.190).

## Limiti

Pinnacle solo, due letture per partita (bound pre-movimento, non CLV a
metà movimento), 2025/26 parziale per Pinnacle (dichiarato in
`data/README.md`), soglie in % sulla quota anziché in pp di probabilità
come nel sito. Test 3 nasce da una partizione in tre dell'esito già
osservato in R1: quattro test in totale, nessuno aggiunto dopo aver visto
i numeri.

---

# Appendice — tabelle complete


<!-- generato da scripts/backtest-r15.ts — tabelle rigenerabili -->

Osservazioni Pinnacle totali (terna completa): 11597; con drop ≥5%: 5800.
In-sample 2019/20, 2020/21, 2021/22, 2022/23: 3844 osservazioni ≥5%. Out-of-sample 2023/24, 2024/25, 2025/26: 1956.

### drop ≥5% × fascia di quota pre-movimento dell'esito sceso

| Segmento | n in | freq in | attesa fair in | residuo pp in | CLV in | n out | freq out | attesa fair out | residuo pp out | CLV out |
|---|---|---|---|---|---|---|---|---|---|---|
| quota < 2.0 (favorito) | 547 | 64.9% | 63.8% | +1.1 | 5.7% | 267 | 63.3% | 63.3% | +0.0 | 4.8% |
| quota 2.0–3.0 | 940 | 43.8% | 44.5% | −0.7 | 7.6% | 499 | 43.7% | 43.7% | −0.0 | 6.9% |
| quota > 3.0 (sfavorito) | 2357 | 22.3% | 23.3% | −1.0 | 10.0% | 1190 | 20.0% | 24.0% | −4.0 | 8.5% |

### drop ≥5% × lega

| Segmento | n in | freq in | attesa fair in | residuo pp in | CLV in | n out | freq out | attesa fair out | residuo pp out | CLV out |
|---|---|---|---|---|---|---|---|---|---|---|
| Premier League | 786 | 31.8% | 31.3% | +0.5 | 9.3% | 418 | 32.1% | 32.6% | −0.6 | 7.7% |
| Serie A | 846 | 34.2% | 35.2% | −1.1 | 8.8% | 407 | 30.0% | 33.0% | −3.0 | 7.3% |
| La Liga | 814 | 34.3% | 35.7% | −1.4 | 8.5% | 415 | 30.8% | 35.3% | −4.4 | 7.3% |
| Bundesliga | 619 | 33.0% | 33.4% | −0.4 | 9.1% | 344 | 33.4% | 34.6% | −1.2 | 7.7% |
| Ligue 1 | 779 | 34.7% | 35.3% | −0.6 | 8.3% | 372 | 33.9% | 36.5% | −2.7 | 8.1% |

### drop ≥5%: esito casa vs esito trasferta

| Segmento | n in | freq in | attesa fair in | residuo pp in | CLV in | n out | freq out | attesa fair out | residuo pp out | CLV out |
|---|---|---|---|---|---|---|---|---|---|---|
| drop sulla casa (1) | 1398 | 41.6% | 41.4% | +0.3 | 8.7% | 711 | 37.4% | 42.3% | −4.9 | 7.7% |
| drop sulla trasferta (2) | 1681 | 31.1% | 31.6% | −0.5 | 10.2% | 748 | 31.8% | 33.0% | −1.2 | 8.4% |
| drop sul pareggio (X, controllo) | 765 | 24.4% | 27.0% | −2.5 | 5.9% | 497 | 24.3% | 25.0% | −0.7 | 6.2% |

### soglia di drop: CLV per campione in vs out-of-sample

| Soglia | n in | CLV in | freq−attesa pp in | n out | CLV out | freq−attesa pp out |
|---|---|---|---|---|---|---|
| drop ≥ 3% | 5402 | 6.7% | −0.3 | 2928 | 5.5% | −1.9 |
| drop ≥ 5% | 3844 | 8.8% | −0.6 | 1956 | 7.6% | −2.4 |
| drop ≥ 8% | 2126 | 12.5% | −0.8 | 1027 | 11.1% | −1.5 |
| drop ≥ 10% | 1381 | 15.4% | −0.7 | 627 | 13.9% | +0.3 |
| drop ≥ 15% | 519 | 23.0% | −0.7 | 185 | 22.3% | −0.3 |

### Dettaglio n (per dichiarare i campioni piccoli)

| Segmento | n in | n out |
|---|---|---|
| quota < 2.0 (favorito) | 547 | 267 |
| quota 2.0–3.0 | 940 | 499 |
| quota > 3.0 (sfavorito) | 2357 | 1190 |
| Premier League | 786 | 418 |
| Serie A | 846 | 407 |
| La Liga | 814 | 415 |
| Bundesliga | 619 | 344 |
| Ligue 1 | 779 | 372 |
| soglia ≥3% | 5402 | 2928 |
| soglia ≥5% | 3844 | 1956 |
| soglia ≥8% | 2126 | 1027 |
| soglia ≥10% | 1381 | 627 |
| soglia ≥15% | 519 | 185 |
