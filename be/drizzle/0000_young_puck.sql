CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"question" text NOT NULL,
	"target_price" real NOT NULL,
	"current_price" real DEFAULT 0 NOT NULL,
	"deadline" bigint NOT NULL,
	"category" text DEFAULT 'crypto' NOT NULL,
	"yes_pool" real DEFAULT 0 NOT NULL,
	"no_pool" real DEFAULT 0 NOT NULL,
	"total_voters" integer DEFAULT 0 NOT NULL,
	"sentiment" real DEFAULT 50 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"resolution" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"type" text NOT NULL,
	"amount" real NOT NULL,
	"tx_signature" text,
	"metadata" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"wallet" text PRIMARY KEY NOT NULL,
	"balance" real DEFAULT 0 NOT NULL,
	"total_deposits" real DEFAULT 0 NOT NULL,
	"total_withdrawals" real DEFAULT 0 NOT NULL,
	"total_votes" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"total_wagered" real DEFAULT 0 NOT NULL,
	"total_pnl" real DEFAULT 0 NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"user_wallet" text NOT NULL,
	"side" text NOT NULL,
	"amount" real NOT NULL,
	"payout" real DEFAULT 0 NOT NULL,
	"order_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_markets_status_deadline" ON "markets" USING btree ("status","deadline");--> statement-breakpoint
CREATE INDEX "idx_tx_wallet" ON "transactions" USING btree ("wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tx_signature" ON "transactions" USING btree ("tx_signature");--> statement-breakpoint
CREATE INDEX "idx_votes_market" ON "votes" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "idx_votes_user_wallet" ON "votes" USING btree ("user_wallet");