/**
 * Tooltip di definizione (Sprint UX-2).
 *
 * Una riga per termine tecnico, sempre la stessa in tutto il sito: le
 * definizioni stanno qui e in nessun altro posto, così non divergono.
 */

export const GLOSSARY: Record<string, string> = {
  pp: "pp = punti percentuali: di quanto è cambiata la probabilità implicita (1/quota). Da 20% a 23% sono +3 pp.",
  clv: "CLV = confronto fra la quota del segnale e la quota di chiusura. Misura il tempismo rispetto al mercato, non l'esito della partita.",
  gap: "GAP = dato mancante dichiarato: informazione che la fonte non ha pubblicato. Non viene mai stimata né interpolata.",
  iperreazione:
    "Iper-reazione: nello storico movimenti simili sono rientrati spesso. La fiducia viene ridotta, il segnale resta in lista.",
  "drop-ampio":
    "Drop ampio: la quota è scesa di almeno il 15% dall'apertura. È una fascia di osservazione, non un rendimento.",
  "indice-normalizzato":
    "Indice su base misurabile: i punti ottenuti divisi per i punti realmente ottenibili, cioè esclusi quelli legati a dati che la fonte non pubblica. Esempio: 35,5 punti su 55 misurabili = 65/100. Non è una probabilità di vittoria.",
  indice:
    "Indice di fiducia 0–100: quanto il movimento è ampio, confermato, persistente e coperto dai dati. Non è una probabilità di vittoria.",
  drop: "Drop: calo della quota rispetto alla prima rilevazione del monitor.",
};

/** Pallino "i" con la definizione in tooltip, accessibile da tastiera. */
export function Info({ term, className = "" }: { term: keyof typeof GLOSSARY | string; className?: string }) {
  const text = GLOSSARY[term];
  if (!text) return null;
  return (
    <span
      role="note"
      tabIndex={0}
      aria-label={text}
      title={text}
      className={`ml-1 inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-slate-300 text-[9px] leading-none font-semibold text-slate-500 align-middle ${className}`}
    >
      i
    </span>
  );
}
