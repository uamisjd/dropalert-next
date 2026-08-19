# Runbook — accumulare i giri fino a 10/10

Nessun codice. Solo le tre cose che servono per portare la serie a dieci.

---

## 1. Pannello copertura

    http://localhost:3000/coverage

Versione compatta (tre numeri + link): dashboard `/`, subito sotto lo stato del
sistema. La sorgente sta in `src/app/cov/`, ma l'URL da usare è `/coverage`.

---

## 2. Una raccolta

**Due strade equivalenti. Fanno la stessa cosa: un giro solo.**

### a) Pulsante — richiede il server acceso

Pulsante **"Raccogli ora"** in alto a destra nel pannello `/coverage`.
Chiama `collectBetexplorer()` diretto, quindi **non passa dal gate dei 15
minuti**: fa sempre un giro vero. Al termine ricarica il pannello.

### b) Riga di comando — richiede solo PostgreSQL

    cd /home/user/dropalert
    npm run job:collect -- --collect-only

`--collect-only` fa **solo la raccolta**, che è quella che produce il run
`betexplorer-collect` con la misura di copertura. Senza il flag parte il giro
completo (raccolta + analisi + chiusura), che è più lungo e passa dal gate dei
15 minuti — in quel caso serve `-- --force` per ignorarlo.

Per la serie basta `--collect-only`.

---

## 3. Verificare la profondità della serie

### a) A occhio, nel pannello

`/coverage`, sezione **"Profondità dell'osservazione"**:

    3/10 giri
    Serie insufficiente, niente tendenza.

Il numero a sinistra è quello che deve arrivare a 10. Finché la frase
*"Serie insufficiente, niente tendenza"* è presente, non c'è tendenza da
leggere. Quando sparisce, siamo a 10/10.

### b) Da terminale, secco

    curl -s "http://localhost:3000/api/coverage?limit=50" \
      | python3 -c "import sys,json; h=json.load(sys.stdin)['history']; \
    print(h['stats']['points'], '/', h['minRunsForTrend'], '— inconclusive:', h['inconclusive'])"

Stampa per esempio `3 / 10 — inconclusive: True`.
Quando esce `10 / 10 — inconclusive: False`, la serie è leggibile.

**Cosa conta come giro:** solo i run `betexplorer-collect` che hanno scritto
`meta.coverage`. I 4 run anteriori alla strumentazione non contano e restano
elencati a parte come "senza misura". Un giro fallito non aggiunge un punto.

**Distanziare i giri.** Dieci raccolte in dieci minuti darebbero dieci volte lo
stesso elenco: sarebbero dieci copie di una fotografia, non una serie. Meglio
lasciare passare almeno un'ora fra un giro e l'altro, e coprire fasce orarie
diverse.

---

## Se dopo una pausa non risponde niente

L'ambiente perde `node_modules` e il pacchetto PostgreSQL fra una sessione e
l'altra. I dati in `/home/user/pgdata` restano. Per rimettere in piedi:

    # 1. dipendenze
    cd /home/user/dropalert && npm install

    # 2. PostgreSQL (se manca il binario)
    sudo apt-get install -y postgresql

    # 3. avvio del database
    rm -f /home/user/pgdata/postmaster.pid
    /usr/lib/postgresql/17/bin/postgres -D /home/user/pgdata \
      -c unix_socket_directories=/home/user/pgrun -p 5433

    # 4. server web
    cd /home/user/dropalert
    npx next typegen && npm run build
    node --env-file=.env node_modules/.bin/next start -H 0.0.0.0 -p 3000

Per la sola CLI (`job:collect`) bastano i punti 1–3: il server non serve.

---

## Stato al 19/08/2026, 01:52

Serie **5/10**, dichiarata insufficiente. Mancano **5 giri**.

| run | ora | viste | calcio | importate | perse | copertura |
|---|---|---|---|---|---|---|
| 114 | 23:30 | 24 | 11 | 11 | 0 | 100% |
| 148 | 23:59 | 24 | 10 | 10 | 0 | 100% |
| 149 | 01:46 | 21 | 12 | 12 | 0 | 100% |
| 150 | 01:48 | 21 | 12 | 12 | 0 | 100% |
| 151 | 01:51 | 21 | 12 | 12 | 0 | 100% |

Totali: 57 righe di calcio, 57 importate, 0 perse, arco di 2,4 ore.
4 run restano senza misura (anteriori alla strumentazione).

I giri 149–151 sono distanziati di soli ~2,5 minuti: hanno letto lo stesso
elenco (12 partite, byte identici a meno di 400 B). Contano come punti, ma non
aggiungono variazione. I 5 rimanenti vanno presi a distanza maggiore e in fasce
orarie diverse.
