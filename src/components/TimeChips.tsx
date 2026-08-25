"use client";

/**
 * Chip di filtro temporale della lista (Sprint UX-1, semplificate in UX-2).
 *
 * Tre chip mutuamente esclusive con conteggio esplicito e tooltip di
 * definizione, più una riga di aritmetica sotto: chi legge deve poter fare
 * la somma a mente e ritrovare il totale.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  DEFAULT_TIME_CHIP,
  TIME_CHIPS,
  parseTimeChip,
  type ChipCounts,
} from "@/lib/view/timeline";

export function TimeChips({ counts }: { counts: ChipCounts }) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const active = parseTimeChip(params.get("when"));

  function select(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === DEFAULT_TIME_CHIP) next.delete("when");
    else next.set("when", value);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    });
  }

  return (
    <div className={isPending ? "opacity-70" : ""}>
      <div role="group" aria-label="Filtro temporale" className="flex flex-wrap gap-1.5">
        {TIME_CHIPS.map((c) => {
          const on = active === c.value;
          const n = counts[c.value];
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={on}
              title={c.hint}
              onClick={() => select(c.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              }`}
            >
              {c.label}
              <span
                className={`ml-1 tabular-nums ${on ? "text-slate-300" : "text-slate-400"}`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>
      {/* aritmetica dichiarata: verificabile a colpo d'occhio */}
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
        Tutte {counts.tutte} = Da giocare {counts["da-giocare"]} + Giocate{" "}
        {counts.giocate}. Dentro «Da giocare»: {counts.oggi} oggi (giornata
        italiana) e {counts.inArrivo} nei giorni successivi. «Giocate» = calcio
        d&apos;inizio passato da oltre 3 ore.
      </p>
    </div>
  );
}
