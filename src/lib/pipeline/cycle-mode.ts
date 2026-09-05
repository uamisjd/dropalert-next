/** Modalità esplicite del ciclo: completa o compatibile col budget serverless. */
export const CYCLE_MODES = ["full", "collect_only"] as const;
export type CycleMode = (typeof CYCLE_MODES)[number];

export function isCycleMode(value: unknown): value is CycleMode {
  return value === "full" || value === "collect_only";
}
