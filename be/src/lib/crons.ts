import cron from "node-cron";
import { v4 as uuid } from "uuid";
import * as pacifica from "./pacifica";
import * as elfa from "./elfa";
import { marketRepo, voteRepo } from "../db/dal";
import { db } from "../db";
import { votes, users, transactions, markets } from "../db/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { broadcast } from "./websocket";

let isSettling = false;

export function startSettlementCron() {
  cron.schedule("* * * * *", async () => {
    if (isSettling) return;
    isSettling = true;

    try {
      const activeMarkets = await marketRepo.getActive();
      const now = Date.now();
      const expired = activeMarkets.filter((m) => Number(m.deadline) <= now);

      if (expired.length === 0) {
        isSettling = false;
        return;
      }

      console.log(`[Settlement] Processing ${expired.length} expired markets...`);

      let prices: Record<string, string> = {};
      let retryCount = 0;
      while (retryCount < 3) {
        try {
          const priceData = await pacifica.getPrices();
          if (priceData?.data && Array.isArray(priceData.data)) {
            for (const p of priceData.data) {
              prices[p.symbol.toUpperCase()] = p.mark;
            }
            break; 
          }
        } catch (err) {
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (Object.keys(prices).length === 0) {
        isSettling = false;
        return;
      }

      for (const market of expired) {
        const symbol = market.symbol.toUpperCase();
        const markPrice = parseFloat(prices[symbol] || "0");
        
        if (markPrice <= 0) continue;

        const resolution = markPrice > market.targetPrice ? "yes" : "no";
        const marketVotes = await voteRepo.getByMarket(market.id);
        const totalPool = market.yesPool + market.noPool;

        try {
          await db.transaction(async (tx) => {
            // Resolve market
            await marketRepo.resolve(market.id, resolution as "yes" | "no");

            broadcast("MARKET_RESOLVED", { 
              marketId: market.id, 
              resolution, 
              price: markPrice 
            });

            if (marketVotes.length > 0) {
              const winningSide = resolution;
              const winners = marketVotes.filter((v) => v.side === winningSide);
              const losers = marketVotes.filter((v) => v.side !== winningSide);
              const winnerPool = winners.reduce((sum, v) => sum + v.amount, 0);

              for (const vote of winners) {
                const share = (winnerPool > 0) ? (vote.amount / winnerPool) : 0;
                const payout = share * totalPool;
                const profit = payout - vote.amount;

                await tx.update(votes)
                  .set({ payout, status: "won" })
                  .where(eq(votes.id, vote.id));

                await tx.update(users)
                  .set({ 
                    balance: sql`${users.balance} + ${payout}`, 
                    wins: sql`${users.wins} + 1`,
                    totalPnl: sql`${users.totalPnl} + ${profit}`
                  })
                  .where(eq(users.wallet, vote.userWallet));
                
                await tx.insert(transactions).values({
                  id: uuid(),
                  wallet: vote.userWallet,
                  type: "payout",
                  amount: payout,
                  status: "confirmed",
                  metadata: JSON.stringify({ marketId: market.id, profit }),
                  createdAt: Date.now()
                });
              }

              for (const vote of losers) {
                await tx.update(votes)
                  .set({ payout: 0, status: "lost" })
                  .where(eq(votes.id, vote.id));

                await tx.update(users)
                  .set({ 
                    losses: sql`${users.losses} + 1`,
                    totalPnl: sql`${users.totalPnl} - ${vote.amount}`
                  })
                  .where(eq(users.wallet, vote.userWallet));
              }
            }
          });
          console.log(`[Settlement] SUCCESS: ${symbol} Resolved as ${resolution.toUpperCase()}`);
        } catch (txErr) {
          console.error(`[Settlement] Transaction failed for ${market.id}:`, txErr);
        }
      }
    } catch (err) {
      console.error("[Settlement] Global Error:", err);
    } finally {
      isSettling = false;
    }
  });
}

export function startPriceUpdateCron() {
  cron.schedule("*/5 * * * * *", async () => {
    try {
      const priceData = await pacifica.getPrices();
      if (!priceData?.data || !Array.isArray(priceData.data)) return;

      const activeMarkets = await marketRepo.getActive();
      const updates: Record<string, number> = {};

      for (const market of activeMarkets) {
        const p = priceData.data.find((d: { symbol: string }) => d.symbol.toUpperCase() === market.symbol.toUpperCase());
        if (p?.mark) {
          const markPrice = parseFloat(p.mark);
          await marketRepo.updatePrice(market.id, markPrice);
          updates[market.symbol] = markPrice;
        }
      }

      if (Object.keys(updates).length > 0) {
        broadcast("PRICE_UPDATE", updates);
      }
    } catch {}
  });
}

export function startMarketGeneratorCron() {
  cron.schedule("*/5 * * * *", async () => {
    await generateMarketsFromTrending();
  });
  setTimeout(() => generateMarketsFromTrending(), 5000);
}

async function generateMarketsFromTrending() {
  try {
    const [infoRes, priceRes] = await Promise.all([
      pacifica.getMarketInfo(),
      pacifica.getPrices()
    ]);

    if (!infoRes?.data || !priceRes?.data) return;

    const pacificaSymbols = new Set<string>(
      (infoRes.data as any[]).map((d) => d.symbol.toUpperCase())
    );

    const prices: Record<string, any> = {};
    if (Array.isArray(priceRes.data)) {
      for (const p of priceRes.data) {
        prices[p.symbol.toUpperCase()] = p;
      }
    }

    const activeMarkets = await marketRepo.getActive();
    const existingSymbols = new Set(activeMarkets.map(m => m.symbol.toUpperCase()));

    const trending = await elfa.getTrendingTokens("24h");
    const tokens = trending?.data?.data || [];

    let created = 0;
    const timeVariations = [1, 5, 15];

    for (const token of tokens.slice(0, 8)) {
      const symbol = token.token.toUpperCase();
      if (!pacificaSymbols.has(symbol) || existingSymbols.has(symbol)) continue;

      const currentPrice = parseFloat(prices[symbol]?.mark || "0");
      if (currentPrice <= 0) continue;

      const duration = timeVariations[Math.floor(Math.random() * timeVariations.length)];
      const deadline = Date.now() + duration * 60 * 1000;
      const question = `${symbol} Price: Higher or Lower in ${duration} min?`;

      const newMarket = await marketRepo.create({
        symbol,
        question,
        targetPrice: currentPrice,
        currentPrice,
        deadline,
        category: "crypto",
        sentiment: Math.round(token.change_percent > 0 ? 75 : 25),
      });

      broadcast("NEW_MARKET", newMarket);
      existingSymbols.add(symbol);
      created++;
    }

    if (created > 0) console.log(`[MarketGen] Created ${created} new markets.`);
  } catch (err) {
    console.error("[MarketGen] Error:", err);
  }
}
