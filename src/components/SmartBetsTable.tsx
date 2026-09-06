"use client";

import Link from "next/link";
import type { ValueOpportunity } from "@/lib/quant/types";

/**
 * Compatibilità per import storici.
 *
 * La vecchia tabella calcolava uno «Smart Score» con Kelly e trasformava il
 * divario della stessa linea in priorità. Non è più un output ammesso dal
 * contratto decisionale. La rotta `/smart-bets` reindirizza a `/value-bets`;
 * questo componente resta solo per evitare import orfani durante una
 * migrazione e non ordina né promuove alcuna riga.
 */
export function SmartBetsTable({ opportunities }: { opportunities: ValueOpportunity[] }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      <p className="font-semibold">Vista Smart Bets dismessa</p>
      <p className="mt-1 text-xs leading-relaxed">
        {opportunities.length} righe restano disponibili come osservazioni, ma non
        vengono trasformate in score, stake o priorità. Usa la coda decisionale in{" "}
        <Link href="/value-bets" className="font-semibold underline">
          /value-bets
        </Link>
        .
      </p>
    </div>
  );
}
