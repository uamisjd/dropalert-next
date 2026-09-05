/**
 * Test della dichiarazione della base del CLV.
 * Runner minimale, nessuna dipendenza esterna e nessun database.
 * Eseguire con: npm run test:clv-basis
 *
 * Perché esiste: il CLV pubblicato dal sito somma osservazioni misurate su due
 * basi diverse (chiusura fair no-vig e chiusura grezza) e la colonna che lo
 * registra non arrivava in nessuna pagina. Questi test bloccano la regola:
 * la base si conta, si dichiara, e un riepilogo misto lo dice.
 */
import {
  CLV_BASIS_KEYS,
  CLV_BASIS_LABELS,
  clvBasisMix,
  clvBasisOf,
  describeClvBasisMix,
} from "../clv-basis";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean) {
  if (cond) passed++;
  else failures.push(name);
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(
    `${name} — atteso ${String(expected)}, ottenuto ${String(actual)}`,
    Object.is(actual, expected),
  );
}

/* --- normalizzazione del valore letto --- */
eq("fair_novig riconosciuto", clvBasisOf("fair_novig"), "fair_novig");
eq("raw_consensus riconosciuto", clvBasisOf("raw_consensus"), "raw_consensus");
eq("null non diventa una base inventata", clvBasisOf(null), "sconosciuta");
eq("undefined dichiarato sconosciuto", clvBasisOf(undefined), "sconosciuta");
eq("valore inatteso dichiarato sconosciuto", clvBasisOf("fair"), "sconosciuta");
eq("stringa vuota dichiarata sconosciuta", clvBasisOf(""), "sconosciuta");

/* --- conteggi --- */
const misto = clvBasisMix([
  { closingBasis: "fair_novig" },
  { closingBasis: "fair_novig" },
  { closingBasis: "raw_consensus" },
  { closingBasis: null },
]);
eq("misto: totale", misto.total, 4);
eq("misto: fair", misto.counts.fair_novig, 2);
eq("misto: grezza", misto.counts.raw_consensus, 1);
eq("misto: sconosciuta", misto.counts.sconosciuta, 1);
eq("misto: basi distinte", misto.distinct, 3);
eq("misto: marcato come misto", misto.mixed, true);
check(
  "misto: quota fair = 2/4",
  Math.abs(misto.fairShare - 0.5) < 1e-9,
);

const omogeneo = clvBasisMix([
  { closingBasis: "fair_novig" },
  { closingBasis: "fair_novig" },
  { closingBasis: "fair_novig" },
]);
eq("omogeneo: non misto", omogeneo.mixed, false);
eq("omogeneo: una sola base", omogeneo.distinct, 1);
eq("omogeneo: quota fair = 1", omogeneo.fairShare, 1);

const soloGrezza = clvBasisMix([
  { closingBasis: "raw_consensus" },
  { closingBasis: "raw_consensus" },
]);
eq("solo grezza: non misto", soloGrezza.mixed, false);
eq("solo grezza: quota fair = 0", soloGrezza.fairShare, 0);

const vuoto = clvBasisMix([]);
eq("vuoto: totale zero", vuoto.total, 0);
eq("vuoto: non misto", vuoto.mixed, false);
eq("vuoto: quota fair zero", vuoto.fairShare, 0);
eq(
  "vuoto: le chiavi restano tutte presenti",
  CLV_BASIS_KEYS.every((k) => vuoto.counts[k] === 0),
  true,
);

/* --- testo pubblicato --- */
const dettoMisto = describeClvBasisMix(misto);
check("misto: dichiara le basi miste", /Basi miste/i.test(dettoMisto));
check("misto: dichiara non confrontabili", /non confrontabili/i.test(dettoMisto));
check(
  "misto: riporta l'importo misurato dell'errore di base",
  dettoMisto.includes("−1,86 pp"),
);

/* Tutte le righe sulla stessa COLONNA non vuol dire confronto omogeneo: il
   prezzo del segnale resta grezzo, quindi ogni riga mescola le due basi.
   Prima questo test affermava il contrario («omogeneo»): era l'errore di
   premessa che faceva sembrare corretta la base sbagliata. */
const dettoFair = describeClvBasisMix(omogeneo);
check(
  "tutte fair: dichiara che le due metà non stanno sullo stesso piano",
  /non stanno sullo stesso piano/i.test(dettoFair),
);
check(
  "tutte fair: riporta l'importo misurato dell'errore di base",
  dettoFair.includes("−1,86 pp"),
);
check(
  "tutte fair: dice che la depressione è meccanica, non di mercato",
  /meccanico/i.test(dettoFair),
);
check("tutte fair: non parla di basi miste", !/Basi miste/i.test(dettoFair));
check(
  "tutte fair: non dichiara un confronto omogeneo",
  !/confronto è omogeneo/i.test(dettoFair),
);

const dettoGrezza = describeClvBasisMix(soloGrezza);
check("solo grezza: dichiara il margine incluso", /margine/i.test(dettoGrezza));
check(
  "solo grezza: dichiara che le due metà stanno sullo stesso piano",
  /stesso piano/i.test(dettoGrezza),
);
check("solo grezza: non parla di basi miste", !/Basi miste/i.test(dettoGrezza));

const dettoVuoto = describeClvBasisMix(vuoto);
check("vuoto: non inventa una base", /non è ancora dichiarabile/i.test(dettoVuoto));

/* ogni etichetta è scritta per esteso: nessuna chiave tecnica arriva in pagina */
check(
  "le etichette non contengono chiavi tecniche",
  CLV_BASIS_KEYS.every((k) => !CLV_BASIS_LABELS[k].includes("_")),
);

if (failures.length > 0) {
  console.error(`✗ ${failures.length} test falliti su ${passed + failures.length}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${passed} test superati (base del CLV dichiarata)`);
