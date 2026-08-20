/**
 * Lettura dell'ultimo rate-limit subito dalla fonte (Sprint 9).
 *
 * Il pannello di copertura dichiara i limiti della fonte accanto alla
 * misura di completezza: un 429 non è una perdita del monitor né un
 * guasto della fonte — è la fonte che chiede di rallentare. Tenere la
 * riga separata dalle perdite evita di leggerlo come un buco nostro.
 *
 * Sola lettura da `source_health`. Il chiamante lo invoca in un
 * try/catch separato: se la tabella non è leggibile, la pagina di
 * copertura resta valida senza la riga — mai cadere per un'annotazione.
 */
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceHealth } from "@/db/schema";

/** L'episodio di rate-limit più recente fra le fonti che l'hanno subito. */
export interface RateLimitNotice {
  sourceKey: string;
  label: string;
  /** istante dell'ultimo 429, ISO */
  lastRateLimitAt: string;
  lastRateLimitMessage: string | null;
  /** episodi cumulati dalla fonte */
  rateLimitCount: number;
}

/**
 * Restituisce l'episodio più recente, `null` se nessuna fonte ha mai
 * subito un rate-limit (o se la riga non è mai stata scritta).
 *
 * `null` è un'assenza dichiarata: nessun episodio registrato, non
 * «nessun limite mai esistito».
 */
export async function readRateLimitNotice(): Promise<RateLimitNotice | null> {
  const rows = await db
    .select({
      sourceKey: sourceHealth.sourceKey,
      label: sourceHealth.label,
      lastRateLimitAt: sourceHealth.lastRateLimitAt,
      lastRateLimitMessage: sourceHealth.lastRateLimitMessage,
      rateLimitCount: sourceHealth.rateLimitCount,
    })
    .from(sourceHealth)
    .where(isNotNull(sourceHealth.lastRateLimitAt))
    .orderBy(desc(sourceHealth.lastRateLimitAt))
    .limit(1);

  const row = rows[0];
  if (!row || row.lastRateLimitAt === null) return null;

  return {
    sourceKey: row.sourceKey,
    label: row.label,
    lastRateLimitAt: row.lastRateLimitAt.toISOString(),
    lastRateLimitMessage: row.lastRateLimitMessage,
    rateLimitCount: row.rateLimitCount,
  };
}
