/**
 * Una card per partita (Sprint UX-2).
 *
 * In vista c'è il segnale più forte del match; gli altri segnali della stessa
 * partita restano raggiungibili in un blocco che si apre, senza moltiplicare
 * le card e senza nascondere nulla. Il blocco sta FUORI dall'articolo della
 * card perché il link di dettaglio ne copre l'intera area.
 */
import Link from "next/link";
import type { MatchGroup } from "@/lib/view/plain";
import { othersLabel } from "@/lib/view/plain";
import { SignalCard } from "./SignalCard";
import { WatchToggle } from "./WatchToggle";
import { fmtPct, fmtPrice } from "./format";

export function MatchCard({
  group,
  now,
  entryKey,
}: {
  group: MatchGroup;
  now: Date;
  /** identità della partita, per le preferite salvate nel browser */
  entryKey: string;
}) {
  const p = group.primary;
  return (
    <div>
      <SignalCard signal={p} now={now} />
      {/* il pulsante sta fuori dalla card: il link la copre tutta */}
      <div className="mt-1 flex justify-end">
        <WatchToggle
          entryKey={entryKey}
          matchId={p.matchId}
          homeTeam={p.homeTeam}
          awayTeam={p.awayTeam}
          kickoffAt={p.kickoffAt}
        />
      </div>
      {group.others.length > 0 ? (
        <details className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <summary className="cursor-pointer text-xs font-medium text-slate-700 hover:text-slate-900">
            {othersLabel(group.others.length)}
          </summary>
          <ul className="mt-1.5 space-y-1">
            {group.others.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
              >
                <span className="font-medium text-slate-900">
                  {s.marketLabel} · {s.selectionLabel}
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600">{s.levelLabel}</span>
                <span className="text-slate-400">·</span>
                <span className="tabular-nums text-slate-600">
                  {fmtPrice(s.openingPrice)} → {fmtPrice(s.currentPrice)} (
                  {fmtPct(s.dropPct)})
                </span>
                <Link
                  href={`/matches/${s.matchId}`}
                  className="ml-auto text-slate-500 underline underline-offset-2 hover:text-slate-900"
                >
                  dettaglio
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
