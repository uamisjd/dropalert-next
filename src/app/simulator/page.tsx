/**
 * Pagina /simulator — Match Engine xG & Dixon-Coles Poisson Bivariato.
 */
import type { Metadata } from "next";
import { PoissonSimulatorView } from "@/components/simulator/PoissonSimulatorView";

export const metadata: Metadata = {
  title: "xG & Dixon-Coles Poisson Match Simulator — DropAlert Pro",
  description:
    "Simulatore statistico di partite basato su Expected Goals (xG) e modello Dixon-Coles. Matrice risultati esatti 0-0 a 5-5 e quote fair indipendenti.",
  alternates: { canonical: "/simulator" },
};

export default function SimulatorPage() {
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
            Statistical Modeling Engine
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Simulatore Match xG / Dixon-Coles
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">
            Genera quote fair teoriche indipendenti dal mercato basate su dati Expected Goals (xG).
            Confronta il modello statistico con le quote offerte dai bookmaker per scovare
            disallineamenti ad alto Expected Value (+EV).
          </p>
        </div>
      </header>

      {/* Vista Simulatore */}
      <PoissonSimulatorView />
    </main>
  );
}
