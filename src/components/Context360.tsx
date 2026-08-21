/**
 * Blocco "Contesto 360°" per il dettaglio partita.
 *
 * Regole non negoziabili, ereditate dallo sprint:
 *  1. la dicitura fissa in testa non si toglie mai;
 *  2. ogni campo porta il tag "conoscenza modello, da verificare" —
 *     l'unica eccezione sono le notizie RSS, che citano la fonte;
 *  3. se il contesto manca si dice che manca e perché: niente inventato;
 *  4. il tetto giornaliero è dichiarato qui, visibile a chi legge;
 *  5. niente di questo blocco entra nel punteggio.
 */
import type { ContextRowView } from "@/lib/repo/context";
import {
  CONTEXT_DISCLAIMER,
  MODEL_KNOWLEDGE_TAG,
} from "@/lib/context/pure";
import type { NewsItem } from "@/lib/context/rss";

const ACCORDO_STYLES: Record<string, string> = {
  sostiene: "border-emerald-300 bg-emerald-50 text-emerald-900",
  contraddice: "border-red-300 bg-red-50 text-red-900",
  "non c'entra": "border-slate-300 bg-slate-100 text-slate-700",
};

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] leading-tight text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm text-slate-800">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
        {MODEL_KNOWLEDGE_TAG}
      </div>
    </div>
  );
}

export function Context360({
  context,
  news,
  now,
}: {
  context: ContextRowView | null;
  news: NewsItem[];
  now: Date;
}) {
  const ok = context !== null && context.status === "ok" && context.fields !== null;

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
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Livello delle categorie" value={context.fields!.livelloCategorie} />
          <Field label="Anomalia del campo" value={context.fields!.anomaliaCampo} />
          <Field label="Posta in palo" value={context.fields!.postaInPalo} />
          <Field label="Rotazioni e fatica" value={context.fields!.rotazioniFatica} />
          <div className="rounded border border-slate-200 bg-white px-3 py-2 sm:col-span-2">
            <div className="text-[11px] leading-tight text-slate-500">
              Accordo col movimento osservato
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                  ACCORDO_STYLES[context.fields!.accordoColDrop] ??
                  ACCORDO_STYLES["non c'entra"]
                }`}
              >
                {context.fields!.accordoColDrop}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                {MODEL_KNOWLEDGE_TAG}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Giudizio del modello sul se questo contesto sostenga,
              contraddica o non c&apos;entri col movimento di quota
              osservato. Non modifica il punteggio e non lo giustifica.
            </p>
          </div>
        </div>
      )}

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
        Cache di 24 ore per partita · tetto giornaliero:{" "}
        {context?.usage.used ?? 0}/{context?.usage.limit ?? "—"} chiamate
        {context?.usage.exhausted
          ? " — in pausa fino a domani"
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
