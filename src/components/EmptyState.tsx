/**
 * Stato vuoto.
 *
 * Non è una decorazione: quando non c'è nulla da mostrare, il compito della
 * pagina è dire PERCHÉ non c'è nulla, distinguendo tre casi molto diversi —
 * i filtri escludono tutto, il monitor non ha ancora dati, oppure la raccolta
 * è rotta. Un vuoto senza causa sarebbe indistinguibile da un guasto.
 */
import type { DashboardStatus } from "@/lib/repo/dashboard";
import { fmtAgo, fmtDateTime } from "./format";

export function EmptyState({
  status,
  filtered,
  now,
}: {
  status: DashboardStatus;
  filtered: boolean;
  now: Date;
}) {
  if (filtered) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
        <p className="text-sm font-medium text-slate-900">
          Nessun movimento corrisponde ai filtri impostati.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          I dati ci sono, ma la selezione corrente li esclude tutti. Prova ad
          azzerare i filtri.
        </p>
      </div>
    );
  }

  /* Tre casi, tre toni: «rotto» e «mai partito» sono rossi, «ha girato ma oggi non
     ha rilevazioni» è ambra — dipingerlo di rosso sarebbe falso allarmismo. */
  const neverRan = status.lastSuccessfulRun == null;
  const broken = status.overall === "blocked" || (status.overall === "no_data" && neverRan);
  const idle = status.overall === "no_data" && !neverRan;

  return (
    <div
      className={`rounded-lg border p-6 ${
        broken
          ? "border-red-300 bg-red-50"
          : idle
            ? "border-amber-300 bg-amber-50"
            : "border-dashed border-slate-300 bg-white"
      }`}
    >
      <p className="text-sm font-medium text-slate-900">
        {status.overall === "blocked"
          ? "Nessun movimento in elenco: la raccolta dati non sta funzionando."
          : idle
            ? "Nessun movimento in elenco: oggi nessuna rilevazione, ma il collettore ha girato."
            : neverRan && status.overall === "no_data"
              ? "Nessun movimento in elenco: il monitor non ha ancora completato una raccolta."
              : "Nessun movimento di quota rilevato al momento."}
      </p>

      <div className="mt-2 space-y-1 text-xs leading-relaxed text-slate-700">
        <p>
          <span className="font-medium">Causa:</span> {status.overallLabel}
        </p>

        {!broken && status.snapshotsToday > 0 && (
          <p>
            Il monitor sta osservando{" "}
            <span className="font-medium tabular-nums">
              {status.matchesMonitored}
            </span>{" "}
            partite e ha registrato{" "}
            <span className="font-medium tabular-nums">
              {status.snapshotsToday}
            </span>{" "}
            rilevazioni oggi, ma nessuna variazione ha superato la soglia di
            rumore di 2 punti percentuali. Un elenco vuoto è un risultato
            legittimo: significa che il mercato è fermo, non che manchi il dato.
          </p>
        )}

        {idle && (
          <p>
            Il collettore ha completato giri in passato (vedi «ultima raccolta
            riuscita» qui sotto), ma oggi non ha lasciato rilevazioni: la causa
            precisa è nella riga «Causa» qui sopra, non in un guasto presunto.
          </p>
        )}

        <p>
          <span className="font-medium">Ultima raccolta riuscita:</span>{" "}
          {status.lastSuccessfulRun ? (
            <>
              {fmtDateTime(status.lastSuccessfulRun.startedAt)} (
              {fmtAgo(status.lastSuccessfulRun.startedAt, now)}) —{" "}
              {status.lastSuccessfulRun.collectorKey}
            </>
          ) : (
            <span className="text-slate-600">
              mai. Il collector non ha ancora completato un giro con esito
              positivo.
            </span>
          )}
        </p>

        {status.openGaps > 0 && (
          <p>
            Restano{" "}
            <span className="font-medium tabular-nums">{status.openGaps}</span>{" "}
            dati mancanti dichiarati. Non vengono colmati con stime.
          </p>
        )}
      </div>
    </div>
  );
}
