/** Formattazione pura: nessuna rete, scrittura DB o autorizzazione di giocate. */
export function wireDiagnosticVerdict(activeTotal: number, activeEligible: number, candidates: number): string {
  if (activeTotal === 0) return "Nessun segnale attivo: verificare raccolta e freschezza; questo dato da solo non prova un guasto.";
  if (activeEligible === 0) return "Segnali attivi presenti ma nessuno raggiunge 45: nessuna lettura selezionata. Non abbassare la soglia.";
  if (candidates === 0) return "Segnali sopra soglia presenti, ma nessuna partita supera gli altri gate: consultare gli scarti.";
  return "Partite idonee alla selezione preliminare, NON raccomandazioni BET. Budget, disponibilità delle quote e letture già eseguite restano da verificare.";
}

/** I dati di terzi non possono introdurre markup/link o comandi nei log. */
export function diagnosticText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 600);
}

export function wireDiagnosticSummary(lines: string[]): string {
  const escaped = lines.map(diagnosticText).join("\n")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `## Diagnosi cablaggio — sola lettura, 0 crediti\n\n<pre>\n${escaped}\n</pre>\n`;
}
