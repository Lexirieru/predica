"use client";

import { useEffect, useRef } from "react";
import type { PredictionMarket } from "@/lib/types";
import { useMarketSeries } from "@/hooks/useMarketSeries";
import BucketPill from "./BucketPill";

interface Props {
  symbol: string;
  /** Number of past buckets to show in the lineup. Default 5. */
  pastLimit?: number;
  /** Number of upcoming buckets to show. Default 4. */
  upcomingLimit?: number;
  /** Currently selected bucket id (past only — live/upcoming ignore this). */
  selectedBucketId?: string | null;
  /** Callback when user clicks a bucket. `null` means "back to live". */
  onBucketClick?: (bucket: PredictionMarket | null) => void;
}

/**
 * Polymarket-style horizontal timeline of a symbol's rounds:
 * past (settled, oldest first) → live → upcoming (soonest first). Auto
 * refreshes on MARKET_RESOLVED or NEW_MARKET WS events.
 */
export default function SymbolTimeline({
  symbol,
  pastLimit = 5,
  upcomingLimit = 4,
  selectedBucketId,
  onBucketClick,
}: Props) {
  const { series, loading } = useMarketSeries(symbol, pastLimit);
  const scrollRef = useRef<HTMLDivElement>(null);

  const liveId = series?.live?.id;

  // Auto-scroll to live pill whenever series refreshes so the user always sees
  // the "now" column even if they've scrolled through history.
  useEffect(() => {
    if (!scrollRef.current || !liveId) return;
    const liveEl = scrollRef.current.querySelector<HTMLElement>(`[data-bucket-id="${liveId}"]`);
    if (liveEl) {
      liveEl.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
  }, [liveId]);

  if (loading && !series) {
    return (
      <div className="px-5 py-2">
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 w-[88px] rounded-lg bg-white/[0.03] animate-pulse shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (!series) return null;

  const past = series.past.slice(-pastLimit);
  const upcoming = series.upcoming.slice(0, upcomingLimit);
  const hasAny = past.length > 0 || series.live || upcoming.length > 0;
  if (!hasAny) return null;

  return (
    <div className="px-5 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-white/20 text-[9px] uppercase tracking-widest">Rounds</p>
        {selectedBucketId && (
          <button
            type="button"
            onClick={() => onBucketClick?.(null)}
            className="text-[9px] uppercase tracking-widest text-[#dc3246] hover:text-red-400 flex items-center gap-1"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#dc3246] animate-pulse" />
            Back to Live
          </button>
        )}
      </div>
      <div
        ref={scrollRef}
        className="flex flex-nowrap gap-1.5 pb-1 -mx-5 px-5 overflow-x-auto touch-pan-x [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {past.map((m) => (
          <div key={m.id} data-bucket-id={m.id} className="shrink-0">
            <BucketPill
              market={m}
              variant="past"
              active={selectedBucketId === m.id}
              onClick={() => onBucketClick?.(m)}
            />
          </div>
        ))}
        {series.live && (
          <div key={series.live.id} data-bucket-id={series.live.id} className="shrink-0">
            <BucketPill
              market={series.live}
              variant="live"
              onClick={() => onBucketClick?.(null)}
            />
          </div>
        )}
        {upcoming.map((m) => (
          <div key={m.id} data-bucket-id={m.id} className="shrink-0">
            <BucketPill market={m} variant="upcoming" />
          </div>
        ))}
      </div>
    </div>
  );
}
