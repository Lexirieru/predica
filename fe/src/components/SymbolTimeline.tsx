"use client";

import { useEffect, useRef, useCallback } from "react";
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

  // Mouse drag-to-scroll for desktop. Mobile users get native pan-x via
  // touch-pan-x on the scroller — this handler only activates for mouse
  // pointers. The parent SwipeStack card has framer-motion drag="y", and
  // pointerdown here would otherwise bubble up and start a vertical drag
  // on the card, so we stop propagation on any pointerdown inside the
  // timeline. That severs the gesture from framer-motion but keeps the
  // click listeners on BucketPill working (click fires separately).
  const dragState = useRef<{ active: boolean; startX: number; startScroll: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.pointerType !== "mouse") return; // touch/pen use native scroll
    if (!scrollRef.current) return;
    dragState.current = {
      active: true,
      startX: e.clientX,
      startScroll: scrollRef.current.scrollLeft,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragState.current;
    if (!s?.active || !scrollRef.current) return;
    const dx = e.clientX - s.startX;
    scrollRef.current.scrollLeft = s.startScroll - dx;
  }, []);

  const handlePointerUp = useCallback(() => {
    if (dragState.current) dragState.current.active = false;
  }, []);

  // Wheel → horizontal scroll on desktop. MUST be a native listener (not
  // React onWheel) because React synthetic event.stopPropagation doesn't
  // stop native listeners on ancestors — SwipeStack attaches its wheel
  // handler via addEventListener, so synthetic stopPropagation wouldn't
  // prevent card-advance. Native listener + native stopPropagation works.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return; // nothing to scroll
      e.stopPropagation();
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

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
            <div key={i} className="h-10 w-[88px] rounded-lg bg-white/3 animate-pulse shrink-0" />
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
    // Wrapper has relative + mask to fade out overflowing pills on the right
    // edge. Without it, the last pill gets cut in half at the card border.
    <div
      className="px-5 py-2 relative"
      style={{
        maskImage:
          "linear-gradient(to right, black 0, black calc(100% - 28px), transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to right, black 0, black calc(100% - 28px), transparent 100%)",
      }}
    >
      {selectedBucketId && (
        <div className="flex justify-end mb-1.5">
          <button
            type="button"
            onClick={() => onBucketClick?.(null)}
            className="text-[10px] text-white/40 hover:text-white/70 flex items-center gap-1 transition-colors"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#dc3246] animate-pulse" />
            Back to Live
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex flex-nowrap gap-1.5 pb-1 -mx-5 px-5 overflow-x-auto touch-pan-x select-none [&::-webkit-scrollbar]:hidden"
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
