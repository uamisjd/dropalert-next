# Contribuire a DropAlert — regole per non rompere

> Scritto dopo la lezione del 06/09/2026: un merge su `main` con lint sporco ha
> lasciato la pipeline «Verifica» rossa per giorni, senza che nessun gate lo
> fermasse. Queste regole esistono perché non riaccada. Sono corte e precise:
> leggile prima di ogni push.

> **Per The Odds API** (fonte a pagamento, provider spento): le regole specifiche
> — chi fa cosa fra agente e umano, costi per azione, attivazione controllata —
> stanno in `docs/REGOLE-OPERATIVE-ODDS.md`. Leggere anch'esse prima di toccare
> quote, budget o attivazione.

## 1. Branch e merge

- Lavora **solo sul ramo di sessione** (es. `arena/…`), mai direttamente su
  `main`. `main` si aggiorna solo mergiando una pull request con la pipeline
  «Verifica» **VERDE**.
- PR: `gh pr create --base main --head <ramo-sessione>`.
- Dopo il merge: controlla che il run «Verifica» su `main` sia verde prima di
  dichiarare chiuso il lavoro. Il rosso su main è un problema, non un dettaglio.

## 2. Gate locale obbligatorio prima di pushare o aprire PR

1. `npm run typecheck` → zero errori.
2. `npx eslint .` → zero errori (exit code 0).
3. Suite senza DB, almeno: `npm run test` (motore), `npm run test:quant`,
   `npm run test:tools`, `npm run test:client`.
4. Se tocchi DB / pipeline / view: la CI «Verifica» copre tutto (test:all +
   build) con PostgreSQL di servizio: **guarda quel run prima del merge**, non
   fidarti solo del locale.
5. Un edit per file, poi `grep` di riverifica: edit multipli sullo stesso file
   possono perdersi.

## 3. Cose che il lint NON perdona (imparate a nostre spese)

- **`setState` sincrono nel corpo di `useEffect`**
  (`react-hooks/set-state-in-effect`). Per idratare da `localStorage` usa una
  funzione interna richiamata subito dall'effect, come fa `/preferite`
  (`const sync = () => {…}; sync();`).
- **`Date.now()` / `Math.random()` nel render** di un componente
  (`react-hooks/purity`). Calcola l'età sul server alla generazione e passala
  come prop: schema `lineAgeMinutes` già usato da `SmartBetsTable`,
  `ValueScannerTable` e (da ora) `ArbitrageTable`.
- **Apostrofi nel testo JSX**: sempre `&apos;` (`react/no-unescaped-entities`).
- **`any` espliciti** (`@typescript-eslint/no-explicit-any`). Risposta esterna
  sconosciuta → `unknown` + narrowing (`asJsonObject`, `toFiniteNumber`, …),
  come in `src/lib/providers/sharp-api/index.ts`.
- **Codice morto o helper inutilizzati**: rimuovili, non lasciarli.

## 4. Nuove pagine o nuove voci in SiteNav: checklist di coerenza

Tutto nello stesso commit, mai solo la voce di menu:

1. `src/components/SiteNav.tsx` — voce con etichetta = H1 della pagina.
2. `src/lib/site.ts` → `PUBLIC_PAGES`: aggiungi se la pagina ha contenuto
   server reale.
3. `src/app/sitemap.ts` → priorità nell'oggetto `PRIORITY`.
4. Pagina con contenuto **solo localStorage** (es. `/preferite`,
   `/mio-bankroll`): layout di rotta con `title`, `canonical` e
   `robots: { index: false, follow: true }` — e **NON** in `PUBLIC_PAGES`
   (contenuto sottile per i crawler).
5. Aggiorna i commenti delle pagine che dichiarano lo stato di navigazione
   («non è nella navigazione pubblica», «nascosta», …).

## 5. Mai toccare `.github/workflows/*` via push

Il token di lavoro NON ha scope `workflow`: un push che modifica i workflow
viene rifiutato da GitHub. Per cambiare cron, `timeout-minutes` o variabili:

- modifica da interfaccia GitHub (apri il file → matita → commit su un ramo) o
- chiedi al proprietario del repository di committare.

Non lasciare modifiche ai workflow nel working tree: restano lì e il push
fallisce.

## 6. Run «Osservazione DropAlert» cancelled a ~10 min

Sono giri che superano `timeout-minutes: 10` del job (GitHub li cancella a
~10m20s). Non è perdita di dati: la seconda gamba (cron Vercel giornaliero +
scheduler esterno, `docs/SCHEDULING.md`) copre i buchi con lo stesso gate.
Se si ripete spesso:

1. apri il run su https://github.com/uamisjd/dropalert-next/actions;
2. leggi l'ultimo step «Giro di osservazione» e i punti dichiarati (DATI
   PARZIALI, non silenzio);
3. se è davvero un timeout: porta `timeout-minutes` a 20 nel workflow
   (applica il §5: modifica da interfaccia GitHub).

## 7. Stile del repository

- Commenti e messaggi di commit in italiano.
- Stati onesti: mai `NaN`, mai zeri di ripiego, mai un dato inventato al posto
  di uno mancante: i buchi si dichiarano.
- Un fix UI importante porta con sé il suo test in
  `src/components/__tests__/`.
- Verifica finale raccomandata: `npm run validate` (typegen + typecheck + test
  motore + build) dove il DB non serve, e in CI per il resto.
