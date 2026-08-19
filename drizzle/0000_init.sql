CREATE TYPE "public"."confidence_band" AS ENUM('insufficient_data', 'low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."gap_reason" AS ENUM('provider_unavailable', 'market_not_offered', 'bookmaker_missing', 'stale_snapshot', 'parse_error', 'rate_limited');--> statement-breakpoint
CREATE TYPE "public"."magnitude_class" AS ENUM('noise', 'moderate', 'high', 'very_high');--> statement-breakpoint
CREATE TYPE "public"."market_type" AS ENUM('1x2', 'ou_2_5', 'btts');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'live', 'finished', 'postponed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."selection_code" AS ENUM('home', 'draw', 'away', 'over', 'under', 'yes', 'no');--> statement-breakpoint
CREATE TYPE "public"."signal_status" AS ENUM('forming', 'active', 'rebounded', 'closed', 'expired');--> statement-breakpoint
CREATE TABLE "bookmakers" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_sharp" boolean DEFAULT false NOT NULL,
	"weight" numeric(4, 3) DEFAULT '1.000' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "closing_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"bookmaker_id" integer NOT NULL,
	"market" "market_type" NOT NULL,
	"selection" "selection_code" NOT NULL,
	"closing_price" numeric(8, 3) NOT NULL,
	"closing_prob" numeric(7, 6) NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"minutes_before_kickoff" integer
);
--> statement-breakpoint
CREATE TABLE "clv_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_id" integer NOT NULL,
	"match_id" integer NOT NULL,
	"signal_price" numeric(8, 3) NOT NULL,
	"closing_price" numeric(8, 3) NOT NULL,
	"clv_pp" numeric(6, 2) NOT NULL,
	"clv_pct" numeric(7, 3) NOT NULL,
	"beat_close" boolean NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collector_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"collector_key" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"matches_seen" integer DEFAULT 0 NOT NULL,
	"snapshots_written" integer DEFAULT 0 NOT NULL,
	"signals_touched" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"errors" jsonb,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "data_gaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer,
	"bookmaker_id" integer,
	"market" "market_type",
	"reason" "gap_reason" NOT NULL,
	"detail" text,
	"observed_from" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_to" timestamp with time zone,
	"resolved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drop_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"market" "market_type" NOT NULL,
	"selection" "selection_code" NOT NULL,
	"opening_price" numeric(8, 3) NOT NULL,
	"current_price" numeric(8, 3) NOT NULL,
	"opening_prob" numeric(7, 6) NOT NULL,
	"current_prob" numeric(7, 6) NOT NULL,
	"delta_pp" numeric(6, 2) NOT NULL,
	"magnitude_class" "magnitude_class" NOT NULL,
	"books_total" integer NOT NULL,
	"books_confirming" integer NOT NULL,
	"coordination_score" numeric(4, 3) NOT NULL,
	"sharp_available" boolean DEFAULT false NOT NULL,
	"sharp_confirms" boolean,
	"sharp_delta_pp" numeric(6, 2),
	"first_move_at" timestamp with time zone NOT NULL,
	"last_move_at" timestamp with time zone NOT NULL,
	"sustained_minutes" integer DEFAULT 0 NOT NULL,
	"is_flash" boolean DEFAULT false NOT NULL,
	"rebounded" boolean DEFAULT false NOT NULL,
	"retracement_ratio" numeric(4, 3),
	"confidence_score" numeric(5, 2) NOT NULL,
	"confidence_band" "confidence_band" NOT NULL,
	"data_coverage" numeric(4, 3) DEFAULT '0.000' NOT NULL,
	"explanation" jsonb NOT NULL,
	"status" "signal_status" DEFAULT 'forming' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"engine_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"tier" integer,
	"external_ref" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"league_id" integer NOT NULL,
	"home_team_id" integer NOT NULL,
	"away_team_id" integer NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"status" "match_status" DEFAULT 'scheduled' NOT NULL,
	"external_ref" text,
	"home_goals" integer,
	"away_goals" integer,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odds_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"bookmaker_id" integer NOT NULL,
	"market" "market_type" NOT NULL,
	"selection" "selection_code" NOT NULL,
	"price" numeric(8, 3) NOT NULL,
	"implied_prob" numeric(7, 6) NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"run_id" integer
);
--> statement-breakpoint
CREATE TABLE "signal_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"delta_pp" numeric(6, 2),
	"confidence_score" numeric(5, 2),
	"note" text,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "system_state" (
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_state_key_pk" PRIMARY KEY("key")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"country" text,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "closing_lines" ADD CONSTRAINT "closing_lines_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_lines" ADD CONSTRAINT "closing_lines_bookmaker_id_bookmakers_id_fk" FOREIGN KEY ("bookmaker_id") REFERENCES "public"."bookmakers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clv_records" ADD CONSTRAINT "clv_records_signal_id_drop_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."drop_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clv_records" ADD CONSTRAINT "clv_records_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_gaps" ADD CONSTRAINT "data_gaps_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_gaps" ADD CONSTRAINT "data_gaps_bookmaker_id_bookmakers_id_fk" FOREIGN KEY ("bookmaker_id") REFERENCES "public"."bookmakers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_signals" ADD CONSTRAINT "drop_signals_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_bookmaker_id_bookmakers_id_fk" FOREIGN KEY ("bookmaker_id") REFERENCES "public"."bookmakers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_events" ADD CONSTRAINT "signal_events_signal_id_drop_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."drop_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookmakers_key_uq" ON "bookmakers" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "closing_lines_uq" ON "closing_lines" USING btree ("match_id","bookmaker_id","market","selection");--> statement-breakpoint
CREATE INDEX "closing_lines_match_idx" ON "closing_lines" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clv_signal_uq" ON "clv_records" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "clv_match_idx" ON "clv_records" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "collector_runs_key_idx" ON "collector_runs" USING btree ("collector_key","started_at");--> statement-breakpoint
CREATE INDEX "data_gaps_match_idx" ON "data_gaps" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "data_gaps_resolved_idx" ON "data_gaps" USING btree ("resolved");--> statement-breakpoint
CREATE UNIQUE INDEX "drop_signals_uq" ON "drop_signals" USING btree ("match_id","market","selection");--> statement-breakpoint
CREATE INDEX "drop_signals_status_idx" ON "drop_signals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "drop_signals_detected_idx" ON "drop_signals" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "drop_signals_confidence_idx" ON "drop_signals" USING btree ("confidence_score");--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_key_uq" ON "leagues" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_key_uq" ON "matches" USING btree ("key");--> statement-breakpoint
CREATE INDEX "matches_kickoff_idx" ON "matches" USING btree ("kickoff_at");--> statement-breakpoint
CREATE INDEX "matches_league_idx" ON "matches" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "matches_status_idx" ON "matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "odds_match_market_idx" ON "odds_snapshots" USING btree ("match_id","market","selection");--> statement-breakpoint
CREATE INDEX "odds_collected_idx" ON "odds_snapshots" USING btree ("collected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "odds_dedupe_uq" ON "odds_snapshots" USING btree ("match_id","bookmaker_id","market","selection","collected_at");--> statement-breakpoint
CREATE INDEX "signal_events_signal_idx" ON "signal_events" USING btree ("signal_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_key_uq" ON "teams" USING btree ("key");