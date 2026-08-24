# Backtest R2 — validazione live sui dati del monitor

**Domanda.** Il backtest storico (R1/R1.5) diceva: nessun edge a chiusura,
valore solo nell'ingresso precoce, sfavoriti e casa in iper-reazione.
Questi numeri ora si misurano sui segnali RILEVATI DAL MONITOR in
produzione: 57 segnali, **52 con CLV**, 45 con risultato finale
(9 generati con `drop-engine/1.0.0`, 48 con `suspicion-v2` — 43 dei quali
con moltiplicatore 0,75 applicato).

**Fonte e metodo.** `scripts/backtest-r2.ts` legge l'API pubblica del
deploy (CLV, versione algoritmo, persistenza) e le pagine partita per i
gol finali. Rigenerabile con `npx tsx scripts/backtest-r2.ts`. Soglie
dichiarate: n<10 ⚠ campione piccolo, n<30 inconcludente. Limiti: la base
del CLV (fair no-vig o consenso) non è esposta dall'API — valori
mescolati, dichiarato; le coorti v1/v2 coprono periodi diversi e il
confronto porta dentro anche il tempo; l'hit rate è informativo, la sola
metrica di qualità resta il CLV.

---

## Tabelle

## CLV per fascia dell'indice

| Segmento | n CLV | CLV pp medio | CLV % medio | batte chiusura | n esiti | hit rate (informativo) |
|---|---|---|---|---|---|---|
| fascia 0–24 | 13 ⚠inconcludente | −4.45 pp | −16.5% | 0.0% | 11 ⚠inconcludente | 27.3% |
| fascia 25–49 | 38 | −4.01 pp | −8.6% | 10.5% | 34 | 26.5% |
| fascia 50–74 | 1 ⚠ | −1.12 pp | −2.1% | 0.0% | 0 ⚠ | n/d |
| fascia 75–100 | 0 ⚠ | n/d | n/d | n/d | 0 ⚠ | n/d |

## CLV per versione algoritmo

| Segmento | n CLV | CLV pp medio | CLV % medio | batte chiusura | n esiti | hit rate (informativo) |
|---|---|---|---|---|---|---|
| v1 (drop-engine/1.0.0) | 9 ⚠ | −5.72 pp | −9.2% | 11.1% | 8 ⚠ | 62.5% |
| v2 (suspicion-v2) | 43 | −3.72 pp | −10.7% | 7.0% | 37 | 18.9% |
| v2 · moltiplicatore applicato | 38 | −3.24 pp | −10.6% | 7.9% | 34 | 14.7% |
| v2 · senza moltiplicatore | 5 ⚠ | −7.32 pp | −11.3% | 0.0% | 3 ⚠ | 66.7% |

## Precoce vs tardivo (rilevamento → kickoff)

| Segmento | n CLV | CLV pp medio | CLV % medio | batte chiusura | n esiti | hit rate (informativo) |
|---|---|---|---|---|---|---|
| precoce (>24h prima) | 4 ⚠ | −8.86 pp | −13.0% | 25.0% | 3 ⚠ | 33.3% |
| intermedio (2–24h) | 40 | −3.60 pp | −10.0% | 7.5% | 35 | 25.7% |
| tardivo (<2h) | 8 ⚠ | −3.98 pp | −11.3% | 0.0% | 7 ⚠ | 28.6% |

## Flash vs sostenuto

| Segmento | n CLV | CLV pp medio | CLV % medio | batte chiusura | n esiti | hit rate (informativo) |
|---|---|---|---|---|---|---|
| flash (<30 min) | 0 ⚠ | n/d | n/d | n/d | 0 ⚠ | n/d |
| sostenuto (≥30 min) | 52 | −4.06 pp | −10.4% | 7.7% | 45 | 26.7% |

## Limiti dichiarati

- La base del CLV (fair no-vig o consenso grezzo) non è esposta dall'API: valori mescolati, dichiarato.
- I gol finali si leggono dalle pagine partita: chi non ha pagina, non ha esito.
- n<10 ⚠ campione piccolo; n<30 inconcludente: nessun verdetto sotto quella soglia.
- L'hit rate è informativo: la sola metrica di qualità resta il CLV.

---

## Lettura

1. **Nessun segmento con CLV positivo.** Media generale −4,06 pp, chiusura
   battuta nel 7,7% dei casi: il prezzo al rilevamento è stato quasi
   sempre peggiore della chiusura. È la conferma LIVE di R1/R1.5 — e la
   pagina lo dice da sempre: l'osservatorio misura il movimento, non
   promette prezzi.

2. **Il moltiplicatore 0,75: direzione coerente, verdetto inconcludente.**
   v2-con-moltiplicatore −3,24 pp (n=38) contro v2-senza −7,32 (n=5 ⚠) e
   v1 −5,72 (n=9 ⚠): le classi sospettate da R1.5 mostrano il CLV MENO
   negativo del campione. Ma i comparatori diretti stanno sotto la soglia
   dei 30: **inconcludente** — si tiene il moltiplicatore e si accumula n,
   non si tocca nulla sulla spinta di questi numeri.

3. **L'indice non ordina il CLV, e la fascia alta è vuota.** 0–24: −4,45
   (n=13), 25–49: −4,01 (n=38), sopra 50: un solo segnale in assoluto (il
   moltiplicatore spinge quasi tutto in basso). Le fasce sono sovrapposte:
   un punteggio più alto NON ha ancora mostrato un CLV migliore. È la
   domanda di fondo di R3, oggi senza risposta live.

4. **Hit rate: informativo e ingannevole, come dichiarato.** v1 segna
   62,5% di centrati (n=8) col CLV peggiore di tutti: vinceva più spesso,
   a prezzi peggiori della chiusura. v2-con-moltiplicatore: 14,7% di
   centrati (n=34) — le classi sospette contengono sfavoriti e case, il
   centrare poco è atteso. Hit rate e qualità del prezzo viaggiano in
   direzioni opposte: la metrica di qualità resta il CLV.

5. **Precoce vs tardivo: precoce peggio, ma n=4.** −8,86 pp contro −3,60
   dell'intermedio (n=40): contrario al bound di R1 (che misurava il
   prezzo PRIMA del movimento, non il nostro rilevamento). Con quattro
   osservazioni è **inconcludente**. Il monitor rileva quasi sempre in
   finestra 2–24h: la scansione a 45' non produce ingressi precoci.

6. **Flash vs sostenuto: nessun flash chiuso** (n=0): il taglio non ha
   ancora dati live. Dichiarato vuoto, non interpretato.

---

## Verdetti

| Tesi | Verdetto |
|---|---|
| Nessun edge a chiusura nemmeno live (R1/R1.5 confermati) | **CONFERMATO** (n=52) |
| Moltiplicatore 0,75: le classi sospette hanno CLV meno negativo | **INCONCLUDENTE** — direzione sì, n<30 |
| Fascia alta dell'indice ⇒ CLV migliore | **INCONCLUDENTE** — fascia alta vuota (n=1) |
| Ingresso precoce (>24h) meglio del tardivo | **INCONCLUDENTE** — n=4, segno opposto |
| Hit rate come metrica di qualità | **SMENTITO** (62,5% hit col CLV peggiore, n=8) |

## Cosa suggerirebbe di cambiare in v2 — SOLO PROPOSTE

1. **Tenere 0,75 e accumulare**: la direzione è coerente con R1.5; ogni
   aggiustamento oggi peserebbe più la fretta che i dati.
2. **Ripopolare la fascia alta o dichiararla strutturalmente vuota**:
   con 45 punti di ampiezza su 100 già occupati dal drop, il moltiplicatore
   comprime tutto sotto 50 — R3 potrebbe ricalibrare i pesi o accettare
   che l'indice misuri solidità osservativa, non pregio del prezzo.
3. **Misurare il tempo interno del rilevamento** (quanto dopo l'inizio
   del movimento rileviamo, ora misurabile con le shape features) prima
   di toccare soglie o finestre: la finestra 2–24h domina il campione e
   il confronto precoce/tardivo non è ancora leggibile.

## Limiti

n complessivo piccolo per verdetto sulle coorti; base CLV mescolata
(dichiarato); coorti v1/v2 in periodi diversi; i gol arrivano dalle
pagine partita e chi non ha pagina non ha esito. Nessuna modifica di
codice in questo sprint: i numeri vivono qui, le decisioni a R3.
