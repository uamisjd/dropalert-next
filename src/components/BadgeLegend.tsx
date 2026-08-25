/**
 * Legenda dei badge (Sprint UX-2), in fondo alla lista.
 *
 * Serve a chi arriva sulla pagina senza contesto: ogni etichetta che compare
 * sulle card ha qui una riga di spiegazione, con le stesse parole.
 */

const ROWS: Array<{ badge: string; text: string; className: string }> = [
  {
    badge: "drop ampio ≥15%",
    text: "La quota è scesa di almeno il 15% dall'apertura: fascia di osservazione, non un rendimento.",
    className: "border-slate-300 bg-slate-50 text-slate-700",
  },
  {
    badge: "⚠ possibile iper-reazione",
    text: "Nello storico movimenti simili sono rientrati spesso: la fiducia è ridotta, il segnale resta in lista.",
    className: "border-amber-300 bg-amber-50 text-amber-900",
  },
  {
    badge: "Senza notizie pubbliche",
    text: "La fonte notizie è stata interrogata e non ha trovato nulla: stato valido, non un guasto.",
    className: "border-slate-200 bg-white text-slate-500",
  },
  {
    badge: "Dati parziali",
    text: "Su questa partita esiste almeno un dato mancante dichiarato: il quadro è incompleto e non viene stimato.",
    className: "border-slate-300 bg-white text-slate-700",
  },
];

export function BadgeLegend() {
  return (
    <section
      aria-labelledby="legenda-badge"
      className="rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <h2
        id="legenda-badge"
        className="mb-2 text-xs font-semibold tracking-wide text-slate-900 uppercase"
      >
        Legenda dei badge
      </h2>
      <ul className="space-y-1.5">
        {ROWS.map((r) => (
          <li key={r.badge} className="flex flex-wrap items-start gap-2 text-xs">
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${r.className}`}
            >
              {r.badge}
            </span>
            <span className="min-w-0 flex-1 leading-relaxed text-slate-600">
              {r.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
