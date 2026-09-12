# Scanner indipendente 1X2 — implementazione sperimentale

12 settembre 2026. Non è un servizio di raccomandazioni, non invia notifiche e
non sostituisce ancora lo scanner pubblico `/value-bets` (che resta osservativo).

## Percorso eseguibile

```sh
npm run audit:candidate -- <id-partita> <chiave-bookmaker> <home|draw|away>
```

Richiede il DB configurato nell'ambiente dell'operatore. Non inserire URL DB o
segreti in chat. Il comando legge soltanto snapshot già archiviati, senza API
provider, crediti, scritture o modifiche ai flag. La transazione è PostgreSQL
`REPEATABLE READ READ ONLY`: anagrafica, segnale e quote appartengono alla stessa
fotografia. Errori DB/input hanno exit nonzero, non diventano zero candidate.

Output: partita, esito, numero di snapshot, operatore target, riferimento Pinnacle,
quote e timestamp separati, fair proporzionale, divario relativo, stato e motivi.
Il divario è `(quota_target × probabilità_riferimento − 1) × 100`: non una
probabilità di vincita, non punti percentuali di probabilità, non un rendimento
realizzato. La fair sharp è un riferimento, non una probabilità vera calibrata.

## Controlli implementati

- Solo eventi reali programmati e pre-gara, selezione 1X2 con segnale attivo e
  indice almeno 45. Non si convertono BTTS/handicap/linee differenti in 1X2.
- Solo sorgente di produzione `the-odds-api`, mai consenso, smoke o demo.
- Riferimento fisso Pinnacle; target distinto. Exchange esclusi fino alla
  modellazione di commissioni, liquidità e lato back/lay.
- Ogni terna deve avere tre esiti univoci, stesso operatore/mercato/istante e
  prezzi validi. L'ultima lettura incompleta/stale non eredita quella precedente.
- Policy sperimentale v1: età massima 5 minuti per entrambe le linee, massimo
  60 secondi fra target e riferimento, margine sharp fra 0 e 30%, divario minimo
  2%. Sono controlli conservativi dichiarati, NON soglie validate per profitto.
- Movimento ricavato separatamente dalle serie dei due operatori: almeno due
  terne in 30 minuti, distanti almeno 5 minuti, calo target e sharp, senza
  rimbalzi osservati. Non si ricicla il movimento del consenso come conferma
  sharp. Intervalli non osservati restano una limitazione del campionamento.
- Conferma esplicita dell'offerta: stesso evento, esito, operatore, prezzo e
  controllo recente, non antecedente alla lettura target. Nessuna conferma viene
  creata dal CLI; la funzione applicativa accetta evidenza fornita dal chiamante,
  non autentica da sola una ricevuta o un accesso al bookmaker.
- Nessun ingresso per dichiarare validazione storica superata. Anche una fixture
  completa arriva solo a CANDIDATA, con avvisi su campione, CLV, calibrazione e
  contesto non verificati. Nessuno stake, Kelly o ordine automatico.
- Massimo 5.000 righe per evento e coppia di operatori nella finestra: oltre il
  limite fallisce esplicitamente, senza analizzare un campione tagliato.

## Limite dei timestamp scoperto durante l'implementazione

Il parser attuale può ripiegare dall'assenza di `last_update` sull'ora di
osservazione/download. `odds_snapshots.collected_at` non conserva l'origine del
timestamp. Non è quindi possibile attestare retroattivamente la freshness di
esecuzione di quelle righe sulla sola colonna temporale.

Il modulo puro richiede `providerTimestampVerified=true` per ogni riga usata
come evidenza. Il repository, che non dispone di tale attestazione nel DB,
passa **false** e restituisce il blocco esplicito. Una conferma di accesso al
bookmaker non sana l'assenza di provenienza temporale del riferimento sharp.

Per abilitare il percorso su nuovi dati occorre un intervento successivo su
contratto DTO/parser, schema e persistenza: origine del timestamp conservata,
nessun backfill ottimistico dello storico e test/migrazione revisionati.
Non sostituire `false` con `true` per aggirare il limite.

Inoltre la raccolta attuale, con una lettura per partita al giorno, non garantisce
la storia e la freshness richieste da questo protocollo. Prima di cambiarla
servono verifica di piano, budget, licenza e copertura. Non aumentare richieste
come effetto collaterale del rilascio dello scanner.

## Verifiche

- Test puri: fixture che arriva a CANDIDATA; assenza prova/accessibilità;
  stesso operatore; exchange; consenso; kickoff; demo; indice; fonti smoke;
  evento/mercato errati; terna incompleta; stale; timestamp invalido/futuro/non
  attestato; skew; duplicati; storia mancante; rimbalzi; edge negativo; ordine.
- Test PostgreSQL locale: percorso reale di lettura, snapshot immutati,
  conferma insufficiente senza provenienza timestamp, esclusione smoke e input.
- Suite incluse in `test:all`, quindi in validazione e CI. Fixture soltanto su
  host DB locale. Nessun test è una conferma del funzionamento con offerte live.

## Stato di rilascio

Questo è il primo percorso end-to-end di audit indipendente, non l'attivazione
pubblica dei BET. Mancano persistenza della provenienza temporale, alimentazione
adeguata autorizzata, integrazione UI/conferma offerta e collaudo reale. Il vecchio
scanner pubblico non è stato silenziosamente cambiato. Nessuna migrazione o
scrittura di produzione eseguita per questa implementazione.
