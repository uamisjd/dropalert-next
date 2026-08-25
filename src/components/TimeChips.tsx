"use client";

/**
 * Chip di filtro temporale della lista partite (Sprint UX-1).
 *
 * Come gli altri filtri, lo stato vive nella query string: la pagina resta un
 * server component e il link è condivisibile. Il default — "Oggi e in arrivo"
 * — non viene scritto nell'URL, così l'indirizzo pulito è già quello giusto.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { DEFAULT_TIME_CHIP, TIME_CHIPS, parseTimeChip } from "@/lib/view/timeline";

export function TimeChips({ counts }: { counts?: Record<string, number> }) {
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
    <div
      role="group"
      aria-label="Filtro temporale"
      className={`flex flex-wrap gap-1.5 ${isPending ? "opacity-70" : ""}`}
    >
      {TIME_CHIPS.map((c) => {
        const on = active === c.value;
        const n = counts?.[c.value];
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={on}
            onClick={() => select(c.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              on
                ? "border-slate-800 bg-slate-800 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
            }`}
          >
            {c.label}
            {typeof n === "number" ? (
              <span className={on ? "ml-1 text-slate-300" : "ml-1 text-slate-400"}>
                {n}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
