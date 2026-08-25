/**
 * «Perché il mercato si muove — lettura» (Sprint «Perché si muove»).
 *
 * Sta sotto i campi del Contesto 360°, collassabile. Combina SOLO fattori
 * con fonte recuperata e il profilo del movimento già misurato dal motore:
 * ogni riga porta il proprio tag, «da fonte» o «ipotesi dal profilo del
 * movimento», e la chiusura è fissa.
 *
 * Non introduce metriche, non entra nel punteggio, non è un pronostico.
 */
import {
  WHY_CLOSING,
  buildWhyReading,
  type MovementProfile,
  type SourcedField,
} from "@/lib/context/why";

export function WhyMoves({
  fields,
  profile,
  defaultOpen = false,
}: {
  fields: SourcedField[];
  profile: MovementProfile;
  defaultOpen?: boolean;
}) {
  const reading = buildWhyReading(fields, profile);

  return (
    <details
      open={defaultOpen}
      className="mt-3 rounded border border-slate-300 bg-slate-50 px-3 py-2"
    >
      <summary className="cursor-pointer text-xs font-semibold tracking-wide text-slate-800 uppercase">
        Perché si muove?
      </summary>

      <p className="mt-2 text-xs leading-relaxed text-slate-700">
        {reading.paragraph}
      </p>

      {reading.drivers.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {reading.drivers.map((d, i) => (
            <li
              key={`${d.tag}-${i}`}
              className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-slate-700"
            >
              <span>{d.text}</span>
              <span className="mt-0.5 block text-[10px] tracking-wide text-slate-400 uppercase">
                {d.tag}
                {d.url !== null ? (
                  <>
                    {" — "}
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="normal-case text-slate-600 underline underline-offset-2 hover:text-slate-900"
                    >
                      {d.title ?? d.url}
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2 border-t border-slate-200 pt-1.5 text-[11px] leading-relaxed text-slate-500">
        La lettura combina soltanto fattori con fonte recuperata e il profilo
        del movimento già misurato dal monitor. Non entra nel punteggio.{" "}
        {WHY_CLOSING}
      </p>
    </details>
  );
}
