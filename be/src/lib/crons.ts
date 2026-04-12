import cron from "node-cron";
import { v4 as uuid } from "uuid";
import * as pacifica from "./pacifica";
import * as elfa from "./elfa";
import { getActiveMarkets, resolveMarket, updateMarketPrice, updateMarketSentiment, createMarket } from "../db/markets";
import { getVotesByMarket } from "../db/votes";
import { getDb } from "../db/schema";

// --- Settlement: check expired markets every minute ---
export function startSettlementCron() {
  cron.schedule("* * * * *", async () => {
    try {
      const markets = getActiveMarkets();
      const now = Date.now();
      const expired = markets.filter((m) => m.deadline <= now);

      if (expired.length === 0) return;

      let prices: Record<string, string> = {};
      try {
        const priceData = await pacifica.getPrices();
        if (priceData?.data && Array.isArray(priceData.data)) {
          for (const p of priceData.data) {
            prices[p.symbol] = p.mark;
          }
        }
      } catch {
        console.error("[Settlement] Failed to fetch Pacifica prices");
        return;
      }

      for (const market of expired) {
        const markPrice = parseFloat(prices[market.symbol] || "0");
        if (markPrice <= 0) continue;

        // 1. Resolve: actual price > target → Yes wins
        const resolution = markPrice > market.target_price ? "yes" : "no";
        resolveMarket(market.id, resolution as "yes" | "no");

        const votes = getVotesByMarket(market.id);
        if (votes.length === 0) {
          console.log(`[Settlement] ${market.symbol}: ${market.question} → ${resolution} (no votes)`);
          continue;
        }

        // 2. Calculate payout pool
        const totalPool = market.yes_pool + market.no_pool;
        const winningSide = resolution;
        const losingSide = resolution === "yes" ? "no" : "yes";

        const winners = votes.filter((v) => v.side === winningSide);
        const losers = votes.filter((v) => v.side === losingSide);
        const winnerPool = winners.reduce((sum, v) => sum + v.amount, 0);

        const db = getDb();
        const updateVotePayout = db.prepare("UPDATE votes SET payout = ?, status = ? WHERE id = ?");
        const updateUserStats = db.prepare(`
          UPDATE users SET wins = wins + ?, losses = losses + ?, total_pnl = total_pnl + ? WHERE wallet = ?
        `);

        const settle = db.transaction(() => {
          // 3. Winners: proportional share of total pool
          for (const vote of winners) {
            const share = winnerPool > 0 ? vote.amount / winnerPool : 0;
            const payout = share * totalPool;
            const profit = payout - vote.amount;

            updateVotePayout.run(payout, "won", vote.id);
            updateUserStats.run(1, 0, profit, vote.user_wallet);
          }

          // 4. Losers: payout = 0, loss = their wager
          for (const vote of losers) {
            updateVotePayout.run(0, "lost", vote.id);
            updateUserStats.run(0, 1, -vote.amount, vote.user_wallet);
          }
        });

        settle();

        // 5. Try to close Pacifica positions (best-effort)
        try {
          // Close losing side positions: if Yes won, close shorts (ask→bid to close)
          // If No won, close longs (bid→ask to close)
          const closeSide = resolution === "yes" ? "bid" : "ask"; // opposite of losers' original
          const totalLoserAmount = losers.reduce((sum, v) => sum + v.amount, 0);
          if (totalLoserAmount > 0) {
            await pacifica.closePosition(
              market.symbol,
              totalLoserAmount.toString(),
              closeSide,
              uuid()
            );
          }
        } catch (err) {
          console.error(`[Settlement] Failed to close Pacifica positions for ${market.symbol}:`, err);
        }

        console.log(
          `[Settlement] ${market.symbol}: ${market.question} → ${resolution}` +
          ` | mark: $${markPrice} vs target: $${market.target_price}` +
          ` | pool: $${totalPool} | winners: ${winners.length} losers: ${losers.length}`
        );
      }
    } catch (err) {
      console.error("[Settlement] Error:", err);
    }
  });

  console.log("[Cron] Settlement check running every minute");
}

// --- Price updater: refresh market prices every 30s ---
export function startPriceUpdateCron() {
  cron.schedule("*/5 * * * * *", async () => {
    try {
      const priceData = await pacifica.getPrices();
      if (!priceData?.data || !Array.isArray(priceData.data)) return;

      const markets = getActiveMarkets();
      for (const market of markets) {
        const p = priceData.data.find((d: { symbol: string }) => d.symbol === market.symbol);
        if (p?.mark) {
          updateMarketPrice(market.id, parseFloat(p.mark));
        }
      }
    } catch {
      // silent
    }
  });

  console.log("[Cron] Price updates running every 5s");
}

// --- Auto-generate markets from Elfa trending tokens every 5 minutes ---
export function startMarketGeneratorCron() {
  cron.schedule("*/5 * * * *", async () => {
    await generateMarketsFromTrending();
  });

  // Also run once on startup after a delay
  setTimeout(() => generateMarketsFromTrending(), 5000);

  console.log("[Cron] Market generator running every 5 minutes");
}

async function generateMarketsFromTrending() {
  try {
    // Get Pacifica symbols
    const infoData = await pacifica.getMarketInfo();
    const pacificaSymbols = new Set<string>(
      (infoData?.data || []).map((d: { symbol: string }) => d.symbol.toUpperCase())
    );

    // Get Elfa trending tokens
    const trending = await elfa.getTrendingTokens("24h");
    const tokens = trending?.data?.data || [];

    // Get current prices
    const priceData = await pacifica.getPrices();
    const prices: Record<string, number> = {};
    if (priceData?.data && Array.isArray(priceData.data)) {
      for (const p of priceData.data) {
        prices[p.symbol.toUpperCase()] = parseFloat(p.mark);
      }
    }

    // Cross-reference: trending tokens that exist on Pacifica
    const db = getDb();
    const existingSymbols = new Set(
      (db.prepare("SELECT DISTINCT symbol FROM markets WHERE status = 'active'").all() as { symbol: string }[])
        .map((r) => r.symbol)
    );

    let created = 0;
    const DAY = 86400000;

    for (const token of tokens.slice(0, 10)) {
      const symbol = token.token.toUpperCase();

      // Skip if not on Pacifica or already has active market
      if (!pacificaSymbols.has(symbol)) continue;
      if (existingSymbols.has(symbol)) continue;

      const currentPrice = prices[symbol];
      if (!currentPrice || currentPrice <= 0) continue;

      // Polymarket-style: target = snapshot price at creation (Price To Beat)
      const targetPrice = currentPrice;

      // Deadline: 5 minutes from now
      const deadline = Date.now() + 5 * 60 * 1000;

      // Sentiment from change_percent
      const sentiment = token.change_percent > 0
        ? Math.min(80, 50 + token.change_percent * 0.5)
        : Math.max(20, 50 + token.change_percent * 0.5);

      const question = `${symbol} Up or Down - 5 Minutes`;

      createMarket({
        symbol,
        question,
        targetPrice,
        currentPrice,
        deadline,
        category: "crypto",
        sentiment: Math.round(sentiment),
      });

      existingSymbols.add(symbol);
      created++;
      if (created >= 10) break; // max 10 new markets per cycle
    }

    if (created > 0) {
      console.log(`[MarketGen] Created ${created} new markets from Elfa trending data`);
    }
  } catch (err) {
    console.error("[MarketGen] Error:", err);
  }
}
