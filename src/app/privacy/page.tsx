/**
 * Informativa privacy (Sprint lancio, punto B).
 *
 * Pagina statica, in italiano. Dice ciò che il sito fa davvero: nessun
 * account, nessuna profilazione, nessun cookie di terze parti. L'unica
 * memoria locale è il localStorage; la sincronizzazione push è facoltativa
 * e descritta separatamente.
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — DropAlert",
  description:
    "Informativa privacy di DropAlert: titolare, dati trattati, cookie e localStorage, diritti dell'interessato e contatti.",
  alternates: { canonical: "/privacy" },
};

/* pagina di solo testo: si può servire dalla cache di bordo a lungo */
export const revalidate = 86400;

const UPDATED = "12 settembre 2026";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <h2 className="mb-1.5 text-sm font-semibold text-slate-900">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main id="main-content" className="mx-auto w-full max-w-4xl flex-1 px-4 py-5">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">
        Informativa privacy
      </h1>
      <p className="mt-1 text-xs text-slate-500">
        Ultimo aggiornamento: {UPDATED}. Redatta ai sensi degli articoli 13 e 14
        del Regolamento (UE) 2016/679 (GDPR).
      </p>

      <Section title="Titolare del trattamento">
        <p>
          Il titolare del trattamento è il gestore del progetto DropAlert,
          contattabile all&apos;indirizzo indicato nella sezione «Contatti».
          DropAlert è un progetto indipendente a carattere statistico e non
          commerciale: non raccoglie scommesse, non vende dati e non è affiliato
          ad alcun operatore di gioco.
        </p>
      </Section>

      <Section title="Quali dati trattiamo">
        <p>
          <strong>Nessun dato anagrafico richiesto.</strong> Il sito non ha
          registrazione, non ha area riservata, non chiede nome, email o numero
          di telefono, e non ospita moduli di contatto.
        </p>
        <p>
          I dati mostrati nelle pagine (quote, movimenti, notizie pubbliche,
          contesto) riguardano eventi sportivi e fonti pubbliche: non sono dati
          personali degli utenti.
        </p>
        <p>
          Il fornitore di hosting registra, per finalità tecniche e di
          sicurezza, i consueti log di server (indirizzo IP, data e ora della
          richiesta, pagina richiesta, tipo di browser). Questi log sono trattati
          dal fornitore per garantire il funzionamento del servizio e prevenire
          abusi, sulla base del legittimo interesse (art. 6.1.f GDPR), e non
          vengono da noi usati per profilare o identificare le persone.
        </p>
      </Section>

      <Section title="Cookie e memoria del browser">
        <p>
          <strong>Il sito non usa cookie di profilazione</strong>, non usa
          cookie di terze parti e non integra pixel pubblicitari o strumenti di
          analytics che traccino gli utenti.
        </p>
        <p>
          Usiamo esclusivamente il <strong>localStorage</strong> del tuo
          browser per ricordare:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            che hai chiuso il banner «Guida in 60 secondi», così non ricompare a
            ogni visita;
          </li>
          <li>
            le eventuali preferenze di visualizzazione che imposti nella
            pagina, le partite preferite e le relative soglie di notifica.
          </li>
          <li>Il registro delle giocate e il bankroll inseriti negli strumenti personali.</li>
          <li>La chiave di gestione dell’iscrizione push verificata, associata al suo endpoint.</li>
        </ul>
        <p>
          Il registro delle giocate resta sul dispositivo. Se attivi le notifiche
          push, le partite seguite e le soglie vengono invece inviate al server
          per stabilire quando avvisarti.
        </p>
        <p>
          Puoi cancellare questi valori in qualunque momento svuotando i dati
          del sito dalle impostazioni del browser: perderai anche preferite,
          preferenze e registro locale delle giocate. Esporta prima i dati che
          vuoi conservare. Cancellare i dati locali non cancella automaticamente
          l’iscrizione push sul server: disattiva prima le notifiche dalle preferite.
        </p>
      </Section>

      <Section title="Notifiche push facoltative">
        <p>
          Solo se le attivi, conserviamo sul server l’endpoint del servizio push,
          le chiavi di cifratura, la lista delle partite seguite e le soglie
          scelte. Sono identificativi tecnici pseudonimi, non dati anonimi:
          non richiedono un account ma consentono di recapitare avvisi al tuo browser.
        </p>
        <p>
          L’invio passa dal servizio push del browser (per esempio Google,
          Mozilla, Apple o Microsoft), soggetto alla relativa informativa.
          Puoi disattivare le notifiche dalla pagina Preferite; il sito richiede
          allora la cancellazione dell’iscrizione dal registro del server usando
          la chiave locale di gestione. Se la chiave manca, la disiscrizione locale
          non conferma la cancellazione sul server: occorre verificare nuovamente
          l’iscrizione per gestirla.
        </p>
        <p>
          Per limitare abusi sulle registrazioni e sulle notifiche di prova,
          il server conserva contatori temporanei: tipo di operazione, conteggio,
          scadenza e impronta SHA-256 dell’endpoint. L’impronta è un identificativo
          pseudonimo, non un dato anonimo. Questi contatori non conservano
          indirizzi IP, chiavi push o la lista delle partite.
        </p>
      </Section>

      <Section title="Verifica e gestione delle notifiche">
        <p>
          L’attivazione richiede di aprire una notifica di verifica entro cinque
          minuti. Il server conserva temporaneamente la richiesta e l’impronta
          del codice monouso; dopo la conferma conserva l’impronta della chiave
          di gestione. La chiave completa resta nel browser e autorizza
          aggiornamenti, prove e cancellazione. Non condividere chiavi o link di
          verifica. Le vecchie iscrizioni richiedono una nuova verifica prima
          di ricevere avvisi automatici.
        </p>
        <p>
          Per evitare duplicati, il server registra un tentativo per endpoint,
          partita e giornata italiana, con stato ed eventuale esito tecnico.
          Il limite riguarda i tentativi, non garantisce la consegna: un errore
          non provoca un nuovo invio automatico nello stesso giorno.
        </p>
      </Section>

      <Section title="Fonti esterne e link">
        <p>
          Le pagine possono contenere collegamenti a fonti pubbliche esterne
          (testate giornalistiche, enciclopedie, siti di statistiche). Aprendo
          quei collegamenti entri in siti di terzi, con proprie informative
          privacy sulle quali non abbiamo controllo.
        </p>
        <p>
          Per generare il contesto informativo delle partite ci appoggiamo a
          servizi esterni di ricerca e di elaborazione linguistica: a questi
          servizi trasmettiamo soltanto dati relativi alle partite (nomi delle
          squadre, competizione, orario, andamento delle quote), mai dati
          riferibili a chi visita il sito.
        </p>
      </Section>

      <Section title="Conservazione">
        <p>
          Le iscrizioni non aggiornate da 90 giorni non vengono più usate e
          diventano eliminabili; una sincronizzazione verificata rinnova il termine.
          Sono rimosse anche su richiesta autorizzata o quando il servizio push
          le segnala come scadute. Le richieste di verifica diventano eliminabili
          dopo 10 minuti (il codice scade dopo cinque), i marcatori di invio dopo
          sette giorni. La pulizia avviene a lotti limitati durante l’attività push,
          non a una scadenza garantita. I contatori antiabuso sono eliminabili dopo
          oltre 24 ore di inattività durante successive richieste ammesse.
          Senza attività la pulizia attende. I dati sportivi e le
          elaborazioni restano in archivio finché servono all&apos;osservatorio
          statistico. I log tecnici sono conservati dal fornitore di hosting per
          il tempo strettamente necessario alla sicurezza del servizio.
        </p>
      </Section>

      <Section title="I tuoi diritti">
        <p>
          Nei limiti in cui un trattamento ti riguardi, puoi esercitare i
          diritti previsti dagli articoli 15-22 del GDPR: accesso, rettifica,
          cancellazione, limitazione, opposizione e portabilità. Hai inoltre
          diritto di proporre reclamo al Garante per la protezione dei dati
          personali (
          <a
            href="https://www.garanteprivacy.it"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            garanteprivacy.it
          </a>
          ).
        </p>
        <p>
          Poiché non raccogliamo nomi o account, in alcuni casi
          non siamo in grado di collegare una richiesta a dati esistenti: in
          quel caso te lo diremo, invece di chiederti altri dati per cercarli.
        </p>
      </Section>

      <Section title="Minori">
        <p>
          Il sito tratta contenuti relativi ai mercati delle scommesse
          sportive ed è riservato ai maggiorenni. Non è rivolto a minori di 18
          anni.
        </p>
      </Section>

      <Section title="Contatti">
        <p>
          Non esiste una casella di posta dedicata: dichiararne una che nessuno
          legge sarebbe peggio che non averla. Per qualunque richiesta relativa
          a questa informativa il contatto è il repository pubblico del
          progetto, aprendo una segnalazione su{" "}
          <a
            href="https://github.com/uamisjd/dropalert-next/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            github.com/uamisjd/dropalert-next
          </a>
          . Non pubblicare endpoint push, chiavi, indirizzi IP o altri dati
          personali nelle segnalazioni pubbliche.
        </p>
      </Section>

      <Section title="Modifiche">
        <p>
          Se cambieranno le finalità o gli strumenti descritti qui sopra,
          aggiorneremo questa pagina e la data in testa. Nessuna modifica verrà
          applicata in silenzio.
        </p>
      </Section>

      <p className="mt-6 text-xs">
        <Link
          href="/"
          className="text-slate-600 underline underline-offset-2 hover:text-slate-900"
        >
          ← Torna ai movimenti
        </Link>
      </p>
    </main>
  );
}
