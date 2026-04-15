"use client";

import { create } from "zustand";
import type { Candle } from "@/lib/types";
import { fetchCandleSeries } from "@/lib/api";

interface CandleState {
  candles: Record<string, Candle[]>; // symbol → candle array (oldest→newest)
  loading: Record<string, boolean>;
  /** Seed candles for a symbol from BE REST. Idempotent: skips if already
   * loaded or a fetch is in-flight. */
  fetchCandles: (symbol: string) => Promise<void>;
  /** Mutate the in-memory cache from a CANDLE_UPDATE WS frame. No-op for
   * symbols we haven't fetched yet — avoids buffering state for every symbol
   * that crosses the wire. */
  upsertCandle: (symbol: string, candle: Candle) => void;
  /** Drop cache on sign-out or manual reset. */
  clear: () => void;
}

const MAX_CANDLES = 60; // cap per symbol to bound memory

export const useCandleStore = create<CandleState>((set, get) => ({
  candles: {},
  loading: {},

  fetchCandles: async (rawSymbol) => {
    const symbol = rawSymbol.toUpperCase();
    const state = get();
    if (state.loading[symbol] || state.candles[symbol]?.length) return;

    set((s) => ({ loading: { ...s.loading, [symbol]: true } }));

    try {
      const series = await fetchCandleSeries(symbol, "1h");
      const trimmed = series.length >= 2 ? series.slice(-MAX_CANDLES) : series;
      set((s) => ({
        candles: { ...s.candles, [symbol]: trimmed },
        loading: { ...s.loading, [symbol]: false },
      }));
    } catch {
      set((s) => ({ loading: { ...s.loading, [symbol]: false } }));
    }
  },

  upsertCandle: (rawSymbol, candle) => {
    const symbol = rawSymbol.toUpperCase();
    set((s) => {
      const existing = s.candles[symbol];
      // Never buffer for a symbol we haven't hydrated yet — reader doesn't
      // care and we'd leak memory on every symbol the WS emits.
      if (!existing) return {};
      const last = existing[existing.length - 1];
      let next: Candle[];
      if (last && last.time === candle.time) {
        // Same bucket forming — replace last.
        next = [...existing.slice(0, -1), candle];
      } else {
        next = [...existing, candle];
        if (next.length > MAX_CANDLES) next = next.slice(-MAX_CANDLES);
      }
      return { candles: { ...s.candles, [symbol]: next } };
    });
  },

  clear: () => set({ candles: {}, loading: {} }),
}));
