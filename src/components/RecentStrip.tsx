/**
 * Striscia "Ultimi movimenti" (Sprint UX-1).
 *
 * Elenca i segnali nati o cambiati nelle ultime 3 ore, in ordine di
 * aggiornamento. Non è una classifica di merito e non introduce metriche:
 * è solo una scorciatoia a ciò che si è mosso da poco. Se non si è mosso
 * nulla, lo dice invece di sparire.
 */
import Link from "next/link";
import type { DashboardSignal } from "@/lib/repo/dashboard";
import { RECENT_WINDOW_HOURS, fmtCountdown } from "@/lib/view/timeline";
import { fmtAgo } from "./format";

export function RecentStrip({
  signals,
  now,
}: {
  signals: DashboardSignal[];
  now: Date;
}) {
  return (
    <section
      aria-labelledby="ultimi-movimenti"
      className="rounded-lg border border-slate-200 bg-white p-3"
    >
      <h2
        id="ultimi-movimenti"
        className="mb-2 text-xs font-semibold tracking-wide text-slate-900 uppercase"
      >
        Ultimi movimenti{" "}
        <span className="font-normal text-slate-500">
          (ultime {RECENT_WINDOW_HOURS} ore)
        </span>
      </h2>
      {signals.length === 0 ? (
        <p className="text-xs text-slate-500">
          Nessun segnale nato o cambiato nelle ultime {RECENT_WINDOW_HOURS} ore.
        </p>
      ) : (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {signals.map((s) => (
            <li key={s.id} className="min-w-[13rem] shrink-0">
              <Link
                href={`/matches/${s.matchId}`}
                className="block rounded border border-slate-200 px-2.5 py-2 hover:border-slate-400"
              >
                <div className="truncate text-xs font-semibold text-slate-900">
                  {s.homeTeam} – {s.awayTeam}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-slate-600">
                  {s.levelLabel} · {fmtCountdown(s.kickoffAt, now)}
                </div>
                <div className="text-[11px] text-slate-400">
                  aggiornato {fmtAgo(s.updatedAt, now)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
