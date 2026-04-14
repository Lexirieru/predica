"use client";

import { useEffect, useState } from "react";
import { fetchSentiment, type SentimentResponse } from "@/lib/api";

interface Props {
  symbol: string;
  fallback: number; // use market.sentiment while we fetch/refresh
}

export default function SentimentBar({ symbol, fallback }: Props) {
  const [data, setData] = useState<SentimentResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetchSentiment(symbol)
        .then((d) => { if (!cancelled) setData(d); })
        .catch(() => {});
    };
    poll();
    // Cache TTL on BE is 5min, so polling every 5min picks up LLM upgrades.
    const interval = setInterval(poll, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [symbol]);

  const value = data?.bullishPercent ?? fallback;
  const confidence = data?.confidence ?? "low";
  const source = data?.source ?? "engagement";
  const refreshing = data?.refreshing ?? false;
  const summary = data?.summary;

  const confidenceDot = confidence === "high" ? "#00b482" : confidence === "medium" ? "#f0a500" : "rgba(255,255,255,0.3)";
  const sourceLabel = source === "llm" ? "Elfa AI" : source === "engagement" ? "Quick estimate" : "Neutral";

  return (
    <div className="px-5 pb-2 shrink-0">
      <button
        type="button"
        onClick={() => summary && setExpanded((e) => !e)}
        className="flex items-center gap-2 w-full text-left"
        disabled={!summary}
      >
        <span className="flex items-center gap-1 text-[10px] text-white/30">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: confidenceDot }}
            title={`${confidence} confidence`}
          />
          {sourceLabel}
          {refreshing && (
            <span className="inline-block w-2 h-2 rounded-full border border-white/20 border-t-white/60 animate-spin" />
          )}
        </span>
        <div className="flex-1 h-1 rounded-full bg-white/[0.04] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${value}%`,
              background:
                value >= 50
                  ? "linear-gradient(90deg, #00b482, #00d4a0)"
                  : "linear-gradient(90deg, #dc3246, #ff5068)",
            }}
          />
        </div>
        <span
          className={`text-[10px] font-semibold ${value >= 50 ? "text-[#00b482]" : "text-[#dc3246]"}`}
        >
          {value}% {value >= 50 ? "Bullish" : "Bearish"}
        </span>
      </button>

      {expanded && summary && (
        <div className="mt-2 p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[11px] text-white/60 leading-relaxed">
          {summary}
          {data && (
            <p className="text-[9px] text-white/20 mt-1.5">
              Updated {new Date(data.lastUpdated).toLocaleTimeString()} · {data.mentionCount} mentions
            </p>
          )}
        </div>
      )}
    </div>
  );
}
