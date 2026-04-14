import { db } from "./index";
import { markets, votes, users } from "./schema";
import { eq, asc, desc, sql, and, gte } from "drizzle-orm";
import { v4 as uuid } from "uuid";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  async getAll(limit = 200) {
    return await db.query.markets.findMany({
      orderBy: [desc(markets.createdAt)],
      limit,
    });
  },
  async getById(id: string) {
    return await db.query.markets.findFirst({ where: eq(markets.id, id) });
  },

  async hasActiveForSymbol(symbol: string): Promise<boolean> {
    const existing = await db.query.markets.findFirst({
      where: and(eq(markets.symbol, symbol), eq(markets.status, "active")),
      columns: { id: true },
    });
    return !!existing;
  },

  async create(data: any) {
    const [newMarket] = await db
      .insert(markets)
      .values({
        id: uuid(),
        ...data,
        sentiment: data.sentiment ?? 50,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning();
    return newMarket;
  },

  async updatePrice(id: string, price: number) {
    await db
      .update(markets)
      .set({ currentPrice: price, updatedAt: Date.now() })
      .where(eq(markets.id, id));
  },

  /**
   * Conditional resolve: only transitions "active" → "settled".
   * Returns true if this call won the race and actually transitioned the row.
   * Caller must treat a `false` return as "already settled — skip payout logic".
   */
  async resolve(id: string, resolution: "yes" | "no", exec: Executor = db): Promise<boolean> {
    const result = await exec
      .update(markets)
      .set({ status: "settled", resolution, updatedAt: Date.now() })
      .where(and(eq(markets.id, id), eq(markets.status, "active")))
      .returning({ id: markets.id });
    return result.length > 0;
  },

  async addToPool(
    id: string,
    side: "yes" | "no",
    amount: number,
    exec: Executor = db,
  ) {
    const field = side === "yes" ? markets.yesPool : markets.noPool;
    await exec
      .update(markets)
      .set({
        [side === "yes" ? "yesPool" : "noPool"]: sql`${field} + ${amount}`,
        totalVoters: sql`${markets.totalVoters} + 1`,
        updatedAt: Date.now(),
      })
      .where(eq(markets.id, id));
  },
};

/**
 * --- VOTE & USER DATA ACCESS ---
 *
 * IMPORTANT: create() requires an active transaction executor (tx) from the caller.
 * This guarantees balance-debit, vote-insert, pool-update, and user-upsert commit atomically.
 */

export const voteRepo = {
  async create(
    tx: Executor,
    data: {
      marketId: string;
      userWallet: string;
      side: "yes" | "no";
      amount: number;
      orderId?: string;
    },
  ) {
    const id = uuid();
    await tx.insert(votes).values({ id, ...data });
    await marketRepo.addToPool(data.marketId, data.side, data.amount, tx);
    await tx
      .insert(users)
      .values({
        wallet: data.userWallet,
        totalVotes: 1,
        totalWagered: data.amount,
      })
      .onConflictDoUpdate({
        target: users.wallet,
        set: {
          totalVotes: sql`${users.totalVotes} + 1`,
          totalWagered: sql`${users.totalWagered} + ${data.amount}`,
        },
      });
    const row = await tx.query.votes.findFirst({ where: eq(votes.id, id) });
    return row;
  },

  async getByMarket(marketId: string) {
    return await db.query.votes.findMany({
      where: eq(votes.marketId, marketId),
      orderBy: [desc(votes.createdAt)],
    });
  },

  async getByUser(wallet: string) {
    // Join markets to save FE an extra /api/markets/all lookup just to resolve
    // market_id → symbol/question for the vote history.
    return await db
      .select({
        id: votes.id,
        marketId: votes.marketId,
        userWallet: votes.userWallet,
        side: votes.side,
        amount: votes.amount,
        payout: votes.payout,
        orderId: votes.orderId,
        status: votes.status,
        createdAt: votes.createdAt,
        marketSymbol: markets.symbol,
        marketQuestion: markets.question,
        marketTargetPrice: markets.targetPrice,
        marketResolution: markets.resolution,
        marketDeadline: markets.deadline,
        marketStatus: markets.status,
      })
      .from(votes)
      .leftJoin(markets, eq(votes.marketId, markets.id))
      .where(eq(votes.userWallet, wallet))
      .orderBy(desc(votes.createdAt));
  },
};

/**
 * --- USER & STATS DATA ACCESS ---
 */

export const userRepo = {
  async getLeaderboard(limit: number = 20) {
    return await db.query.users.findMany({
      orderBy: [desc(users.wins), desc(users.totalPnl)],
      limit,
    });
  },

  async getByWallet(wallet: string) {
    return await db.query.users.findFirst({ where: eq(users.wallet, wallet) });
  },

  /**
   * Atomic balance debit. Returns true if debit succeeded (user had sufficient balance).
   * Uses conditional UPDATE to prevent TOCTOU race where two concurrent votes both pass the check.
   */
  async tryDebit(
    tx: Executor,
    wallet: string,
    amount: number,
  ): Promise<boolean> {
    const result = await tx
      .update(users)
      .set({ balance: sql`${users.balance} - ${amount}` })
      .where(and(eq(users.wallet, wallet), gte(users.balance, amount)))
      .returning({ wallet: users.wallet });
    return result.length > 0;
  },
};
