# Applicazione mirata della migrazione 0010 alla produzione

## Prerequisiti verificati e ambito autorizzato

- Prova su copia Neon: run `34721053463`, rollback confermato, 15.255 snapshot
  controllati senza modificare lo storico.
- Snapshot production mostrato dal gestore: **2026-09-12T21:57:06Z**, 44,52 MB,
  scadenza «never». Creazione verificata dalla schermata, ripristino non provato.
- Il gestore ha autorizzato a predisporre la sola migrazione production.
- Non include merge/deploy, flag del collector, raccolte, push o ribasature CLV.

## Avvio deliberato da GitHub

Actions → **Verifica dati reali (manuale)** → Run workflow:

| Campo | Valore |
|---|---|
| Branch | `arena/01a095e8-dropalert-next` |
| which | `migration-apply-production` |
| migration_confirmation | `APPLICA-0010-PRODUCTION` |
| migration_snapshot | `2026-09-12T21:57:06Z` |
| match_id / sport_key | vuoti |
| ore | default, non usato |

**Questa modalità scrive in produzione. Non è la prova con rollback.**
La conferma e la data attestano la scelta dell'operatore: il workflow non
interroga le API Neon per verificare esistenza o stato dello snapshot.
La destinazione è il secret esistente `DATABASE_URL`, confrontato con
`MIGRATION_TEST_DATABASE_URL` per escludere lo stesso endpoint. Tale confronto
non dimostra da solo l'identità del branch. Non cambiare i secret per aggirarlo.

## Controlli e scritture

- Job separato: audit, collector e prova di migrazione sono esclusi.
- Conferma prima delle dipendenze/credenziali; installazione senza lifecycle script;
  secret disponibili solo al passo di applicazione, nessuna chiave provider.
- Client singolo, TLS Neon, connessione 15 s, statement 30 s, lock 2 s.
  Breve lock esclusivo sugli snapshot: altre attività possono attendere.
  Il workflow non avvia raccolte, ma non spegne gli scheduler già esistenti.
- Solo SQL revisionato della 0010; nessun migratore generale o riparazione dello
  storico. Registro Drizzle deve coincidere per hash e timestamp con 0000–0009.
- Lock transazionale consultivo e sul journal; registro e DDL aggiornati
  atomicamente. Se journal/schema non corrispondono, arresto senza riparazioni.
- Fingerprint delle colonne preesistenti, numero di righe, default e NOT NULL
  verificati prima del commit. Le righe presenti ricevono unknown, non provider.
  Limite della procedura: 100.000 snapshot, oltre si richiede revisione.
- Dopo commit, schema e presenza univoca del record nel journal verificati.
- Riesecuzione: se 0010 è registrata e schema corretto, GIÀ APPLICATA senza nuove
  scritture. Le nuove righe eventualmente presenti non vengono cambiate in unknown.

## Lettura dell'esito

Summary e annotazioni mostreranno **COMMIT confermato** oppure **GIÀ APPLICATA**.
Non pubblicano connessioni, credenziali, contenuto righe o eccezioni del driver.

Con **ESITO NON CONFERMATO** non fare deploy e non avviare un Restore:
una disconnessione può avvenire dopo il commit. Verificare prima il journal;
la riesecuzione della stessa procedura riconosce una migrazione già completata.
Errori prima del commit annullano DDL e journal insieme.

Il codice precedente resta compatibile con la colonna additiva e il default.
In caso di problemi applicativi preferire rollback del codice, senza cancellare
la colonna. Il ripristino dello snapshot è una procedura separata e può perdere
scritture successive allo snapshot: mai eseguirlo automaticamente.

## Verifiche automatiche

Test locale su database ricreato applicando realmente 0000–0009: controllo hash,
errore forzato al journal dopo DDL con rollback completo, commit corretto, dati
preesistenti invariati/unknown, riesecuzione, compatibilità col migratore Drizzle
ordinario e rilevamento schema incoerente. La CI usa soltanto DB locale.
Il successo dei test non equivale all'applicazione della migrazione production.
