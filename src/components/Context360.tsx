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
  forma_recente_5: "Forma recente (ultime cinque)",
  assenze_note: "Assenze e indisponibilità",
  accordo_col_drop: "Accordo col movimento osservato",
};

/** Etichetta leggibile di un campo: mai la chiave grezza in snake_case. */
function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ");
}

/**
 * Un campo è recuperato solo se esiste un valore dichiarato. «Non noto» e
 * stringa vuota sono dichiarazioni di assenza del dato: non si stampano come
 * card (sarebbe una card vuota) ma si elencano in una riga che lo dice.
 */
function isUnknownField(field: ContextFieldDetail): boolean {
  const valore = field.valore.trim().toLowerCase();
  return valore === "" || valore === "non noto";
}

function FieldCard({ field }: { field: ContextFieldDetail }) {
  const isAccordo = field.key === "accordo_col_drop";
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] leading-tight text-slate-500">
        {fieldLabel(field.key)}
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
  lowInformation = false,
}: {
  context: ContextRowView | null;
  news: NewsItem[];
  now: Date;
  /** profilo del movimento già misurato: alimenta la lettura «Perché si muove» */
  profile?: MovementProfile;
  /**
   * true per competizioni a bassa copertura informativa (femminili, minori):
   * si dichiara in testa al blocco, così i «non noto» non sembrano un guasto.
   */
  lowInformation?: boolean;
}) {
  const ok = context !== null && context.status === "ok" && context.fields !== null;
  const detailFields = context?.detail?.fields ?? null;
  const sources = context?.sources ?? null;

  /* campi con un valore dichiarato (oppure l'accordo, che è sempre un
     verdetto) e campi dichiarati «non noto»: due trattamenti diversi */
  const visibili = (detailFields ?? []).filter(
    (f) => f.key === "accordo_col_drop" || !isUnknownField(f),
  );
  const ignoti = (detailFields ?? []).filter((f) => !visibili.includes(f));

  /* deduplica: un link già mostrato sotto a un campo non torna nell'elenco */
  const urlGiaCitati = new Set(
    (detailFields ?? [])
      .map((f) => f.fonteUrl)
      .filter((u): u is string => u !== null),
  );
  const altreFonti = (sources ?? []).filter((s) => !urlGiaCitati.has(s.uri));

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

      {lowInformation ? (
        <p className="mb-3 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
          Competizione a bassa copertura informativa: è normale che diversi
          campi siano dichiarati non noti.
        </p>
      ) : null}

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
          {visibili.length === 0 ? (
            <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
              Nessun campo con un valore dichiarato per questa partita:
              tutte le informazioni richieste sono risultate non note.
              Nessun valore viene ricostruito al loro posto.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {visibili.map((f) => (
                <FieldCard key={f.key} field={f} />
              ))}
            </div>
          )}
          {ignoti.length > 0 ? (
            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
              Non recuperati per questa partita:{" "}
              {ignoti.map((f) => fieldLabel(f.key).toLowerCase()).join(", ")}{" "}
              — sono dichiarati, non riempiti per simmetria.
            </p>
          ) : null}
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

      {/* Fonti consultate: solo quelle NON già citate da un campo qui sopra.
          Ripetere lo stesso link a due centimetri di distanza non aggiunge
          nulla e fa sembrare due fonti quella che è una sola. */}
      {ok && altreFonti.length > 0 ? (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-semibold text-slate-700">
            Altre fonti consultate
          </h3>
          <ul className="space-y-1">
            {altreFonti.map((s) => (
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

      {/* Le notizie NON si ripetono qui: hanno un blocco proprio poco sotto,
          con testata, data e lingua. Qui resta solo il rimando. */}
      {news.length > 0 ? (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          {news.length === 1
            ? "1 notizia pubblica recuperata per questa partita"
            : `${news.length} notizie pubbliche recuperate per questa partita`}
          : sono elencate nel blocco «Notizie» qui sotto, con testata e data.
        </p>
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
