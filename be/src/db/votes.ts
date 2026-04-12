import { getDb } from "./schema";
import { v4 as uuid } from "uuid";
import { addToPool } from "./markets";

export interface VoteRow {
  id: string;
  market_id: string;
  user_wallet: string;
  side: string;
  amount: number;
  order_id: string | null;
  status: string;
  created_at: number;
}

export function createVote(data: {
  marketId: string;
  userWallet: string;
  side: "yes" | "no";
  amount: number;
  orderId?: string;
}): VoteRow {
  const db = getDb();
  const id = uuid();

  db.prepare(`
    INSERT INTO votes (id, market_id, user_wallet, side, amount, order_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'confirmed')
  `).run(id, data.marketId, data.userWallet, data.side, data.amount, data.orderId ?? null);

  // Update pool
  addToPool(data.marketId, data.side, data.amount);

  // Upsert user
  db.prepare(`
    INSERT INTO users (wallet, total_votes, total_wagered)
    VALUES (?, 1, ?)
    ON CONFLICT(wallet) DO UPDATE SET
      total_votes = total_votes + 1,
      total_wagered = total_wagered + ?
  `).run(data.userWallet, data.amount, data.amount);

  return db.prepare("SELECT * FROM votes WHERE id = ?").get(id) as VoteRow;
}

export function getVotesByMarket(marketId: string): VoteRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM votes WHERE market_id = ? ORDER BY created_at DESC").all(marketId) as VoteRow[];
}

export function getVotesByUser(wallet: string): VoteRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM votes WHERE user_wallet = ? ORDER BY created_at DESC").all(wallet) as VoteRow[];
}

export function getLeaderboard(limit: number = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT wallet, total_votes, wins, losses, total_wagered, total_pnl
    FROM users
    ORDER BY wins DESC, total_pnl DESC
    LIMIT ?
  `).all(limit);
}
