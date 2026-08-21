CREATE TABLE "news_fetch" (
	"match_id" integer PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"items_count" integer DEFAULT 0 NOT NULL,
	"language" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"title" text NOT NULL,
	"source" text,
	"published_at" timestamp with time zone,
	"link" text NOT NULL,
	"language" text NOT NULL,
	"query" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_fetch" ADD CONSTRAINT "news_fetch_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "news_items_match_link_uq" ON "news_items" USING btree ("match_id","link");--> statement-breakpoint
CREATE INDEX "news_items_match_idx" ON "news_items" USING btree ("match_id");