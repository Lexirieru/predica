"use client";

import { useEffect } from "react";
import type { Candle } from "@/lib/types";
import { useCandleStore } from "@/store/useCandleStore";

/**
 * Load candles for a single symbol on mount (or when `enabled` flips true),
 * and subscribe to live updates from the store. Returns the cached series.
 *
 * Designed for per-card rendering: the card that's visible calls this with
 * enabled=true; neighbors that are just being prefetched can use the
 * prefetch helper below without mounting a full hook.
 */
export function useCandlesFor(symbol: string, enabled: boolean = true): {
  candles: Candle[];
  loading: boolean;
} {
  const candles = useCandleStore((s) => s.candles[symbol.toUpperCase()]);
  const loading = useCandleStore((s) => s.loading[symbol.toUpperCase()] ?? false);
  const fetchCandles = useCandleStore((s) => s.fetchCandles);

  useEffect(() => {
    if (!enabled || !symbol) return;
    fetchCandles(symbol);
  }, [symbol, enabled, fetchCandles]);

  return { candles: candles ?? [], loading };
}

/**
 * Imperative prefetch — useful from SwipeStack to warm neighbors without
 * committing to a full render. Calling many times is safe: store dedupes.
 */
export function prefetchCandles(symbol: string) {
  useCandleStore.getState().fetchCandles(symbol);
}
