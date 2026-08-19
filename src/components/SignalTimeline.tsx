/**
 * Timeline delle transizioni di un segnale.
 *
 * Legge l'audit trail di `signal_events` così com'è: ogni riga è un ricalcolo
 * che ha cambiato stato o spostato l'indice di almeno 5 punti. I ricalcoli
 * che non hanno cambiato nulla non sono registrati e qui non compaiono —
 * l'assenza di eventi intermedi significa "nessun cambiamento rilevante",
 * non "nessuna osservazione".
 */
import type { DetailSignal, TimelineEntry } from "@/lib/repo/match-detail";
import { fmtDateTime, fmtPp } from "./format";

const DOT_STYLES: Record<string, string> = {
  detected: "bg-slate-900 border-slate-900",
  strengthened: "bg-slate-700 border-slate-700",
  weakened: "bg-white border-slate-400",
  rebounded: "bg-white border-amber-500",
  expired: "bg-white border-slate-400",
  closed: "bg-slate-400 border-slate-400",
};

function Entry({ e, isLast }: { e: TimelineEntry; isLast: boolean }) {
  const dot = DOT_STYLES[e.kind] ?? "bg-white border-slate-400";

  return (
    <li className="relative pb-4 pl-6 last:pb-0">
      {!isLast && (
        <span
          aria-hidden
          className="absolute top-3 bottom-0 left-[5px] w-px bg-slate-200"
        />
      )}
      <span
        aria-hidden
        className={`absolute top-1.5 left-0 h-2.5 w-2.5 rounded-full border-2 ${dot}`}
      />
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium text-slate-900">{e.label}</span>
        <time className="text-xs tabular-nums text-slate-500">
          {fmtDateTime(e.at)}
        </time>
        {e.deltaPp !== null && (
          <span className="text-xs tabular-nums whitespace-nowrap text-slate-600">
            {fmtPp(e.deltaPp)}
          </span>
        )}
        {e.confidenceScore !== null && (
          <span className="text-xs tabular-nums text-slate-500">
            indice {e.confidenceScore}/100
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
        {e.description}
      </p>
      {e.note && (
        <p className="mt-1 border-l-2 border-slate-200 pl-2 text-xs leading-relaxed text-slate-500">
          {e.note}
        </p>
      )}
    </li>
  );
}

export function SignalTimeline({ signal }: { signal: DetailSignal }) {
  const events = signal.timeline;

  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-700 uppercase">
        Storia del segnale
      </h4>

      {events.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-600">
          Nessuna transizione registrata a registro per questo segnale. Il
          record esiste ma l&apos;audit trail è vuoto: è un&apos;anomalia di
          tracciamento, non un segnale senza storia.
        </p>
      ) : (
        <ol className="mt-1">
          {events.map((e, i) => (
            <Entry
              key={`${e.at}-${e.kind}-${i}`}
              e={e}
              isLast={i === events.length - 1}
            />
          ))}
        </ol>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        Stato attuale:{" "}
        <span className="font-medium text-slate-700">{signal.statusLabel}</span>
        . Vengono registrate solo le transizioni di stato e le variazioni
        dell&apos;indice di almeno 5 punti: fra un evento e l&apos;altro il
        monitor ha continuato a ricalcolare senza trovare cambiamenti
        rilevanti.
      </p>
    </div>
  );
}
