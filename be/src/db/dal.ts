import { db } from "./index";
import { markets, votes, users } from "./schema";
import { eq, asc, desc, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";

/**
 * --- MARKET DATA ACCESS ---
 */

export const marketRepo = {
  async getActive() {
    return await db.query.markets.findMany({
      where: eq(markets.status, "active"),
      orderBy: [asc(markets.deadline)],
    });
  },

  async getById(id: string) {
    return await db.query.markets.findFirst({ where: eq(markets.id, id) });
  },

  async create(data: any) {
    const [newMarket] = await db.insert(markets).values({
      id: uuid(),
      ...data,
      sentiment: data.sentiment ?? 50,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).returning();
    return newMarket;
  },

  async updatePrice(id: string, price: number) {
    await db.update(markets).set({ currentPrice: price, updatedAt: Date.now() }).where(eq(markets.id, id));
  },

  async resolve(id: string, resolution: "yes" | "no") {
    await db.update(markets).set({ status: "settled", resolution, updatedAt: Date.now() }).where(eq(markets.id, id));
  },

  async addToPool(id: string, side: "yes" | "no", amount: number) {
    const field = side === "yes" ? markets.yesPool : markets.noPool;
    await db.update(markets)
      .set({ 
        [side === "yes" ? "yesPool" : "noPool"]: sql`${field} + ${amount}`,
        totalVoters: sql`${markets.totalVoters} + 1`,
        updatedAt: Date.now() 
      })
      .where(eq(markets.id, id));
  }
};

/**
 * --- VOTE & USER DATA ACCESS ---
 */

export const voteRepo = {
  async create(data: { marketId: string; userWallet: string; side: "yes" | "no"; amount: number; orderId?: string }) {
    const id = uuid();
    await db.transaction(async (tx) => {
      await tx.insert(votes).values({ id, ...data });
      await marketRepo.addToPool(data.marketId, data.side, data.amount);
      await tx.insert(users).values({
        wallet: data.userWallet,
        totalVotes: 1,
        totalWagered: data.amount,
      }).onConflictDoUpdate({
        target: users.wallet,
        set: {
          totalVotes: sql`${users.totalVotes} + 1`,
          totalWagered: sql`${users.totalWagered} + ${data.amount}`,
        },
      });
    });
    return await db.query.votes.findFirst({ where: eq(votes.id, id) });
  },

  async getByMarket(marketId: string) {
    return await db.query.votes.findMany({ where: eq(votes.marketId, marketId), orderBy: [desc(votes.createdAt)] });
  },

  async getByUser(wallet: string) {
    return await db.query.votes.findMany({ where: eq(votes.userWallet, wallet), orderBy: [desc(votes.createdAt)] });
  }
};

/**
 * --- USER & STATS DATA ACCESS ---
 */

export const userRepo = {
  async getLeaderboard(limit: number = 20) {
    return await db.query.users.findMany({ orderBy: [desc(users.wins), desc(users.totalPnl)], limit });
  },
  
  async getByWallet(wallet: string) {
    return await db.query.users.findFirst({ where: eq(users.wallet, wallet) });
  }
};
