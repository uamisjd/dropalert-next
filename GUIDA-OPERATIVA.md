# DropAlert — Guida Operativa per Profitto Personale

**Obiettivo:** configurare DropAlert come terminale di trading personale per scommettere con vantaggio matematico.

**Tempo stimato:** 2-3 ore per la configurazione iniziale, poi uso quotidiano.

---

## ⚡ Setup Immediato (Oggi)

### 1. Configura le API Key (10 minuti)

```bash
# Copia il template
cp .env.example .env

# Modifica .env con il tuo editor
nano .env  # o vim, o vscode
```

**Cosa configurare:**

> **Cosa usa davvero il sito (stato al 21/09/2026):** la fonte principale è
> BetExplorer (nessuna chiave). La **linea sharp** che alimenta il
> «conferma sharp» e la chiusura sharp arriva da **The Odds API** (Pinnacle
> fra i bookmaker), dietro i flag del cablaggio per-bookmaker
> (`ODDS_WIRE_COLLECT=true` + `DROP_EXCLUDE_CONSENSUS_BOOKS=true`,
> `docs/STUDIO-CABLAGGIO-ODDS.md`). Il resto sotto è opzionale.

#### The Odds API (la linea sharp del sito) — Quote per singolo bookmaker
1. Vai su https://the-odds-api.com
2. Registrati (free tier: 500 crediti/mese)
3. Copia la API key
4. Incolla in `.env`:
   ```
   ODDS_API_KEY="..."
   ```

> **La fonte è SPENTA di proposito.** `ADAPTER_IMPLEMENTED = false` in
> `src/lib/providers/optional/the-odds-api.ts`: finché lo smoke test live non è
> stato eseguito con chiave e database reali, il sito non presenta le quote di
> questa fonte come eseguibili e continua a dire **NO BET** quando manca un
> prezzo realmente eseguibile. La verifica si fa in due esecuzioni manuali —
> prima `npm run odds:find` (0 crediti, endpoint fuori quota), poi
> `npm run smoke:odds-api -- --match-id <id>` (1 credito) — oppure dalla
> workflow **Smoke The Odds API** su GitHub Actions, dove il database è già
> raggiungibile. Procedura completa e codici di uscita:
> `docs/SMOKE-THE-ODDS-API.md`.

#### SharpAPI (facoltativo — adapter standalone, NON nel ciclo del sito)
1. Vai su https://sharpapi.io
2. Registrati (free tier: 12 req/min)
3. Copia la API key
4. Incolla in `.env`:
   ```
   SHARP_API_KEY="sk_live_..."
   ```

> **Attenzione:** l'adapter `src/lib/providers/sharp-api/` è un modulo
> standalone: puoi interrogarlo dai script (sezione «Testa SharpAPI» sotto),
> ma **non è cablato nel ciclo di raccolta né nelle pagine**: configurare la
> chiave non cambia ciò che il sito mostra. La linea sharp usata dal sito è
> quella di The Odds API sopra. Se vuoi che entri nel flusso, è un lavoro di
> cablaggio da dichiarare nel backlog (`docs/BACKLOG.md`).

#### OddsPapi (opzionale) — Dati storici per backtesting
1. Vai su https://oddspapi.io
2. Registrati (free tier: 250 req/mese, **dati storici inclusi**)
3. Copia la API key
4. Incolla in `.env`:
   ```
   ODDS_PAPI_KEY="..."
   ```

### 2. Avvia il Server (2 minuti)

```bash
npm run dev
```

Apri http://localhost:3000

### 3. (Opzionale) Testa l'adapter SharpAPI (5 minuti)

L'adapter è standalone: il test verifica che la chiave funzioni, non che il
sito la stia usando (non la usa, vedi sopra).

```bash
cat > test-sharp.ts << 'EOF'
import { isSharpApiAvailable, getSharpOdds } from "./src/lib/providers/sharp-api";

async function test() {
  console.log("SharpAPI disponibile:", isSharpApiAvailable());
  
  // Test su un match (adatta l'ID al formato SharpAPI)
  const odds = await getSharpOdds("soccer/england/premier-league/arsenal-chelsea");
  console.log("Quote:", JSON.stringify(odds, null, 2));
}

test();
EOF

npx tsx test-sharp.ts
```

Se vedi le quote Pinnacle, l'adapter e la chiave funzionano — ma ricorda:
fino a un cablaggio dichiarato nel backlog, il sito non le mostrerà.

### 4. Configura il Bankroll (2 minuti)

1. Vai su http://localhost:3000/mio-bankroll
2. Imposta il tuo bankroll iniziale (es. €1000)
3. Salva

Il bankroll è salvato nel tuo browser (localStorage), mai inviato al server.

---

## 📊 Uso Quotidiano

### Mattina (5-10 minuti)

1. **Apri `/value-bets`** — vedi i divari di prezzo (consenso contro no-vig
   della stessa fonte: è un auto-confronto, la riga resta **NO BET** finché
   non esiste un prezzo eseguibile e una fair indipendente)
2. **Filtra per divario > 2%** — le righe sopra soglia, le negative restano
   visibili con «mostra tutto»
3. **La size la calcoli tu in `/strumenti`** — il sito non pubblica Kelly né
   euro: il peso della varianza (Kelly frazionaria) e la surebet sono lì, con
   i numeri che inserisci tu
4. **Leggi il contesto 360°** — forma, assenze, motivazioni supportano il segnale?

### Durante il Giorno

1. **Ricevi alert push** (se configurati) — solo per le partite in `/preferite`
   che superano **la tua soglia personale sull'indice di fiducia** (la stessa
   scala della card); mai da altre partite, massimo un avviso al giorno per partita
2. **Piazza la scommessa** — con il bookmaker che offri a te stesso, alla quota
   che il mercato ti dà davvero (il consenso BetExplorer non è acquistabile)
3. **Registra in `/mio-bankroll`**:
   - Match, selezione, quota, puntata
   - Divario %, size scelta
   - Note (perché hai scommesso)

### Sera (2 minuti)

1. **Aggiorna le scommesse chiuse** in `/mio-bankroll`:
   - Clicca "Vinta" o "Persa"
   - Inserisci la **quota di chiusura** (quella disponibile 1 minuto prima del kickoff)
   - Il sistema calcola il CLV automaticamente

### Settimanale (10 minuti)

1. **Analizza `/mio-bankroll`**:
   - CLV medio > +2%? → Il metodo funziona
   - ROI > 0%? → Stai facendo profitto
   - Drawdown < 15%? → Le size sono corrette

2. **Esporta il JSON** come backup

---

## 🎯 Criteri di Scommessa

### Scommetti SOLO se:

✅ **Divario > 2%** su `/value-bets` (soglia minima per coprire varianza)
✅ **La size calcolata in `/strumenti` è ≥ 0.5% Kelly frazionaria** (altrimenti è troppo piccola)
✅ **CLV storico > 0%** (il sistema batte la chiusura; sotto le 30 osservazioni è non concludente)
✅ **Contesto 360° supporta** (niente assenze chiave, forma ok)
✅ **Kickoff tra 1-24 ore** (non troppo presto, non troppo tardi)
✅ **Esiste un prezzo davvero eseguibile** (la riga NO BET non è una scommessa: è l'onestà del gate)

### NON scommettere se:

❌ Divario < 2% (margine insufficiente)
❌ Size < 0.5% Kelly frazionaria (troppo piccola, non vale il tempo)
❌ Contesto contraddice il segnale (assenze, squalifiche, motivazioni)
❌ Hai già raggiunto il limite giornaliero (max 3-5 scommesse/giorno)
❌ Bankroll in drawdown > 20% (fermati, rivedi i filtri)

---

## 📈 Metriche di Successo

### Dopo 30 scommesse:
- **CLV medio > +2%** → Il metodo funziona, continua
- **CLV medio 0-2%** → Sei vicino alla chiusura, alza la soglia di edge
- **CLV medio < 0%** → Non stai battendo la chiusura, rivedi tutto

### Dopo 100 scommesse:
- **ROI > 0%** → Stai facendo profitto, puoi scalare
- **ROI -5% a 0%** → Varianza negativa, continua se CLV è buono
- **ROI < -5%** → Problema strutturale, fermati e analizza

### Dopo 200+ scommesse:
- **ROI > +5% e CLV > +3%** → Hai trovato il Santo Graal, scala il bankroll
- **ROI 0-5%** → Profitto modesto, ottimizza i filtri
- **ROI < 0%** → Il sistema non funziona, rivedi la strategia

---

## 🧪 Validazione del Sistema

### Settimana 1-2: Test
- Piazza 10-20 scommesse piccole (€5-10 ciascuna)
- Obiettivo: verificare che i value bets trovati siano reali
- Non guardare il ROI, guarda il CLV

### Settimana 3-4: Validazione
- Piazza 30-50 scommesse con size normali (Kelly quarter)
- Obiettivo: CLV medio > +2%
- Se CLV è buono ma ROI negativo → varianza, continua

### Mese 2: Scaling
- Se CLV > +2% su 50+ scommesse → aumenta il bankroll
- Se CLV < 0% → fermati, rivedi i filtri

---

## 🔧 Troubleshooting

### "SharpAPI non trova il match"
- L'ID del match deve essere nel formato SharpAPI
- Controlla la documentazione: https://sharpapi.io/docs
- Alcuni match minori non sono coperti

### "Non trovo righe con divario > 2%"
- Normale: il divario è misurato contro il no-vig della stessa fonte (auto-confronto):
  intorno a −margine è la condizione attesa, non un guasto
- Se la lista è vuota su tutte le giornate, il collo di bottiglia è la finestra
  di lettura, non la regola: `docs/DECISIONI-APERTE.md` §3
- Non abbassare la soglia: meglio poche scommesse buone che tante mediocri

### "CLV negativo dopo 30 scommesse"
- Il sistema non batte la chiusura
- Possibili cause:
  1. Divario sovrastimato (la fair non è corretta)
  2. Scommetti troppo tardi (il mercato si è già allineato)
  3. Bookmaker soft troppo lenti ad aggiornare
- Soluzione: alza la soglia di divario a 3-4%, scommetti prima

### "Drawdown > 20%"
- Size troppo aggressive
- Riduci Kelly a Eighth invece di Quarter
- Oppure abbassa il cap a 2% invece di 3%

---

## 📚 Risorse

### Documentazione interna
- `docs/STRATEGIA-USO-PERSONALE.md` — Strategia completa
- `docs/STRUMENTI-BETTING.md` — Come funzionano gli strumenti matematici
- `docs/STUDIO-VALUE-BETS.md` — Audit della sezione value bets
- `docs/STUDIO-PARTITE-FINITE.md` — Analisi delle partite chiuse

### Progetti GitHub da integrare
- **OddsHarvester** — Quote per singolo bookmaker da OddsPortal
- **OctoPy** — Modello matematico (Shin, Poisson)
- **Soccer xG** — Expected goals accademico (KU Leuven)

### Libri consigliati
- "The Logic of Sports Betting" — Ed Miller & Matthew Davidow
- "Trading Bases" — Joe Peta (baseball, ma i principi sono universali)
- "Sharp Sports" — Stanford Wong (il classico)

---

## ⚠️ Disclaimer

**Questo strumento è per uso personale.** Non fornisce consigli di scommessa, non garantisce vincite, non è un servizio per terzi.

**Gioca responsabilmente:**
- Mai più del 3% del bankroll per scommessa
- Mai più del 10% del bankroll al giorno
- Se perdi più del 20% del bankroll, fermati
- Il gioco può causare dipendenza: +18, Numero Verde 800 558 822

**Nessuna vincita è garantita.** Il vantaggio matematico esiste solo su grandi numeri (200+ scommesse). Su piccole serie domina la varianza.

---

## 🚀 Prossimi Passi

### Oggi
- [ ] Avvia il server e imposta il bankroll in `/mio-bankroll`
- [ ] (Se vuoi la linea sharp nel sito) configura The Odds API e leggi
      `docs/SMOKE-THE-ODDS-API.md` per il smoke test
- [ ] (Facoltativo) testa l'adapter SharpAPI standalone
- [ ] Piazza la prima scommessa (piccola, €5-10)

### Questa settimana
- [ ] Piazza 10 scommesse
- [ ] Registra tutto in `/mio-bankroll`
- [ ] Analizza il CLV medio

### Questo mese
- [ ] Raggiungi 30 scommesse
- [ ] Valida il sistema (CLV > +2%?)
- [ ] Decidi: scalare o rivedere?

---

**Buon trading!** 📊
