import { db } from "./index";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("[Migration] Running Drizzle migrations (raw schema sync)...");
  
  try {
    // Basic table creation with IF NOT EXISTS using DO block for Postgres safety
    await db.execute(sql`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename  = 'markets') THEN
          CREATE TABLE markets (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            question TEXT NOT NULL,
            target_price REAL NOT NULL,
            current_price REAL NOT NULL DEFAULT 0,
            deadline BIGINT NOT NULL,
            category TEXT NOT NULL DEFAULT 'crypto',
            yes_pool REAL NOT NULL DEFAULT 0,
            no_pool REAL NOT NULL DEFAULT 0,
            total_voters INTEGER NOT NULL DEFAULT 0,
            sentiment REAL NOT NULL DEFAULT 50,
            status TEXT NOT NULL DEFAULT 'active',
            resolution TEXT,
            created_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
            updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
          );
        END IF;

        IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename  = 'users') THEN
          CREATE TABLE users (
            wallet TEXT PRIMARY KEY,
            balance REAL NOT NULL DEFAULT 0,
            total_deposits REAL NOT NULL DEFAULT 0,
            total_withdrawals REAL NOT NULL DEFAULT 0,
            total_votes INTEGER NOT NULL DEFAULT 0,
            wins INTEGER NOT NULL DEFAULT 0,
            losses INTEGER NOT NULL DEFAULT 0,
            total_wagered REAL NOT NULL DEFAULT 0,
            total_pnl REAL NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
          );
        END IF;

        IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename  = 'votes') THEN
          CREATE TABLE votes (
            id TEXT PRIMARY KEY,
            market_id TEXT NOT NULL REFERENCES markets(id),
            user_wallet TEXT NOT NULL,
            side TEXT NOT NULL,
            amount REAL NOT NULL,
            payout REAL NOT NULL DEFAULT 0,
            order_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
          );
        END IF;

        IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename  = 'candle_snapshots') THEN
          CREATE TABLE candle_snapshots (
            symbol TEXT NOT NULL,
            interval TEXT NOT NULL,
            open_time BIGINT NOT NULL,
            close_time BIGINT NOT NULL,
            open REAL NOT NULL,
            close REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            volume REAL NOT NULL DEFAULT 0,
            trades INTEGER NOT NULL DEFAULT 0,
            updated_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
            PRIMARY KEY (symbol, interval, open_time)
          );
        END IF;

        IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename  = 'achievements') THEN
          CREATE TABLE achievements (
            id TEXT PRIMARY KEY,
            wallet TEXT NOT NULL,
            badge_type TEXT NOT NULL,
            unlocked_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
            metadata TEXT
          );
        END IF;

        IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename  = 'transactions') THEN
          CREATE TABLE transactions (
            id TEXT PRIMARY KEY,
            wallet TEXT NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            tx_signature TEXT,
            metadata TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
          );
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_votes_market ON votes(market_id);
      CREATE INDEX IF NOT EXISTS idx_votes_user_wallet ON votes(user_wallet);
      CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
      CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transactions(wallet);
      CREATE INDEX IF NOT EXISTS idx_candle_symbol_time ON candle_snapshots(symbol, open_time);
      CREATE INDEX IF NOT EXISTS idx_candle_open_time ON candle_snapshots(open_time);
      CREATE INDEX IF NOT EXISTS idx_achievements_wallet ON achievements(wallet);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_achievement_wallet_badge ON achievements(wallet, badge_type);
    `);
    console.log("[Migration] SUCCESS: Schema synchronized.");
  } catch (err) {
    console.error("[Migration] FAILED:", err);
  }
}

migrate();
