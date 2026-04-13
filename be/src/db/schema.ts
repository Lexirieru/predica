import { pgTable, text, real, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const markets = pgTable("markets", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  question: text("question").notNull(),
  targetPrice: real("target_price").notNull(),
  currentPrice: real("current_price").notNull().default(0),
  deadline: integer("deadline").notNull(),
  category: text("category").notNull().default("crypto"),
  yesPool: real("yes_pool").notNull().default(0),
  noPool: real("no_pool").notNull().default(0),
  totalVoters: integer("total_voters").notNull().default(0),
  sentiment: real("sentiment").notNull().default(50),
  status: text("status", { enum: ["active", "expired", "settled"] }).notNull().default("active"),
  resolution: text("resolution", { enum: ["yes", "no"] }),
  createdAt: integer("created_at").notNull().default(sql`(extract(epoch from now()) * 1000)::bigint`),
  updatedAt: integer("updated_at").notNull().default(sql`(extract(epoch from now()) * 1000)::bigint`),
}, (table) => {
  return {
    statusIdx: index("idx_markets_status").on(table.status),
    deadlineIdx: index("idx_markets_deadline").on(table.deadline),
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
  createdAt: integer("created_at").notNull().default(sql`(extract(epoch from now()) * 1000)::bigint`),
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
  createdAt: integer("created_at").notNull().default(sql`(extract(epoch from now()) * 1000)::bigint`),
});

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  wallet: text("wallet").notNull(),
  type: text("type", { enum: ["deposit", "withdraw", "payout"] }).notNull(),
  amount: real("amount").notNull(),
  txSignature: text("tx_signature"),
  metadata: text("metadata"),
  status: text("status", { enum: ["pending", "confirmed", "failed"] }).notNull().default("pending"),
  createdAt: integer("created_at").notNull().default(sql`(extract(epoch from now()) * 1000)::bigint`),
}, (table) => {
  return {
    walletIdx: index("idx_tx_wallet").on(table.wallet),
  }
});
