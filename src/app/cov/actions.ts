"use server";

/**
 * Azione "Raccogli ora": un solo giro di raccolta, su richiesta esplicita.
 *
 * Le Server Action sono richiamabili dal browser: questa operazione è
 * disponibile soltanto in sviluppo. In produzione usare i job autenticati.
 *
 * Fa **una** raccolta e nient'altro. Nessun ciclo, nessuna attesa, nessun
 * processo che sopravvive alla risposta: il pulsante lancia un giro e
 * ricarica il pannello con quello che quel giro ha misurato.
 */
import { revalidatePath } from "next/cache";
import { collectBetexplorer } from "@/lib/providers/betexplorer/collect";

export interface CollectNowResult {
  ok: boolean;
  status: "success" | "partial" | "failed" | "error";
  message: string;
}

export async function collectNow(): Promise<CollectNowResult> {
  if (process.env.NODE_ENV !== "development") {
    return {
      ok: false,
      status: "error",
      message: "Raccolta manuale disponibile solo in sviluppo. In produzione usare il workflow autorizzato.",
    };
  }
  try {
    /* giro chiesto a mano: dichiarato tale, così non gonfia la
       profondità della serie, che si conta sui giri schedulati */
    const report = await collectBetexplorer({ trigger: "manual" });

    /* il pannello legge dal database: va riletto dopo la scrittura */
    revalidatePath("/cov");
    revalidatePath("/");

    const summary =
      `${report.fixturesSeen} righe in elenco, ` +
      `${report.matchesUpserted} partite lavorate, ` +
      `${report.snapshotsWritten} quote scritte.`;

    if (report.status === "success") {
      return { ok: true, status: "success", message: `Giro completato: ${summary}` };
    }

    /* un giro parziale resta un giro: si dichiara com'è andato */
    const problems =
      report.problems.length > 0
        ? ` Problemi dichiarati: ${report.problems.length}.`
        : "";

    return {
      ok: report.status !== "failed",
      status: report.status,
      message: `Giro ${report.status === "partial" ? "parziale" : "fallito"}: ${summary}${problems}`,
    };
  } catch {
    /* mai fingere che sia andata bene */
    return {
      ok: false,
      status: "error",
      message: "Raccolta non eseguita. Verificare la configurazione e lo stato della fonte.",
    };
  }
}
