import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DATABASE_URL || "./predica.db";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(path.resolve(DB_PATH));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initTables(db);
  }
  return db;
}

function initTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      question TEXT NOT NULL,
      target_price REAL NOT NULL,
      current_price REAL NOT NULL DEFAULT 0,
      deadline INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'crypto',
      yes_pool REAL NOT NULL DEFAULT 0,
      no_pool REAL NOT NULL DEFAULT 0,
      total_voters INTEGER NOT NULL DEFAULT 0,
      sentiment REAL NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'active',
      resolution TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL REFERENCES markets(id),
      user_wallet TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('yes', 'no')),
      amount REAL NOT NULL,
      payout REAL NOT NULL DEFAULT 0,
      order_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
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
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('deposit', 'withdraw')),
      amount REAL NOT NULL,
      tx_signature TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_votes_market ON votes(market_id);
    CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_wallet);
    CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
    CREATE INDEX IF NOT EXISTS idx_markets_deadline ON markets(deadline);
    CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transactions(wallet);
  `);
}
