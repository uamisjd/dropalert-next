"use client";

/**
 * Filtri e ordinamento della lista segnali.
 *
 * Lo stato vive nella query string: la pagina resta un server component,
 * i link sono condivisibili e il ricaricamento non perde la selezione.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { SignalLevel } from "@/lib/repo/dashboard";

const LEVELS: Array<{ value: SignalLevel; label: string }> = [
  { value: "forte", label: "Forte" },
  { value: "reale", label: "Reale" },
  { value: "debole", label: "Debole" },
  { value: "nessuno", label: "Nessuno" },
];

const SORTS: Array<{ value: string; label: string }> = [
  { value: "score", label: "Indice di fiducia" },
  { value: "drop", label: "Variazione quota" },
  { value: "kickoff", label: "Orario" },
];

export function SignalFilters({
  leagues,
  shown,
  total,
}: {
  leagues: string[];
  shown: number;
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const activeLevels = new Set(
    (params.get("level") ?? "").split(",").filter(Boolean),
  );
  const league = params.get("league") ?? "";
  const sort = params.get("sort") ?? "score";

  /* La casella di ricerca è l'unica fonte di verità del proprio testo: si
     inizializza dall'URL una volta sola e da lì in poi lo pilota lei, con un
     ritardo che evita di navigare a ogni tasto premuto. */
  const [team, setTeam] = useState(() => params.get("team") ?? "");

  function push(next: URLSearchParams) {
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    });
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    push(next);
  }

  function toggleLevel(level: SignalLevel) {
    const next = new URLSearchParams(params.toString());
    const set = new Set(activeLevels);
    if (set.has(level)) set.delete(level);
    else set.add(level);
    if (set.size === 0) next.delete("level");
    else next.set("level", [...set].join(","));
    push(next);
  }

  /* propaga la ricerca all'URL a digitazione ferma */
  useEffect(() => {
    const current = params.get("team") ?? "";
    if (team.trim() === current) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (team.trim()) next.set("team", team.trim());
      else next.delete("team");
      push(next);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team]);

  function resetAll() {
    setTeam("");
    push(new URLSearchParams());
  }

  const hasFilters = activeLevels.size > 0 || league !== "" || team !== "";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      {/* livello del segnale */}
      <fieldset className="mb-3">
        <legend className="mb-1.5 text-xs font-medium text-slate-700">
          Livello del segnale
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {LEVELS.map((l) => {
            const on = activeLevels.has(l.value);
            return (
              <button
                key={l.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleLevel(l.value)}
                className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                  on
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
                }`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label
            htmlFor="f-team"
            className="mb-1 block text-xs font-medium text-slate-700"
          >
            Cerca squadra
          </label>
          <input
            id="f-team"
            type="search"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder="Nome squadra"
            className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-600 focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="f-league"
            className="mb-1 block text-xs font-medium text-slate-700"
          >
            Competizione
          </label>
          <select
            id="f-league"
            value={league}
            onChange={(e) => setParam("league", e.target.value)}
            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-600 focus:outline-none"
          >
            <option value="">Tutte</option>
            {leagues.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="f-sort"
            className="mb-1 block text-xs font-medium text-slate-700"
          >
            Ordina per
          </label>
          <select
            id="f-sort"
            value={sort}
            onChange={(e) => setParam("sort", e.target.value)}
            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-600 focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-xs text-slate-600">
        <span aria-live="polite">
          {isPending
            ? "Aggiornamento…"
            : `${shown} ${shown === 1 ? "movimento" : "movimenti"} su ${total}`}
        </span>
        {hasFilters && (
          <button
            type="button"
            onClick={resetAll}
            className="rounded border border-slate-300 px-2 py-0.5 hover:border-slate-500"
          >
            Azzera filtri
          </button>
        )}
      </div>
    </div>
  );
}
