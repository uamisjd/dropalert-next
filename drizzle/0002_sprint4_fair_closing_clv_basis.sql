ALTER TABLE "closing_lines" ADD COLUMN "fair_closing_price" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "closing_lines" ADD COLUMN "fair_closing_prob" numeric(7, 6);--> statement-breakpoint
ALTER TABLE "closing_lines" ADD COLUMN "market_margin" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "clv_records" ADD COLUMN "closing_basis" text DEFAULT 'raw_consensus' NOT NULL;--> statement-breakpoint
ALTER TABLE "clv_records" ADD COLUMN "market_margin" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "clv_records" ADD COLUMN "signal_score" numeric(5, 2);