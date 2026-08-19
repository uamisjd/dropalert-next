CREATE TYPE "public"."source_status" AS ENUM('ok', 'degraded', 'blocked', 'disabled', 'unknown');--> statement-breakpoint
CREATE TABLE "source_health" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"label" text NOT NULL,
	"status" "source_status" DEFAULT 'unknown' NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"avg_latency_ms" integer,
	"last_latency_ms" integer,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"partial_count" integer DEFAULT 0 NOT NULL,
	"consecutive_errors" integer DEFAULT 0 NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drop_signals" ADD COLUMN "detected_price" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "drop_signals" ADD COLUMN "detected_prob" numeric(7, 6);--> statement-breakpoint
CREATE UNIQUE INDEX "source_health_key_uq" ON "source_health" USING btree ("source_key");