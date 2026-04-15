"use client";

import { useState, useEffect } from "react";
import { PredictionMarket } from "@/lib/types";
import { useStore } from "@/store/useStore";
import PriceChart from "./PriceChart";

function formatPrice(price: number): string {
  if (price >= 10000) return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(3)}`;
  return `$${price.toFixed(6)}`;
}

function getSymbolIcon(symbol: string): string {
  const icons: Record<string, string> = {
    BTC: "₿", ETH: "Ξ", SOL: "◎", DOGE: "Ð", XRP: "✕",
    ARB: "◆", WIF: "🐕", TAO: "τ", HYPE: "H", ZEC: "ⓩ",
    WLFI: "W", ADA: "₳", LINK: "⬡", AVAX: "▲", SUI: "S",
  };
  return icons[symbol] || symbol.charAt(0);
}

export default function PredictionCard({ market }: { market: PredictionMarket }) {
  const openTradeModal = useStore((s) => s.openTradeModal);
  const [countdown, setCountdown] = useState({ mins: 0, secs: 0 });

  // Live countdown MM:SS
  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, market.deadline - Date.now());
      setCountdown({
        mins: Math.floor(diff / 60000),
        secs: Math.floor((diff % 60000) / 1000),
      });
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [market.deadline]);

  const priceDiff = market.currentPrice - market.targetPrice;
  const isUp = priceDiff >= 0;
  const diffFormatted = `${isUp ? "+" : ""}${formatPrice(Math.abs(priceDiff))}`;

  // Odds: based on how far price is from target
  const totalPool = market.yesPool + market.noPool;
  const upOdds = totalPool > 0 ? Math.max(1, Math.round((market.yesPool / totalPool) * 100)) : 50;
  const downOdds = 100 - upOdds;

  const isExpired = market.deadline <= Date.now();

  return (
    <div className="w-full h-full flex flex-col px-5 py-4">
      {/* Header: Symbol + Title */}
      <div className="flex items-center gap-3 mb-4 stagger-1">
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-lg font-bold shadow-lg">
          {getSymbolIcon(market.symbol)}
        </div>
        <div className="flex-1">
          <h2 className="text-white text-lg font-bold leading-tight">
            {market.symbol} Up or Down
          </h2>
          <p className="text-white/30 text-xs">{market.durationMin} Minute{market.durationMin === 1 ? "" : "s"}</p>
        </div>
        {/* Countdown */}
        <div className="text-right">
          <div className="flex items-center gap-1">
            <div className={`text-2xl font-bold tabular-nums ${isExpired ? "text-white/20" : countdown.mins === 0 && countdown.secs < 30 ? "text-[var(--color-no)]" : "text-white"}`}>
              {String(countdown.mins).padStart(2, "0")}
            </div>
            <div className="text-white/30 text-xs flex flex-col items-center">
              <span className="text-[8px] uppercase tracking-widest">min</span>
            </div>
            <div className={`text-2xl font-bold tabular-nums ${isExpired ? "text-white/20" : countdown.mins === 0 && countdown.secs < 30 ? "text-[var(--color-no)]" : "text-white"}`}>
              {String(countdown.secs).padStart(2, "0")}
            </div>
            <div className="text-white/30 text-xs flex flex-col items-center">
              <span className="text-[8px] uppercase tracking-widest">sec</span>
            </div>
          </div>
        </div>
      </div>

      {/* Price To Beat vs Current Price */}
      <div className="flex items-start justify-between mb-3 stagger-2">
        <div>
          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-0.5">Price To Beat</p>
          <p className="text-white/50 text-xl font-bold tabular-nums">{formatPrice(market.targetPrice)}</p>
        </div>
        <div className="text-right">
          <p className={`text-[10px] uppercase tracking-wider mb-0.5 ${isUp ? "text-[var(--color-yes)]" : "text-[var(--color-no)]"}`}>
            Current Price <span className="font-semibold">{diffFormatted}</span>
          </p>
          <p className={`text-xl font-bold tabular-nums ${isUp ? "text-[var(--color-yes)]" : "text-[var(--color-no)]"}`}>
            {formatPrice(market.currentPrice)}
          </p>
        </div>
      </div>

      {/* Chart with target line */}
      <div className="flex-1 rounded-2xl bg-white/[0.02] border border-white/[0.06] p-3 mb-3 relative overflow-hidden stagger-3">
        {/* Target price label */}
        <div className="absolute left-3 top-3 z-10">
          <span className="text-[10px] text-white/20 bg-white/[0.05] px-1.5 py-0.5 rounded">
            Target {formatPrice(market.targetPrice)}
          </span>
        </div>
        <PriceChart
          key={market.symbol}
          candles={market.candles}
          currentPrice={market.currentPrice}
          isPositive={isUp}
          targetPrice={market.targetPrice}
        />
      </div>

      {/* Up / Down buttons */}
      <div className="flex gap-3 mb-3 stagger-4">
        <button
          onClick={() => !isExpired && openTradeModal(market.id, "yes")}
          disabled={isExpired}
          className="flex-1 min-h-[52px] rounded-2xl font-bold text-base transition-all duration-150 relative overflow-hidden disabled:opacity-30"
          style={{
            background: "linear-gradient(135deg, rgba(0,209,169,0.15) 0%, rgba(0,209,169,0.05) 100%)",
            border: "1px solid rgba(0,209,169,0.3)",
            color: "var(--color-yes)",
          }}
        >
          <span className="text-sm">Up {upOdds}¢</span>
        </button>
        <button
          onClick={() => !isExpired && openTradeModal(market.id, "no")}
          disabled={isExpired}
          className="flex-1 min-h-[52px] rounded-2xl font-bold text-base transition-all duration-150 relative overflow-hidden disabled:opacity-30"
          style={{
            background: "linear-gradient(135deg, rgba(255,73,118,0.15) 0%, rgba(255,73,118,0.05) 100%)",
            border: "1px solid rgba(255,73,118,0.3)",
            color: "var(--color-no)",
          }}
        >
          <span className="text-sm">Down {downOdds}¢</span>
        </button>
      </div>

      {/* Pool info */}
      <div className="flex justify-between text-[10px] text-white/20 tabular-nums stagger-5">
        <span>Pool ${totalPool >= 1000 ? `${(totalPool / 1000).toFixed(1)}K` : totalPool.toFixed(0)}</span>
        <span>{market.totalVoters} voters</span>
        <span>Via Pacifica Perps</span>
      </div>
    </div>
  );
}
