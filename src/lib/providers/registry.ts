/**
 * Registry delle fonti (Sprint 3A).
 *
 * Punto unico in cui si dichiara quali fonti esistono e quali sono accese.
 * Aggiungere una fonte significa: implementare `OddsProvider`, importarla
 * qui, e nient'altro. Il motore (`src/lib/drop/*`) non viene toccato, lo
 * schema non viene toccato.
 *
 * Politica di attivazione:
 * - una fonte è accesa solo se `enabled` è true;
 * - le fonti opzionali (the-odds-api, football-data.org, openfootball)
 *   restano SPENTE finché non si imposta la variabile d'ambiente dedicata;
 * - il sistema deve funzionare senza alcuna chiave API.
 */
import type { OddsProvider, ProviderCapabilities } from "./types";

/* ------------------------------------------------------------------ */
/* Lettura della configurazione                                        */
/* ------------------------------------------------------------------ */

/** Interpreta una variabile d'ambiente come booleano esplicito. */
export function envFlag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Legge un intero positivo da variabile d'ambiente, con default. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/* ------------------------------------------------------------------ */
/* Registro                                                            */
/* ------------------------------------------------------------------ */

const registry = new Map<string, OddsProvider>();

/**
 * Registra una fonte. Chiavi duplicate sono un errore di programmazione:
 * meglio fallire all'avvio che avere due fonti che si sovrascrivono.
 */
export function registerProvider(provider: OddsProvider): void {
  if (registry.has(provider.key)) {
    throw new Error(
      `Fonte duplicata nel registry: "${provider.key}". Ogni fonte deve avere una chiave univoca.`,
    );
  }
  registry.set(provider.key, provider);
}

/** Tutte le fonti dichiarate, accese o spente. */
export function listProviders(): OddsProvider[] {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Solo le fonti attive. */
export function listEnabledProviders(): OddsProvider[] {
  return listProviders().filter((p) => p.enabled);
}

/** Fonte per chiave, `null` se non dichiarata. */
export function getProvider(key: string): OddsProvider | null {
  return registry.get(key) ?? null;
}

/**
 * Fonti attive che offrono una certa capacità.
 * Serve allo scheduler per sapere chi interrogare per le partite, chi per
 * le quote e chi per i risultati, senza cablare nomi nel codice.
 */
export function providersWith(
  capability: keyof ProviderCapabilities,
): OddsProvider[] {
  return listEnabledProviders().filter((p) => p.capabilities[capability]);
}

/** Svuota il registry. Usato dai test per isolarsi. */
export function resetRegistry(): void {
  registry.clear();
}

/* ------------------------------------------------------------------ */
/* Diagnostica                                                         */
/* ------------------------------------------------------------------ */

export interface ProviderDescriptor {
  key: string;
  label: string;
  enabled: boolean;
  capabilities: ProviderCapabilities;
  rateLimit: { requestsPerMinute: number; minIntervalMs: number };
  /** motivo leggibile dello stato, per /api/health */
  note: string;
}

/**
 * Fotografia del registry per la diagnostica.
 * `/api/health` la usa per dire quali fonti esistono e perché una è spenta,
 * invece di limitarsi a non nominarla.
 */
export function describeRegistry(): ProviderDescriptor[] {
  return listProviders().map((p) => ({
    key: p.key,
    label: p.label,
    enabled: p.enabled,
    capabilities: p.capabilities,
    rateLimit: p.rateLimit,
    note: p.enabled
      ? p.capabilities.perBookmakerOdds
        ? "Attiva. Espone quote per singolo bookmaker."
        : "Attiva. Espone solo la linea di consenso: coordinazione e conferma sharp non sono calcolabili da questa fonte."
      : "Disattivata da configurazione.",
  }));
}

/**
 * true se nessuna fonte attiva sa produrre quote per singolo bookmaker.
 * In quel caso il sistema deve dichiarare che coordinazione e sharp non
 * sono misurabili, invece di mostrarli a zero come se fossero misurati.
 */
export function perBookmakerOddsUnavailable(): boolean {
  const oddsProviders = providersWith("odds");
  if (oddsProviders.length === 0) return true;
  return !oddsProviders.some((p) => p.capabilities.perBookmakerOdds);
}
