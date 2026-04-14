"use client";

import { useState, useEffect, useRef } from "react";
import { PredictionMarket } from "@/lib/types";
import { useStore } from "@/store/useStore";
import PriceChart from "./PriceChart";
import LiveTrades from "./LiveTrades";
import { useWebSocket } from "@/hooks/useWebSocket";
import { fetchSentiment } from "@/lib/api";

function fmt(price: number): string {
  if (price >= 10000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(3);
  return price.toFixed(6);
}

const ICONS: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", SOL: "◎", DOGE: "Ð", XRP: "✕", TAO: "τ",
  HYPE: "H", ZEC: "Ⓩ", WLFI: "W", ADA: "₳", LINK: "⬡", AVAX: "▲",
  SUI: "S", ARB: "◆", WIF: "🐕", TRUMP: "T", BNB: "B", LTC: "Ł",
  TON: "T", AAVE: "A", NEAR: "N", UNI: "U", JUP: "J", WLD: "W",
  PUMP: "P", BCH: "B", XMR: "M",
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
  const [liveSentiment, setLiveSentiment] = useState<number | null>(null);
  const nextActId = useRef(0);

  // Sentiment polling from Elfa AI
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetchSentiment(market.symbol).then((d) => {
        if (!cancelled) setLiveSentiment(d.bullishPercent);
      }).catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 5 * 60 * 1000); // every 5 min
    return () => { cancelled = true; clearInterval(interval); };
  }, [market.symbol]);

  useEffect(() => {
    const tick = () => {
      const d = Math.max(0, market.deadline - Date.now());
      const capped = Math.min(d, 5 * 60 * 1000);
      setCd({ m: Math.floor(capped / 60000), s: Math.floor((capped % 60000) / 1000) });
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [market.deadline]);

  // Real activity feed from WS
  useWebSocket("NEW_VOTE", (data) => {
    const vote = data as { marketId: string; side: string; amount: number; wallet: string };
    if (vote.marketId !== market.id) return;
    setActivity((prev) => {
      const item: ActivityItem = {
        id: nextActId.current++,
        wallet: vote.wallet ? `${vote.wallet.slice(0, 4)}..${vote.wallet.slice(-2)}` : "anon",
        side: vote.side === "yes" ? "Up" : "Down",
        amount: vote.amount,
        ago: "now",
      };
      const next = [item, ...prev];
      if (next.length > 4) next.pop();
      return next;
    });
  });

  const diff = market.currentPrice - market.targetPrice;
  const isUp = diff >= 0;
  const expired = market.deadline <= Date.now();
  const resolved = market.status === "resolved" || market.status === "settled";
  const totalPool = market.yesPool + market.noPool;
  const upOdds = totalPool > 0 ? Math.max(1, Math.round((market.yesPool / totalPool) * 100)) : 50;
  const downOdds = 100 - upOdds;
  const sentiment = liveSentiment ?? market.sentiment;

  return (
    <div className="h-full rounded-2xl bg-[#141414] border border-white/[0.06] overflow-hidden flex flex-col relative">
      {/* Resolution banner overlay */}
      {resolved && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-2xl">
          <div className="text-center">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Resolved</p>
            <p className={`text-3xl font-bold ${market.resolution === "yes" ? "text-[#00b482]" : "text-[#dc3246]"}`}>
              {market.resolution === "yes" ? "UP" : "DOWN"}
            </p>
            <p className="text-white/20 text-xs mt-2">Price was {market.resolution === "yes" ? "above" : "below"} target</p>
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
            <h3 className="text-white text-base font-bold leading-snug">{market.symbol} Up or Down</h3>
            {market.totalVoters > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-400">Hot</span>
            )}
          </div>
          <p className="text-white/20 text-[11px]">5 Minutes</p>
        </div>
        <div className={`tabular-nums font-bold text-2xl ${expired ? "text-white/15" : cd.m === 0 && cd.s < 30 ? "text-[var(--color-no)]" : "text-white"}`}>
          {String(cd.m).padStart(2, "0")}
          <span className="text-white/20">:</span>
          {String(cd.s).padStart(2, "0")}
        </div>
      </div>

      {/* Sentiment bar */}
      <div className="px-5 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/20">Elfa AI</span>
          <div className="flex-1 h-1 rounded-full bg-white/[0.04] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{
                width: `${sentiment}%`,
                background: sentiment >= 50 ? "linear-gradient(90deg, #00b482, #00d4a0)" : "linear-gradient(90deg, #dc3246, #ff5068)",
              }}
            />
          </div>
          <span className={`text-[10px] font-semibold ${sentiment >= 50 ? "text-[#00b482]" : "text-[#dc3246]"}`}>
            {sentiment}% {sentiment >= 50 ? "Bullish" : "Bearish"}
          </span>
        </div>
      </div>

      {/* Prices */}
      <div className="px-5 pb-2 flex justify-between items-end shrink-0">
        <div>
          <p className="text-[9px] text-white/20 uppercase tracking-widest">Price To Beat</p>
          <p className="text-white/40 text-lg font-bold tabular-nums">${fmt(market.targetPrice)}</p>
        </div>
        <div className="text-right">
          <p className={`text-[9px] uppercase tracking-widest ${isUp ? "text-[var(--color-yes)]" : "text-[var(--color-no)]"}`}>
            Current {isUp ? "▲" : "▼"} ${fmt(Math.abs(diff))}
          </p>
          <p className={`text-lg font-bold tabular-nums ${isUp ? "text-[var(--color-yes)]" : "text-[var(--color-no)]"}`}>
            ${fmt(market.currentPrice)}
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 mx-4 mb-2 rounded-xl bg-[#0d0d0d] border border-white/[0.04] p-3 min-h-0 overflow-hidden relative">
        <PriceChart key={market.id} candles={market.candles} currentPrice={market.currentPrice} isPositive={isUp} targetPrice={market.targetPrice} />
        <LiveTrades marketId={market.id} />
      </div>

      {/* Recent activity (real from WS) */}
      {activity.length > 0 && (
        <div className="px-5 pb-2 shrink-0">
          <div className="space-y-1">
            {activity.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5 text-[10px] animate-[fadeInUp_0.3s_ease_both]">
                <span className="text-white/15 font-mono">{a.wallet}</span>
                <span className="text-white/10">bought</span>
                <span className={`font-semibold ${a.side === "Up" ? "text-[#00b482]" : "text-[#dc3246]"}`}>
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
        <span>Pool ${totalPool >= 1000 ? `${(totalPool / 1000).toFixed(1)}K` : totalPool.toFixed(0)}</span>
        <span>{market.totalVoters} voters</span>
        <span>Via Pacifica</span>
      </div>

      {/* Buy buttons */}
      <div className="px-5 pb-5 flex gap-2.5 shrink-0">
        <button
          onClick={() => !expired && !resolved && openTradeModal(market.id, "yes")}
          disabled={expired || resolved}
          className="flex-1 h-12 rounded-xl font-bold text-[15px] disabled:opacity-20 active:scale-[0.97] transition-transform duration-100"
          style={{ backgroundColor: "#00b482", color: "#fff" }}
        >
          Buy Up {upOdds}¢
        </button>
        <button
          onClick={() => !expired && !resolved && openTradeModal(market.id, "no")}
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
