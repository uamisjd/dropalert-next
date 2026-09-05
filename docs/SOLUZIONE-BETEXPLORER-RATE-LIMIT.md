# Soluzione Rate Limit BetExplorer (429) + Integrazione Multi-Bookmaker

**Data:** 05/09/2026  
**Problema:** BetExplorer blocca le richieste con HTTP 429 (Too Many Requests)  
**Impatto:** Fonte principale ferma, sistema non riceve nuovi dati

---

## 1. Analisi del Problema

### Cosa sta succedendo
```
Fonti: 0 ok · 1 degradata (ultimo successo 1 h fa)
BetExplorer (consenso): ultimo errore 429 su https://www.betexplorer.com/dropping-odds/
155 volte — la fonte ci ha chiesto di rallentare
```

### Perché succede
1. **GitHub Actions** esegue il collector ogni **45 minuti** (cron: `7,22,37,52 * * * *`)
2. **BetExplorer** ha rate limit aggressivo (probabilmente 10-20 richieste/ora per IP)
3. **Il sistema ha già un cooldown adattivo** (45→90→180 min), ma non basta
4. **IP di GitHub Actions** è condiviso con altri progetti → più probabilità di essere bloccato

### Cosa dice il codice
```typescript
// src/lib/providers/betexplorer/collect.ts
// Cooldown adattivo sui 429: scala 45→90→180 min
// Il sistema SALTA il giro di rete se in cooldown
// Ma BetExplorer continua a bloccare anche dopo il cooldown
```

---

## 2. Soluzioni Immediate (Da Implementare ORA)

### Soluzione A: Aumentare Delay tra Richieste
**File:** `src/lib/providers/betexplorer/index.ts`  
**Modifica:** Aumentare `BETEXPLORER_MIN_INTERVAL_MS` da 4000ms a 8000-10000ms

```typescript
// Prima
minIntervalMs: envInt("BETEXPLORER_MIN_INTERVAL_MS", 4_000),

// Dopo
minIntervalMs: envInt("BETEXPLORER_MIN_INTERVAL_MS", 10_000), // 10 secondi tra richieste
```

**Pro:** Riduce probabilità di 429  
**Contro:** Rallenta il collector (più tempo per completare un giro)

### Soluzione B: Ridurre Frequenza GitHub Actions
**File:** `.github/workflows/collect.yml`  
**Modifica:** Cambiare cron da 45 min a 60-90 min

```yaml
# Prima
schedule:
  - cron: '7,22,37,52 * * * *'  # ogni 45 min

# Dopo
schedule:
  - cron: '7 * * * *'  # ogni 60 min
  # oppure
  - cron: '7,37 * * * *'  # ogni 30 min ma solo 2 volte/ora
```

**Pro:** Meno richieste totali  
**Contro:** Dati meno freschi

### Soluzione C: Aggiungere Proxy Rotation
**Implementazione:** Usare servizio proxy (es. Bright Data, Scraper API) per ruotare IP

```typescript
// src/lib/providers/betexplorer/http.ts
const PROXY_LIST = [
  'http://proxy1:port',
  'http://proxy2:port',
  // ...
];

const randomProxy = PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
// Usa proxy nella richiesta fetch
```

**Pro:** Ogni richiesta da IP diverso → meno probabilità di blocco  
**Contro:** Costo ($50-200/mese), complessità implementazione

### Soluzione D: User-Agent Rotation
**Implementazione:** Ruotare User-Agent tra richieste

```typescript
const USER_AGENTS = [
  'DropAlertBot/1.0 (terminale quantitativo)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
];

const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
```

**Pro:** Semplice da implementare  
**Contro:** BetExplorer potrebbe rilevare pattern

---

## 3. Soluzione Strategica: Integrare OddsHarvester (Multi-Bookmaker)

### Cosa è OddsHarvester
- **Progetto:** https://github.com/jordantete/OddsHarvester
- **Licenza:** MIT (uso commerciale OK)
- **Cosa fa:** Scraping di OddsPortal con Playwright
- **Vantaggi:**
  - Quote da **80+ bookmaker** (non solo consenso)
  - Storico odds per ogni match
  - Community predictions e tipster profiles
  - Supporto proxy integrato
  - Output JSON/CSV/S3

### Come Integrarlo

#### Opzione 1: Eseguire OddsHarvester come Job Separato
```bash
# Script Python eseguito da GitHub Actions
pip install oddsharvester

# Scraping partite odierne
oddsharvester upcoming -s football -d $(date +%Y%m%d) -m 1x2 --headless -o odds_today.json

# Scraping storico (una volta al giorno)
oddsharvester historic -s football -l england-premier-league --season current -m 1x2 -o odds_history.json
```

**Workflow GitHub Actions:**
```yaml
name: OddsHarvester Collector
on:
  schedule:
    - cron: '15 */2 * * *'  # ogni 2 ore
jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install OddsHarvester
        run: pip install oddsharvester
      - name: Scrape Today's Odds
        run: |
          oddsharvester upcoming -s football -d $(date +%Y%m%d) -m 1x2 --headless -o data/odds_today.json
      - name: Upload to Database
        run: node scripts/import-oddsharvester.js
```

#### Opzione 2: Integrare odds-portal-scraper (Node.js)
**Progetto:** https://github.com/Mg30/odds-portal-scraper  
**Vantaggio:** Già in Node.js, integrazione diretta

```bash
npm install -g odds-portal-scraper

# Uso
odds-portal next-matches premier-league --local ./data --odds-format eu
```

**Integrazione nel codice:**
```typescript
// src/lib/providers/oddsportal/index.ts
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function fetchOddsPortal(league: string) {
  const { stdout } = await execAsync(
    `odds-portal next-matches ${league} --local ./data --odds-format eu`
  );
  return JSON.parse(stdout);
}
```

---

## 4. Roadmap Implementazione

### Fase 1: Stabilizzare BetExplorer (Oggi)
- [ ] Aumentare `BETEXPLORER_MIN_INTERVAL_MS` a 10000ms
- [ ] Ridurre frequenza GitHub Actions a 60 min
- [ ] Testare per 24h e monitorare 429

### Fase 2: Integrare OddsHarvester (Questa Settimana)
- [ ] Installare OddsHarvester in ambiente di sviluppo
- [ ] Testare scraping su 5 leghe principali
- [ ] Creare adapter per importare dati nel database
- [ ] Configurare GitHub Actions per eseguire ogni 2 ore

### Fase 3: Multi-Bookmaker (Prossima Settimana)
- [ ] Modificare schema database per supportare quote per bookmaker
- [ ] Aggiornare `odds_snapshots` con campo `bookmaker_id`
- [ ] Implementare calcolo `coordinationScore` (ora sempre 0)
- [ ] Abilitare `sharpConfirms` (ora sempre null)

### Fase 4: Smart Filter + Arbitrage (Mese Prossimo)
- [ ] Creare pagina `/smart-bets` con score combinato
- [ ] Implementare arbitrage scanner (quando abbiamo multi-bookmaker)
- [ ] Notifiche push per value bets con edge > 2%

---

## 5. Confronto Fonti Dati

| Fonte | Bookmaker | Latenza | Costo | Affidabilità |
|-------|-----------|---------|-------|--------------|
| **BetExplorer** | 1 (consenso) | 45 min | Gratis | ❌ Bloccato (429) |
| **OddsHarvester** | 80+ | 2 ore | Gratis | ✅ MIT, attivo |
| **The Odds API** | 40+ | Real-time | Gratis (500 req/mese) | ✅ Funzionante |
| **SharpAPI** | Pinnacle | Real-time | Gratis (12 req/min) | ✅ Funzionante |
| **odds-portal-scraper** | 80+ | Manuale | Gratis | ✅ MIT, attivo |

---

## 6. Raccomandazione Finale

### Cosa Fare ORA (Priorità Alta)
1. **Aumentare delay BetExplorer** a 10 secondi → riduce 429
2. **Ridurre frequenza GitHub Actions** a 60 min → meno richieste
3. **Testare per 24h** → verificare se BetExplorer si sblocca

### Cosa Fare Questa Settimana (Priorità Media)
1. **Installare OddsHarvester** → fonte multi-bookmaker affidabile
2. **Creare adapter** per importare dati nel database
3. **Configurare GitHub Actions** per eseguire ogni 2 ore

### Cosa Fare Prossima Settimana (Priorità Bassa)
1. **Abilitare multi-bookmaker** nel database
2. **Calcolare coordinationScore** e sharpConfirms
3. **Implementare Smart Filter** e arbitrage scanner

---

## 7. Progetti GitHub Rilevanti

### OddsHarvester ⭐ (Priorità Alta)
- **URL:** https://github.com/jordantete/OddsHarvester
- **Stars:** 226
- **Licenza:** MIT
- **Perché:** Multi-bookmaker, proxy support, storico odds, community data
- **Come:** Eseguire come job separato, importare JSON nel database

### odds-portal-scraper (Alternativa Node.js)
- **URL:** https://github.com/Mg30/odds-portal-scraper
- **Stars:** Non specificate
- **Licenza:** MIT
- **Perché:** Già in Node.js, integrazione diretta
- **Come:** npm install, chiamare da codice TypeScript

### soccerapi (Per Bookmaker Specifici)
- **URL:** https://github.com/S1M0N38/soccerapi
- **Stars:** 177
- **Licenza:** MIT
- **Perché:** Scraping diretto da bet365, 888sport, Unibet
- **Contro:** Non mantenuto attivamente (ultimo update 2022)

### betScrapeR (Per Analisi Storica)
- **URL:** https://github.com/dashee87/betScrapeR
- **Stars:** Non specificate
- **Licenza:** MIT
- **Perché:** R package, Betfair API + web scraping
- **Contro:** Richiede R, non integrabile direttamente

---

## 8. Costi e Budget

### Soluzione Gratuita (Consigliata)
- **BetExplorer:** Gratis (ma bloccato)
- **OddsHarvester:** Gratis (MIT)
- **The Odds API:** Gratis (500 req/mese già configurato)
- **SharpAPI:** Gratis (12 req/min già configurato)
- **Totale:** €0/mese

### Soluzione con Proxy (Se Necessario)
- **Bright Data:** $50-200/mese (proxy rotation)
- **Scraper API:** $29-99/mese (gestione automatica)
- **Totale:** $50-200/mese

### Soluzione Ibrida (Consigliata)
- **BetExplorer:** Gratis (con delay aumentato)
- **OddsHarvester:** Gratis (multi-bookmaker)
- **The Odds API:** Gratis (linea sharp)
- **Proxy:** Solo se BetExplorer continua a bloccare
- **Totale:** €0-50/mese

---

## 9. Conclusioni

**Il problema BetExplorer è risolvibile** con:
1. **Delay aumentato** (10 secondi tra richieste)
2. **Frequenza ridotta** (60 min invece di 45)
3. **OddsHarvester** come fonte secondaria multi-bookmaker

**Non serve spendere soldi** per proxy o API a pagamento. OddsHarvester è gratuito, affidabile e risolve il problema del multi-bookmaker (gap #2 del backlog).

**Prossimi passi:**
1. Implementare Soluzione A+B (oggi)
2. Installare OddsHarvester (questa settimana)
3. Abilitare multi-bookmaker (prossima settimana)

---

**Domande?** Chiedi chiarimenti su qualsiasi punto.
