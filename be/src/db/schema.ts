import { pgTable, text, real, integer, bigint, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const tsDefault = sql`(extract(epoch from now()) * 1000)::bigint`;

export const markets = pgTable("markets", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  question: text("question").notNull(),
  targetPrice: real("target_price").notNull(),
  currentPrice: real("current_price").notNull().default(0),
  deadline: bigint("deadline", { mode: "number" }).notNull(),
  category: text("category").notNull().default("crypto"),
  yesPool: real("yes_pool").notNull().default(0),
  noPool: real("no_pool").notNull().default(0),
  totalVoters: integer("total_voters").notNull().default(0),
  sentiment: real("sentiment").notNull().default(50),
  status: text("status", { enum: ["upcoming", "active", "expired", "settled"] }).notNull().default("active"),
  resolution: text("resolution", { enum: ["yes", "no"] }),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(tsDefault),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(tsDefault),
}, (table) => {
  return {
    statusDeadlineIdx: index("idx_markets_status_deadline").on(table.status, table.deadline),
  }
});

export const votes = pgTable("votes", {
  id: text("id").primaryKey(),
  marketId: text("market_id").notNull().references(() => markets.id),
  userWallet: text("user_wallet").notNull(),
  side: text("side", { enum: ["yes", "no"] }).notNull(),
  amount: real("amount").notNull(),
  payout: real("payout").notNull().default(0),
  orderId: text("order_id"),
  status: text("status", { enum: ["pending", "won", "lost"] }).notNull().default("pending"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(tsDefault),
}, (table) => {
  return {
    marketIdx: index("idx_votes_market").on(table.marketId),
    userWalletIdx: index("idx_votes_user_wallet").on(table.userWallet),
  }
});

export const users = pgTable("users", {
  wallet: text("wallet").primaryKey(),
  balance: real("balance").notNull().default(0),
  totalDeposits: real("total_deposits").notNull().default(0),
  totalWithdrawals: real("total_withdrawals").notNull().default(0),
  totalVotes: integer("total_votes").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  totalWagered: real("total_wagered").notNull().default(0),
  totalPnl: real("total_pnl").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(tsDefault),
});

// Persistent OHLC history keyed by (symbol, interval, openTime). Backfills the
// chart after BE restart and feeds the "timeline" view where old buckets still
// need price context. Rows older than CANDLE_RETENTION_DAYS are pruned by a cron.
export const candleSnapshots = pgTable("candle_snapshots", {
  symbol: text("symbol").notNull(),
  interval: text("interval").notNull(),
  openTime: bigint("open_time", { mode: "number" }).notNull(),
  closeTime: bigint("close_time", { mode: "number" }).notNull(),
  open: real("open").notNull(),
  close: real("close").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  volume: real("volume").notNull().default(0),
  trades: integer("trades").notNull().default(0),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(tsDefault),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.symbol, table.interval, table.openTime] }),
    symbolTimeIdx: index("idx_candle_symbol_time").on(table.symbol, table.openTime),
    openTimeIdx: index("idx_candle_open_time").on(table.openTime),
  }
});

// Gamification: earned badges per wallet. `badgeType` is a stable enum id
// that the FE maps to icon + label. `metadata` carries optional context
// (e.g. streak length, bet amount that triggered the badge).
export const achievements = pgTable("achievements", {
  id: text("id").primaryKey(),
  wallet: text("wallet").notNull(),
  badgeType: text("badge_type").notNull(),
  unlockedAt: bigint("unlocked_at", { mode: "number" }).notNull().default(tsDefault),
  metadata: text("metadata"),
}, (table) => {
  return {
    walletIdx: index("idx_achievements_wallet").on(table.wallet),
    walletBadgeUnique: uniqueIndex("uq_achievement_wallet_badge").on(table.wallet, table.badgeType),
  }
});

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  wallet: text("wallet").notNull(),
  type: text("type", { enum: ["deposit", "withdraw", "payout"] }).notNull(),
  amount: real("amount").notNull(),
  txSignature: text("tx_signature"),
  metadata: text("metadata"),
  status: text("status", { enum: ["pending", "confirmed", "failed"] }).notNull().default("pending"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(tsDefault),
}, (table) => {
  return {
    walletIdx: index("idx_tx_wallet").on(table.wallet),
    txSigIdx: uniqueIndex("uq_tx_signature").on(table.txSignature),
  }
});
