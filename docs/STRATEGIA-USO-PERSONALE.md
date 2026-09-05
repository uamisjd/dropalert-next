# DropAlert — Strategia di Uso Personale per Profitto

**Data:** 05/09/2026 · **Obiettivo:** usare DropAlert come strumento personale per scommettere con vantaggio matematico

---

## Il Cambio di Paradigma

DropAlert non deve diventare un SaaS per altri. Deve diventare **il tuo terminale di trading personale**, lo strumento che ti dice:
1. **Dove c'è valore** (quote soft sopra la linea sharp)
2. **Quanto puntare** (Kelly frazionaria sul tuo bankroll)
3. **Quando agire** (alert tempestivi prima che il mercato si allinei)
4. **Come stai andando** (CLV e ROI tracciati nel tempo)

Il sito pubblico resta informativo e compliant. Ma **tu**, come proprietario, usi i dati per le tue decisioni personali.

---

## Cosa Serve per Fare Profitto: I 5 Pilastri

### 1. Linea Sharp Indipendente (CRITICO)

**Problema attuale:** DropAlert legge solo BetExplorer (quote di consenso, un bookmaker sintetico). Senza una linea sharp di riferimento, non puoi calcolare il vero EV.

**Soluzione:** Integrare **Pinnacle** come benchmark.

**Perché Pinnacle:**
- Margini più bassi del mercato (2-3% vs 5-8% dei soft)
- Limiti alti (accettano scommesse da €10.000+)
- Non limitano i vincitori (a differenza dei soft)
- La loro linea è considerata la "chiusura del mercato"

**Come integrarlo:**

#### Opzione A: SharpAPI (⭐ Raccomandata per iniziare)
- **Free tier:** 12 req/min (17.280/giorno) — più che sufficiente
- **+EV built-in:** calcola già il no-vig su Pinnacle
- **SSE streaming:** latenza <89ms
- **Costo:** €0
- **Implementazione:** Adapter `sharp-api` nel tuo sistema provider

#### Opzione B: OddsPapi (per dati storici)
- **Free tier:** 250 req/mese
- **Dati storici inclusi** (unico provider)
- **Pinnacle + Singbet + SBOBet** come sharp
- **Uso:** Backtesting e validazione del modello

#### Opzione C: The Odds API (già nel codice)
- **Free tier:** 500 crediti/mese
- **Già implementato** come adapter opzionale
- **Limite:** Crediti si esauriscono velocemente

**Azione immediata:**
```bash
# Registrati a SharpAPI (gratis)
# Ottieni API key
# Implementa src/lib/providers/sharp-api/index.ts
```

### 2. Calcolo EV Corretto

**Stato attuale:** Il motore EV esiste (`src/lib/quant/ev-engine.ts`) ma non viene usato correttamente perché manca la linea sharp.

**Cosa serve:**
```typescript
// PSEUDOCODICE: come dovrebbe funzionare
const sharpPrices = await getSharpPrices(matchId); // [1.85, 3.40, 4.20] da Pinnacle
const softPrices = getCurrentPrices(matchId); // [1.90, 3.50, 4.50] dal tuo bookmaker

const fairOdds = getBestFairOdds(sharpPrices); // rimuovi margine da Pinnacle
const ev = calculateEV(softPrices[0], { fairOdds: fairOdds[0] });

if (ev.hasEdge && ev.edgePct > 2.0) {
  // VALORE RILEVATO: quota soft 1.90 vs fair 1.88 = +1.06% edge
  alertUser(matchId, ev);
}
```

**Modifiche al codice:**
1. Aggiungere campo `sharpPrices` in `ValueOpportunity`
2. Modificare `getValueOpportunities` per chiamare SharpAPI
3. Mostrare nella tabella: "Quota soft 1.90 vs Pinnacle fair 1.88 = +1.06% EV"

### 3. Money Management con Kelly

**Stato attuale:** Kelly esiste (`src/lib/quant/kelly.ts`) ma è solo in `/strumenti` (calcolatrice manuale).

**Cosa serve:** Kelly integrato nelle card dei value bets.

**Implementazione:**
```typescript
// Per ogni value bet con edge > 0
const kelly = calculateKellyStake({
  offeredOdds: opportunity.currentOdds,
  trueProbability: opportunity.trueProbPct / 100,
  bankroll: userBankroll, // salvato in localStorage
  tier: "quarter", // standard professionale
  maxCapPct: 3.0, // mai più del 3% per scommessa
});

// Mostrare nella card:
// "Kelly: 1.2% = €12 su bankroll €1000"
```

**UI:** Aggiungere campo "Il tuo bankroll" in cima alla pagina `/value-bets` (salvato in localStorage, mai inviato al server).

### 4. Alert Tempestivi

**Stato attuale:** Notifiche push esistono ma sono generiche ("indice sopra soglia X").

**Cosa serve:** Alert specifici per value bets.

**Implementazione:**
```typescript
// Nuova rotta: POST /api/push/value-alert
{
  "matchId": 123,
  "selection": "1",
  "edgePct": 3.5,
  "kellyPct": 1.2,
  "message": "VALUE: Inter -3.5% EV su 1X2 Casa. Kelly: 1.2% = €12"
}
```

**Trigger:** Quando un segnale ha:
- Edge > 2% (soglia minima per coprire varianza)
- Kelly > 0.5% (altrimenti la size è troppo piccola)
- Kickoff tra 1-24 ore (non troppo presto, non troppo tardi)

### 5. Tracking Performance Personale

**Stato attuale:** `/performance` mostra il CLV del sistema, non le tue scommesse personali.

**Cosa serve:** Bankroll tracker personale.

**Implementazione:**
```typescript
// Nuova tabella: personal_bets
{
  id: number,
  matchId: number,
  selection: string,
  odds: number,
  stake: number,
  edgePct: number,
  kellyPct: number,
  placedAt: Date,
  settledAt: Date | null,
  result: "won" | "lost" | "void" | null,
  profit: number | null,
}

// Nuova pagina: /mio-bankroll (privata, dietro auth)
// Mostra: ROI, CLV medio, drawdown, profitto totale
```

**Privacy:** Tabella separata, accessibile solo con autenticazione, mai esposta pubblicamente.

---

## Progetti GitHub da Integrare: I 3 Essenziali

### 🥇 OddsHarvester — Il Collettore Definitivo

**URL:** https://github.com/jordantete/OddsHarvester
**Licenza:** MIT ✅
**Linguaggio:** Python (Playwright)

**Perché è essenziale:**
- Cattura **quote per singolo bookmaker** da OddsPortal
- Risolve il gap #2 del backlog (coordinazione multi-bookmaker)
- Dati storici per qualsiasi stagione
- Rileva quote bloccate (mercati ritirati)
- Community data (predizioni utenti, ROI tipster)

**Come si integra:**
1. **Sostituire BetExplorer** come fonte primaria, OPPURE
2. **Affiancare BetExplorer** come seconda fonte per validazione incrociata

**Implementazione:**
```bash
# Installa OddsHarvester
pip install oddsharvester

# Script giornaliero: scarica quote per tutti i match di oggi
oddsharvester upcoming -s football -d $(date +%Y%m%d) -m 1x2,btts,over_under --headless -f json -o data/odds-today.json

# Adapter Node.js che legge il JSON e popola il database
# src/lib/providers/oddsharvester/index.ts
```

**Vantaggio competitivo:** Con OddsHarvester hai:
- 15-20 bookmaker per match (vs 1 di BetExplorer)
- `coordinationScore` finalmente misurabile
- `sharpConfirms` osservabile (se Pinnacle è fra i bookmaker)
- Indice può superare il tetto di 55

### 🥈 OctoPy — Il Modello Matematico

**URL:** https://github.com/octosport/octopy
**Licenza:** MIT ✅
**Linguaggio:** Python

**Perché è essenziale:**
- Implementa il **metodo Shin** (già citato nei tuoi docs!)
- Poisson goals prediction
- Machine learning prediction
- Validato su dati reali

**Come si integra:**
Il tuo RESEARCH-BACKLOG punto 7 dice "Modello gol (Elo/Poisson) vs mercato" — OctoPy è l'implementazione pronta.

**Workflow:**
```python
# Script giornaliero: genera probabilità per tutti i match di oggi
from octopy import PoissonModel, ShinMethod

model = PoissonModel()
predictions = model.predict_matches("data/historical-results.csv")

shin = ShinMethod()
fair_probs = shin.remove_margin(predictions)

# Salva in JSON
with open("data/model-predictions.json", "w") as f:
    json.dump(fair_probs, f)
```

```typescript
// Adapter Node.js: confronta probabilità modello con quote di mercato
// src/lib/quant/model-comparison.ts

const modelProbs = await loadModelPredictions(); // da OctoPy
const marketProbs = getMarketProbabilities(matchId); // dalle quote

const divergence = modelProbs[0] - marketProbs[0];
if (divergence > 0.05) {
  // Il modello dice 45% probabilità, il mercato dice 40% = +5% edge
  flagAsValueBet(matchId, divergence);
}
```

**Vincolo:** Nessun output del modello entra nel sito pubblico finché il backtest out-of-sample non è passato (regola già nel backlog).

### 🥉 Soccer xG — Expected Goals Accademico

**URL:** https://github.com/ML-KULeuven/soccer_xg
**Licenza:** Apache 2.0 ✅
**Linguaggio:** Python
**Istituzione:** KU Leuven ( Belgio, peer-reviewed)

**Perché è utile:**
- Modello xG validato accademicamente
- Supporta dati Opta, Wyscout, StatsBomb
- Pipeline personalizzabili
- Modelli separati per gioco aperto, punizioni, rigori

**Come si integra:**
La sezione `/xg` è già in "costruzione". Questo pacchetto la completa.

**Workflow:**
```python
# Calcola xG per tutti i match di oggi
from soccer_xg import XGModel

model = XGModel.load_model('openplay_xgboost_advanced')
xg_home = model.estimate_xg(home_team_shots)
xg_away = model.estimate_xg(away_team_shots)

# Confronta con quote Over/Under
total_xg = xg_home + xg_away
market_ou_25 = get_market_probability("over_25", matchId)

if total_xg > 2.8 and market_ou_25 < 0.55:
  # Modello dice 2.8 gol attesi, mercato dice 55% probabilità over 2.5
  # Se la probabilità reale è 65%, c'è +10% edge
  flagAsValueBet(matchId, "over_25", edge=10%)
```

**Uso:** Come filtro aggiuntivo per i value bets. Un segnale è più credibile se:
- EV positivo dalle quote
- Confermato dal modello xG
- Confermato dal contesto 360° (forma, assenze, etc.)

---

## Idee Grandiose: 3 Feature Killer

### 💡 Idea 1: "Smart Filter" — Il Tuo Assistente Personale

**Concept:** Un pannello filtri avanzato che combina tutti i segnali in un unico score.

**Implementazione:**
```typescript
interface SmartFilter {
  minEdge: number; // minimo 2%
  minKelly: number; // minimo 0.5%
  minConfidence: number; // minimo 60/100
  requireSharpConfirmation: boolean; // solo se Pinnacle conferma
  requireModelAgreement: boolean; // solo se OctoPy concorda
  requireXGConfirmation: boolean; // solo se xG supporta
  maxOdds: number; // massimo 3.00 (evita scommesse ad alta varianza)
  minLiquidity: number; // solo mercati con volume sufficiente
}

function calculateSmartScore(opportunity, filters): number {
  let score = 0;
  
  // Edge pesa il 40%
  score += (opportunity.edgePct / 10) * 40;
  
  // Kelly pesa il 20%
  score += (opportunity.kellyPct / 5) * 20;
  
  // Confidence pesa il 15%
  score += (opportunity.confidence / 100) * 15;
  
  // Sharp confirmation vale 15 punti
  if (opportunity.sharpConfirmed) score += 15;
  
  // Model agreement vale 10 punti
  if (opportunity.modelAgrees) score += 10;
  
  return score;
}
```

**UI:** Nuova pagina `/smart-bets` che mostra solo le scommesse con score > 70, ordinate per score.

**Messaggio:** "Oggi ci sono 3 scommesse smart: Inter (score 85), Milan (score 78), Roma (score 72)"

### 💡 Idea 2: "Arbitrage Scanner" — Profitto Garantito

**Concept:** Trova arbitraggi fra bookmaker diversi.

**Come funziona:**
```typescript
// Esempio: Match Inter vs Milan
// Bookmaker A: Inter 2.10, Pareggio 3.40, Milan 3.80
// Bookmaker B: Inter 2.00, Pareggio 3.50, Milan 4.00

// Calcola arbitraggio
const arb = calculateArbitrage({
  "1": [2.10, 2.00], // Inter
  "X": [3.40, 3.50], // Pareggio
  "2": [3.80, 4.00], // Milan
});

// Se arb.profitPct > 0, c'è arbitraggio
// In questo caso: punta €100 su Inter @2.10 (A), €60 su X @3.50 (B), €50 su Milan @4.00 (B)
// Totale investito: €210, incasso minimo: €210 (Inter) o €210 (X) o €200 (Milan)
// Profitto garantito: €0 (break-even) o perdita €10 (se vince Milan)
// Aspetta, ricalcolo...

// Arbitraggio reale: somma (1/odds) < 1
// (1/2.10) + (1/3.50) + (1/4.00) = 0.476 + 0.286 + 0.250 = 1.012 > 1 (no arb)

// Serve: (1/odds_best) < 1
// Migliori quote: Inter 2.10, X 3.50, Milan 4.00
// (1/2.10) + (1/3.50) + (1/4.00) = 1.012 (ancora no arb)

// Arbitraggio esiste se trovi quote dove la somma è < 1
// Esempio: Inter 2.20, X 3.60, Milan 4.20
// (1/2.20) + (1/3.60) + (1/4.20) = 0.455 + 0.278 + 0.238 = 0.971 < 1 ✅
// Profitto: 2.9% garantito
```

**Implementazione:**
```typescript
// Nuova pagina: /arbitrage
// Per ogni match, confronta le quote migliori fra tutti i bookmaker
// Se trovi arbitraggio, mostra:
// - Match: Inter vs Milan
// - Profitto: 2.9% garantito
// - Puntate: €100 su Inter @2.20 (Book A), €61 su X @3.60 (Book B), €52 su Milan @4.20 (Book C)
// - Totale investito: €213, incasso: €220 (qualsiasi esito)
```

**Realtà:** Arbitraggi veri sono rari (1-2% dei match) e piccoli (0.5-2% profitto). Ma quando li trovi, è profitto garantito.

**Fonte dati:** OddsHarvester (quote per singolo bookmaker) è essenziale.

### 💡 Idea 3: "Closing Line Value Tracker" — La Tua Performance Reale

**Concept:** Traccia il CLV delle tue scommesse personali, non del sistema.

**Perché è importante:**
- Il CLV del sistema misura quanto il sistema è bravo a prevedere i movimenti
- Il CLV personale misura quanto **tu** sei bravo a battere la chiusura
- Se batti costantemente la chiusura, stai facendo profitto di lungo periodo

**Implementazione:**
```typescript
// Quando piazzi una scommessa
const bet = {
  matchId: 123,
  selection: "1",
  odds: 2.10, // quota a cui hai puntato
  stake: 50,
  placedAt: "2026-09-05T14:00:00Z",
};

// Alla chiusura del mercato (1 minuto prima del kickoff)
const closingOdds = getClosingOdds(matchId, "1"); // es. 1.95

// Calcola CLV
const clv = (bet.odds / closingOdds) - 1; // (2.10 / 1.95) - 1 = +7.7%

// Significa: hai puntato a 2.10, il mercato ha chiuso a 1.95
// Hai battuto la chiusura del 7.7% = stai facendo profitto
```

**Dashboard personale:**
```
Le tue ultime 50 scommesse:
- CLV medio: +4.2%
- ROI: +8.5%
- Win rate: 52%
- Profitto totale: €425 su €5.000 puntati
- Drawdown massimo: -12%

Grafico: CLV nel tempo (asse X: data, asse Y: CLV cumulativo)
```

**Obiettivo:** Se il tuo CLV medio è > 2% su 100+ scommesse, stai facendo profitto di lungo periodo anche se il ROI attuale è negativo (la varianza si normalizza nel tempo).

---

## Roadmap Implementativa: 90 Giorni

### Settimana 1-2: Fondamenta
- [ ] Registrati a SharpAPI (free tier)
- [ ] Implementa adapter `src/lib/providers/sharp-api/index.ts`
- [ ] Testa su 10 match: confronta quote Pinnacle con BetExplorer
- [ ] Aggiungi campo `sharpPrices` al database

### Settimana 3-4: Value Bets Reali
- [ ] Modifica `getValueOpportunities` per usare SharpAPI
- [ ] Mostra nella tabella: "Quota soft vs Pinnacle fair = EV%"
- [ ] Aggiungi filtro "solo EV > 2%"
- [ ] Testa su 50 match: quanti value bets trovi?

### Settimana 5-6: Kelly Integrato
- [ ] Aggiungi campo "Il tuo bankroll" in `/value-bets` (localStorage)
- [ ] Calcola Kelly per ogni value bet
- [ ] Mostra nella card: "Kelly: 1.2% = €12"
- [ ] Aggiungi filtro "solo Kelly > 0.5%"

### Settimana 7-8: OddsHarvester
- [ ] Installa OddsHarvester (Python)
- [ ] Script giornaliero: scarica quote per tutti i match
- [ ] Adapter Node.js: popola database con quote per bookmaker
- [ ] Testa: quanti bookmaker per match? La coordinazione è misurabile?

### Settimana 9-10: Alert Value Bets
- [ ] Nuova rotta: `POST /api/push/value-alert`
- [ ] Trigger: edge > 2% AND Kelly > 0.5% AND kickoff 1-24h
- [ ] Testa: ricevi gli alert sul telefono
- [ ] Piazza le prime scommesse basate sugli alert

### Settimana 11-12: Tracking Personale
- [ ] Nuova tabella: `personal_bets`
- [ ] Nuova pagina: `/mio-bankroll` (dietro auth)
- [ ] Traccia tutte le tue scommesse
- [ ] Calcola CLV personale, ROI, drawdown
- [ ] Dopo 30 scommesse: analizza i risultati

### Settimana 13+: Ottimizzazione
- [ ] Integra OctoPy (modello matematico)
- [ ] Integra Soccer xG (expected goals)
- [ ] Implementa Smart Filter
- [ ] Implementa Arbitrage Scanner
- [ ] Analizza 100+ scommesse: il sistema funziona?

---

## Metriche di Successo

Dopo 90 giorni, devi avere:

| Metrica | Obiettivo | Significato |
|---|---|---|
| Value bets trovati/giorno | 5-10 | Il sistema trova opportunità |
| Edge medio | > 2% | Le opportunità sono reali |
| Kelly medio | > 0.5% | Le size sono significative |
| Scommesse piazzate | 50+ | Hai dati sufficienti |
| CLV personale medio | > 2% | Stai battendo la chiusura |
| ROI | > 0% | Stai facendo profitto |

**Se il CLV è > 2% ma il ROI è negativo:** stai facendo le scommesse giuste, ma la varianza ti sta punendo. Continua, si normalizza su 200+ scommesse.

**Se il CLV è < 0%:** il sistema non funziona. Rivedi i filtri, alza la soglia di edge, riduci le size.

**Se il CLV è > 5% e il ROI è > 5%:** hai trovato il Santo Graal. Scala le size, aumenta il bankroll.

---

## Costi e Investimento

### Costi Mensili
- SharpAPI: €0 (free tier)
- Hosting (Vercel): €0 (già incluso)
- Database (Neon): €0 (free tier)
- OddsHarvester: €0 (open-source)
- **Totale: €0/mese**

### Investimento Iniziale (Bankroll)
- **Minimo:** €1.000 (per testare il sistema)
- **Consigliato:** €5.000 (per avere size significative)
- **Ottimale:** €10.000+ (per scalare quando il sistema è validato)

**Regola:** Non puntare mai più del 3% del bankroll su una singola scommessa (Kelly con cap).

---

## Sintesi Finale

**La partita da giocare:** usare DropAlert come terminale di trading personale per scommettere con vantaggio matematico.

**I 5 pilastri:**
1. Linea sharp (Pinnacle) come benchmark
2. Calcolo EV corretto (soft vs sharp)
3. Kelly per money management
4. Alert tempestivi
5. Tracking performance personale

**I 3 progetti essenziali:**
1. OddsHarvester (quote per bookmaker)
2. OctoPy (modello matematico)
3. Soccer xG (expected goals)

**Le 3 idee grandiose:**
1. Smart Filter (score combinato)
2. Arbitrage Scanner (profitto garantito)
3. CLV Tracker personale (la tua performance reale)

**Obiettivo a 90 giorni:** 50+ scommesse piazzate, CLV medio > 2%, ROI > 0%.

**La chiave:** DropAlert non deve darti "consigli di giocata" generici. Deve darti **le informazioni giuste** per prendere decisioni informate: dove c'è valore, quanto puntare, quando agire, come stai andando. Il resto lo fai tu.
