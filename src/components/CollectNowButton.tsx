"use client";

/**
 * Pulsante "Raccogli ora".
 *
 * Lancia **un solo** giro di raccolta e ricarica il pannello. Niente
 * ripetizioni automatiche, niente conto alla rovescia, niente attesa di
 * dieci giri: se ne servono altri, si preme di nuovo.
 *
 * Durante l'esecuzione il pulsante resta disabilitato: un doppio clic
 * significherebbe due richieste alla fonte a distanza di un istante, cosa
 * che la nostra stessa regola di cortesia vieta.
 */
import { useState, useTransition } from "react";
import { collectNow, type CollectNowResult } from "@/app/cov/actions";

export function CollectNowButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CollectNowResult | null>(null);

  const run = (): void => {
    setResult(null);
    startTransition(async () => {
      setResult(await collectNow());
    });
  };

  const tone =
    result === null
      ? ""
      : result.status === "success"
        ? "text-emerald-800"
        : result.status === "partial"
          ? "text-amber-800"
          : "text-red-800";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Raccolta in corso…" : "Raccogli ora"}
      </button>

      {pending ? (
        <span className="text-[11px] text-slate-500">
          Un solo giro, con i limiti di cortesia verso la fonte: può
          richiedere un minuto.
        </span>
      ) : null}

      {result !== null ? (
        <span className={`max-w-xs text-right text-[11px] leading-relaxed ${tone}`}>
          {result.message}
        </span>
      ) : null}
    </div>
  );
}
