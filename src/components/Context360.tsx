/**
 * Contesto pubblico della partita.
 *
 * La gerarchia è intenzionale: prima i fatti collegati a una fonte, poi — in
 * un'area chiusa e chiaramente etichettata — le indicazioni automatiche non
 * verificate. In questo modo una frase del modello non ha lo stesso peso
 * visivo di una fonte consultabile.
 */
import type { ContextRowView } from "@/lib/repo/context";
import type { ContextFieldDetail } from "@/lib/context/pure";
import { CONTEXT_DISCLAIMER, MODEL_KNOWLEDGE_TAG } from "@/lib/context/pure";
import type { MovementProfile } from "@/lib/context/why";
import type { NewsItem } from "@/lib/context/rss";
import { WhyMoves } from "./WhyMoves";

const ACCORDO_STYLES: Record<string, string> = {
  sostiene: "border-slate-700 bg-slate-800 text-white",
  contraddice: "border-slate-400 bg-white text-slate-800",
  "non c'entra": "border-slate-300 bg-slate-100 text-slate-700",
};

const FIELD_LABELS: Record<string, string> = {
  livello_categorie: "Livello delle categorie",
  anomalia_campo: "Anomalia del campo",
  posta_in_palo: "Posta in palio",
  rotazioni_fatica: "Rotazioni e fatica",
  h2h_e_forma_recente: "Scontri diretti e forma recente",
  forma_recente_5: "Forma recente (ultime cinque)",
  assenze_note: "Assenze e indisponibilità",
  accordo_col_drop: "Accordo col movimento osservato",
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ");
}

function isUnknownField(field: ContextFieldDetail): boolean {
  const value = field.valore.trim().toLowerCase();
  return value === "" || value === "non noto";
}

function FieldCard({ field }: { field: ContextFieldDetail }) {
  const isAgreement = field.key === "accordo_col_drop";
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] leading-tight font-medium text-slate-500">
        {fieldLabel(field.key)}
      </div>
      <div className="mt-1 text-sm leading-relaxed text-slate-800">
        {isAgreement ? (
          <span
            className={`rounded border px-2 py-0.5 text-xs font-semibold ${
              ACCORDO_STYLES[field.valore] ?? ACCORDO_STYLES["non c'entra"]
            }`}
          >
            {field.valore}
          </span>
        ) : (
          field.valore
        )}
      </div>
      <div className="mt-1.5 text-[10px] tracking-wide text-slate-400 uppercase">
        {field.fonteUrl !== null ? (
          <>
            da fonte recuperata —{" "}
            <a
              href={field.fonteUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="normal-case text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-950"
            >
              {field.fonteTitolo ?? field.fonteUrl}
            </a>
          </>
        ) : (
          MODEL_KNOWLEDGE_TAG
        )}
      </div>
    </div>
  );
}

export function Context360({
  context,
  now,
  profile,
  lowInformation = false,
}: {
  context: ContextRowView | null;
  now: Date;
  /** mantenuto nel contratto per compatibilità; le notizie hanno un blocco unico separato */
  news?: NewsItem[];
  profile?: MovementProfile;
  lowInformation?: boolean;
}) {
  const ok =
    context !== null && context.status === "ok" && context.fields !== null;
  const detailFields = context?.detail?.fields ?? null;
  const sources = context?.sources ?? [];

  const visible = (detailFields ?? []).filter(
    (field) => field.key === "accordo_col_drop" || !isUnknownField(field),
  );
  const unknown = (detailFields ?? []).filter(
    (field) => !visible.includes(field),
  );
  const sourced = visible.filter(
    (field) => field.key !== "accordo_col_drop" && field.fonteUrl !== null,
  );
  const automatic = visible.filter(
    (field) => field.key === "accordo_col_drop" || field.fonteUrl === null,
  );

  const citedUrls = new Set(
    (detailFields ?? [])
      .map((field) => field.fonteUrl)
      .filter((url): url is string => url !== null),
  );
  const otherSources = sources.filter((source) => !citedUrls.has(source.uri));

  return (
    <section
      aria-labelledby="contesto-pubblico"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase">
            Contesto pubblico
          </p>
          <h2
            id="contesto-pubblico"
            className="mt-1 text-lg font-semibold text-slate-950"
          >
            Cosa sappiamo davvero
          </h2>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
          Non entra nel punteggio
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        {CONTEXT_DISCLAIMER}
      </p>

      {lowInformation ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          Competizione a bassa copertura informativa: è normale che diversi
          campi siano dichiarati non noti.
        </p>
      ) : null}

      {context === null ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm leading-relaxed text-slate-600">
          Non è disponibile un contesto pubblico per questa partita. Le quote
          restano valide come osservazione di mercato, ma non attribuiamo loro
          una causa senza fonti.
        </p>
      ) : !ok ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm leading-relaxed text-slate-600">
          Contesto non disponibile
          {context.unavailableReason ? ` — ${context.unavailableReason}` : ""}.
          Nessuna spiegazione viene ricostruita al suo posto.
        </p>
      ) : detailFields !== null ? (
        <>
          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Fatti collegati a una fonte
              </h3>
              <span className="text-xs text-slate-500">
                {sourced.length === 1
                  ? "1 elemento"
                  : `${sourced.length} elementi`}
              </span>
            </div>

            {sourced.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {sourced.map((field) => (
                  <FieldCard key={field.key} field={field} />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm leading-relaxed text-slate-600">
                Nessun fatto specifico è stato collegato a una fonte pubblica.
                Il movimento resta osservato, ma la sua causa non è documentata.
              </p>
            )}
          </div>

          {profile !== undefined ? (
            <WhyMoves fields={detailFields} profile={profile} />
          ) : null}

          {automatic.length > 0 ? (
            <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <summary className="cursor-pointer text-xs font-semibold text-slate-800">
                Indicazioni automatiche da verificare ({automatic.length})
              </summary>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Queste frasi non sono collegate a una fonte recuperata. Sono
                separate dai fatti perché non vanno lette come informazioni
                confermate.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {automatic.map((field) => (
                  <FieldCard key={field.key} field={field} />
                ))}
              </div>
            </details>
          ) : null}

          {unknown.length > 0 ? (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              <span className="font-medium text-slate-700">
                Non recuperati per questa partita:
              </span>{" "}
              {unknown
                .map((field) => fieldLabel(field.key).toLowerCase())
                .join(", ")}{" "}
              — sono dichiarati, non riempiti per simmetria.
            </p>
          ) : null}
        </>
      ) : (
        <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <summary className="cursor-pointer text-xs font-semibold text-slate-800">
            Indicazioni automatiche da verificare
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Questa analisi appartiene a una versione precedente e non contiene
            collegamenti puntuali alle fonti. Per questo resta in secondo piano.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                ["Livello delle categorie", context.fields!.livelloCategorie],
                ["Anomalia del campo", context.fields!.anomaliaCampo],
                ["Posta in palio", context.fields!.postaInPalo],
                ["Rotazioni e fatica", context.fields!.rotazioniFatica],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded border border-slate-200 bg-white px-3 py-2"
              >
                <div className="text-[11px] leading-tight text-slate-500">
                  {label}
                </div>
                <div className="mt-0.5 text-sm text-slate-800">{value}</div>
                <div className="mt-1 text-[10px] tracking-wide text-slate-400 uppercase">
                  {MODEL_KNOWLEDGE_TAG}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {ok ? (
        <details className="mt-4 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-950">
            Fonti e trasparenza della ricerca
          </summary>
          <div className="mt-2 space-y-2 text-xs leading-relaxed text-slate-600">
            {otherSources.length > 0 ? (
              <div>
                <h3 className="font-semibold text-slate-700">
                  Altre fonti consultate
                </h3>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {otherSources.map((source) => (
                    <li key={source.uri}>
                      <a
                        href={source.uri}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="underline decoration-slate-300 underline-offset-2 hover:text-slate-950"
                      >
                        {source.title ?? source.uri}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-[11px] text-slate-500">
              Cache 24 ore · modello {context?.usage.used ?? 0}/
              {context?.usage.limit ?? "—"}
              {context?.usage.exhausted ? " (in pausa fino a domani)" : ""} ·
              ricerca{" "}
              {context !== null && (context.grounded || sources.length > 0)
                ? "attiva"
                : "non attiva"}
              {context?.searchProvider ? ` (${context.searchProvider})` : ""} ·
              generato{" "}
              {context?.generatedAt
                ? new Date(context.generatedAt).toLocaleString("it-IT", {
                    timeZone: "Europe/Rome",
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}{" "}
              (ora italiana{" "}
              {now.toLocaleString("it-IT", {
                timeZone: "Europe/Rome",
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
              ).
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
}
