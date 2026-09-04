/**
 * Pagina /strumenti — Suite Completa di Calcolo Quantitativo per Scommettitori e Trader.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { MarginCalculator } from "@/components/tools/MarginCalculator";
import { VarianceSimulator } from "@/components/tools/VarianceSimulator";
import { SurebetCalculator } from "@/components/tools/SurebetCalculator";
import { DutchingCalculator } from "@/components/tools/DutchingCalculator";
import { GreenUpCalculator } from "@/components/trading/GreenUpCalculator";
import { HELPLINE } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Strumenti di Calcolo Quantitativo — DropAlert Pro",
  description:
    "Suite completa di calcolatori per scommesse e trading sportivo: Margine e quote Fair No-Vig, Simulatore di Varianza, Surebet, Dutching e Green-Up Exchange.",
  alternates: { canonical: "/strumenti" },
};

export const dynamic = "force-static";

export default function StrumentiPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
      {/* Header */}
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-lg">
        <div
          aria-hidden
          className="absolute -top-24 -right-20 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl"
        />
        <div className="relative max-w-3xl">
          <p className="text-xs font-bold tracking-[0.2em] text-cyan-400 uppercase">
            Quantitative Toolbox
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Strumenti di Calcolo & Simulazione
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Calcolatori matematici e modelli probabilistici per scommettitori quantitativi
            e trader sportivi: stima del margine, de-vigging, arbitraggi, dutching, simulazioni Monte Carlo e strategie di green-up.
          </p>
        </div>
      </header>

      {/* Navigazione Rapida Strumenti */}
      <div className="mb-6 flex flex-wrap gap-2">
        {[
          ["#margine", "Margine & No-Vig"],
          ["#varianza", "Varianza & Monte Carlo"],
          ["#surebet", "Surebet (Arbitraggio)"],
          ["#dutching", "Dutching"],
          ["#greenup", "Green-Up Exchange"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-100 hover:text-slate-950"
          >
            {label}
          </a>
        ))}
      </div>

      {/* Sezioni Calcolatori */}
      <div className="space-y-8">
        <div id="margine" className="scroll-mt-20">
          <MarginCalculator />
        </div>

        <div id="varianza" className="scroll-mt-20">
          <VarianceSimulator />
        </div>

        <div id="surebet" className="scroll-mt-20">
          <SurebetCalculator />
        </div>

        <div id="dutching" className="scroll-mt-20">
          <DutchingCalculator />
        </div>

        <div id="greenup" className="scroll-mt-20">
          <GreenUpCalculator />
        </div>
      </div>

      {/* Footer informativo */}
      <footer className="mt-10 border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-500">
        <p className="mb-2">
          Tutti i calcolatori operano localmente nel browser garantendo la totale riservatezza dei parametri inseriti.
        </p>
        <p>
          Il gioco è riservato ai maggiorenni (18+) e può causare dipendenza patologica. Numero Verde Nazionale:{" "}
          <a
            href={`tel:+39${HELPLINE.replace(/\s/g, "")}`}
            className="font-semibold text-slate-800 underline"
          >
            {HELPLINE}
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
