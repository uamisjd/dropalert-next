ALTER TABLE "source_health" ADD COLUMN "cooldown_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_health" ADD COLUMN "cooldown_level" integer DEFAULT 0 NOT NULL;