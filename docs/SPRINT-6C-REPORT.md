# Sprint 6C — La copertura diventa visibile

**Data:** 18/08/2026, 24:00 (Europe/Rome)
**Perimetro:** portare in interfaccia la misura di copertura prodotta in 6B.
Nessun allarme, nessuno scheduler, nessuna correzione dei `NOT_REACHED`.

---

## 1. Cosa è stato fatto

La misura di copertura esisteva dal 6B, ma viveva solo nel database e in una
rotta JSON. Ora ha due presenze visibili:

- una **pagina dedicata** `/coverage`, che spiega il giro nel dettaglio;
- un **riquadro compatto** nella dashboard `/`, subito sotto lo stato del
  sistema, con tre numeri e un link.

La pagina non aggiunge nessun calcolo: stampa quello che il giro ha misurato.
Tutto ciò che il giro non ha misurato viene dichiarato come non misurato.

---

## 2. File creati

| File | Contenuto |
|---|---|
| `src/lib/cov/view.ts` | Helper puri di presentazione: `buildCoverageView`, `coverageLabel`, `REASON_KIND`, `REASON_SHORT`, `KIND_LABELS`, `SERIES_INSUFFICIENT_TEXT`; tipi `CoverageView`, `ReasonRow`, `ReasonKind`. Nessun accesso a DB o rete. |
| `src/components/CoveragePanel.tsx` | Pannello esteso (server component): banner NON MISURATO, quattro numeri del giro, tabella dei motivi con la loro natura, dettaglio per competizione, note del giro, sezione "Come si legge". |
| `src/components/CoverageSummary.tsx` | Riquadro compatto per la dashboard: righe di calcio / importate / perse, profondità della serie, link a `/coverage`. |
| `src/components/CollectNowButton.tsx` | Pulsante client (`useTransition`), disabilitato durante l'esecuzione, stampa l'esito dichiarato del giro. |
| `src/app/cov/page.tsx` | Pagina server, `force-dynamic`, try/catch attorno a `getCoverageHistory(50)`. |
| `src/app/cov/actions.ts` | Server action `collectNow()`: **un solo** giro di raccolta, poi `revalidatePath` di `/cov` e `/`. |
| `src/lib/cov/__tests__/view.test.ts` | 27 casi, runner autonomo, nessun DB e nessuna rete. |

## 3. File modificati

| File | Modifica |
|---|---|
| `next.config.ts` | Aggiunto il rewrite `/coverage → /cov` accanto a `/api/coverage → /api/cov`. La directory sorgente si chiama `cov` perché la piattaforma cancella dagli snapshot ogni directory chiamata `coverage`; l'URL pubblico resta quello leggibile. |
| `src/app/page.tsx` | Costruisce `coverage: CoverageView | null` in try/catch e rende `<CoverageSummary>` dopo `<StatusPanel>`. Se la lettura fallisce il riquadro **sparisce**: non viene mostrato nessun numero di ripiego. |
| `package.json` | Nuovo script `test:cov-view`, inserito in `test:all`. |

## 4. Funzioni create

`buildCoverageView(input)` — da `CoverageHistory` a struttura stampabile.
`coverageLabel(coverage)` — `null` → `"non misurato"`, altrimenti percentuale a un decimale.
`collectNow()` — server action, un giro, esito dichiarato.
`CoveragePanel`, `CoverageSummary`, `CollectNowButton` — componenti.

**API o tabelle nuove:** nessuna. Lo sprint è di sola lettura sul modello dati;
l'unica scrittura possibile è il giro di raccolta lanciato dal pulsante, che usa
il collector già esistente.

---

## 5. Le quattro regole di lettura, e dove si vedono

1. **`coverage: null` è "non misurato", non zero.** Se il giro non ha misura, il
   pannello mostra un banner al posto dei numeri, e `coverageLabel` restituisce
   la parola, non uno `0.0%`.
2. **Il denominatore sono le righe di calcio, e le perse si contano in
   assoluto.** La percentuale c'è, ma accanto sta sempre scritto su quante righe
   è calcolata, con la nota che su un campione simile una partita vale quasi
   dieci punti.
3. **I motivi hanno nature diverse e non si sommano.** Tabella a tre colonne:
   `sport` e `demo` fuori perimetro, `robots` limite della fonte, `no_odds` e
   `not_reached` perdite del monitor. Solo questi ultimi due entrano in
   `lossesDeclared`.
4. **Sotto dieci giri non si legge tendenza.** Ogni vista mostra `N/10 giri` e
   la riga fissa *"Serie insufficiente, niente tendenza."* I giri anteriori alla
   strumentazione sono contati a parte come non misurati.

---

## 6. I tre nodi aperti, chiusi

**Nodo 1 — l'URL.** Risolto con il rewrite: la pagina sta in `src/app/cov/`,
l'utente digita `/coverage`. Verificato: `/coverage` e `/cov` rispondono
entrambi 200.

**Nodo 2 — la natura di `altro`.** Era marcato "fuori perimetro", ma era una
deduzione senza prova: `altro` è esattamente il motivo che il collector **non**
ha saputo attribuire. Chiamarlo fuori perimetro lo assolve, chiamarlo perdita lo
condanna, e nessuna delle due cose è stata constatata. Ora ha una natura sua,
`non_classificato`, con etichetta *"Motivo non attribuito"*; non entra nelle
perdite e non entra nel fuori perimetro. Finché è a zero non cambia nulla; se
sale, il pannello aggiunge una riga che dice quante righe sono e che il giro non
ha saputo dire dove sono finite.

**Nodo 3 — il gate dei 15 minuti.** Verificato leggendo il codice: il gate vive
in `runCycle` (`shouldRunNow`), **non** in `collectBetexplorer`. Il pulsante
chiama il collector direttamente, quindi fa sempre un giro vero. Confermato
sperimentalmente: giro eseguito a 23:59, a 29 minuti dal precedente, `status:
success`, 30 quote scritte. Nessun messaggio sul gate: non serviva.

---

## 7. Test

| Suite | Esito |
|---|---|
| engine | 53 / 53 |
| view | 68 / 68 |
| pipeline | 40 / 40 |
| providers | 49 / 49 |
| betexplorer | 39 / 39 |
| copertura (6A/6B) | 76 / 76 |
| **copertura — vista (nuova)** | **27 / 27** |
| **totale `test:all`** | **352 / 352** |

I 27 casi nuovi coprono: non-misurato contro zero; `coverageLabel` sui tre casi
limite; i numeri dell'ultimo giro riportati senza rielaborazioni; una riga per
ogni motivo previsto; la natura di ciascun motivo, `altro` compreso; il calcolo
di `lossesDeclared` (1 `no_odds` + 2 `not_reached` = 3, con robots e sport
presenti e ignorati); la serie a 0, 1 e 10 giri; i giri senza misura; le
competizioni; le note; un elenco senza calcio.

**Catena di validazione:** `next typegen` → `tsc --noEmit` pulito →
`eslint src --max-warnings=0` pulito → `npm run build` con `/cov` fra le rotte →
server avviato → `curl` su `/coverage`, `/cov`, `/` e `/api/coverage`, tutti 200.

Durante la sessione tre test sono falliti: erano sbagliati i test, non il
codice. L'etichetta reale è `"1/10 giri"` e non `"1/10"`; ho corretto le attese,
perché la dicitura estesa è quella giusta da leggere nel pannello.

---

## 8. Misura corrente

Il pulsante ha prodotto un secondo giro strumentato, quindi la serie ora ha due
punti reali:

| | run 114 (23:30) | run 148 (23:59) |
|---|---|---|
| righe viste | 24 | 24 |
| di calcio | 11 | 10 |
| importate | 11 | 10 |
| perse | 0 | 0 |
| copertura | 100.0% | 100.0% |
| altri sport | 13 | 14 |
| per-book non pubblicato | 11 | 10 |

Serie: 2 punti su 10 richiesti, 30 minuti di osservazione, **dichiarata
insufficiente**. 4 giri più vecchi restano senza misura. Le 2 perdite
`NOT_REACHED` del 6A non ricompaiono in questi giri, ma restano non corrette e
non spiegate: due giri puliti non sono una smentita.

---

## 9. Cosa manca

- La serie è lunga 2 giri su 10. Finché non arriva a dieci, il pannello non può
  dire niente sull'andamento, e infatti non lo dice.
- Le 2 perdite `NOT_REACHED` del 6A restano etichettate e non indagate.
- I 24 gap `SOURCE_MISSING` restano dichiarati: il per-book è vietato dal robots
  della fonte e non è un lavoro che si possa fare.
- `sharpConfirms` resta `null` con il suo gap aperto: c'è un solo bookmaker
  sintetico, la coordinazione non è misurabile e non entra nel punteggio.
- Il CLV non ha ancora osservazioni sufficienti.
- Nessuno scheduler: i giri partono a mano, dal pulsante o dalla CLI.

---

## 10. Prossimo sprint — una cosa sola

**Portare la serie a dieci giri strumentati, senza scrivere codice nuovo.**

È l'unica proposta che nasce dai numeri: ogni cosa che il pannello oggi si
rifiuta di dire — se la copertura è stabile, se il 100% regge, se i
`NOT_REACHED` ricompaiono e con quale frequenza — è bloccata dalla stessa
condizione, la profondità della serie sotto la soglia. Con dieci giri distanziati
la serie diventa leggibile e la scelta successiva (indagare i `NOT_REACHED`,
oppure automatizzare la raccolta) si appoggia a una misura invece che a una
preferenza.

Non richiede nuovo codice: la strumentazione c'è, il pulsante c'è, la CLI c'è.
Richiede solo giri distanziati nel tempo e una lettura finale della serie.
