/**
 * Composizione del registry delle fonti (Sprint 3A).
 *
 * Questo è l'unico file che decide QUALI fonti esistono. Il resto del
 * sistema chiede al registry, non conosce i nomi.
 *
 * Stato attuale:
 * - BetExplorer è la fonte reale, accesa di default. Espone SOLO la quota
 *   di consenso: `perBookmakerOdds` è false e il sistema lo dichiara.
 * - the-odds-api resta dichiarata ma spenta, come da decisione presa.
 *
 * Non si simula copertura: ciò che una fonte non dà resta un buco
 * dichiarato in `data_gaps`.
 */
import { createBetexplorerProvider } from "./betexplorer/index";
import { createTheOddsApiProvider } from "./optional/the-odds-api";
import { registerProvider, resetRegistry } from "./registry";

let initialized = false;

/**
 * Popola il registry una sola volta per processo.
 * Idempotente: chiamarla più volte non duplica le fonti.
 */
export function initProviders(): void {
  if (initialized) return;
  registerProvider(createBetexplorerProvider());
  registerProvider(createTheOddsApiProvider());
  initialized = true;
}

/** Reinizializza da zero. Usato dai test. */
export function reinitProviders(): void {
  resetRegistry();
  initialized = false;
  initProviders();
}

export * from "./types";
export * from "./registry";
export * from "./rate-limiter";
export * from "./runner";
