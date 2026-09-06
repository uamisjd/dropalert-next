import { redirect } from "next/navigation";

/**
 * Alias mantenuto solo per i vecchi link.
 *
 * La precedente pagina «Smart Bets» trasformava un no-vig della stessa linea in
 * un punteggio con Kelly e in una priorità operativa. Non è una decisione
 * difendibile: il consenso BetExplorer non è una quota eseguibile e non esiste
 * ancora una fair indipendente validata. Il flusso corretto è `/value-bets`,
 * dove ogni riga mostra il proprio stato e può concludere NO BET.
 */
export default function SmartBetsPage() {
  redirect("/value-bets");
}
