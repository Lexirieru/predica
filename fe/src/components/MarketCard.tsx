"use client";

import { useState, useEffect, useRef } from "react";
import { PredictionMarket, Candle } from "@/lib/types";
import { useStore } from "@/store/useStore";
import PriceChart from "./PriceChart";
import LiveTrades from "./LiveTrades";
import SentimentBar from "./SentimentBar";
import SymbolTimeline from "./SymbolTimeline";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useNow } from "@/hooks/useNow";
import { useCandlesFor } from "@/hooks/useCandlesFor";
import { fetchCandleSeries } from "@/lib/api";

// 5 significant digits (matches Pacifica display).
//   74755   → 74,755
//   2347.6  → 2,347.6
//   45.183  → 45.183
//   1.4155  → 1.4155 (XRP)
//   0.03453 → 0.034538 (DOGE)
function fmt(price: number): string {
  const abs = Math.abs(price);
  let precision: number;
  if (abs <= 0) precision = 2;
  else if (abs >= 1) precision = Math.max(0, 5 - (Math.floor(Math.log10(abs)) + 1));
  else precision = Math.floor(-Math.log10(abs)) + 5;
  return price.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

const ICONS: Record<string, string> = {
  BTC: "₿",
  ETH: "Ξ",
  SOL: "◎",
  DOGE: "Ð",
  XRP: "✕",
  TAO: "τ",
  HYPE: "H",
  ZEC: "Ⓩ",
  WLFI: "W",
  ADA: "₳",
  LINK: "⬡",
  AVAX: "▲",
  SUI: "S",
  ARB: "◆",
  WIF: "🐕",
  TRUMP: "T",
  BNB: "B",
  LTC: "Ł",
  TON: "T",
  AAVE: "A",
  NEAR: "N",
  UNI: "U",
  JUP: "J",
  WLD: "W",
  PUMP: "P",
  BCH: "B",
  XMR: "M",
};

interface ActivityItem {
  id: number;
  wallet: string;
  side: "Up" | "Down";
  amount: number;
  ago: string;
}

export default function MarketCard({ market }: { market: PredictionMarket }) {
  const openTradeModal = useStore((s) => s.openTradeModal);
  const [cd, setCd] = useState({ m: 0, s: 0 });
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<PredictionMarket | null>(null);
  // Historical candles are keyed by bucket id so stale data from a previous
  // bucket never leaks into a subsequent render. Without the key, the state
  // update that clears `historicalCandles` runs AFTER the first render that
  // flips selectedBucket — meaning the live chart would receive the previous
  // bucket's candles for one frame and lock its scale to them.
  const [historical, setHistorical] = useState<{ id: string; candles: Candle[] } | null>(null);
  const nextActId = useRef(0);

  // Reset selection when user swipes to a different symbol.
  useEffect(() => {
    setSelectedBucket(null);
    setHistorical(null);
  }, [market.symbol]);

  // When a past bucket is selected, fetch a wider candle window covering its
  // deadline and filter to the relevant slice (5min bucket + small pre/post
  // padding). 6h window covers any realistic past bucket shown in the timeline.
  useEffect(() => {
    if (!selectedBucket) return;
    let cancelled = false;
    const start = selectedBucket.deadline - 5 * 60_000 - 3 * 60 * 1000; // bucket + 3min lead-in
    const end = selectedBucket.deadline + 60_000; // 1min post-settlement

    fetchCandleSeries(selectedBucket.symbol, "6h")
      .then((all) => {
        if (cancelled) return;
        const sliced = all.filter((c) => {
          const ms = c.time * 1000;
          return ms >= start && ms <= end;
        });
        // Fall back to unsliced last 30 candles if slice is empty (bucket too old).
        setHistorical({
          id: selectedBucket.id,
          candles: sliced.length >= 2 ? sliced : all.slice(-30),
        });
      })
      .catch(() => {
        if (!cancelled) setHistorical({ id: selectedBucket.id, candles: [] });
      });

    return () => { cancelled = true; };
  }, [selectedBucket]);

  useEffect(() => {
    const WINDOW_MS = 5 * 60_000;
    const tick = () => {
      const d = Math.max(0, market.deadline - Date.now());
      const capped = Math.min(d, WINDOW_MS);
      setCd({
        m: Math.floor(capped / 60000),
        s: Math.floor((capped % 60000) / 1000),
      });
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [market.deadline]);

  // Real activity feed from WS
  useWebSocket("NEW_VOTE", (data) => {
    const vote = data as {
      marketId: string;
      side: string;
      amount: number;
      wallet: string;
    };
    if (vote.marketId !== market.id) return;
    setActivity((prev) => {
      const item: ActivityItem = {
        id: nextActId.current++,
        wallet: vote.wallet
          ? `${vote.wallet.slice(0, 4)}..${vote.wallet.slice(-2)}`
          : "anon",
        side: vote.side === "yes" ? "Up" : "Down",
        amount: vote.amount,
        ago: "now",
      };
      const next = [item, ...prev];
      if (next.length > 4) next.pop();
      return next;
    });
  });

  // Lazy candle fetch — fires once per symbol, cached globally. Means we
  // don't block the initial feed render on a sea of /candles requests.
  const { candles: liveCandles } = useCandlesFor(market.symbol);
  const displayMarket = selectedBucket ?? market;
  // Only use historical data when it matches the currently-selected bucket.
  // Mismatch = stale fetch (user switched buckets or went back to live mid-
  // fetch) → fall through to liveCandles.
  const historicalCandles =
    selectedBucket && historical?.id === selectedBucket.id ? historical.candles : null;
  const displayCandles = historicalCandles ?? liveCandles;
  const diff = displayMarket.currentPrice - displayMarket.targetPrice;
  const isUp = diff >= 0;
  const now = useNow(1_000);
  const expired = market.deadline <= now;
  const resolved = market.status === "resolved" || market.status === "settled";
  const frozen = !!selectedBucket;
  const settledPositive = selectedBucket?.resolution === "yes";
  const totalPool = market.yesPool + market.noPool;
  const upOdds =
    totalPool > 0
      ? Math.max(1, Math.round((market.yesPool / totalPool) * 100))
      : 50;
  const downOdds = 100 - upOdds;

  return (
    <div className="h-full rounded-2xl bg-[#141414] border border-white/[0.06] overflow-hidden flex flex-col relative">
      {/* Resolution banner overlay */}
      {resolved && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-2xl">
          <div className="text-center">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-2">
              Resolved
            </p>
            <p
              className={`text-3xl font-bold ${market.resolution === "yes" ? "text-[#00b482]" : "text-[#dc3246]"}`}
            >
              {market.resolution === "yes" ? "UP" : "DOWN"}
            </p>
            <p className="text-white/20 text-xs mt-2">
              Price was {market.resolution === "yes" ? "above" : "below"} target
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-5 pt-5 pb-1 flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-base font-bold shrink-0">
          {ICONS[market.symbol] || market.symbol[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-white text-base font-bold leading-snug">
              {market.symbol} Up or Down
            </h3>
            {market.totalVoters > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-400">
                Hot
              </span>
            )}
            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-white/10 text-white/60">
              5m
            </span>
          </div>
          <p className="text-white/20 text-[11px]">5 Minutes</p>
        </div>
        <div
          className={`tabular-nums font-bold text-2xl ${expired ? "text-white/15" : cd.m === 0 && cd.s < 30 ? "text-[var(--color-no)]" : "text-white"}`}
        >
          {String(cd.m).padStart(2, "0")}
          <span className="text-white/20">:</span>
          {String(cd.s).padStart(2, "0")}
        </div>
      </div>

      {/* Sentiment bar — LLM-backed via SWR, expandable for AI summary */}
      <SentimentBar symbol={market.symbol} fallback={market.sentiment} />

      {/* Prices */}
      <div className="px-5 pb-2 flex justify-between items-end shrink-0">
        <div>
          <p className="text-[9px] text-white/20 uppercase tracking-widest">
            Price To Beat
          </p>
          <p className="text-white/40 text-lg font-bold tabular-nums">
            ${fmt(market.targetPrice)}
          </p>
        </div>
        <div className="text-right">
          <p
            className={`text-[9px] uppercase tracking-widest ${isUp ? "text-[var(--color-yes)]" : "text-[var(--color-no)]"}`}
          >
            Current {isUp ? "▲" : "▼"} ${fmt(Math.abs(diff))}
          </p>
          <p
            className={`text-lg font-bold tabular-nums ${isUp ? "text-[var(--color-yes)]" : "text-[var(--color-no)]"}`}
          >
            ${fmt(market.currentPrice)}
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 mx-4 mb-2 rounded-xl bg-[#0d0d0d] border border-white/[0.04] p-3 min-h-0 overflow-hidden relative">
        <PriceChart
          key={selectedBucket ? `frozen-${selectedBucket.id}` : `live-${market.symbol}`}
          candles={displayCandles}
          currentPrice={displayMarket.currentPrice}
          isPositive={isUp}
          targetPrice={displayMarket.targetPrice}
          frozen={frozen}
          settlementPrice={frozen ? selectedBucket.currentPrice : undefined}
          settledPositive={settledPositive}
        />
        {!frozen && <LiveTrades marketId={market.id} />}

        {/* Frozen-mode badge overlay */}
        {frozen && (
          <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded-md bg-black/60 border border-white/10 backdrop-blur-sm">
            <p className="text-[9px] uppercase tracking-widest text-white/40">Viewing past round</p>
            <p className={`text-[11px] font-bold ${settledPositive ? "text-[#00b482]" : "text-[#dc3246]"}`}>
              {settledPositive ? "▲ UP" : "▼ DOWN"} · settled ${selectedBucket.currentPrice.toFixed(selectedBucket.currentPrice >= 1 ? 2 : 6)}
            </p>
          </div>
        )}
      </div>

      {/* Symbol timeline — past/live/upcoming rounds for this symbol */}
      <SymbolTimeline
        symbol={market.symbol}
        pastLimit={5}
        upcomingLimit={4}
        selectedBucketId={selectedBucket?.id}
        onBucketClick={(bucket) => setSelectedBucket(bucket)}
      />

      {/* Recent activity (real from WS) */}
      {activity.length > 0 && (
        <div className="px-5 pb-2 shrink-0">
          <div className="space-y-1">
            {activity.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-1.5 text-[10px] animate-[fadeInUp_0.3s_ease_both]"
              >
                <span className="text-white/15 font-mono">{a.wallet}</span>
                <span className="text-white/10">bought</span>
                <span
                  className={`font-semibold ${a.side === "Up" ? "text-[#00b482]" : "text-[#dc3246]"}`}
                >
                  {a.side} ${a.amount}
                </span>
                <span className="text-white/10 ml-auto">{a.ago}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pool stats */}
      <div className="px-5 pb-2 flex justify-between text-[10px] text-white/15 tabular-nums shrink-0">
        <span>
          Pool $
          {totalPool >= 1000
            ? `${(totalPool / 1000).toFixed(1)}K`
            : totalPool.toFixed(0)}
        </span>
        <span>{market.totalVoters} voters</span>
        <span>Via Pacifica</span>
      </div>

      {/* Buy buttons */}
      <div className="px-5 pb-5 flex gap-2.5 shrink-0">
        <button
          onClick={() =>
            !expired && !resolved && openTradeModal(market.id, "yes")
          }
          disabled={expired || resolved}
          className="flex-1 h-12 rounded-xl font-bold text-[15px] disabled:opacity-20 active:scale-[0.97] transition-transform duration-100"
          style={{ backgroundColor: "#00b482", color: "#fff" }}
        >
          Buy Up {upOdds}¢
        </button>
        <button
          onClick={() =>
            !expired && !resolved && openTradeModal(market.id, "no")
          }
          disabled={expired || resolved}
          className="flex-1 h-12 rounded-xl font-bold text-[15px] disabled:opacity-20 active:scale-[0.97] transition-transform duration-100"
          style={{ backgroundColor: "#dc3246", color: "#fff" }}
        >
          Buy Down {downOdds}¢
        </button>
        <button className="w-12 h-12 rounded-xl bg-white/[0.05] flex items-center justify-center text-white/25 shrink-0 text-lg">
          ···
        </button>
      </div>
    </div>
  );
}
