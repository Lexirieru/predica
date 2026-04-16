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
import { pushCandle, pruneOldCandles, warmCacheFromDb, CANDLE_RETENTION_DAYS } from "./candleCache";
import { isElfaTracked, warmElfaValidity } from "./elfaValidator";
import { evaluateAchievements } from "./achievements";
import { sendPushToWallet } from "./webpush";
import { computePayouts } from "./payoutWeight";

let isSettling = false;

export function startSettlementCron() {
  // Every 10s — market expires at any second within the minute, so a per-minute
  // cron leaves users staring at a 00:00 countdown for up to 60s before the
  // resolution hits. 10s keeps the gap small without hammering the DB.
  cron.schedule("*/10 * * * * *", async () => {
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

      // One query fans out to all expired markets' votes — replaces N
      // sequential getByMarket calls, which scaled linearly with batch size.
      const votesByMarket = await voteRepo.getByMarketIds(expired.map((m) => m.id));

      for (const market of expired) {
        const symbol = market.symbol.toUpperCase();
        const markPrice = parseFloat(prices[symbol] || "0");

        if (markPrice <= 0) continue;

        const resolution = markPrice > market.targetPrice ? "yes" : "no";
        const marketVotes = votesByMarket[market.id] ?? [];
        const totalPool = market.yesPool + market.noPool;

        try {
          // `committed` tells us the tx actually flipped the row (won the race)
          // vs silently skipped (another worker beat us). We broadcast AFTER the
          // tx fully commits so we never send MARKET_RESOLVED for a rolled-back
          // settlement — which would leave the FE out of sync with DB state.
          let committed = false;
          // Populated inside the tx so we can fire notifications AFTER commit,
          // per-user with their own outcome (payout + profit). Reading the
          // votes table again post-commit would work but adds a roundtrip.
          type Outcome = { wallet: string; won: boolean; payout: number; profit: number; amount: number };
          const outcomes: Outcome[] = [];
          await db.transaction(async (tx) => {
            const won = await marketRepo.resolve(market.id, resolution as "yes" | "no", tx);
            if (!won) {
              console.log(`[Settlement] ${symbol} already settled by another worker — skip.`);
              return;
            }
            committed = true;

            if (marketVotes.length > 0) {
              // Hybrid payout split lives in payoutWeight.computePayouts so the
              // math stays unit-testable. Here we just apply the outcomes to
              // DB and collect them for WS/push side-effects.
              const payouts = computePayouts(
                marketVotes.map((v) => ({
                  id: v.id,
                  userWallet: v.userWallet,
                  side: v.side,
                  amount: v.amount,
                  shareWeight: Number(v.shareWeight),
                })),
                resolution as "yes" | "no",
              );

              for (const o of payouts) {
                outcomes.push({ wallet: o.wallet, won: o.won, payout: o.payout, profit: o.profit, amount: o.amount });

                if (o.won) {
                  await tx.update(votes)
                    .set({ payout: o.payout, status: "won" })
                    .where(eq(votes.id, o.voteId));

                  await tx.update(users)
                    .set({
                      balance: sql`${users.balance} + ${o.payout}`,
                      wins: sql`${users.wins} + 1`,
                      totalPnl: sql`${users.totalPnl} + ${o.profit}`,
                    })
                    .where(eq(users.wallet, o.wallet));

                  await tx.insert(transactions).values({
                    id: uuid(),
                    wallet: o.wallet,
                    type: "payout",
                    amount: o.payout,
                    status: "confirmed",
                    metadata: JSON.stringify({ marketId: market.id, profit: o.profit }),
                    createdAt: Date.now(),
                  });
                } else {
                  await tx.update(votes)
                    .set({ payout: 0, status: "lost" })
                    .where(eq(votes.id, o.voteId));

                  await tx.update(users)
                    .set({
                      losses: sql`${users.losses} + 1`,
                      totalPnl: sql`${users.totalPnl} - ${o.amount}`,
                    })
                    .where(eq(users.wallet, o.wallet));
                }
              }
            }
          });

          if (committed) {
            broadcast("MARKET_RESOLVED", {
              marketId: market.id,
              resolution,
              price: markPrice,
            });
            console.log(`[Settlement] SUCCESS: ${symbol} Resolved as ${resolution.toUpperCase()}`);

            // Evaluate badges for everyone who voted on this market. Fire-and-
            // forget so settlement throughput isn't blocked on WS / DB writes.
            const touched = new Set(marketVotes.map((v) => v.userWallet));
            for (const wallet of touched) {
              evaluateAchievements(wallet).catch((e) =>
                console.warn(`[Achievements] eval failed for ${wallet}:`, (e as Error).message),
              );
            }

            // Fire Web Push per participant. Fire-and-forget; each wallet gets
            // a personalized title/body based on their outcome. Tag by marketId
            // so a second settlement retry wouldn't double-notify the user
            // (browsers dedupe on tag).
            for (const o of outcomes) {
              const title = o.won
                ? `🎉 You won +$${o.profit.toFixed(2)}!`
                : `💔 You lost $${o.amount.toFixed(2)}`;
              const body = `${symbol} resolved ${resolution.toUpperCase()} @ $${markPrice.toFixed(4)}`;
              sendPushToWallet(o.wallet, {
                title,
                body,
                tag: `market:${market.id}`,
                url: `/markets/${market.id}`,
                data: {
                  marketId: market.id,
                  symbol,
                  resolution,
                  won: o.won,
                  payout: o.payout,
                  profit: o.profit,
                },
              }).catch((e) =>
                console.warn(`[WebPush] send failed for ${o.wallet}:`, (e as Error).message),
              );
            }
          }
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
    await ensureUpcomingBuckets();
  });
  setTimeout(() => ensureUpcomingBuckets(), 5000);
}

/**
 * Daily prune of candle_snapshots older than CANDLE_RETENTION_DAYS.
 * Runs at 03:15 UTC (low-traffic window) so the delete doesn't contend with
 * peak-hour writes.
 */
export function startCandleCleanupCron() {
  cron.schedule("15 3 * * *", async () => {
    try {
      const deleted = await pruneOldCandles();
      if (deleted > 0) {
        console.log(`[CandleCleanup] Pruned ${deleted} rows older than ${CANDLE_RETENTION_DAYS} days`);
      }
    } catch (err) {
      console.error("[CandleCleanup] Failed:", err);
    }
  });
}

/**
 * On boot, probe each curated symbol against Elfa to populate the validity
 * cache. Without this the first generator run would block on N sequential
 * Elfa calls; warming in parallel chunks up-front keeps startup fast.
 */
export async function warmElfaValidityCache() {
  try {
    await warmElfaValidity(CURATED_SYMBOLS);
  } catch (err) {
    console.error("[ElfaValidity] Warm failed:", err);
  }
}

/**
 * On boot, rehydrate the in-memory candle buffers from DB so the chart
 * endpoint doesn't return empty arrays while waiting for the first WS tick.
 * Only warms active-market symbols — everything else loads on demand.
 */
export async function warmCandleCache() {
  try {
    const active = await marketRepo.getActive();
    const symbols = Array.from(new Set(active.map((m) => m.symbol.toUpperCase())));
    if (symbols.length > 0) {
      await warmCacheFromDb(symbols);
      console.log(`[CandleCache] Warmed cache for ${symbols.length} symbols`);
    }
  } catch (err) {
    console.error("[CandleCache] Warm failed:", err);
  }
}

const CURATED_SYMBOLS = [
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX",
  "SUI", "LINK", "LTC", "TON", "AAVE", "NEAR", "ARB", "UNI",
  "HYPE", "TAO", "JUP", "WLD", "TRUMP", "PUMP", "BCH", "XMR",
];

// Pacifica's perp list is asset-class-agnostic: alongside crypto it lists
// equities (NVDA, TSLA, GOOGL, MSTR, HOOD, CRCL, PLTR, BP, SPY, QQQ, SP500),
// forex (USDJPY, EURUSD, GBPUSD, USDKRW), and commodities (XAU, XAG, NATGAS,
// COPPER, PLATINUM, URNM, CL). Predica is a crypto prediction market, so we
// exclude those even if Elfa happens to have ticker mention data for them.
const NON_CRYPTO_SYMBOLS = new Set<string>([
  // Equities / ETFs
  "NVDA", "TSLA", "GOOGL", "AAPL", "AMZN", "MSTR", "HOOD", "CRCL", "PLTR", "BP",
  "SPY", "QQQ", "SP500",
  // Forex
  "USDJPY", "EURUSD", "GBPUSD", "USDKRW",
  // Commodities
  "XAU", "XAG", "NATGAS", "COPPER", "PLATINUM", "URNM", "CL",
]);

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

// All markets are fixed 5-minute rounds — one cadence for every symbol.
// horizonMin = how far ahead we pre-create the bucket lineup.
type DurationConfig = {
  durationMin: number;
  horizonMin: number;
  symbols: "all" | Set<string>;
};

const MARKET_DURATIONS: DurationConfig[] = [
  { durationMin: 5, horizonMin: 60, symbols: "all" },
];

const MARKET_DURATION_MIN = 5;

/**
 * Seed sentiment for a newly generated market. Two-factor proxy:
 *   • price momentum from Pacifica yesterday_price (70% weight)
 *   • mention growth from Elfa (30% weight, trending tokens only)
 *
 * Result mapped to 0..100, centered at 50 (neutral). Replaces the old
 * binary 25/75 split which gave a token with change=+1% the same sentiment
 * as one with change=+5000%.
 */
function seedSentiment(priceInfo: any, mentionChangePercent = 0): number {
  const current = parseFloat(priceInfo?.mark || "0");
  const yesterday = parseFloat(priceInfo?.yesterday_price || "0");
  const priceChange = yesterday > 0 ? (current - yesterday) / yesterday : 0;

  const mentionGrowth = mentionChangePercent / 100;

  // Squash extreme values: ±50% price change / ±500% mention growth → full saturation
  const priceSignal = Math.max(-1, Math.min(1, priceChange / 0.5));
  const mentionSignal = Math.max(-1, Math.min(1, mentionGrowth / 5));

  const combined = priceSignal * 0.7 + mentionSignal * 0.3;
  return Math.max(0, Math.min(100, Math.round(50 + combined * 50)));
}

/**
 * Snap timestamp to the next multiple of slotMs. e.g. if now is 08:02:37
 * and slotMs=5min, returns 08:05:00. Used to align bucket deadlines to
 * clock boundaries so they're predictable (:00, :05, :10, ...).
 */
function nextSlotBoundary(now: number, slotMs: number): number {
  return Math.ceil(now / slotMs) * slotMs;
}

async function createBucket(
  symbol: string,
  deadline: number,
  durationMin: number,
  sentiment: number,
  prices: Record<string, any>,
): Promise<boolean> {
  // Idempotency scoped to (symbol, deadline, durationMin): different duration
  // buckets may legitimately share a wall-clock deadline (e.g. a 5m and a 15m
  // both ending at :15), so we don't want the shorter one to block the longer.
  const existing = await marketRepo.getBySymbolDeadline(symbol, deadline, durationMin);
  if (existing) return false;

  const currentPrice = parseFloat(prices[symbol]?.mark || "0");
  const question = `${symbol} Price: Higher or Lower in ${durationMin} min?`;

  // targetPrice locked to 0 at creation — the activator cron stamps the real
  // price when the bucket becomes active. See startMarketActivatorCron.
  const newMarket = await marketRepo.create({
    symbol,
    question,
    targetPrice: 0,
    currentPrice,
    deadline,
    durationMin,
    category: "crypto",
    sentiment,
    status: "upcoming",
  });

  broadcast("NEW_MARKET", newMarket);
  return true;
}

/**
 * Pre-create upcoming buckets for curated + trending symbols. One series per
 * entry in MARKET_DURATIONS (1m/5m/15m), each with its own horizon. Slots
 * align to clock boundaries so deadlines land on predictable times.
 * Idempotent — re-runs skip existing (symbol, deadline, durationMin) triples.
 */
async function ensureUpcomingBuckets() {
  try {
    const [infoRes, priceRes] = await Promise.all([
      pacifica.getMarketInfo(),
      pacifica.getPrices(),
    ]);
    if (!infoRes?.data || !priceRes?.data) return;

    const pacificaSymbols = new Set<string>(
      (infoRes.data as any[]).map((d) => d.symbol.toUpperCase()),
    );

    const prices: Record<string, any> = {};
    if (Array.isArray(priceRes.data)) {
      for (const p of priceRes.data) prices[p.symbol.toUpperCase()] = p;
    }

    // Symbol set must satisfy BOTH:
    //   1. Listed on Pacifica (tradeable)
    //   2. Elfa has ticker-level mention data (so sentiment bar / activity feed
    //      actually has signal — NVDA/TSLA/GOOGL fail this check)
    //
    // Trending tokens from Elfa are also filtered by isElfaTracked because
    // Elfa's trending aggregator includes stocks that lack per-ticker data.
    const candidateSet = new Set<string>();
    for (const s of CURATED_SYMBOLS) {
      if (NON_CRYPTO_SYMBOLS.has(s)) continue;
      if (pacificaSymbols.has(s)) candidateSet.add(s);
    }
    try {
      const trending = await elfa.getTrendingTokens("24h");
      const tokens = trending?.data?.data || [];
      for (const t of tokens.slice(0, TRENDING_SCAN_LIMIT)) {
        const s = t.token.toUpperCase();
        if (NON_CRYPTO_SYMBOLS.has(s)) continue;
        if (pacificaSymbols.has(s)) candidateSet.add(s);
      }
    } catch {
      // Elfa unavailable — candidates are curated-only; still validate each below.
    }

    const activeSymbols = new Set<string>();
    await Promise.all(
      Array.from(candidateSet).map(async (s) => {
        if (await isElfaTracked(s)) activeSymbols.add(s);
      }),
    );

    // Fallback: if Elfa is down/quota-exceeded and validates 0 symbols,
    // use the Pacifica-listed curated set so market generation keeps running.
    // Sentiment bar will show neutral 50% but the demo stays alive.
    if (activeSymbols.size === 0) {
      console.warn("[Buckets] Elfa filter empty — falling back to curated Pacifica symbols.");
      for (const s of candidateSet) activeSymbols.add(s);
      if (activeSymbols.size === 0) {
        console.warn("[Buckets] No Pacifica-listed candidates either. Skipping batch.");
        return;
      }
    }

    // Per-duration slot schedule. Outer loop: duration config. Inner loop:
    // eligible symbols for that duration. Innermost: deadlines up to horizon.
    const now = Date.now();
    let created = 0;

    for (const cfg of MARKET_DURATIONS) {
      const slotMs = cfg.durationMin * 60_000;
      // nextSlotBoundary returns the next clock-aligned boundary, but for a
      // 15m slot at now=12:07 that's 12:15 — whose "open time" 12:00 is 7min
      // in the past. The activator would immediately flip that bucket to
      // active and users would see a market that starts its countdown at 8min
      // instead of a fresh 15:00. Push the first deadline forward by a full
      // slot whenever the aligned boundary's open time has already passed,
      // so every bucket we create has a FULL duration countdown when it
      // activates. Price: up to one slot of "no market for this duration"
      // after server boot in the middle of a slot — acceptable trade.
      let firstDeadline = nextSlotBoundary(now, slotMs);
      if (firstDeadline - slotMs < now) firstDeadline += slotMs;
      const lastDeadline = now + cfg.horizonMin * 60_000;

      const eligible =
        cfg.symbols === "all"
          ? activeSymbols
          : new Set(Array.from(activeSymbols).filter((s) => (cfg.symbols as Set<string>).has(s)));

      for (const symbol of eligible) {
        const mentionGrowth = 0; // seed sentiment uses price only at creation
        const sentiment = seedSentiment(prices[symbol], mentionGrowth);
        for (let deadline = firstDeadline; deadline <= lastDeadline; deadline += slotMs) {
          const ok = await createBucket(symbol, deadline, cfg.durationMin, sentiment, prices);
          if (ok) created++;
        }
      }
    }

    if (created > 0) {
      console.log(
        `[Buckets] Pre-created ${created} upcoming buckets across ${activeSymbols.size} symbols (durations: ${MARKET_DURATIONS.map((d) => d.durationMin + "m").join("/")}).`,
      );
      syncCandleSubscriptions(Array.from(activeSymbols));
    }
  } catch (err) {
    console.error("[Buckets] Error:", err);
  }
}

/**
 * Every 10s: transition upcoming → active when the bucket's open time (deadline
 * minus duration) has arrived. Stamps targetPrice = current mark price at the
 * moment of activation so users vote against a fair, real-time reference.
 */
export function startMarketActivatorCron() {
  cron.schedule("*/10 * * * * *", async () => {
    try {
      const due = await marketRepo.getDueForActivation(Date.now());
      if (due.length === 0) return;

      // One price fetch covers all symbols in the batch.
      const priceData = await pacifica.getPrices();
      const prices: Record<string, number> = {};
      if (priceData?.data && Array.isArray(priceData.data)) {
        for (const p of priceData.data) prices[p.symbol.toUpperCase()] = parseFloat(p.mark);
      }

      for (const m of due) {
        const mark = prices[m.symbol.toUpperCase()];
        const slotMs = (m.durationMin ?? MARKET_DURATION_MIN) * 60_000;
        const openedAt = Number(m.deadline) - slotMs;
        const stale = Date.now() - openedAt > 60_000;

        if (!mark || mark <= 0) {
          if (stale) {
            console.warn(
              `[Activator] ${m.symbol} stuck upcoming — no mark price for ${Math.round((Date.now() - openedAt) / 1000)}s past open (market id ${m.id})`,
            );
          }
          continue;
        }

        const ok = await marketRepo.activate(m.id, mark);
        if (ok) {
          broadcast("NEW_MARKET", { ...m, status: "active", targetPrice: mark, currentPrice: mark });
          console.log(`[Activator] ${m.symbol} active @ ${mark} (deadline ${new Date(Number(m.deadline)).toISOString()})`);
        } else if (stale) {
          console.warn(`[Activator] ${m.symbol} activate() returned false while stale — likely settled by another worker or deleted`);
        }
      }
    } catch (err) {
      console.error("[Activator] Error:", err);
    }
  });
}
