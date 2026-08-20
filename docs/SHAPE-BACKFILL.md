# Backfill delle shape features — dichiarazione

**Scopo.** Riempire `drop_signals.shape` (migrazione 0005, struttura in
`src/lib/shape/features.ts`) per ogni segnale in archivio, così la ricerca
(R2, R3) ha la forma dei movimenti già calcolata e riusabile, senza
ricalcolarla dai dati grezzi ogni volta.

**Idempotenza.** Il backfill (`npm run job:shape`,
`src/scripts/build-shape-features.ts`) non inserisce righe e aggiorna
SOLO la colonna `shape`: ricalcola un segnale soltanto se la sua forma
manca, è illeggibile o è più vecchia dell'ultima rilevazione della serie
(`isShapeStale`, testata in `test:shape`). Rieseguirlo a dati fermi non
tocca nulla; nuove rilevazioni aggiornano solo i segnali coinvoltati.

**Perché sta nel ciclo del cron e non in una leva manuale.** Una forma
che si calcola «quando qualcuno se lo ricorda» invecchia subito: ogni
giro che aggiunge rilevazioni deve ripassare la forma dei segnali toccati.
Sta in coda al ciclo di raccolta — dopo le migrazioni e dopo il collect,
dentro lo stesso `npm run job:collect` invocato dal cron — così la forma
non è mai più vecchia del dato che la produce.

**Perché non è (ancora) un passo workflow separato.** Il token in uso non
ha lo scope `workflow`: GitHub rifiuta ogni push che tocchi
`.github/workflows/collect.yml` (regola piattaforma, non una scelta
nostra). La catena vive quindi in `scripts/cycle.sh`, invocato da
`npm run job:collect` con gli stessi argomenti di prima: il collector
(`src/scripts/run-collect.ts`) non è stato modificato di una riga.

**Promozione a passo workflow**, quando sarà disponibile un token con lo
scope `workflow` (o la modifica fatta a mano dall'interfaccia): aggiungere
a `collect.yml`, dopo il passo «Giro di osservazione»:

```yaml
      - name: Shape features (backfill idempotente)
        run: npm run job:shape
```

e riportare `job:collect` del `package.json` al suo valore precedente:

```json
    "job:collect": "tsx --env-file-if-exists=.env src/scripts/run-collect.ts",
```

**Comportamento al fallimento.** Se il backfill solleva errori, il ciclo
di raccolta è già stato scritto a registro: il passo fallisce in modo
visibile invece di tacere, e il giro successivo riprova da dove il dato si
è fermato. La serie N/10 e il CLV non c'entrano: la forma è un dato di
ricerca, non una misura del monitor.
