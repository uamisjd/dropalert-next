# Piano 3 Giorni — DropAlert Multi-Bookmaker

## ✅ Giorno 1 — COMPLETATO (2026-09-05)

### 1. Fix BetExplorer 429 (Rate Limit)
- [x] Aumenta delay da 4s a 10s in `src/lib/providers/betexplorer/index.ts`
- [x] Riduci frequenza GitHub Actions da 45min a 60min in `.github/workflows/collect.yml`
- [x] Cambia `COLLECT_INTERVAL_MINUTES` da 45 a 60

### 2. Integra OddsHarvester (multi-bookmaker)
- [x] Crea `scripts/oddsharvester-collect.py` (wrapper Python per CLI)
- [x] Crea `scripts/import-oddsharvester.ts` (adatta dati al nostro DB)
- [x] Aggiungi workflow GitHub Actions `.github/workflows/oddsharvester.yml` (ogni 2h)
- [x] Aggiungi script npm `oddsharvester:collect`, `oddsharvester:import`, `oddsharvester:full`

**Nota:** Script OddsHarvester rimossi temporaneamente per errori di schema DB. Da reimplementare correttamente.

### 3. Test e verifica
- [x] Verifica che BetExplorer non riceva più 429 (controlla log GitHub Actions)
- [ ] Verifica che OddsHarvester raccolga dati (controlla `data/oddsharvester/`)
- [x] Verifica che Vercel deploy correttamente
- [x] Fix errori typecheck in sharp-api/index.ts (tipi undefined)
- [x] Fix dichiarazioni duplicate in mio-bankroll/page.tsx

### Commit
- `e3746f9` feat(giorno-1): fix BetExplorer 429 + integra OddsHarvester multi-bookmaker
- `c4971d3` docs: aggiungi piano 3 giorni
- `cfbc30f` fix: correggi errori build Vercel

---

## ✅ Giorno 2 — COMPLETATO (2026-09-06)

### 1. Verifica schema database
- [x] Verifica che `odds_snapshots` abbia `bookmaker_id` (già presente)
- [x] Verifica che `bookmakers` abbia `is_sharp` e `weight` (già presente)
- [x] Seed già configurato: 3 sharp (Pinnacle, Betfair Exchange, Smarkets) + 7 soft

### 2. Coordination Score (25 punti)
- [x] **Già implementato** in `src/lib/drop/engine.ts` (`computeCoordination()`)
- [x] Calcola automaticamente su segnali con multi-bookmaker
- [x] Usa peso bookmaker (`weight` da tabella `bookmakers`)

### 3. Sharp Confirms (20 punti)
- [x] **Già implementato** in `src/lib/drop/engine.ts` (`computeSharp()`)
- [x] Filtra bookmaker con `isSharp = true` (Pinnacle, Betfair Exchange, Smarkets)
- [x] Calcola automaticamente quando dati sharp disponibili

### 4. Pagina /smart-bets
- [x] Crea `src/app/smart-bets/page.tsx`
- [x] Crea `src/components/SmartBetsTable.tsx`
- [x] Smart Score (0-100) combina: Edge (40%), Kelly (20%), Quota (20%), Freshness (20%)
- [x] Filtra solo value bets con edge ≥ 2%
- [x] Ordina per punteggio decrescente
- [x] Mostra Kelly inline
- [ ] Aggiungi link nella navigazione (opzionale, uso personale)

### Commit
- `b150bbd` feat(giorno-2): aggiungi pagina /smart-bets con punteggio combinato

### PR
- [#18](https://github.com/uamisjd/dropalert-next/pull/18) feat(giorno-2): pagina /smart-bets con punteggio combinato

---

## ⏳ Giorno 3 — Arbitraggio e Testing (2026-09-07)

### 1. Arbitrage Scanner
- [ ] Crea `src/lib/quant/arbitrage.ts` (calcola opportunità cross-bookmaker)
- [ ] Crea pagina `/arbitrage`
- [ ] Mostra surebet con profitto garantito > 0.5%

### 2. Testing completo
- [ ] Verifica che BetExplorer 429 siano ridotti (< 10/giorno)
- [ ] Verifica che OddsHarvester importi correttamente (quando reimplementato)
- [ ] Verifica che coordination score sia calcolato (> 80% segnali)
- [ ] Verifica che sharp confirms sia calcolato (> 60% segnali)
- [ ] Verifica che arbitrage rilevi opportunità (> 5/giorno)

### 3. Documentazione finale
- [ ] Aggiorna `GUIDA-OPERATIVA.md` con nuove feature
- [ ] Aggiorna `README.md` con architettura multi-bookmaker
- [ ] Crea `docs/COME-USARE-SMART-BETS.md`

---

## Metriche di successo

| Metrica | Prima | Dopo Giorno 1 | Dopo Giorno 2 | Dopo Giorno 3 |
|---------|-------|---------------|---------------|---------------|
| BetExplorer 429 | ~155/giorno | < 50/giorno | < 20/giorno | < 10/giorno |
| Bookmaker nel DB | 1 (BetExplorer) | 1 | 1 (ma schema pronto per N) | 20+ |
| Coordination Score | sempre 0 | sempre 0 | calcolato (> 80% segnali) | calcolato (> 90% segnali) |
| Sharp Confirms | sempre null | sempre null | calcolato (> 60% segnali) | calcolato (> 80% segnali) |
| Index confidenza | max 55 punti | max 55 punti | max 100 punti | max 100 punti |
| Arbitraggio | N/A | N/A | N/A | 5+ opportunità/giorno |

---

## Note tecniche

### Database schema (già pronto)
- `bookmakers.id`, `bookmakers.key`, `bookmakers.name`, `bookmakers.is_sharp`, `bookmakers.weight`
- `odds_snapshots.match_id`, `odds_snapshots.bookmaker_id`, `odds_snapshots.price`, etc.

### Bookmaker sharp (da seed.ts)
- Pinnacle (`is_sharp = true`, `weight = 1.0`)
- Betfair Exchange (`is_sharp = true`, `weight = 1.0`)
- Smarkets (`is_sharp = true`, `weight = 0.9`)

### Bookmaker soft (da seed.ts)
- bet365, William Hill, Unibet, Betsson, Marathonbet, 1xBet, Betclic
- `is_sharp = false`, `weight` tra 0.6 e 0.8

### Engine (già implementato)
- `computeCoordination()` in `src/lib/drop/engine.ts`
- `computeSharp()` in `src/lib/drop/engine.ts`
- Entrambi calcolano automaticamente quando dati multi-bookmaker disponibili
