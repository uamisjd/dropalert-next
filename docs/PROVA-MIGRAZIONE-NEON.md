# Prova della migrazione 0010 sulla copia Neon

Il gestore ha creato il branch Neon `dropalert-migration-test` da `production`
e configurato il secret GitHub `MIGRATION_TEST_DATABASE_URL`. Non è un branch
Git e non è la connessione del sito Vercel.

## Avvio

GitHub Actions → **Verifica dati reali (manuale)** → Run workflow:

- branch codice: `arena/01a095e8-dropalert-next`;
- `which`: **migration-rehearsal**;
- `match_id` e `sport_key`: vuoti; `ore`: lasciare il default, non usato.

Non scegliere smoke-wire, control o rebase-clv. Non sostituire `DATABASE_URL`.
Il job ordinario audit viene escluso: non riceve esecuzione, non parte alcun
collector o script di notifiche. Il job dedicato non riceve chiavi provider.

## Protezioni

1. Solo il nuovo secret fornisce la connessione di test. `DATABASE_URL` viene
   passato come `PRODUCTION_DATABASE_URL` esclusivamente per confronto in
   memoria: non si apre una connessione con quel valore.
2. Connessioni Neon PostgreSQL con TLS e parametri limitati. Stesso endpoint
   anche con utente/database diversi o variante `-pooler` → rifiuto.
   Endpoint diversi **non provano** che siano branch diversi (per esempio
   esistono compute aggiuntivi): la scelta corretta del branch nella console
   Neon resta responsabilità dell'operatore. Non è una verifica tramite API Neon.
3. La prova accetta soltanto il testo revisionato della migrazione 0010;
   non lancia il migratore generale e non applica migrazioni precedenti.
4. Richiede enum e colonna ancora assenti. Legge al massimo 100.000 snapshot;
   usa fingerprint ordinata delle colonne preesistenti e conteggio per
   verificarne l'invarianza, senza stamparne il contenuto.
5. DDL dentro una transazione con **rollback obbligatorio**, anche sul percorso
   di successo; nessun percorso commit. Timeout connessione 15 s, statement
   30 s, lock 2 s. Durante la prova la tabella di test è bloccata alle scritture.
6. Controlla default unknown, NOT NULL e tutte le righe storiche unknown.
   Dopo rollback verifica assenza di colonna/enum. Registro Drizzle non toccato.
7. Riepilogo pubblica solo esito, conteggio e verifiche. Errori del driver,
   URL, nomi database, credenziali e righe non vengono pubblicati.
8. Dipendenze installate senza lifecycle script e senza secret; connessioni
   fornite soltanto al passo di prova. Nessuna app o suite con fixture del
   progetto viene avviata sulla copia dei dati reali.

## Esito

Nella pagina Summary cercare **Prova migrazione 0010 — ROLLBACK confermato**.
Il branch di test rimane nello schema precedente e la prova è ripetibile.
Questo risultato non applica la migrazione né autorizza produzione: serve poi
un rilascio separato con punto di ripristino verificato, autorizzazione e ordine
migrazione-prima-del-codice. La copia di prova non sostituisce il backup.

In caso di NON COMPLETATA, non ritentare sulla connessione di produzione:
verificare secret/endpoint e stato iniziale del branch. Se il branch è scaduto
(auto-delete), ricrearlo e aggiornare soltanto il secret di prova.

## Test automatizzati

Controlli URL/SQL, verifica isolamento dei job e test PostgreSQL locale con
DDL reale e rollback, contenuto invariato, ripetibilità e schema incompatibile.
La CI usa un database locale usa-e-getta, non il secret Neon. Non confondere
un test CI superato con una prova già eseguita sul branch Neon del gestore.
