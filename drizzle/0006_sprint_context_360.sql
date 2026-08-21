CREATE TABLE "match_context" (
	"match_id" integer PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"model" text,
	"livello_categorie" text,
	"anomalia_campo" text,
	"posta_in_palo" text,
	"rotazioni_fatica" text,
	"accordo_col_drop" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_context" ADD CONSTRAINT "match_context_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_context_expires_idx" ON "match_context" USING btree ("expires_at");