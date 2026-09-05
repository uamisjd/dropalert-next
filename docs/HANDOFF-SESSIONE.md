# Handoff — DropAlert: stato lavori, infrastruttura live, cosa continuare

> Documento di continuità fra sessioni di lavoro. Ultimo aggiornamento: 2026-09-05.
> PR #11 (ramo `arena/01a0707a-dropalert-next` → `main`): MERGIATA in questa sessione.

## 1. Cos'è questo progetto (in una frase)

DropAlert è un **terminale quantitativo per scommesse sul calcio**: monitora i
movimenti delle quote (fonte BetExplorer, solo consenso), misura divari contro
linee no-vig, pubblica CLV onesto (anche negativo) e offre calcolatori
client-side. Contratto editoriale: segnali e strumenti per informare le giocate,
**nessuna vincita garantita**, gioco responsabile. Niente consigli di puntata,
niente link a bookmaker, niente stime spacciate per dati.

## 2. Mappa rapida

- Pagine: `/` movimenti · `/value-bets` divario · `/trading` escursione ·
  `/surebet` + `/strumenti` + `/simulator` calcolatori · `/ieri` esiti ·
  `/domani` calendario · `/performance` CLV · `/cov` copertura ·
  `/metodologia` · `/preferite` watchlist · `/gioco-responsabile` · `/privacy`
- Raccolta: `Osservazione DropAlert` (GitHub Actions, ogni ~15 min) →
  `scripts/cycle.sh` → `src/scripts/run-collect.ts` → pipeline
  (`src/lib/pipeline/`) → Neon Postgres. Le pagine leggono il DB, mai la fonte.
- Fonte live: BetExplorer scraping (`src/lib/providers/betexplorer/`), solo
  consenso (`perBookmakerOdds=false`, dichiarato ovunque). Fonti secondarie:
  football-data (calendario, serve chiave), Tavily (news+contesto, budget
  giornaliero condiviso), the-odds-api (SPENTA di proposito, guscio onesto).
- Vercel: solo hosting + deploy (il cron di Vercel NON si usa: piano Hobby =
  1 cron/giorno). **Deployment Protection DISATTIVATA** (05.09.2026): sito
  pubblico, indicizzabile. Non riattivarla senza motivo.

## 3. Cosa è stato fatto (sessioni precedenti, già in `main`)

1. Riposizionamento a terminale betting + guardrail frasi vietate.
2. Audit P0+P1: **leak SQL rimossi da 4 pagine** (ieri/domani/cov/value-bets —
   errore grezzo solo nel log server, testo generico in HTML); unità divario
   % vs pp riallineate ovunque (scanner, card, MatchQuantPanel); banner
   "PROFITTO GARANTITO" rimosso; GreenUp onesto (segni, colori, responsabilità
   condizionale, no "Rischio Zero"); EmptyState a 3 toni; grafico CLV con
   rottura oltre 7 gg di silenzio; `readFailed` nel trading.
3. **Fix critico collector** (motivo della PR): `fetchFixtures` visitava in
   serie una pagina di dettaglio per OGNI riga dell'elenco (200+ nel weekend)
   → 3 timeout da 10 min di fila, raccolta ferma. Ora: tetto 60 righe +
   budget 5 min, ordinate per calo, resto dichiarato `[dettaglio-non-visitato]`
   (contato come `our_choice`). Aggiunti: timeout 15 s su invio web-push,
   `connect_timeout` 30 s + statement timeout 120 s sul client DB.
4. Fonti/strumenti auditati: Margin/Variance/Kelly/synthetic/EV/Dixon-Coles
   corretti; simulator senza più `undefined% EV`/💎; Dutching con invito a
   quote incomplete; robots.txt riverificato live (invariato 05.09.2026).

## 4. Stato live al momento del merge (verificare che regga)

- Produzione: deploy Vercel `success` su main; home con dati freschi.
- `/api/health`: `partial_data` con ~95 buchi `rate_limited` + circuito
  BetExplorer aperto = pressione della fonte gestita come progettato.
- Azioni GitHub: run `Osservazione DropAlert` ripartiti da soli (09:29Z) dopo
  i 3 timeout notturni; PR #11 con check Vercel + validate verdi.

## 5. Istruzioni per la prossima sessione (in ordine)

1. **Post-merge (subito)**: deploy Production verde? Prossimi 2–3 run
   `Osservazione DropAlert` in `success` (non `cancelled`)? `/coverage` con
   giri recenti? `/api/health` raggiungibile? Comando:
   `gh run list --workflow "Osservazione DropAlert" --limit 5`.
2. **Pressione fonte (giorni successivi)**: se i 429 persistono
   (`rate_limited` alto in health), abbassare il ritmo:
   `BETEXPLORER_RPM` 12→8 o `BETEXPLORER_MIN_INTERVAL_MS` 4000→6000
   (variabili del workflow, NON servono push di codice). Meno righe per giro,
   ma giri che arrivano in fondo.
3. **Fragilità nota del parser**: le regex cercano classi `table-main__*` e
   BetExplorer ha aggiunto un age-gate 18+ (05.09.2026, contenuto ancora
   presente nell'HTML). Se un giorno `fetchFixtures` torna 0 righe con pagina
   200, la guardia scatta (`partial`, non silenzio): controllare se hanno
   cambiato markup o se il gate blocca davvero, poi aggiornare `parse.ts` e le
   fixture in `src/lib/providers/__tests__/fixtures/`.
4. **Mai toccare `.github/workflows/` via push dell'agente**: il token in uso
   non ha scope `workflow` e il push viene rifiutato. Modifiche al cron solo
   da interfaccia GitHub.
5. **Mai cambiare ramo**: tutto il lavoro sul ramo della sessione attiva;
   push solo a quello; PR da quello verso `main`.

## 6. Comandi utili

- `npm run test:all` (exit 0 = tutto verde) · `npx tsc --noEmit` ·
  `npm run build` · singole suite: `test:client test:feed test:filters
  test:quant test:tools test:betexplorer test:coverage test:view ...`
-_countingultura di lavoro_: un edit per file alla volta + `grep` di
  riverifica (edit multipli sullo stesso file possono perdersi); commenti in
  italiano; stati onesti mai zeri di ripiego; test per ogni fix UI in
  `src/components/__tests__/tools.test.tsx` (jsdom; c'è lo shim di `self`).

## 7. URL e riferimenti

- Produzione: deployment `dropalert-next-i31uaax6b-sima14.vercel.app`
  (l'alias/canonical sta in `SITE_URL` / `NEXT_PUBLIC_SITE_URL`).
- PR #11: `https://github.com/uamisjd/dropalert-next/pull/11`.
- Workflow: `Osservazione DropAlert` (.github/workflows/collect.yml),
  `Verifica`, `Verifica dati reali (manuale)`.
- Doc di metodo: `docs/STUDIO-VALUE-BETS.md`, `docs/STUDIO-PARTITE-FINITE.md`,
  `docs/SCHEDULING.md`, `src/app/metodologia/page.tsx` (fonte di verità
  pubblica di cosa il sito dichiara di misurare).
