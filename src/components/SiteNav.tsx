"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* Ordine per funzione: segnali (divari, escursioni, arbitraggio),
   calcolatori (surebet, simulatore, strumenti), archivio (ieri, domani),
   area personale (preferite, bankroll), metriche e documentazione.
   Le voci personali sono strumenti del proprietario. */
const LINKS: Array<{ href: string; label: string; badge?: string; highlight?: boolean; group?: string }> = [
  { href: "/", label: "Movimenti" },
  { href: "/value-bets", label: "Divario di prezzo", highlight: false },
  { href: "/trading", label: "Escursione prezzi" },
  { href: "/arbitrage", label: "Arbitrage" },
  { href: "/surebet", label: "Surebet", group: "calcolatori" },
  { href: "/simulator", label: "Simulatore xG", group: "calcolatori" },
  { href: "/strumenti", label: "Strumenti", group: "calcolatori" },
  { href: "/preferite", label: "Preferite", group: "personale" },
  { href: "/mio-bankroll", label: "Bankroll", group: "personale" },
  { href: "/ieri", label: "Ieri", group: "archivio" },
  { href: "/domani", label: "Domani", group: "archivio" },
  { href: "/performance", label: "Performance", group: "metriche" },
  { href: "/coverage", label: "Copertura", group: "metriche" },
  { href: "/guida", label: "Come si legge" },
  { href: "/metodologia", label: "Metodo" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-2.5">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-sm font-black tracking-tight text-slate-950"
          aria-label="DropAlert — terminale quantitativo per scommesse sul calcio"
        >
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-950 shadow-sm"
          >
            <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          </span>
          <span className="flex items-center gap-1.5">
            <span>DropAlert</span>
            <span className="rounded bg-cyan-100 px-1 py-0.2 text-[10px] font-extrabold text-cyan-900 uppercase">
              PRO
            </span>
          </span>
        </Link>

        <nav
          aria-label="Navigazione principale"
          className="min-w-0 flex-1 overflow-x-auto"
        >
          <div className="flex min-w-max items-center justify-end gap-1">
            {LINKS.map((link, i) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              const showSep =
                i > 0 &&
                link.group !== undefined &&
                link.group !== LINKS[i - 1]?.group;
              return (
                <span key={link.href} className="flex items-center">
                  {showSep ? (
                    <span
                      aria-hidden
                      className="mx-0.5 h-4 w-px bg-slate-200"
                    />
                  ) : null}
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? "bg-slate-950 text-white"
                        : link.highlight
                          ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                    }`}
                  >
                    {link.label}
                    {link.badge ? (
                      <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-100 px-1 text-[9px] font-bold text-cyan-800">
                        {link.badge}
                      </span>
                    ) : null}
                  </Link>
                </span>
              );
            })}
          </div>
        </nav>
      </div>
    </header>
  );
}
