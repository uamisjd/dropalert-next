/** Destinazioni Web Push supportate. Mai URL arbitrari forniti dal client.
 * Una denylist di IP privati non basta (DNS rebinding): ammettiamo soltanto
 * i servizi push dei browser, prima di salvare e prima di ogni invio.
 */
import { z } from "zod";

export function isAllowedPushEndpoint(value: string): boolean {
  if (value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    const host = url.hostname;
    return host === "fcm.googleapis.com" ||
      host === "updates.push.services.mozilla.com" ||
      host === "updates-autopush.push.services.mozilla.com" ||
      host === "web.push.apple.com" ||
      host === "notify.windows.com" || host.endsWith(".notify.windows.com");
  } catch {
    return false;
  }
}

// Chiave pubblica P-256 non compressa (65 byte), segreto auth (16 byte).
const subscriptionSchema = z.object({
  endpoint: z.string().refine(isAllowedPushEndpoint),
  keys: z.object({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/),
  }),
});

export function parsePushTarget(value: unknown): z.infer<typeof subscriptionSchema> | null {
  const parsed = subscriptionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const MAX_PUSH_WATCHLIST_ITEMS = 100;
export const MAX_PUSH_BODY_BYTES = 64 * 1024;
export const MAX_PUSH_TARGET_BYTES = 8 * 1024;

const watchedItemSchema = z.object({
  matchKey: z.string().min(1).max(256),
  matchId: z.number().int().positive().max(2147483647),
  homeTeam: z.string().min(1).max(120),
  awayTeam: z.string().min(1).max(120),
  thresholdKind: z.enum(["indice", "drop"]).nullable(),
  thresholdValue: z.number().min(0).max(100).nullable(),
}).refine((row) => (row.thresholdKind === null) === (row.thresholdValue === null), {
  message: "soglia incompleta",
});
const watchlistSchema = z.array(watchedItemSchema).max(MAX_PUSH_WATCHLIST_ITEMS)
  .refine((rows) => new Set(rows.map((r) => r.matchKey)).size === rows.length &&
    new Set(rows.map((r) => r.matchId)).size === rows.length, { message: "partite duplicate" });

/** Rifiuta l’intera lista non valida: non salvarne silenziosamente una parte. */
export function parsePushWatchlist(value: unknown): z.infer<typeof watchlistSchema> | null {
  const parsed = watchlistSchema.safeParse(value === undefined ? [] : value);
  return parsed.success ? parsed.data : null;
}
