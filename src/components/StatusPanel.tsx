/**
 * Pannello "Stato dati".
 *
 * Sta in alto perché è la premessa di tutto il resto: prima di leggere un
 * numero, chi guarda deve sapere quanto è completo il quadro da cui viene.
 * Dichiara le fonti, i buchi aperti e l'ultima raccolta riuscita.
 */
import type { DashboardStatus } from "@/lib/repo/dashboard";
import { ND, fmtAgo, fmtDateTime, gapReasonLabel, sourceStatusLabel } from "./format";
import { sourcesLabel } from "@/lib/view/plain";
import type { SharpBudgetView } from "@/lib/repo/sharp";

const BANNER_STYLES: Record<DashboardStatus["overall"], string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
  partial: "border-orange-300 bg-orange-50 text-orange-900",
  blocked: "border-red-300 bg-red-50 text-red-900",
  no_data: "border-slate-400 bg-slate-100 text-slate-800",
};

const SOURCE_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  blocked: "bg-red-500",
  disabled: "bg-slate-400",
  unknown: "bg-slate-300",
};

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] leading-tight text-slate-500" title={hint}>
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums text-slate-900">
        {value}
      </div>
    </div>
  );
}

export function StatusPanel({
  status,
  now,
  sharpBudget,
}: {
  status: DashboardStatus;
  now: Date;
  /** budget della fonte sharp, quando la pagina lo conosce */
  sharpBudget?: SharpBudgetView;
}) {
  return (
    <section
      aria-labelledby="stato-dati"
      className="rounded-lg border border-slate-200 bg-slate-50 p-4"
    >
      <h2
        id="stato-dati"
        className="mb-3 text-sm font-semibold tracking-wide text-slate-900 uppercase"
      >
        Stato dati
      </h2>

      {/* verdetto complessivo, pessimistico per scelta */}
      <p
        className={`mb-3 rounded border px-3 py-2 text-sm ${BANNER_STYLES[status.overall]}`}
      >
        {status.overallLabel}
      </p>

      {/* Stato delle fonti in chiaro: un "0/1" senza spiegazione faceva
          sembrare spenta una fonte degradata che invece sta rispondendo. */}
      <p
        className="mb-2 rounded border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800"
        title="Conteggio per stato reale della fonte, non un rapporto attive/totali."
      >
        {sourcesLabel(status.sources, now)}
      </p>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat
          label="Partite oggi"
          value={status.matchesToday}
          hint="Partite con calcio d'inizio nella giornata italiana corrente."
        />
        <Stat
          label="Partite monitorate"
          value={status.matchesMonitored}
          hint="Partite per cui esiste almeno una rilevazione di quota a registro."
        />
        <Stat
          label="Rilevazioni oggi"
          value={status.snapshotsToday}
          hint="Quote registrate dal monitor nella giornata italiana corrente."
        />
      </div>

      {/* elenco delle fonti */}
      <div className="mb-3">
        <h3 className="mb-1.5 text-xs font-semibold text-slate-700">Fonti</h3>
        {status.sources.length === 0 ? (
          <p className="text-xs text-slate-600">
            Nessuna fonte ha ancora registrato un tentativo.
          </p>
        ) : (
          <ul className="space-y-1">
            {status.sources.map((s) => (
              <li
                key={s.key}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              >
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_DOT[s.status] ?? "bg-slate-300"}`}
                />
                <span className="font-medium text-slate-900">{s.label}</span>
                <span className="text-slate-600">
                  {sourceStatusLabel(s.status)}
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600">
                  ultimo successo {fmtAgo(s.lastSuccessAt, now)}
                </span>
                {s.avgLatencyMs !== null && (
                  <>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600 tabular-nums">
                      latenza media {s.avgLatencyMs} ms
                    </span>
                  </>
                )}
                {s.consecutiveErrors > 0 && (
                  <>
                    <span className="text-slate-400">·</span>
                    <span className="text-red-700 tabular-nums">
                      {s.consecutiveErrors} errori consecutivi
                    </span>
                  </>
                )}
                {/* Cooldown adattivo sui 429: la fonte è in pausa VERA,
                    dichiarata con i minuti che mancano. Ambra: è cortesia,
                    non perdita. */}
                {s.cooldownUntil && new Date(s.cooldownUntil) > now && (
                  <span className="w-full text-amber-700">
                    fonte in cooldown {Math.max(1, Math.ceil((new Date(s.cooldownUntil).getTime() - now.getTime()) / 60000))} min per 429 (livello {s.cooldownLevel}) — il prossimo giro di rete aspetta.
                  </span>
                )}
                {/* Il rate-limit è un limite della fonte, non un dato che
                    abbiamo perso: riga propria, ambra come gli altri limiti
                    di fonte, mai rossa come le perdite del monitor. */}
                {s.lastRateLimitAt && (
                  <span className="w-full text-amber-700">
                    limite della fonte: richieste limitate (429){" "}
                    {fmtDateTime(s.lastRateLimitAt)} (
                    {fmtAgo(s.lastRateLimitAt, now)})
                    {s.rateLimitCount > 1 && `, ${s.rateLimitCount} volte`} — la
                    fonte ci ha chiesto di rallentare: nessun dato inventato al
                    suo posto.
                  </span>
                )}
                {s.lastErrorMessage && (
                  <span className="w-full text-slate-500">
                    ultimo errore: {s.lastErrorMessage}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* budget della linea sharp: dichiarato accanto agli altri limiti */}
      {sharpBudget !== undefined ? (
        <div className="mb-3">
          <h3 className="mb-1.5 text-xs font-semibold text-slate-700">
            Budget linea sharp (The Odds API)
          </h3>
          <p className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
            <span className="font-medium tabular-nums">
              {sharpBudget.usedThisMonth}/{sharpBudget.monthlyCap}
            </span>{" "}
            crediti questo mese ·{" "}
            <span className="font-medium tabular-nums">
              {sharpBudget.usedToday}/{sharpBudget.allowanceToday}
            </span>{" "}
            oggi (tetto {sharpBudget.dailyHardCap} al giorno). La quota
            giornaliera si ricalcola sui giorni che restano nel mese: i crediti
            devono bastare fino all&apos;ultimo giorno.
          </p>
        </div>
      ) : null}

      {/* buchi dichiarati */}
      <div className="mb-3">
        <h3 className="mb-1.5 text-xs font-semibold text-slate-700">
          Dati mancanti dichiarati
        </h3>
        {status.openGaps === 0 ? (
          <p className="text-xs text-slate-600">
            Nessun buco aperto rispetto a ciò che le fonti configurate espongono.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {status.gapsByReason.map((g) => (
              <li
                key={g.reason}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              >
                <span className="font-medium tabular-nums">{g.count}</span>{" "}
                {gapReasonLabel(g.reason)}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          I buchi restano visibili finché non vengono colmati da una rilevazione
          reale. Nessun valore mancante viene stimato o interpolato.
        </p>
      </div>

      {/* tracciabilità della raccolta */}
      <div className="border-t border-slate-200 pt-2.5 text-xs text-slate-600">
        <div>
          Ultimo giro del collector:{" "}
          {status.lastRun ? (
            <>
              <span className="font-medium text-slate-900">
                {status.lastRun.collectorKey}
              </span>{" "}
              — esito {status.lastRun.status}, {fmtDateTime(status.lastRun.startedAt)} (
              {fmtAgo(status.lastRun.startedAt, now)}), {status.lastRun.snapshotsWritten}{" "}
              rilevazioni scritte
            </>
          ) : (
            <span className="text-slate-500">{ND} — nessun giro registrato</span>
          )}
        </div>
        {status.lastRun?.status !== "success" && (
          <div className="mt-0.5">
            Ultimo giro riuscito:{" "}
            {status.lastSuccessfulRun ? (
              <>
                {fmtDateTime(status.lastSuccessfulRun.startedAt)} (
                {fmtAgo(status.lastSuccessfulRun.startedAt, now)})
              </>
            ) : (
              <span className="text-slate-500">mai</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
