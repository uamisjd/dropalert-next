/**
 * Garanzia di carico verso la fonte (Sprint OPS-2).
 *
 * Qui si verifica UNA promessa: comunque si combinino i trigger — cron di
 * GitHub, cron di Vercel, pulsante manuale — la fonte delle quote non riceve
 * traffico aggiuntivo. L'unica autorità sulla spaziatura è `shouldRunNow`,
 * e lo skip anticipato del workflow è deliberatamente più prudente.
 *
 * Funzioni pure: nessuna rete, nessun database.
 * Eseguire con: npm run test:gate
 */
import { latestRunMoment, shouldRunNow } from "../scheduler";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}
function eq(name: string, a: unknown, b: unknown) {
  check(`${name} — atteso ${String(b)}, ottenuto ${String(a)}`, Object.is(a, b));
}

/** Soglia dello skip pre-install nel workflow (scripts/gate-check.sh). */
const GATE_SKIP_MINUTES = 40;
/** Intervallo reale applicato dal codice. */
const INTERVAL = 45;

const now = new Date("2026-08-27T15:00:00Z");
const minutiFa = (m: number) => new Date(now.getTime() - m * 60_000);

/* --- il gate del codice --- */
eq("giro fresco: si salta", shouldRunNow(minutiFa(10), now, INTERVAL, false).run, false);
eq("giro a 44 minuti: ancora troppo presto", shouldRunNow(minutiFa(44), now, INTERVAL, false).run, false);
eq("giro a 45 minuti: si esegue", shouldRunNow(minutiFa(45), now, INTERVAL, false).run, true);
eq("primo giro assoluto: si esegue", shouldRunNow(null, now, INTERVAL, false).run, true);
check(
  "lo skip dice perché, non tace",
  shouldRunNow(minutiFa(10), now, INTERVAL, false).reason.includes("saltata"),
);

/* --- la garanzia: lo skip anticipato non può mai «rubare» un giro --- */
check(
  "la soglia del workflow è più prudente dell'intervallo del codice",
  GATE_SKIP_MINUTES < INTERVAL,
);
for (let eta = 0; eta <= 120; eta++) {
  const skipAnticipato = eta < GATE_SKIP_MINUTES;
  const eseguirebbe = shouldRunNow(minutiFa(eta), now, INTERVAL, false).run;
  if (skipAnticipato && eseguirebbe) {
    failures.push(
      `a ${eta} minuti il workflow salterebbe un giro che il codice avrebbe eseguito`,
    );
    break;
  }
}
passed += 1;

/* --- trigger multipli, nessun traffico extra --- */
/* tre trigger ravvicinati (Actions + Vercel + manuale) sullo stesso ultimo
   giro: solo il primo può raccogliere, gli altri escono senza toccare la
   fonte, perché la spaziatura si misura sull'ULTIMO giro riuscito */
const ultimo = minutiFa(5);
const trigger = [0, 1, 2].map((m) =>
  shouldRunNow(ultimo, new Date(now.getTime() + m * 60_000), INTERVAL, false),
);
check("nessuno dei tre trigger ravvicinati raccoglie", trigger.every((t) => !t.run));

/* il forzato resta l'unica eccezione, ed è manuale e dichiarata */
eq("solo il forzato ignora l'intervallo", shouldRunNow(minutiFa(1), now, INTERVAL, true).run, true);
check(
  "il forzato lo dichiara nel motivo",
  shouldRunNow(minutiFa(1), now, INTERVAL, true).reason.includes("forzata"),
);

/* --- il tentativo conta: un giro interrotto non libera il successivo --- */
/* Scenario misurato il 05/09/2026: l'ultimo giro CHIUSO era di 46 minuti fa,
   un giro TENTATO 15 minuti fa era stato interrotto a metà dal budget del
   chiamante e non aveva scritto l'esito. Col solo registro delle chiusure il
   gate lasciava passare ogni battuta: quattro raccolte all'ora contro una
   ogni 45 minuti, cioè ~11 richieste in più alla fonte ogni quarto d'ora. */
eq(
  "nessun registro: niente da rispettare",
  latestRunMoment(null, null),
  null,
);
eq(
  "solo chiusura: si rispetta la chiusura",
  latestRunMoment(minutiFa(50), null)!.getTime(),
  minutiFa(50).getTime(),
);
eq(
  "solo tentativo (giro mai chiuso): si rispetta il tentativo",
  latestRunMoment(null, minutiFa(15))!.getTime(),
  minutiFa(15).getTime(),
);
eq(
  "tentativo più recente della chiusura: vince il tentativo",
  latestRunMoment(minutiFa(46), minutiFa(15))!.getTime(),
  minutiFa(15).getTime(),
);
eq(
  "chiusura più recente del tentativo: vince la chiusura",
  latestRunMoment(minutiFa(10), minutiFa(40))!.getTime(),
  minutiFa(10).getTime(),
);
eq(
  "giro chiuso e poi tentato alla stessa ora: nessuna attesa extra",
  latestRunMoment(minutiFa(45), minutiFa(45))!.getTime(),
  minutiFa(45).getTime(),
);
/* qui sta il senso della modifica: con il tentativo a 15 minuti il gate deve
   negare la raccolta, mentre con la sola chiusura l'avrebbe concessa */
eq(
  "chiusura a 46 min, senza tentativo: si raccoglie (comportamento precedente)",
  shouldRunNow(minutiFa(46), now, INTERVAL, false).run,
  true,
);
eq(
  "chiusura a 46 min + tentativo a 15 min: non si raccoglie",
  shouldRunNow(latestRunMoment(minutiFa(46), minutiFa(15)), now, INTERVAL, false).run,
  false,
);
check(
  "il diniego dice il perché senza inventare un esito",
  shouldRunNow(latestRunMoment(minutiFa(46), minutiFa(15)), now, INTERVAL, false).reason.includes(
    "saltata",
  ),
);
passed += 1;

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (gate di carico verso la fonte)`);
