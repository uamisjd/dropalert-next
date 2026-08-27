/**
 * «Quote in arrivo» — partite di calendario senza quote (ENH-1, punto 1).
 *
 * Serve a sapere che cosa sta arrivando prima che il collector raccolga i
 * prezzi. Sono partite SENZA movimento: non hanno indice, non hanno segnale
 * e non entrano in nessuna statistica. L'etichetta lo dichiara, e la fonte
 * del calendario è citata in fondo.
 */
import type { CalendarFixture } from "@/lib/calendar/football-data";
import { COVERED_COMPETITIONS } from "@/lib/calendar/football-data";
import { fmtCountdown } from "@/lib/view/timeline";
import { fmtDay, fmtTime } from "./format";

export function UpcomingFixtures({
  fixtures,
  now,
  unavailableReason,
  title = "Quote in arrivo",
}: {
  fixtures: CalendarFixture[];
  now: Date;
  unavailableReason?: string | null;
  title?: string;
}) {
  return (
    <section
      aria-labelledby="quote-in-arrivo"
      className="rounded-lg border border-slate-200 bg-white p-3"
    >
      <h2
        id="quote-in-arrivo"
        className="mb-1 text-xs font-semibold tracking-wide text-slate-900 uppercase"
      >
        {title}
      </h2>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
        Partite in calendario per cui il monitor non ha ancora rilevato quote:
        compaiono qui perché si sappia che stanno arrivando. Non hanno indice
        né segnale, e non entrano in alcuna statistica.
      </p>

      {fixtures.length === 0 ? (
        <p className="text-xs text-slate-600">
          {unavailableReason ??
            "Nessuna partita in calendario nelle competizioni coperte per questa finestra."}
        </p>
      ) : (
        <ul className="space-y-1">
          {fixtures.map((f) => (
            <li
              key={`${f.sourceId}-${f.kickoffAt}`}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded border border-dashed border-slate-300 px-2.5 py-1.5 text-xs"
            >
              <span className="font-medium text-slate-900">
                {f.homeTeam} – {f.awayTeam}
              </span>
              <span className="text-slate-500">{f.competition}</span>
              <span aria-hidden className="text-slate-300">
                |
              </span>
              <span className="tabular-nums text-slate-600">
                {fmtDay(f.kickoffAt)} ore {fmtTime(f.kickoffAt)}
              </span>
              <span className="tabular-nums text-slate-500">
                ({fmtCountdown(f.kickoffAt, now)})
              </span>
              <span className="ml-auto rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                quote in arrivo
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 border-t border-slate-100 pt-1.5 text-[11px] leading-relaxed text-slate-500">
        Calendario da football-data.org (piano gratuito), aggiornato una volta
        al giorno. Coperte: {COVERED_COMPETITIONS}. Le altre competizioni
        restano quelle dell&apos;archivio del monitor. Il calendario non è una
        fonte di quote: i prezzi arrivano solo dalla raccolta abituale.
      </p>
    </section>
  );
}
