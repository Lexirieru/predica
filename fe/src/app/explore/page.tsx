"use client";

import { useState } from "react";
import { PredictionMarket } from "@/lib/types";
import { useStore } from "@/store/useStore";
import { useMarkets } from "@/hooks/useMarkets";
import CountdownTimer from "@/components/CountdownTimer";
import OddsBar from "@/components/OddsBar";
import { useRouter } from "next/navigation";

type DurationFilter = "all" | 5 | 15;

function formatPrice(price: number): string {
  if (price >= 10000) return `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toFixed(3)}`;
  return `$${price.toFixed(6)}`;
}

export default function ExplorePage() {
  const { markets, loading } = useMarkets();
  const [duration, setDuration] = useState<DurationFilter>("all");
  const [search, setSearch] = useState("");
  const setTargetMarketKey = useStore((s) => s.setTargetMarketKey);
  const router = useRouter();

  const filtered = markets
    .filter((m) => {
      if (search) {
        const q = search.toLowerCase();
        return m.symbol.toLowerCase().includes(q) || m.question.toLowerCase().includes(q);
      }
      return true;
    })
    .filter((m) => duration === "all" || m.durationMin === duration)
    .sort((a, b) => b.yesPool + b.noPool - (a.yesPool + a.noPool));

  // Navigate by (symbol + durationMin), not by raw-array index. The feed's
  // displayed list is filtered + shuffled, so passing an index would land on
  // the wrong card. SwipeStack picks up targetMarketKey and resolves it
  // against its own filtered list.
  const handleCardClick = (market: PredictionMarket) => {
    setTargetMarketKey(`${market.symbol}:${market.durationMin}`);
    router.push("/");
  };

  const durations: { key: DurationFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: 5, label: "5 Minutes" },
    { key: 15, label: "15 Minutes" },
  ];

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <h1 className="text-xl font-bold text-white mb-4">Explore</h1>

      {/* Search */}
      <div className="relative mb-3">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          placeholder="Search by symbol or question..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-white/4 border border-white/8 rounded-xl min-h-[40px] py-2 pl-9 pr-4 text-white text-sm placeholder:text-white/20 outline-none focus:border-white/15 transition-colors"
        />
      </div>

      {/* Duration filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
        {durations.map((d) => (
          <button
            key={String(d.key)}
            onClick={() => setDuration(d.key)}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150"
            style={{
              background: duration === d.key ? "rgba(0,209,169,0.15)" : "rgba(255,255,255,0.04)",
              color: duration === d.key ? "var(--color-yes)" : "rgba(255,255,255,0.4)",
              border: `1px solid ${duration === d.key ? "rgba(0,209,169,0.3)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Results count */}
      <p className="text-white/20 text-xs mb-3">{filtered.length} markets</p>

      {loading ? (
        <div className="flex justify-center pt-20">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center pt-20 text-white/20">
          <p className="text-sm">No markets found</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((market) => {
            const total = market.yesPool + market.noPool;
            const yesPercent = total > 0 ? Math.round((market.yesPool / total) * 100) : 50;
            const noPercent = 100 - yesPercent;
            const totalPool = market.yesPool + market.noPool;

            return (
              <button
                key={market.id}
                onClick={() => handleCardClick(market)}
                className="w-full text-left p-4 rounded-2xl bg-white/2 border border-white/6 hover:bg-white/4 transition-colors duration-150 block"
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-white/60">{market.symbol}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                          market.durationMin === 15
                            ? "bg-[#00b482]/15 text-[#00b482]"
                            : "bg-white/10 text-white/60"
                        }`}
                      >
                        {market.durationMin}m
                      </span>
                      <span className="text-white/15">·</span>
                      <span className="text-[10px] text-white/25">{market.totalVoters.toLocaleString()} voters</span>
                    </div>
                    <p className="text-white text-sm font-semibold leading-snug">{market.question}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-white text-sm font-bold tabular-nums">{formatPrice(market.currentPrice)}</p>
                    <div className="mt-0.5">
                      <CountdownTimer deadline={market.deadline} />
                    </div>
                  </div>
                </div>

                {/* Odds bar */}
                <OddsBar yesPercent={yesPercent} noPercent={noPercent} />

                {/* Bottom stats */}
                <div className="flex justify-between mt-2 text-[10px] text-white/20 tabular-nums">
                  <span>Pool ${totalPool >= 1000 ? `${(totalPool / 1000).toFixed(1)}K` : totalPool}</span>
                  <span>Target {formatPrice(market.targetPrice)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
