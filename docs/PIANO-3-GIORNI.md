# Piano 3 Giorni — DropAlert Multi-Bookmaker

**Obiettivo:** Completare integrazione multi-bookmaker e abilitare tutte le feature avanzate in 3 giorni.

---

## 📅 Giorno 1 (OGGI — 05/09/2026) ✅ COMPLETATO

### Fix BetExplorer Rate Limit (429)
- ✅ Aumentato delay da 4s a 10s (`BETEXPLORER_MIN_INTERVAL_MS`)
- ✅ Ridotta frequenza GitHub Actions da 45min a 60min
- ✅ `COLLECT_INTERVAL_MINUTES` da 45 a 60
- ✅ Commit e push completati

### Integrazione OddsHarvester
- ✅ Script Python `scripts/oddsharvester-collect.py`
  - Esegue scraping da 80+ bookmaker via OddsPortal
  - Raccoglie quote per oggi e domani
  - Output: `data/oddsharvester/latest.json`
- ✅ Adapter TypeScript `scripts/import-oddsharvester.ts`
  - Importa quote nel database con bookmaker_id
  - Crea bookmaker se non esistono
  - Supporta mercati: 1X2, Over/Under 2.5, BTTS
- ✅ Workflow GitHub Actions `.github/workflows/oddsharvester.yml`
  - Esegue ogni 2 ore (12 volte al giorno)
  - Installa OddsHarvester + Playwright
  - Importa dati nel database Neon
- ✅ Script npm in `package.json`
  - `npm run oddsharvester:collect`
  - `npm run oddsharvester:import`
  - `npm run oddsharvester:full`

### Documentazione
- ✅ `docs/SOLUZIONE-BETEXPLORER-RATE-LIMIT.md` — Analisi completa + roadmap

---

## 📅 Giorno 2 (DOMANI — 06/09/2026)

### Multi-Bookmaker nel Database
- [ ] Verificare che `odds_snapshots` supporti `bookmaker_id`
  - Se non esiste, creare migrazione
  - Aggiornare schema se necessario
- [ ] Modificare query per leggere quote per bookmaker
- [ ] Testare import OddsHarvester su dati reali

### Abilitare Coordination Score
- [ ] Modificare `src/lib/drop/engine.ts` per calcolare `coordinationScore`
  - Conta bookmaker che confermano il movimento
  - Peso: 25 punti su 100 (ora sempre 0)
- [ ] Aggiornare `/value-bets` per mostrare coordination
- [ ] Testare con dati OddsHarvester

### Abilitare Sharp Confirms
- [ ] Identificare bookmaker "sharp" (Pinnacle, Betfair Exchange, ecc.)
- [ ] Modificare `src/lib/drop/engine.ts` per calcolare `sharpConfirms`
  - Verifica se bookmaker sharp conferma il movimento
  - Peso: 20 punti su 100 (ora sempre null)
- [ ] Aggiornare UI per mostrare conferma sharp
- [ ] Testare con dati OddsHarvester

### Smart Filter (Pagina /smart-bets)
- [ ] Creare pagina `src/app/smart-bets/page.tsx`
- [ ] Implementare score combinato:
  - Edge % (peso 40%)
  - Kelly % (peso 20%)
  - Confidence Score (peso 20%)
  - Coordination Score (peso 10%)
  - Sharp Confirms (peso 10%)
- [ ] Filtri avanzati:
  - Min edge, min Kelly, min confidence
  - Solo con sharp confirmation
  - Solo con coordination > 50%
- [ ] Aggiungere a SiteNav

---

## 📅 Giorno 3 (DOPODOMANI — 07/09/2026)

### Arbitrage Scanner
- [ ] Creare pagina `src/app/arbitrage/page.tsx`
- [ ] Implementare rilevamento arbitraggi:
  - Confronta quote tra bookmaker
  - Calcola profitto garantito %
  - Mostra stake ottimale per ogni bookmaker
- [ ] Filtri:
  - Min profitto %
  - Solo mercati specifici (1X2, O/U, BTTS)
  - Solo bookmaker disponibili
- [ ] Alert per arbitraggi > 2%

### Testing Completo
- [ ] Testare BetExplorer con nuovo delay (verificare 429 ridotti)
- [ ] Testare OddsHarvester su 5 leghe principali
- [ ] Verificare import nel database
- [ ] Testare multi-bookmaker in `/value-bets`
- [ ] Testare coordination score e sharp confirms
- [ ] Testare Smart Filter con dati reali
- [ ] Testare Arbitrage Scanner

### Documentazione Finale
- [ ] Aggiornare `GUIDA-OPERATIVA.md` con nuove feature
- [ ] Creare `docs/MULTI-BOOKMAKER.md` — Come usare OddsHarvester
- [ ] Creare `docs/ARBITRAGE.md` — Come funzionano gli arbitraggi
- [ ] Aggiornare README.md con nuove feature

### Deploy e Monitoraggio
- [ ] Verificare deploy Vercel
- [ ] Monitorare GitHub Actions (BetExplorer + OddsHarvester)
- [ ] Verificare che dati multi-bookmaker arrivino al database
- [ ] Testare UI completa su https://dropalert-next.vercel.app/

---

## 🎯 Risultati Attesi

### Dopo Giorno 1 ✅
- BetExplorer rate limit ridotto (meno 429)
- OddsHarvester integrato (infrastruttura pronta)
- Workflow GitHub Actions configurati

### Dopo Giorno 2
- Multi-bookmaker attivo nel database
- Coordination Score calcolato (0 → valore reale)
- Sharp Confirms calcolato (null → valore reale)
- Smart Filter disponibile
- Indice di confidenza più accurato (55 → 100 punti possibili)

### Dopo Giorno 3
- Arbitrage Scanner funzionante
- Tutte le feature testate
- Documentazione completa
- Sistema pronto per uso personale

---

## 🔧 Comandi Utili

### Giorno 1 (Test Locale)
```bash
# Test BetExplorer con nuovo delay
npm run job:collect

# Test OddsHarvester (richiede Python + Playwright)
pip install oddsharvester
playwright install chromium
npm run oddsharvester:collect

# Import dati nel database
npm run oddsharvester:import

# Full pipeline
npm run oddsharvester:full
```

### Giorno 2 (Multi-Bookmaker)
```bash
# Verifica bookmaker nel database
npm run db:studio
# Tabella: bookmakers, odds_snapshots

# Test coordination score
npm run test:all

# Avvia dev server
npm run dev
# Visita: http://localhost:3000/value-bets
# Visita: http://localhost:3000/smart-bets
```

### Giorno 3 (Arbitrage + Testing)
```bash
# Test arbitrage scanner
npm run dev
# Visita: http://localhost:3000/arbitrage

# Test completo
npm run test:all

# Build produzione
npm run build
```

---

## 📊 Metriche di Successo

### Giorno 1
- ✅ BetExplorer: < 10 errori 429 nelle 24h successive
- ✅ OddsHarvester: workflow GitHub Actions eseguito con successo
- ✅ Dati: almeno 50 match con quote multi-bookmaker importati

### Giorno 2
- ✅ Coordination Score: calcolato per > 50% dei segnali
- ✅ Sharp Confirms: calcolato per > 30% dei segnali
- ✅ Indice confidenza: media > 60 (prima max 55)
- ✅ Smart Filter: pagina funzionante con filtri

### Giorno 3
- ✅ Arbitrage: almeno 5 arbitraggi rilevati al giorno
- ✅ Testing: tutti i test passano
- ✅ Deploy: sito online con tutte le feature
- ✅ Documentazione: completa e aggiornata

---

## 🚨 Rischi e Mitigazioni

### Rischio 1: OddsHarvester fallisce scraping
**Mitigazione:**
- Script ha `continue-on-error: true`
- Log dettagliati in GitHub Actions
- Fallback: usa solo BetExplorer + The Odds API

### Rischio 2: Database schema non supporta multi-bookmaker
**Mitigazione:**
- Verificare schema prima di Giorno 2
- Se necessario, creare migrazione
- Testare import su database di test

### Rischio 3: GitHub Actions supera limiti (2000 min/mese)
**Mitigazione:**
- Monitorare usage in Settings → Actions
- Se necessario, ridurre frequenza OddsHarvester a ogni 4 ore
- Oppure: eseguire solo su repo pubblico (minuti illimitati)

### Rischio 4: BetExplorer continua a bloccare
**Mitigazione:**
- Monitorare errori 429 in `/api/health`
- Se persiste, aumentare delay a 15s o 20s
- Oppure: usare solo OddsHarvester come fonte primaria

---

## 📝 Note Importanti

1. **OddsHarvester richiede Playwright** — GitHub Actions installa automaticamente
2. **Database Neon** — verificare che `bookmakers` table esista, altrimenti creare migrazione
3. **Bookmaker "sharp"** — definire lista (Pinnacle, Betfair Exchange, Smarkets, ecc.)
4. **Arbitrage threshold** — iniziare con 2%, poi ottimizzare in base ai dati reali
5. **Testing** — eseguire `npm run test:all` dopo ogni modifica importante

---

**Ultimo aggiornamento:** 05/09/2026, 22:30  
**Prossimo aggiornamento:** 06/09/2026, fine Giorno 2
