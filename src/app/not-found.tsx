/**
 * 404 personalizzata.
 *
 * Il sito è interamente in italiano: la 404 di default di Next ("This page
 * could not be found") era l'unica stringa inglese dell'interfaccia, senza
 * indicazioni di dove andare. Qui si dichiara il limite e si indica la via.
 */
import Link from "next/link";

const VIA = [
  { href: "/", label: "Movimenti rilevati" },
  { href: "/value-bets", label: "Divario di prezzo" },
  { href: "/trading", label: "Escursione prezzi" },
  { href: "/arbitrage", label: "Arbitrage" },
  { href: "/strumenti", label: "Strumenti di calcolo" },
  { href: "/ieri", label: "Archivio di ieri" },
  { href: "/domani", label: "In arrivo domani" },
  { href: "/performance", label: "Performance (CLV)" },
] as const;

export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto w-full max-w-4xl flex-1 px-4 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <p className="text-xs font-bold uppercase tracking-widest text-cyan-700">
          Errore 404
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
          Questa pagina non esiste
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-slate-600">
          L&apos;indirizzo che hai aperto non corrisponde a nessuna pagina del
          terminale: non la cerchiamo in archivio e non la inventiamo, come per
          qualsiasi altro dato mancante. Il monitor e gli strumenti restano
          dove sono sempre stati.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {VIA.map((v) => (
            <Link
              key={v.href}
              href={v.href}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:border-cyan-400 hover:bg-cyan-50 hover:text-cyan-900"
            >
              {v.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
