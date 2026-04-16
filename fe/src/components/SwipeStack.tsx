"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { PredictionMarket } from "@/lib/types";
import { useStore } from "@/store/useStore";
import { prefetchCandles } from "@/hooks/useCandlesFor";
import MarketCard from "./MarketCard";

const SWIPE_THRESHOLD = 80;

const variants = {
  enter: (direction: number) => ({
    transform: direction > 0 ? "translateY(40%) scale(0.95)" : "translateY(-40%) scale(0.95)",
    opacity: 0,
  }),
  center: {
    transform: "translateY(0%) scale(1)",
    opacity: 1,
  },
  exit: (direction: number) => ({
    transform: direction > 0 ? "translateY(-30%) scale(0.97)" : "translateY(30%) scale(0.97)",
    opacity: 0,
  }),
};

export default function SwipeStack({
  markets,
  onAdvance,
}: {
  markets: PredictionMarket[];
  /** Advance the whole feed from settled to live (one click = all cards). */
  onAdvance?: () => void;
}) {
  const currentMarketIndex = useStore((s) => s.currentMarketIndex);
  const setCurrentMarketIndex = useStore((s) => s.setCurrentMarketIndex);
  const [direction, setDirection] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // Fix from fe-swipenit: lock transitions to prevent rapid-fire from trackpad
  const canTransition = useRef(true);
  // Track by symbol so the user stays on the same symbol when its bucket
  // rotates (settled → next active 5m bucket has a different market.id but
  // same symbol). Tracking by id alone would cause the index to jump to 0
  // every 5min when the bucket rotates.
  // Track by (symbol + durationMin) so the user stays on the same card when
  // its bucket rotates. Different durations for the same symbol are distinct
  // cards, so symbol alone is not enough to identify the card.
  const currentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (markets.length === 0) return;
    const currentKey = currentKeyRef.current;
    if (currentKey) {
      const newIdx = markets.findIndex((m) => `${m.symbol}:${m.durationMin}` === currentKey);
      if (newIdx >= 0 && newIdx !== currentMarketIndex) {
        setCurrentMarketIndex(newIdx);
      }
    }
  }, [markets, currentMarketIndex, setCurrentMarketIndex]);

  const goTo = useCallback(
    (dir: number) => {
      if (!canTransition.current) return;
      canTransition.current = false;
      const nextIndex = dir > 0
        ? (currentMarketIndex + 1) % markets.length
        : (currentMarketIndex - 1 + markets.length) % markets.length;
      setDirection(dir);
      setCurrentMarketIndex(nextIndex);
    },
    [currentMarketIndex, markets.length, setCurrentMarketIndex]
  );

  // Fix from fe-swipenit: proper wheel handling with accumulation
  // Trackpad 2-finger scroll fires many small deltaY events.
  // Accumulate them and only fire once per gesture.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let accumulated = 0;
    let fired = false;
    let idleTimer: ReturnType<typeof setTimeout>;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fired = false;
        accumulated = 0;
      }, 150);

      if (fired) return;

      accumulated += e.deltaY;

      if (Math.abs(accumulated) > 60) {
        goTo(accumulated > 0 ? 1 : -1);
        fired = true;
        accumulated = 0;
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
      clearTimeout(idleTimer);
    };
  }, [goTo]);

  const handleDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const { offset, velocity } = info;
      if (offset.y < -SWIPE_THRESHOLD || velocity.y < -300) {
        goTo(1);
      } else if (offset.y > SWIPE_THRESHOLD || velocity.y > 300) {
        goTo(-1);
      }
    },
    [goTo]
  );

  // Prefetch candles for neighbors (1 ahead, 1 behind, wrap) so a swipe
  // lands on a card that already has data. Store dedupes — safe to over-call.
  useEffect(() => {
    if (markets.length === 0) return;
    const idx = currentMarketIndex < markets.length ? currentMarketIndex : 0;
    const prev = markets[(idx - 1 + markets.length) % markets.length];
    const next = markets[(idx + 1) % markets.length];
    if (prev) prefetchCandles(prev.symbol);
    if (next) prefetchCandles(next.symbol);
  }, [markets, currentMarketIndex]);

  if (markets.length === 0) return null;

  const safeIndex = currentMarketIndex < markets.length ? currentMarketIndex : 0;
  const market = markets[safeIndex];
  currentKeyRef.current = `${market.symbol}:${market.durationMin}`;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      role="feed"
      aria-label="Prediction markets feed"
    >
      <AnimatePresence
        initial={false}
        custom={direction}
        mode="popLayout"
        onExitComplete={() => {
          canTransition.current = true;
        }}
      >
        <motion.div
          // Key by symbol (not market.id) so bucket rotation within the same
          // symbol (settled 8:30 → active 8:35) doesn't retrigger the swipe
          // enter/exit animation. Swiping to a different symbol still animates
          // because the key changes.
          key={`${market.symbol}:${market.durationMin}`}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            transform: { type: "spring", stiffness: 300, damping: 30 },
            opacity: { duration: 0.15, ease: [0.23, 1, 0.32, 1] },
          }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.4}
          onDragEnd={handleDragEnd}
          className="absolute inset-0 p-3 touch-pan-x"
        >
          <MarketCard market={market} onAdvance={onAdvance} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
