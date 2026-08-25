/**
 * Blocco "Contesto 360°" per il dettaglio partita, con ricerca attiva.
 *
 * Regole non negoziabili, ereditate e confermate dallo sprint grounding:
 *  1. la dicitura fissa in testa non si toglie mai;
 *  2. ogni campo porta UNO di due tag: «da fonte recuperata» col link,
 *     se la ricerca ha citato una sorgente, altrimenti «conoscenza
 *     modello, da verificare». I tag nascono dal parsing, non dalla UI;
 *  3. se il contesto manca si dice che manca e perché: niente inventato;
 *  4. il tetto giornaliero è dichiarato qui, visibile a chi legge;
 *  5. niente di questo blocco entra nel punteggio.
 */
import type { ContextRowView } from "@/lib/repo/context";
import type { ContextFieldDetail } from "@/lib/context/pure";
import {
  CONTEXT_DISCLAIMER,
  MODEL_KNOWLEDGE_TAG,
} from "@/lib/context/pure";
import type { NewsItem } from "@/lib/context/rss";

import type { MovementProfile } from "@/lib/context/why";
import { WhyMoves } from "./WhyMoves";

const ACCORDO_STYLES: Record<string, string> = {
  sostiene: "border-emerald-300 bg-emerald-50 text-emerald-900",
  contraddice: "border-red-300 bg-red-50 text-red-900",
  "non c'entra": "border-slate-300 bg-slate-100 text-slate-700",
};

const FIELD_LABELS: Record<string, string> = {
  livello_categorie: "Livello delle categorie",
  anomalia_campo: "Anomalia del campo",
  posta_in_palo: "Posta in palo",
  rotazioni_fatica: "Rotazioni e fatica",
  h2h_e_forma_recente: "Scontri diretti e forma recente",
  accordo_col_drop: "Accordo col movimento osservato",
};

function FieldCard({ field }: { field: ContextFieldDetail }) {
  const isAccordo = field.key === "accordo_col_drop";
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] leading-tight text-slate-500">
        {FIELD_LABELS[field.key] ?? field.key}
      </div>
      <div className="mt-0.5 text-sm text-slate-800">
        {isAccordo ? (
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
      <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
        {field.fonteUrl !== null ? (
          <>
            da fonte recuperata —{" "}
            <a
              href={field.fonteUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="normal-case text-slate-600 underline underline-offset-2 hover:text-slate-900"
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
  news,
  now,
  profile,
}: {
  context: ContextRowView | null;
  news: NewsItem[];
  now: Date;
  /** profilo del movimento già misurato: alimenta la lettura «Perché si muove» */
  profile?: MovementProfile;
}) {
  const ok = context !== null && context.status === "ok" && context.fields !== null;
  const detailFields = context?.detail?.fields ?? null;
  const sources = context?.sources ?? null;

  return (
    <section
      aria-labelledby="contesto-360"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2
        id="contesto-360"
        className="mb-1 text-sm font-semibold tracking-wide text-slate-700 uppercase"
      >
        Contesto 360°
      </h2>

      <p className="mb-3 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800">
        {CONTEXT_DISCLAIMER}
      </p>

      {context === null ? (
        <p className="text-xs leading-relaxed text-slate-600">
          Contesto non disponibile per questa partita: si genera solo per
          partite con un segnale in essere.
        </p>
      ) : !ok ? (
        <p className="text-xs leading-relaxed text-slate-600">
          Contesto non disponibile
          {context.unavailableReason !== null
            ? ` — ${context.unavailableReason}`
            : ""}
          . Nessun campo viene inventato al suo posto.
          {context.usage.exhausted ? (
            <>
              {" "}
              Tetto giornaliero raggiunto ({context.usage.used}/
              {context.usage.limit}): riprende domani.
            </>
          ) : null}
        </p>
      ) : detailFields !== null ? (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {detailFields.map((f) => (
              <FieldCard key={f.key} field={f} />
            ))}
          </div>
          {sources === null || sources.length === 0 ? (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {context?.searchUnavailableReason !== null &&
              context?.searchUnavailableReason !== undefined
                ? `${context.searchUnavailableReason}: nessun campo viene inventato al suo posto.`
                : "Nessuna fonte recuperata per questa partita: tutti i campi sono conoscenza del modello, da verificare."}
            </p>
          ) : null}
        </>
      ) : (
        /* righe dell'era v1: stessi campi, tutti conoscenza modello */
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              ["Livello delle categorie", context.fields!.livelloCategorie],
              ["Anomalia del campo", context.fields!.anomaliaCampo],
              ["Posta in palo", context.fields!.postaInPalo],
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
              <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                {MODEL_KNOWLEDGE_TAG}
              </div>
            </div>
          ))}
          <div className="rounded border border-slate-200 bg-white px-3 py-2 sm:col-span-2">
            <div className="text-[11px] leading-tight text-slate-500">
              Accordo col movimento osservato
            </div>
            <div className="mt-1">
              <span
                className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                  ACCORDO_STYLES[context.fields!.accordoColDrop] ??
                  ACCORDO_STYLES["non c'entra"]
                }`}
              >
                {context.fields!.accordoColDrop}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Non modifica il punteggio e non lo giustifica.
            </p>
          </div>
        </div>
      )}

      {/* lettura «Perché si muove»: sotto i campi, collassabile */}
      {profile !== undefined ? (
        <WhyMoves fields={detailFields ?? []} profile={profile} />
      ) : null}

      {/* Fonti consultate: i link del grounding, massimo tre */}
      {ok && sources !== null && sources.length > 0 ? (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-semibold text-slate-700">
            Fonti consultate
          </h3>
          <ul className="space-y-1">
            {sources.map((s) => (
              <li key={s.uri} className="text-xs leading-relaxed">
                <a
                  href={s.uri}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-slate-700 underline underline-offset-2 hover:text-slate-900"
                >
                  {s.title ?? s.uri}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* notizie RSS: l'unica parte con una fonte recuperata */}
      {news.length > 0 ? (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-semibold text-slate-700">
            Notizie (RSS, fonte recuperata)
          </h3>
          <ul className="space-y-1">
            {news.map((n) => (
              <li key={`${n.feed}-${n.title}`} className="text-xs leading-relaxed">
                {n.link !== null ? (
                  <a
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-slate-700 underline underline-offset-2 hover:text-slate-900"
                  >
                    {n.title}
                  </a>
                ) : (
                  <span className="text-slate-700">{n.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-500">
        Cache di 24 ore per partita · chiamate al modello:{" "}
        {context?.usage.used ?? 0}/{context?.usage.limit ?? "—"}
        {context?.usage.exhausted ? " — in pausa fino a domani" : ""} ·
        ricerca attiva:{" "}
        {context !== null &&
        (context.grounded || (context.sources?.length ?? 0) > 0)
          ? "sì"
          : "no"}
        {context?.searchProvider !== null && context?.searchProvider !== undefined
          ? ` (${context.searchProvider})`
          : ""}
        {context?.grounded && context?.searchProvider !== "Tavily"
          ? " (grounding Google)"
          : ""}{" "}
        · generato il{" "}
        {context?.generatedAt !== null && context?.generatedAt !== undefined
          ? new Date(context.generatedAt).toLocaleString("it-IT", {
              timeZone: "Europe/Rome",
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—"}{" "}
        (ora italiana {now.toLocaleString("it-IT", {
          timeZone: "Europe/Rome",
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}).
      </p>
    </section>
  );
}
