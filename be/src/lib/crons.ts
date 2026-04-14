import cron from "node-cron";
import { v4 as uuid } from "uuid";
import * as pacifica from "./pacifica";
import * as elfa from "./elfa";
import { marketRepo, voteRepo } from "../db/dal";
import { db } from "../db";
import { votes, users, transactions, markets } from "../db/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { broadcast } from "./websocket";
import {
  startPacificaWs,
  onPrices,
  onCandle,
  syncCandleSubscriptions,
  type PriceTick,
  type CandleTick,
} from "./pacificaWs";
import { pushCandle } from "./candleCache";

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
            // Conditional transition active → settled. If another process/instance
            // already settled this market, we bail out without touching payouts.
            const won = await marketRepo.resolve(market.id, resolution as "yes" | "no", tx);
            if (!won) {
              console.log(`[Settlement] ${symbol} already settled by another worker — skip.`);
              return;
            }

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

// Throttle DB writes per symbol to at most once per BROADCAST_INTERVAL_MS.
// Pacifica streams price ticks frequently (often sub-second); writing every
// tick would hammer the DB. Broadcast over our WS stays real-time.
const BROADCAST_INTERVAL_MS = 1_000;
const lastPersist: Record<string, number> = {};

export function startPriceStream() {
  onPrices(async (ticks: PriceTick[]) => {
    try {
      const activeMarkets = await marketRepo.getActive();
      if (activeMarkets.length === 0) return;

      const priceMap: Record<string, number> = {};
      for (const t of ticks) {
        const sym = t.symbol.toUpperCase();
        const mark = parseFloat(t.mark);
        if (mark > 0) priceMap[sym] = mark;
      }

      const updates: Record<string, number> = {};
      const now = Date.now();

      for (const market of activeMarkets) {
        const sym = market.symbol.toUpperCase();
        const mark = priceMap[sym];
        if (!mark) continue;

        updates[sym] = mark;

        if (now - (lastPersist[sym] || 0) >= BROADCAST_INTERVAL_MS) {
          lastPersist[sym] = now;
          marketRepo.updatePrice(market.id, mark).catch(() => {});
        }
      }

      if (Object.keys(updates).length > 0) {
        broadcast("PRICE_UPDATE", updates);
      }
    } catch {}
  });

  onCandle((tick: CandleTick) => {
    pushCandle(tick);
    broadcast("CANDLE_UPDATE", {
      symbol: tick.symbol,
      interval: tick.interval,
      openTime: tick.openTime,
      closeTime: tick.closeTime,
      open: parseFloat(tick.open),
      close: parseFloat(tick.close),
      high: parseFloat(tick.high),
      low: parseFloat(tick.low),
      volume: parseFloat(tick.volume),
      trades: tick.trades,
    });
  });

  startPacificaWs();

  // Initial candle sub + periodic reconcile in case market set drifts
  syncCandleForActive();
  setInterval(syncCandleForActive, 30_000);
}

async function syncCandleForActive() {
  try {
    const active = await marketRepo.getActive();
    const symbols = Array.from(new Set(active.map((m) => m.symbol.toUpperCase())));
    syncCandleSubscriptions(symbols);
  } catch {}
}

export function startMarketGeneratorCron() {
  cron.schedule("*/5 * * * *", async () => {
    await generateMarketsFromTrending();
  });
  setTimeout(() => generateMarketsFromTrending(), 5000);
}

const CURATED_SYMBOLS = [
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX",
  "SUI", "LINK", "LTC", "TON", "AAVE", "NEAR", "ARB", "UNI",
  "HYPE", "TAO", "JUP", "WLD", "TRUMP", "PUMP", "BCH", "XMR",
];

const CURATED_PER_BATCH = 6;
const TRENDING_PER_BATCH = 4;
const TRENDING_SCAN_LIMIT = 30;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const MARKET_DURATION_MIN = 5;

async function createMarketForSymbol(
  symbol: string,
  prices: Record<string, any>,
  sentiment: number,
): Promise<boolean> {
  const currentPrice = parseFloat(prices[symbol]?.mark || "0");
  if (currentPrice <= 0) return false;

  const deadline = Date.now() + MARKET_DURATION_MIN * 60 * 1000;
  const question = `${symbol} Price: Higher or Lower in ${MARKET_DURATION_MIN} min?`;

  const newMarket = await marketRepo.create({
    symbol,
    question,
    targetPrice: currentPrice,
    currentPrice,
    deadline,
    category: "crypto",
    sentiment,
  });

  broadcast("NEW_MARKET", newMarket);
  return true;
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
    const pickedSymbols = new Set(activeMarkets.map(m => m.symbol.toUpperCase()));

    let created = 0;

    // 1) Curated slots — guaranteed major coins, randomized each batch
    const curatedPool = shuffle(
      CURATED_SYMBOLS.filter(s => pacificaSymbols.has(s) && !pickedSymbols.has(s))
    );
    for (const symbol of curatedPool) {
      if (created >= CURATED_PER_BATCH) break;
      const ok = await createMarketForSymbol(symbol, prices, 50);
      if (ok) {
        pickedSymbols.add(symbol);
        created++;
      }
    }

    // 2) Trending slots — fill remainder with Elfa AI trending tokens
    const trending = await elfa.getTrendingTokens("24h");
    const tokens = trending?.data?.data || [];

    let trendingAdded = 0;
    for (const token of tokens.slice(0, TRENDING_SCAN_LIMIT)) {
      if (trendingAdded >= TRENDING_PER_BATCH) break;
      const symbol = token.token.toUpperCase();
      if (!pacificaSymbols.has(symbol) || pickedSymbols.has(symbol)) continue;

      const sentiment = Math.round(token.change_percent > 0 ? 75 : 25);
      const ok = await createMarketForSymbol(symbol, prices, sentiment);
      if (ok) {
        pickedSymbols.add(symbol);
        created++;
        trendingAdded++;
      }
    }

    if (created > 0) {
      console.log(`[MarketGen] Created ${created} new markets (curated + trending).`);
      syncCandleSubscriptions(Array.from(pickedSymbols));
    }
  } catch (err) {
    console.error("[MarketGen] Error:", err);
  }
}
