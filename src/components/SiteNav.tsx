"use client";

/**
 * Navigazione persistente (Sprint lancio, punto E1).
 *
 * Sta nel layout radice: le stesse cinque voci su ogni pagina, così non si
 * arriva mai in un vicolo cieco. La voce corrente è marcata con
 * `aria-current` e non è un link a sé stessa.
 *
 * Client component solo per leggere il percorso attivo: nessun dato, nessuna
 * chiamata, nessuno stato.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Home" },
  { href: "/ieri", label: "Ieri" },
  { href: "/domani", label: "Domani" },
  { href: "/watchlist", label: "Preferite" },
  { href: "/metodologia", label: "Metodologia" },
  { href: "/gioco-responsabile", label: "Gioco responsabile" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-slate-200 bg-white">
      <nav
        aria-label="Navigazione principale"
        className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-1 gap-y-1 px-4 py-2"
      >
        <Link
          href="/"
          className="mr-2 text-sm font-bold tracking-tight text-slate-900"
        >
          DropAlert
        </Link>
        {LINKS.map((l) => {
          const active =
            l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
