# Passaggio da osservazione a candidata — verifica 12/09/2026

## Esito

**Non pronto per abilitare raccomandazioni BET.** Non abbassare i gate e non interpretare un drop o un divario positivo come autorizzazione a giocare.

### Riscontro pubblico

La risposta di `/api/health` letta durante questa verifica, con `generatedAt=2026-09-12T14:59:11.614Z`, dichiara:

- The Odds API abilitata, capacità `perBookmakerOdds=true`.
- Wire disattivato: richiede insieme `ODDS_WIRE_COLLECT=true` e `DROP_EXCLUDE_CONSENSUS_BOOKS=true`.
- Stato `partial_data`, 982 gap `bookmaker_missing`.

È una fotografia con il timestamp dichiarato dal servizio, non una prova delle credenziali attuali o di copertura continua. Le istruzioni storiche che descrivono l'adapter come costantemente `false` sono superate: nel codice attuale `ADAPTER_IMPLEMENTED` dipende da `ODDS_ADAPTER_IMPLEMENTED`.

### Blocco applicativo distinto dal provider

`src/lib/repo/value-bets.ts` passa al contratto decisionale:

- `currentPrice` proveniente dalla dashboard di consenso;
- `priceSource: "consensus"`;
- `fairSource: "same_line"`;
- validazione storica non disponibile (`sampleSize: 0`, esiti false).

Questo è intenzionalmente osservativo. Accendere il wire o fare il merge della PR #32 **non** trasforma questo scanner in un selettore di candidate. Non sostituire quelle costanti senza costruire e verificare l'evidenza corrispondente.

## Controllo tentato e blocco di accesso

- Lettura dei nomi dei secret GitHub: HTTP 403 `Resource not accessible by integration`.
- Avvio del workflow esistente in modalità `smoke-wire` senza `match_id`: stesso HTTP 403.
- Nessun workflow avviato, credito consumato o dato di produzione scritto da questi tentativi. Nessun flag modificato.

L'integrazione consente push/PR e lettura CI, ma non queste operazioni. Servono permessi adeguati della connessione GitHub in Arena oppure l'avvio manuale da parte del gestore. Non inserire credenziali in chat o nelle issue.

## Prossimo controllo operativo (sola lettura)

Da Actions → **Verifica dati reali (manuale)**:

- branch: `arena/01a095e8-dropalert-next`;
- `which`: `smoke-wire`;
- `match_id`: vuoto;
- lasciare gli altri input ai valori predefiniti.

Equivalente per un operatore autorizzato:

```sh
gh workflow run audit.yml --ref arena/01a095e8-dropalert-next -f which=smoke-wire
```

Senza `match_id` lo script elenca i candidati dal database senza chiamate a pagamento o persistenza. Il workflow richiede comunque una chiave provider configurata e accesso DB: un fallimento non va reinterpretato come lista vuota.

## Gate successivi, nell'ordine

1. Esaminare candidati, lega coperta e freschezza. Nessun candidato idoneo → fermarsi, non forzare una partita.
2. Con autorizzazione a costo e scrittura, eseguire una lettura limitata su un ID verificato: `smoke-wire` con `match_id`. La procedura prevede una lettura quote da un credito e snapshot con sorgente smoke distinta; verificare budget/piano reali prima dell'avvio.
3. Verificare quote complete, mapping evento, timestamp provider, operatore effettivamente accessibile all'utente e copertura sharp. Una quota aggregata o smoke non va promossa automaticamente a offerta eseguibile.
4. Progettare e implementare il percorso candidato con prezzo per-operatore e fair indipendente: stessa partita/mercato/linea, selezioni complete, operatore di riferimento distinto da quello valutato, freshness di esecuzione esplicita, costi exchange ove pertinenti, esclusione delle fonti smoke/demo. Testare ogni gate mancante e impedire autopromozioni da dati incompleti.
5. Attivare insieme i due flag wire solo nell'ambiente deliberatamente scelto, dopo verifica di budget, scheduler, separazione preview/produzione e rollback. La sola attivazione non chiude il punto 4.
6. Per VALORE VERIFICATO occorre un protocollo storico fuori campione, CLV coerente e calibrazione verificati. Non inventare campioni e non attivare sizing o stake sulla sola etichetta CANDIDATA.

PR #32 resta aperta; nessun merge o deploy di produzione eseguito in questo passaggio.


## Aggiornamento dopo esecuzione del gestore

Run `34715220091`, branch della PR #32, completato con successo il 12/09/2026.
Dal log fornito dal gestore: **1 segnale attivo, 0 sopra soglia 45, 0 candidati**;
modalità elenco, nessuna lettura quote a pagamento. I flag stampati sono quelli del
processo Actions: da soli non attestano l'ambiente Vercel. L'endpoint pubblico
health, fotografia `generatedAt=2026-09-12T19:54:29.910Z`, conferma separatamente
wire spento e dati parziali. L'ultimo collector ha concluso con successo alle
19:16:04 UTC, senza segnali toccati; non emerge da questo dato un arresto totale
della raccolta, né si può dedurre la freschezza di ogni quota.

### Diagnostica aggiunta

- Mantiene invariati soglia e gate di selezione; aggiunge una query read-only per
  un campione massimo di 12 segnali sotto soglia, prima esclusi dalla query e
  quindi assenti dalla lista degli scarti.
- Distingue segnali da partite candidate e candidati alla lettura da BET.
- Mostra gli orari di successo/tentativo/rate-limit delle fonti registrati nel DB,
  senza chiamare i provider e senza pubblicare messaggi grezzi di errore.
- Scrive un riepilogo strutturato in `GITHUB_STEP_SUMMARY`, con dati di terzi
  escapati e output limitato. Un job verde con zero candidati lo dichiara.
- Contatori e righe possono cambiare fra query concorrenti con il collector;
  il report lo esplicita. Una query fallita non viene convertita in zero.

Verifica locale di questa aggiunta: 26 test wire esistenti, 9 nuovi controlli
puri di diagnosi/escaping, 95 verifiche workflow, TypeScript e lint superati.
Questa nuova diagnostica non è ancora stata rieseguita contro il database reale;
il log del gestore è quello della versione precedente.

Il percorso candidato indipendente del punto 4 rimane da implementare e
validare: questo intervento di osservabilità non lo sostituisce.

## Esito del secondo workflow e nuovo percorso applicativo

Run `34715864943`, log fornito dal gestore: rilevazione 20:02:06 UTC, segnale #822
con indice 26,63, nessun segnale ≥45 e nessun candidato. Fonte BetExplorer con
successo 20:01:32 UTC, zero errori consecutivi: non è prova di arresto totale
né di copertura completa.

Implementato successivamente il percorso separato `audit:candidate`: vedere
[SCANNER-INDIPENDENTE.md](SCANNER-INDIPENDENTE.md). Confronta operatori distinti
ed espone i gate mancanti, ma non rimpiazza ancora lo scanner pubblico né
abilita BET. La provenienza temporale non persistita resta un blocco esplicito,
non una freshness inventata. Non occorre ripetere il workflow smoke per testare
questo codice: sono disponibili fixture pure e test PostgreSQL locali.


### Provenienza temporale — aggiornamento implementativo

Aggiunta la migrazione 0010 e la catena DTO/parser/persistenza/lettura per i nuovi
snapshot. Lo storico rimane unknown e non viene promosso nemmeno da un conflitto
con una nuova lettura dello stesso istante. Il blocco sullo storico resta valido;
per i nuovi dati espliciti il gate può essere superato, ma non quelli di accesso
all’offerta, movimento, freshness o validazione. Dettagli e ordine di rilascio in
SCANNER-INDIPENDENTE.md. Nessuna migrazione applicata al DB reale.
