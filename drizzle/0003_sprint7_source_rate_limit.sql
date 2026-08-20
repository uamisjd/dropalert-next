ALTER TABLE "source_health" ADD COLUMN "last_rate_limit_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_health" ADD COLUMN "last_rate_limit_message" text;--> statement-breakpoint
ALTER TABLE "source_health" ADD COLUMN "rate_limit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
/*
 * Recupero dell'episodio già accaduto.
 *
 * Il 429 su dropping-odds era già stato registrato due volte: come
 * `last_error_message` sulla fonte e come riga `rate_limited` in
 * `data_gaps`. Mancava solo la data dedicata, quindi l'episodio spariva
 * dalla vista appena un giro andava a buon fine.
 *
 * La data qui sotto NON è inventata: è `observed_from` del buco che il
 * runner aveva già scritto quando la fonte ci ha limitato. Se quel buco
 * non esiste, non si scrive niente: meglio nessuna data che una stimata.
 */
UPDATE "source_health" AS sh
SET "last_rate_limit_at" = g."observed_from",
    "last_rate_limit_message" = COALESCE(sh."last_error_message", g."detail"),
    "rate_limit_count" = 1
FROM (
  SELECT "observed_from", "detail"
  FROM "data_gaps"
  WHERE "reason" = 'rate_limited'
  ORDER BY "observed_from" DESC
  LIMIT 1
) AS g
WHERE sh."source_key" = 'betexplorer'
  AND sh."last_rate_limit_at" IS NULL;
