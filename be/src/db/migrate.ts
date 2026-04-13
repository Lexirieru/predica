import { db } from "./index";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("[Migration] Running Drizzle migrations (raw schema sync)...");

  // For Supabase/Postgres, we can use db.execute to ensure tables exist
  // In a real production app, we should use drizzle-kit push
  try {
    // Basic table creation if they don't exist
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS markets (
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

      CREATE TABLE IF NOT EXISTS users (
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

      CREATE TABLE IF NOT EXISTS votes (
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

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        tx_signature TEXT,
        metadata TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
      );

      CREATE INDEX IF NOT EXISTS idx_votes_market ON votes(market_id);
      CREATE INDEX IF NOT EXISTS idx_votes_user_wallet ON votes(user_wallet);
      CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
      CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transactions(wallet);
    `);
    console.log("[Migration] SUCCESS: Schema synchronized.");
  } catch (err) {
    console.error("[Migration] FAILED:", err);
  }
}

migrate();
