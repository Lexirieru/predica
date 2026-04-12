import { getDb } from "./schema";
import { v4 as uuid } from "uuid";

export interface MarketRow {
  id: string;
  symbol: string;
  question: string;
  target_price: number;
  current_price: number;
  deadline: number;
  category: string;
  yes_pool: number;
  no_pool: number;
  total_voters: number;
  sentiment: number;
  status: string;
  resolution: string | null;
  created_at: number;
  updated_at: number;
}

export function getActiveMarkets(): MarketRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM markets WHERE status = 'active' ORDER BY deadline ASC").all() as MarketRow[];
}

export function getAllMarkets(): MarketRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM markets ORDER BY created_at DESC").all() as MarketRow[];
}

export function getMarketById(id: string): MarketRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM markets WHERE id = ?").get(id) as MarketRow | undefined;
}

export function createMarket(data: {
  symbol: string;
  question: string;
  targetPrice: number;
  currentPrice: number;
  deadline: number;
  category: string;
  sentiment?: number;
}): MarketRow {
  const db = getDb();
  const id = uuid();
  const now = Date.now();

  db.prepare(`
    INSERT INTO markets (id, symbol, question, target_price, current_price, deadline, category, sentiment, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.symbol, data.question, data.targetPrice, data.currentPrice, data.deadline, data.category, data.sentiment ?? 50, now, now);

  return getMarketById(id)!;
}

export function updateMarketPrice(id: string, price: number) {
  const db = getDb();
  db.prepare("UPDATE markets SET current_price = ?, updated_at = ? WHERE id = ?").run(price, Date.now(), id);
}

export function updateMarketSentiment(id: string, sentiment: number) {
  const db = getDb();
  db.prepare("UPDATE markets SET sentiment = ?, updated_at = ? WHERE id = ?").run(sentiment, Date.now(), id);
}

export function resolveMarket(id: string, resolution: "yes" | "no") {
  const db = getDb();
  db.prepare("UPDATE markets SET status = 'resolved', resolution = ?, updated_at = ? WHERE id = ?").run(resolution, Date.now(), id);
}

export function addToPool(id: string, side: "yes" | "no", amount: number) {
  const db = getDb();
  const col = side === "yes" ? "yes_pool" : "no_pool";
  db.prepare(`UPDATE markets SET ${col} = ${col} + ?, total_voters = total_voters + 1, updated_at = ? WHERE id = ?`).run(amount, Date.now(), id);
}

export function seedMarkets() {
  // No-op: markets are now generated from Elfa trending data
}
