"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Movimenti" },
  { href: "/ieri", label: "Ieri" },
  { href: "/domani", label: "Domani" },
  { href: "/preferite", label: "Preferite" },
  { href: "/strumenti", label: "Strumenti" },
  { href: "/metodologia", label: "Metodo" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-4xl items-center gap-4 px-4 py-2.5">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-sm font-bold tracking-tight text-slate-950"
          aria-label="DropAlert — movimenti"
        >
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-950 shadow-sm"
          >
            <span className="h-2 w-2 rounded-full bg-cyan-400" />
          </span>
          <span>DropAlert</span>
        </Link>

        <nav
          aria-label="Navigazione principale"
          className="min-w-0 flex-1 overflow-x-auto"
        >
          <div className="flex min-w-max items-center justify-end gap-1">
            {LINKS.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-slate-950 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </header>
  );
}
