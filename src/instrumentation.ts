/**
 * Punto di avvio dell'applicazione.
 *
 * Next chiama `register()` una volta per processo server, prima di servire
 * la prima richiesta. È l'unico posto onesto dove accendere il runner
 * schedulato: non dipende dal fatto che qualcuno visiti una pagina, e non
 * si duplica a ogni richiesta come farebbe un avvio pigro dentro un
 * componente.
 *
 * Due guardie, entrambe necessarie:
 *
 * - `NEXT_RUNTIME === "nodejs"` — il file viene caricato anche nel runtime
 *   edge, dove non esistono né timer di processo né connessione al
 *   database. Lì non si accende nulla.
 * - `SCHEDULER_ENABLED` — controllata dentro `startCollectLoop`, così una
 *   build o un ambiente di test non si mettono a bussare alla fonte.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  /* import dinamico: il modulo tira dentro il database, che nel runtime
     edge non deve nemmeno essere valutato */
  const { startCollectLoop } = await import("@/lib/pipeline/collect-loop");

  try {
    const result = startCollectLoop();
    if (!result.started) console.info(`[scheduler] ${result.reason}`);
  } catch (err) {
    /* l'applicazione deve partire comunque: senza scheduler si osserva
       meno, senza server non si osserva niente */
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[scheduler] avvio del runner fallito: ${message}. L'applicazione parte comunque, la raccolta resta manuale.`,
    );
  }
}
