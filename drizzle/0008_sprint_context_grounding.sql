ALTER TABLE "match_context" ADD COLUMN "detail" jsonb;--> statement-breakpoint
ALTER TABLE "match_context" ADD COLUMN "sources" jsonb;--> statement-breakpoint
ALTER TABLE "match_context" ADD COLUMN "grounded" boolean DEFAULT false NOT NULL;